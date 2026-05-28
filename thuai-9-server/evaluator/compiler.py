import logging
import os
import shutil
import zipfile

import docker

from config import settings

logger = logging.getLogger(__name__)
_docker_client = None


def get_docker():
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.from_env()
    return _docker_client


def compile_cpp(submission_id: int) -> tuple[bool, str]:
    """Compile a C++ submission. Returns (success, error_log)."""
    build_dir = os.path.join(settings.match_data_dir, "build", str(submission_id))
    src_dir = os.path.join(build_dir, "src")
    zip_path = os.path.join(settings.upload_dir, f"{submission_id}.zip")

    os.makedirs(src_dir, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(src_dir)
    except Exception as e:
        return False, f"解压失败: {e}"

    client = get_docker()
    try:
        container = client.containers.run(
            image="ghcr.io/thuasta/thuai-9-sdk-cpp:latest",
            command="bash -c 'cd /build && xmake f -m release -y --root && xmake --root'",
            volumes={build_dir: {"bind": "/build", "mode": "rw"}},
            network_disabled=True,
            mem_limit="512m",
            nano_cpus=1_000_000_000,
            remove=True,
            stdout=True,
            stderr=True,
        )
        output = container.decode("utf-8", errors="replace") if isinstance(container, bytes) else ""
    except docker.errors.ContainerError as e:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, e.stderr.decode("utf-8", errors="replace") if e.stderr else str(e)
    except Exception as e:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, str(e)

    # Look for compiled binary
    binary_candidates = [
        os.path.join(build_dir, "bin", "agent"),
        os.path.join(build_dir, "build", "linux", "x86_64", "release", "agent"),
    ]
    binary_path = next((p for p in binary_candidates if os.path.isfile(p)), None)

    if binary_path is None:
        # Try to find any executable named 'agent'
        for root, _, files in os.walk(build_dir):
            for fname in files:
                if fname == "agent":
                    binary_path = os.path.join(root, fname)
                    break
            if binary_path:
                break

    if binary_path is None:
        shutil.rmtree(build_dir, ignore_errors=True)
        return False, f"编译完成但未找到 agent 可执行文件\n{output}"

    artifact_dir = os.path.join(settings.artifact_dir, str(submission_id))
    os.makedirs(artifact_dir, exist_ok=True)
    shutil.copy2(binary_path, os.path.join(artifact_dir, "agent"))
    os.chmod(os.path.join(artifact_dir, "agent"), 0o755)
    shutil.rmtree(build_dir, ignore_errors=True)
    return True, ""


def compile_python(submission_id: int) -> tuple[bool, str]:
    """Validate and store a Python submission. Returns (success, error_log)."""
    zip_path = os.path.join(settings.upload_dir, f"{submission_id}.zip")
    artifact_dir = os.path.join(settings.artifact_dir, str(submission_id))

    os.makedirs(artifact_dir, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(artifact_dir)
    except Exception as e:
        shutil.rmtree(artifact_dir, ignore_errors=True)
        return False, f"解压失败: {e}"

    if not os.path.isfile(os.path.join(artifact_dir, "main.py")):
        shutil.rmtree(artifact_dir, ignore_errors=True)
        return False, "未找到 main.py"

    return True, ""
