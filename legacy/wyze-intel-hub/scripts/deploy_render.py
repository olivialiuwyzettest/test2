#!/usr/bin/env python3
"""Deploy the Wyze Intel Hub to Render via the public API.

Required env vars:
- RENDER_API_KEY

Optional env vars:
- RENDER_OWNER_ID
- RENDER_OWNER_NAME
- RENDER_SERVICE_NAME (default: wyze-intel-hub)
- RENDER_REGION (default: oregon)
- RENDER_PLAN (default: free)
- RENDER_IMAGE_PATH (default: mcr.microsoft.com/devcontainers/python:3.11)
- RENDER_HEALTH_PATH (default: /healthz)
- RENDER_POLL_SECONDS (default: 10)
- RENDER_DEPLOY_TIMEOUT_SECONDS (default: 1800)
"""

from __future__ import annotations

import base64
import io
import json
import os
import tarfile
import time
from pathlib import Path
from typing import Any

import requests

RENDER_API_BASE = "https://api.render.com/v1"
# Note: Docker Hub pulls can intermittently fail due to upstream rate-limits/outages.
# MCR tends to be more reliable for anonymous pulls from Render.
DEFAULT_IMAGE_PATH = "mcr.microsoft.com/devcontainers/python:3.11"

EXCLUDE_DIRS = {
    ".git",
    ".runtime",
    ".venv",
    "__pycache__",
    "docs",
}
EXCLUDE_FILES = {
    "intel.db",
    ".DS_Store",
}


