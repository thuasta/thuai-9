import logging
import os
import shutil
import time
import zipfile
from typing import Callable

import docker

from config import settings

logger = logging.getLogger(__name__)
_docker_client = None
MAX_COMPILE_LOG_BYTES = 128 * 1024


def get_docker():
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.from_env()
    return _docker_client


def _extract_zip_direct(zip_path: str, dest_dir: str) -> list[str]:
    with zipfile.ZipFile(zip_path) as zf:
        file_paths = [n for n in zf.namelist() if n and not n.endswith("/")]
        if not file_paths:
            raise ValueError("压缩包为空，未找到可用文件")
        # Extract exactly as archived, then build from zip root context.
        zf.extractall(dest_dir)
        return file_paths


def _ensure_root_dockerfile(file_paths: list[str]) -> str:
    if not file_paths:
        raise ValueError("压缩包为空，未找到可用文件")
    if "Dockerfile" not in file_paths:
        raise ValueError("压缩包根目录必须包含Dockerfile")
    return "Dockerfile"


def _build_log_text(log_entries) -> str:
    lines: list[str] = []
    for entry in log_entries or []:
        chunk = _build_log_chunk(entry)
        if chunk:
            lines.append(chunk)
    return "".join(lines).strip()


def _build_log_chunk(entry) -> str:
    if not isinstance(entry, dict):
        return ""
    if entry.get("stream"):
        return str(entry["stream"])
    if entry.get("errorDetail", {}).get("message"):
        return str(entry["errorDetail"]["message"])
    if entry.get("error"):
        return str(entry["error"])
    return ""


def _normalize_compile_log(text: str, success: bool) -> str:
    text = text.strip()
    if not text:
        text = "编译成功（无输出）" if success else "编译失败（无输出）"
    if len(text) > MAX_COMPILE_LOG_BYTES:
        dropped = len(text) - MAX_COMPILE_LOG_BYTES
        text = f"... [前 {dropped} 字节已省略] ...\n" + text[-MAX_COMPILE_LOG_BYTES:]
    return text


def _normalize_progress_log(text: str) -> str:
    text = text.strip()
    if not text:
        text = "编译中..."
    if len(text) > MAX_COMPILE_LOG_BYTES:
        dropped = len(text) - MAX_COMPILE_LOG_BYTES
        text = f"... [前 {dropped} 字节已省略] ...\n" + text[-MAX_COMPILE_LOG_BYTES:]
    return text


def compile_submission(
    submission_id: int,
    on_progress: Callable[[str], None] | None = None,
) -> tuple[bool, str, str | None]:
    """Build submission image from zip Dockerfile.

    Returns ``(success, error_log, image_ref)``.
    """
    build_dir = os.path.join(settings.match_data_dir, "build", str(submission_id))
    context_dir = os.path.join(build_dir, "context")
    zip_path = os.path.join(settings.upload_dir, f"{submission_id}.zip")
    artifact_dir = os.path.join(settings.artifact_dir, str(submission_id))
    image_ref = f"thuai9-submission-{submission_id}:latest"

    shutil.rmtree(build_dir, ignore_errors=True)
    shutil.rmtree(artifact_dir, ignore_errors=True)
    os.makedirs(context_dir, exist_ok=True)
    try:
        extracted_files = _extract_zip_direct(zip_path, context_dir)
    except Exception as exc:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, f"解压失败: {exc}", None

    try:
        dockerfile_relpath = _ensure_root_dockerfile(extracted_files)
    except ValueError as exc:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, str(exc), None

    build_context_dir = context_dir
    dockerfile_name = dockerfile_relpath
    dockerfile_path = os.path.join(build_context_dir, dockerfile_name)
    if not os.path.isfile(dockerfile_path):
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, f"未找到 Dockerfile: {dockerfile_relpath}", None

    client = get_docker()
    try:
        build_logs = client.api.build(
            path=build_context_dir,
            dockerfile=dockerfile_name,
            tag=image_ref,
            rm=True,
            forcerm=True,
            decode=True,
        )
    except docker.errors.APIError as exc:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, _normalize_compile_log(str(exc), False), None
    except Exception as exc:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, _normalize_compile_log(str(exc), False), None

    log_entries: list[dict] = []
    last_emit = 0.0

    if on_progress is not None:
        on_progress("编译中...")

    try:
        for entry in build_logs:
            chunk = _build_log_chunk(entry)
            if chunk:
                log_entries.append(entry)
                if on_progress is not None:
                    now = time.monotonic()
                    has_error = bool(entry.get("error") or entry.get("errorDetail"))
                    if has_error or now - last_emit >= 0.5:
                        on_progress(_normalize_progress_log(_build_log_text(log_entries)))
                        last_emit = now

            if entry.get("error") or entry.get("errorDetail"):
                shutil.rmtree(build_dir, ignore_errors=True)
                compile_log = _build_log_text(log_entries)
                return False, _normalize_compile_log(compile_log, False), None
    except docker.errors.APIError as exc:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, _normalize_compile_log(str(exc), False), None
    except Exception as exc:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, _normalize_compile_log(str(exc), False), None

    os.makedirs(artifact_dir, exist_ok=True)
    with open(os.path.join(artifact_dir, "image_ref.txt"), "w", encoding="utf-8") as f:
        f.write(image_ref)

    compile_log = _normalize_compile_log(_build_log_text(log_entries), True)
    shutil.rmtree(build_dir, ignore_errors=True)
    return True, compile_log, image_ref
