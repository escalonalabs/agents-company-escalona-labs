from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = Path(__file__).resolve().relative_to(REPO_ROOT)
TEXT_EXCLUDES = {SCRIPT_PATH.as_posix()}
DIR_EXCLUDES = {".git", "node_modules", ".next", ".turbo", "dist", "build", "coverage"}
BANNED_STRINGS = (
    "Multica",
    "multica",
    "@multica/",
    "multica.ai",
    "multica_token",
    "multica_workspace_id",
)
ROOT_PACKAGE_NAME = "agents-company"
SCOPED_PREFIX = "@escalonalabs/"
GO_MODULE = "github.com/escalonalabs/agents-company-escalona-labs/server"
DESKTOP_APP_ID_PREFIX = "com.escalonalabs."


def should_skip(path: Path) -> bool:
    rel = path.relative_to(REPO_ROOT)
    if rel.as_posix() in TEXT_EXCLUDES:
        return True
    return any(part in DIR_EXCLUDES for part in rel.parts)


def scan_text_files() -> list[str]:
    findings: list[str] = []
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file() or should_skip(path):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for banned in BANNED_STRINGS:
            if banned in text:
                findings.append(f"{path.relative_to(REPO_ROOT)} contains prohibited identifier: {banned}")
    return findings


def validate_package_names() -> list[str]:
    findings: list[str] = []
    for package_json in REPO_ROOT.rglob("package.json"):
        if should_skip(package_json):
            continue
        data = json.loads(package_json.read_text(encoding="utf-8"))
        name = data.get("name")
        if not name:
            findings.append(f"{package_json.relative_to(REPO_ROOT)} is missing a package name")
            continue
        rel = package_json.relative_to(REPO_ROOT)
        if rel == Path("package.json"):
            if name != ROOT_PACKAGE_NAME:
                findings.append(f"{rel} must use root package name {ROOT_PACKAGE_NAME}, found {name}")
            continue
        if name.startswith("@") and not name.startswith(SCOPED_PREFIX):
            findings.append(f"{rel} must use the {SCOPED_PREFIX} scope, found {name}")
    return findings


def validate_go_module() -> list[str]:
    go_mod = REPO_ROOT / "server" / "go.mod"
    if not go_mod.exists():
        return []
    lines = go_mod.read_text(encoding="utf-8").splitlines()
    for line in lines:
        if line.startswith("module "):
            module_name = line.removeprefix("module ").strip()
            if module_name != GO_MODULE:
                return [f"server/go.mod must declare module {GO_MODULE}, found {module_name}"]
            return []
    return ["server/go.mod is missing a module declaration"]


def validate_desktop_app_id() -> list[str]:
    builder = REPO_ROOT / "apps" / "desktop" / "electron-builder.yml"
    if not builder.exists():
        return []
    text = builder.read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("appId:"):
            app_id = line.split(":", 1)[1].strip()
            if not app_id.startswith(DESKTOP_APP_ID_PREFIX):
                return [f"apps/desktop/electron-builder.yml must use appId starting with {DESKTOP_APP_ID_PREFIX}, found {app_id}"]
            return []
    return ["apps/desktop/electron-builder.yml is missing appId"]


def main() -> int:
    findings = []
    findings.extend(scan_text_files())
    findings.extend(validate_package_names())
    findings.extend(validate_go_module())
    findings.extend(validate_desktop_app_id())

    if findings:
        print("Repository guardrails failed:")
        for finding in findings:
            print(f"- {finding}")
        return 1

    print("Repository guardrails passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

