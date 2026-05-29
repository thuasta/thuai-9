from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import os
import shutil
import time

from compiler import get_docker
from config import settings

logger = logging.getLogger(__name__)

GAME_TIMEOUT_SECONDS = 360
POLL_INTERVAL = 1
MANAGED_AGENT_LABEL = "thuai9.managed"
MANAGED_AGENT_VALUE = "evaluator-agent"


@dataclass(frozen=True)
class MatchAgent:
    submission_id: int
    team_id: int
    image_ref: str
    token: str


def _spawn_agent(client, match_id: int, agent: MatchAgent):
    if not agent.image_ref:
        raise ValueError(f"submission {agent.submission_id} missing image reference")

    return client.containers.run(
        image=agent.image_ref,
        environment={
            "TOKEN": agent.token,
            "SERVER": settings.live_server_url,
        },
        network=settings.live_server_network,
        mem_limit="256m",
        nano_cpus=500_000_000,
        labels={
            MANAGED_AGENT_LABEL: MANAGED_AGENT_VALUE,
            "thuai9.match_id": str(match_id),
            "thuai9.submission_id": str(agent.submission_id),
        },
        detach=True,
        remove=False,
    )


def _prepare_live_server_config_dir() -> str:
    config_dir = os.path.join(settings.match_data_dir, "live-server-config")
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "config.json")

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "game": {
                    # Allow arena matches to start even when only one
                    # dispatched ready submission is available.
                    "minimumPlayerCount": 1,
                }
            },
            f,
            ensure_ascii=False,
        )

    return config_dir


def _start_live_server(client, tokens: list[str]):
    if not settings.restart_live_server:
        return None

    try:
        old_server = client.containers.get(settings.live_server_container)
        old_server.remove(force=True)
    except Exception:
        pass

    logger.info(
        "Starting live game server container %s with %d players",
        settings.live_server_container,
        len(tokens),
    )
    config_dir = _prepare_live_server_config_dir()
    server = client.containers.run(
        image=settings.live_server_image,
        name=settings.live_server_container,
        entrypoint=["./server"],
        environment={"TOKENS": ",".join(tokens)},
        labels={
            "thuai9.managed": "live-server",
        },
        volumes={
            settings.live_server_data_dir: {"bind": "/app/data", "mode": "rw"},
            config_dir: {"bind": "/app/config", "mode": "ro"},
        },
        network=settings.live_server_network,
        detach=True,
        remove=False,
    )

    deadline = time.time() + 20
    while time.time() < deadline:
        server.reload()
        if server.status == "running":
            return server
        time.sleep(0.5)

    raise RuntimeError(f"live server {settings.live_server_container} did not become running")


def cleanup_runtime_containers() -> None:
    client = get_docker()

    try:
        old_server = client.containers.get(settings.live_server_container)
        old_server.remove(force=True)
        logger.info("Removed stale live game server container %s", settings.live_server_container)
    except Exception:
        pass

    try:
        stale_agents = client.containers.list(
            all=True,
            filters={"label": f"{MANAGED_AGENT_LABEL}={MANAGED_AGENT_VALUE}"},
        )
    except Exception:
        logger.exception("Failed to list stale agent containers")
        return

    for container in stale_agents:
        try:
            container.remove(force=True)
            logger.info("Removed stale agent container %s", container.name)
        except Exception:
            logger.exception("Failed to remove stale agent container %s", container.name)


def _read_result(result_path: str) -> dict[str, int] | None:
    if not os.path.isfile(result_path):
        return None

    try:
        with open(result_path, encoding="utf-8") as f:
            result = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None

    scores = result.get("scores")
    if not isinstance(scores, dict):
        return None

    parsed: dict[str, int] = {}
    for token, score in scores.items():
        try:
            parsed[str(token)] = int(score)
        except (TypeError, ValueError):
            continue
    return parsed


def _collect_agent_logs(containers) -> str:
    snippets: list[str] = []
    for container in containers:
        try:
            logs = container.logs(tail=80).decode("utf-8", errors="replace").strip()
        except Exception as exc:
            logs = f"<failed to read logs: {exc}>"
        if logs:
            snippets.append(f"== {container.name} ==\n{logs}")
    return "\n\n".join(snippets)


# Cap per-agent log to a fixed size before persisting so a runaway agent can't
# explode the database. Matches what the portal will display anyway.
PER_AGENT_LOG_BYTES = 64 * 1024
# Bound how many lines we pull out of Docker into evaluator memory in the first
# place — a runaway agent can emit gigabytes, but we only keep the tail anyway.
LOG_TAIL_LINES = 5000