def _get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _should_exclude(path: Path) -> bool:
    parts = set(path.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if path.name in EXCLUDE_FILES:
        return True
    if path.suffix in {".pyc", ".pyo"}:
        return True
    return False


def _build_source_archive(repo_root: Path) -> bytes:
    required_paths = [repo_root / "app", repo_root / "requirements.txt"]
    for p in required_paths:
        if not p.exists():
            raise RuntimeError(f"Expected path missing: {p}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        # Keep the deploy payload small: only ship the runtime app + requirements.
        # (This repo may contain other large folders like node_modules.)
        include_roots = [repo_root / "app", repo_root / "requirements.txt"]

        for root in include_roots:
            if root.is_file():
                rel = root.relative_to(repo_root)
                arcname = Path("wyze-intel-hub") / rel
                tar.add(root, arcname=str(arcname))
                continue

            for path in sorted(root.rglob("*")):
                rel = path.relative_to(repo_root)
                if _should_exclude(rel):
                    continue
                if path.is_dir():
                    continue
                arcname = Path("wyze-intel-hub") / rel
                tar.add(path, arcname=str(arcname))
    return buf.getvalue()


class RenderClient:
    def __init__(self, api_key: str):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    def _request(self, method: str, path: str, *, params: dict | None = None, payload: dict | None = None) -> Any:
        url = f"{RENDER_API_BASE}{path}"
        resp = self.session.request(method, url, params=params, data=json.dumps(payload) if payload else None, timeout=60)
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Render API {method} {path} failed [{resp.status_code}]: {resp.text[:500]}"
            )
        if not resp.content:
            return None
        return resp.json()

    def list_owners(self) -> list[dict]:
        rows = self._request("GET", "/owners")
        owners: list[dict] = []
        for row in rows:
            owner = (row or {}).get("owner") or {}
            if owner:
                owners.append(owner)
        return owners

    def list_services(self, owner_id: str, name: str | None = None) -> list[dict]:
        params: dict[str, str] = {"ownerId": owner_id, "limit": "100"}
        if name:
            params["name"] = name
        rows = self._request("GET", "/services", params=params)
        services: list[dict] = []
        for row in rows:
            service = (row or {}).get("service") or {}
            if service:
                services.append(service)
        return services

    def create_service(self, payload: dict) -> dict:
        return self._request("POST", "/services", payload=payload)

    def update_service(self, service_id: str, payload: dict) -> dict:
        return self._request("PATCH", f"/services/{service_id}", payload=payload)

    def trigger_deploy(self, service_id: str) -> dict:
        return self._request("POST", f"/services/{service_id}/deploys", payload={})

    def list_deploys(self, service_id: str, *, limit: int = 20) -> list[dict]:
        rows = self._request("GET", f"/services/{service_id}/deploys", params={"limit": str(limit)})
        deploys: list[dict] = []
        for row in rows or []:
            deploy = (row or {}).get("deploy") or {}
            if deploy:
                deploys.append(deploy)
        return deploys

    def get_deploy(self, service_id: str, deploy_id: str) -> dict:
        return self._request("GET", f"/services/{service_id}/deploys/{deploy_id}")

    def get_service(self, service_id: str) -> dict:
        return self._request("GET", f"/services/{service_id}")

    def upsert_env_var(self, service_id: str, key: str, value: str) -> dict:
        return self._request(
            "PUT",
            f"/services/{service_id}/env-vars/{key}",
            payload={"value": value},
        )


def _pick_owner_id(client: RenderClient) -> str:
    explicit = os.getenv("RENDER_OWNER_ID", "").strip()
    if explicit:
        return explicit

    owners = client.list_owners()
    if not owners:
        raise RuntimeError("No Render owners/workspaces found for this API key")

    owner_name = os.getenv("RENDER_OWNER_NAME", "").strip().lower()
    if owner_name:
        for owner in owners:
            if str(owner.get("name", "")).strip().lower() == owner_name:
                return str(owner["id"])
        available = ", ".join(str(o.get("name")) for o in owners)
        raise RuntimeError(f"RENDER_OWNER_NAME='{owner_name}' not found. Available owners: {available}")

    if len(owners) == 1:
        return str(owners[0]["id"])

    summary = "; ".join(f"{o.get('name')} ({o.get('id')})" for o in owners)
    raise RuntimeError(
        "Multiple owners found. Set RENDER_OWNER_ID or RENDER_OWNER_NAME. "
        f"Available: {summary}"
    )


def _build_bootstrap_command() -> str:
    py_bootstrap = (
        "o=__import__('os');"
        "s=__import__('sys');"
        "b64=__import__('base64');"
        "t=__import__('tarfile');"
        "sp=__import__('subprocess');"
        "p=__import__('pathlib');"
        "d=b64.b64decode(o.environ['APP_ARCHIVE_B64']);"
        "b=p.Path('/opt/wyze');"
        "b.mkdir(parents=True,exist_ok=True);"
        "g=b/'src.tgz';"
        "g.write_bytes(d);"
        "t.open(g,'r:gz').extractall(b);"
        "r=b/'wyze-intel-hub';"
        "sp.check_call([s.executable,'-m','pip','install','--no-cache-dir','-r',str(r/'requirements.txt')]);"
        "o.chdir(r);"
        "o.execvp(s.executable,[s.executable,'-m','uvicorn','app.main:app','--host','0.0.0.0','--port',o.getenv('PORT','10000')])"
    )
    return f"python -c{py_bootstrap}"


def _base_env_vars(archive_b64: str) -> list[dict[str, str]]:
    return [
        {"key": "TIMEZONE", "value": "America/Los_Angeles"},
        {"key": "RUN_REFRESH_ON_STARTUP", "value": "true"},
        {"key": "DAILY_REFRESH_HOUR", "value": "6"},
        {"key": "DAILY_REFRESH_MINUTE", "value": "0"},
        {"key": "HIGH_ENGAGEMENT_SCORE", "value": "20"},
        {"key": "HIGH_ENGAGEMENT_COMMENTS", "value": "10"},
        {"key": "MAX_ITEMS_PER_QUERY", "value": "30"},
        {"key": "APP_ARCHIVE_B64", "value": archive_b64},
    ]


def _service_payload(
    owner_id: str,
    service_name: str,
    archive_b64: str,
    plan: str,
    region: str,
    health_path: str,
    image_path: str,
) -> dict:
    bootstrap_command = _build_bootstrap_command()
    return {
        "type": "web_service",
        "name": service_name,
        "ownerId": owner_id,
        "autoDeploy": "no",
        "image": {
            "ownerId": owner_id,
            "imagePath": image_path,
        },
        "envVars": _base_env_vars(archive_b64),
        "serviceDetails": {
            "runtime": "image",
            "region": region,
            "plan": plan,
            "healthCheckPath": health_path,
            "envSpecificDetails": {
                "dockerCommand": bootstrap_command,
            },
        },
    }


def _wait_for_deploy(client: RenderClient, service_id: str, deploy_id: str, timeout_seconds: int, poll_seconds: int) -> dict:
    terminal_success = {"live"}
    terminal_failure = {"build_failed", "update_failed", "canceled", "pre_deploy_failed"}

    deadline = time.time() + timeout_seconds
    last_status = ""
    while time.time() < deadline:
        deploy = client.get_deploy(service_id, deploy_id)
        status = str(deploy.get("status", "")).strip()
        if status and status != last_status:
            print(f"Deploy status: {status}")
            last_status = status

        if status in terminal_success:
            return deploy
        if status in terminal_failure:
            raise RuntimeError(f"Deploy failed with status: {status}")

        time.sleep(poll_seconds)

    raise TimeoutError(f"Timed out waiting for deploy {deploy_id}")


def _service_url(service: dict) -> str:
    details = service.get("serviceDetails") or {}
    return str(details.get("url") or service.get("dashboardUrl") or "")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    api_key = _get_required_env("RENDER_API_KEY")
    service_name = os.getenv("RENDER_SERVICE_NAME", "wyze-intel-hub").strip() or "wyze-intel-hub"
    region = os.getenv("RENDER_REGION", "oregon").strip() or "oregon"
    plan = os.getenv("RENDER_PLAN", "free").strip() or "free"
    health_path = os.getenv("RENDER_HEALTH_PATH", "/healthz").strip() or "/healthz"
    image_path = os.getenv("RENDER_IMAGE_PATH", DEFAULT_IMAGE_PATH).strip() or DEFAULT_IMAGE_PATH
    poll_seconds = int(os.getenv("RENDER_POLL_SECONDS", "10"))
    timeout_seconds = int(os.getenv("RENDER_DEPLOY_TIMEOUT_SECONDS", "1800"))

    client = RenderClient(api_key)
    owner_id = _pick_owner_id(client)
    print(f"Using owner/workspace: {owner_id}")

    print("Packaging source archive...")
    archive_bytes = _build_source_archive(repo_root)
    print(f"Archive size: {len(archive_bytes) / (1024 * 1024):.2f} MB")
    archive_b64 = base64.b64encode(archive_bytes).decode("ascii")
    print(f"Archive payload size (base64): {len(archive_b64)} chars")

    payload = _service_payload(owner_id, service_name, archive_b64, plan, region, health_path, image_path)

    existing = client.list_services(owner_id=owner_id, name=service_name)
    if existing:
        service = existing[0]
        service_id = str(service["id"])
        print(f"Updating existing service: {service_name} ({service_id})")

        for env_var in _base_env_vars(archive_b64):
            client.upsert_env_var(service_id, env_var["key"], env_var["value"])

        # Render's deploy trigger endpoint sometimes returns 202 with an empty body.
        # Capture the current latest deploy ID so we can detect the newly triggered deploy.
        prior_deploys = client.list_deploys(service_id, limit=1)
        prior_deploy_id = str(prior_deploys[0]["id"]) if prior_deploys else ""

        client.update_service(
            service_id,
            {
                "autoDeploy": "no",
                "image": payload["image"],
                "serviceDetails": payload["serviceDetails"],
                "name": service_name,
            },
        )

        deploy = client.trigger_deploy(service_id) or {}
        deploy_id = str(deploy.get("id") or "")

        if not deploy_id:
            # Poll until a new deploy appears (or time out).
            deadline = time.time() + 30
            while time.time() < deadline:
                latest = client.list_deploys(service_id, limit=1)
                if latest:
                    candidate = str(latest[0].get("id") or "")
                    if candidate and candidate != prior_deploy_id:
                        deploy_id = candidate
                        break
                time.sleep(1)
    else:
        print(f"Creating new service: {service_name}")
        created = client.create_service(payload)
        service = created.get("service") or {}
        service_id = str(service.get("id") or "")
        deploy_id = str(created.get("deployId") or "")

    if not service_id:
        raise RuntimeError("No service ID returned from Render API")
    if not deploy_id:
        raise RuntimeError("No deploy ID returned from Render API")

    print(f"Waiting for deploy: {deploy_id}")
    _wait_for_deploy(client, service_id, deploy_id, timeout_seconds, poll_seconds)

    latest_service = client.get_service(service_id)
    url = _service_url(latest_service)
    if not url:
        raise RuntimeError("Deploy succeeded but service URL was not returned")

    print("\nDeployment complete")
    print(f"Service ID: {service_id}")
    print(f"Public URL: {url}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Deployment failed: {exc}")
        raise SystemExit(1)