def _read_container_log(container) -> str:
    try:
        raw = container.logs(stdout=True, stderr=True, tail=LOG_TAIL_LINES)
    except Exception as exc:
        return f"<failed to read logs: {exc}>"
    text = raw.decode("utf-8", errors="replace")
    if len(text) > PER_AGENT_LOG_BYTES:
        truncated = len(text) - PER_AGENT_LOG_BYTES
        text = f"... [truncated {truncated} bytes] ...\n" + text[-PER_AGENT_LOG_BYTES:]
    return text


def run_match(
    match_id: int, agents: list[MatchAgent]
) -> tuple[dict[int, int] | None, str, dict[int, str]]:
    """Run all ready submissions in one live arena game.

    Returns ``(scores, error_log, agent_logs)`` where ``agent_logs`` maps
    each submission id to the captured stdout+stderr of that agent's
    container. ``agent_logs`` is populated regardless of outcome so the
    portal can show teams their own output even on success.
    """
    if not agents:
        return None, "没有可参赛的 ready 提交", {}

    client = get_docker()
    data_dir = settings.live_server_data_dir
    result_path = os.path.join(data_dir, "result.json")
    os.makedirs(data_dir, exist_ok=True)

    try:
        os.remove(result_path)
    except FileNotFoundError:
        pass

    containers = []
    server = None
    # Indexed by submission_id so callers can persist per-team logs even when
    # an exception forces an early return.
    container_by_submission: dict[int, object] = {}
    agent_logs: dict[int, str] = {}

    def _snapshot_logs() -> dict[int, str]:
        return {
            sub_id: _read_container_log(container)
            for sub_id, container in container_by_submission.items()
        }

    try:
        agent_tokens = [agent.token for agent in agents]
        server = _start_live_server(client, agent_tokens)

        # Give the WebSocket listener a short moment to bind after start.
        time.sleep(2)

        for agent in agents:
            container = _spawn_agent(client, match_id, agent)
            containers.append(container)
            container_by_submission[agent.submission_id] = container
            logger.info(
                "Spawned agent for match %d: submission=%d team=%d token=%s",
                match_id,
                agent.submission_id,
                agent.team_id,
                agent.token,
            )

        expected_tokens = {agent.token for agent in agents}
        token_to_submission = {agent.token: agent.submission_id for agent in agents}
        deadline = time.time() + GAME_TIMEOUT_SECONDS
        latest_complete_scores: dict[str, int] | None = None

        while time.time() < deadline:
            scores = _read_result(result_path)
            if scores is not None:
                missing = sorted(expected_tokens - scores.keys())
                if not missing:
                    latest_complete_scores = scores

            if server is None:
                if latest_complete_scores is not None:
                    agent_logs = _snapshot_logs()
                    return _scores_by_submission(latest_complete_scores, token_to_submission), "", agent_logs
            else:
                server.reload()
                if server.status in {"exited", "dead"}:
                    agent_logs = _snapshot_logs()
                    if latest_complete_scores is not None:
                        return _scores_by_submission(latest_complete_scores, token_to_submission), "", agent_logs
                    return None, "游戏服已结束，但未写出完整结果", agent_logs
            time.sleep(POLL_INTERVAL)

        latest_scores = _read_result(result_path) or {}
        missing = sorted(expected_tokens - latest_scores.keys())
        log_suffix = _collect_agent_logs(containers)
        agent_logs = _snapshot_logs()
        details = f"比赛超时，缺少结果 token: {', '.join(missing) if missing else '无'}"
        if latest_scores:
            details += f"\n已收到结果: {latest_scores}"
        if log_suffix:
            details += f"\n\n{log_suffix}"
        return None, details, agent_logs

    except Exception as exc:
        logger.exception("Match %d failed", match_id)
        log_suffix = _collect_agent_logs(containers)
        agent_logs = _snapshot_logs()
        return None, f"{exc}\n\n{log_suffix}".strip(), agent_logs

    finally:
        if server is not None:
            try:
                server.stop(timeout=5)
            except Exception:
                pass
            try:
                server.remove(force=True)
            except Exception:
                pass

        for container in containers:
            try:
                container.stop(timeout=5)
            except Exception:
                pass
            try:
                container.remove(force=True)
            except Exception:
                pass

        shutil.rmtree(os.path.join(settings.match_data_dir, str(match_id)), ignore_errors=True)


def _scores_by_submission(
    scores: dict[str, int],
    token_to_submission: dict[str, int],
) -> dict[int, int]:
    return {
        token_to_submission[token]: score
        for token, score in scores.items()
        if token in token_to_submission
    }
