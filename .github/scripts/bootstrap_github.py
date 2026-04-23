from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = REPO_ROOT / "docs" / "backlog"
ISSUE_KEY_RE = re.compile(r"^(AC-\d+)\b")
DEFAULT_LABELS = [
    "bug",
    "documentation",
    "duplicate",
    "enhancement",
    "good first issue",
    "help wanted",
    "invalid",
    "question",
    "wontfix",
]
PRODUCTION_REQUIRED_STATUS_CHECKS = [
    "quality",
    "ops-validation",
    "bootstrap-smoke",
    "integration-smokes",
    "self-hosted-smoke",
    "repo-guardrails",
    "dependency-review",
    "secret-scan",
    "replay-regression",
]
MAIN_REQUIRED_STATUS_CHECKS = list(PRODUCTION_REQUIRED_STATUS_CHECKS)
RELEASE_REQUIRED_STATUS_CHECKS = [
    check
    for check in PRODUCTION_REQUIRED_STATUS_CHECKS
    if check != "dependency-review"
]
MAIN_RULESET_NAME = "Main Branch Protection"
RELEASE_RULESET_NAME = "Release Candidate Protection"


def gh(*args: str, cwd: Path | None = None, input_text: str | None = None) -> str:
    cmd = ["gh", *args]
    completed = subprocess.run(
        cmd,
        cwd=cwd or REPO_ROOT,
        text=True,
        input=input_text,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed:\n{completed.stderr.strip()}")
    return completed.stdout


def gh_json(*args: str) -> Any:
    output = gh(*args)
    if not output.strip():
        return None
    return json.loads(output)


def gh_api_json(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    args = ["api", path, "-X", method]
    input_text = None
    if payload is not None:
        args.extend(["--input", "-"])
        input_text = json.dumps(payload)
    output = gh(*args, input_text=input_text)
    if not output.strip():
        return None
    return json.loads(output)


def gh_paginated_items(path: str) -> list[dict[str, Any]]:
    pages = gh_json("api", "--paginate", "--slurp", path)
    items: list[dict[str, Any]] = []
    for page in pages:
        if isinstance(page, list):
            items.extend(page)
        else:
            items.append(page)
    return items


def load_seed() -> dict[str, Any]:
    seed_files = sorted(SEED_DIR.glob("*seed.json"))
    merged: dict[str, Any] = {"labels": [], "milestones": [], "issues": []}
    seen_labels: set[str] = set()
    seen_milestones: set[str] = set()
    seen_issues: set[str] = set()

    for path in seed_files:
        seed = json.loads(path.read_text(encoding="utf-8"))

        for label in seed.get("labels", []):
            name = label["name"]
            if name in seen_labels:
                continue
            merged["labels"].append(label)
            seen_labels.add(name)

        for milestone in seed.get("milestones", []):
            title = milestone["title"]
            if title in seen_milestones:
                continue
            merged["milestones"].append(milestone)
            seen_milestones.add(title)

        for issue in seed.get("issues", []):
            key = issue["key"]
            if key in seen_issues:
                continue
            merged["issues"].append(issue)
            seen_issues.add(key)

    return merged


def requested_operations(args: argparse.Namespace) -> list[str]:
    requested = []
    if args.sync_labels:
        requested.append("sync_labels")
    if args.sync_milestones:
        requested.append("sync_milestones")
    if args.sync_issues:
        requested.append("sync_issues")
    if args.delete_default_labels:
        requested.append("delete_default_labels")
    if args.protect_main:
        requested.append("protect_main")
    if args.unprotect_main:
        requested.append("unprotect_main")
    if args.protect_release:
        requested.append("protect_release")
    if args.unprotect_release:
        requested.append("unprotect_release")
    if requested:
        return requested
    return ["sync_labels", "sync_milestones", "sync_issues"]


def issue_title(issue: dict[str, Any]) -> str:
    return f"{issue['key']} {issue['title']}"


def issue_body(issue: dict[str, Any]) -> str:
    depends = issue.get("depends_on") or []
    depends_line = ", ".join(depends) if depends else "None"
    return "\n".join(
        [
            f"Key: `{issue['key']}`",
            "",
            issue["body"],
            "",
            f"Depends on: {depends_line}",
            "",
            "Definition of Done:",
            "- The described output exists",
            "- Validation criteria are satisfied",
            "- Remaining work, if any, is written back into GitHub",
        ]
    )


def issue_key_from_title(title: str) -> str | None:
    match = ISSUE_KEY_RE.match(title)
    if not match:
        return None
    return match.group(1)


def list_labels(repo: str) -> dict[str, dict[str, Any]]:
    labels = gh_paginated_items(f"repos/{repo}/labels?per_page=100")
    return {item["name"]: item for item in labels}


def ensure_label(repo: str, label: dict[str, Any], existing: dict[str, dict[str, Any]]) -> None:
    name = label["name"]
    if name not in existing:
        gh(
            "label",
            "create",
            name,
            "--repo",
            repo,
            "--color",
            label["color"],
            "--description",
            label["description"],
        )
        return

    current = existing[name]
    if current["color"] == label["color"] and current["description"] == label["description"]:
        return

    gh(
        "label",
        "edit",
        name,
        "--repo",
        repo,
        "--color",
        label["color"],
        "--description",
        label["description"],
    )


def sync_labels(repo: str, labels: list[dict[str, Any]]) -> None:
    existing = list_labels(repo)
    for label in labels:
        ensure_label(repo, label, existing)
        existing[label["name"]] = label


def delete_default_labels(repo: str) -> None:
    for label in DEFAULT_LABELS:
        completed = subprocess.run(
            ["gh", "label", "delete", label, "--repo", repo, "--yes"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        if completed.returncode == 0:
            continue
        stderr = completed.stderr.strip().lower()
        if "not found" in stderr:
            continue
        if completed.returncode != 0:
            raise RuntimeError(f"Failed deleting label {label}:\n{completed.stderr.strip()}")


def list_milestones(repo: str, state: str = "all") -> dict[str, dict[str, Any]]:
    milestones = gh_paginated_items(f"repos/{repo}/milestones?state={state}&per_page=100")
    return {item["title"]: item for item in milestones}


def ensure_milestone(repo: str, milestone: dict[str, Any], existing: dict[str, dict[str, Any]]) -> int:
    title = milestone["title"]
    if title not in existing:
        created = gh_api_json(
            "POST",
            f"repos/{repo}/milestones",
            {
                "title": title,
                "description": milestone["description"],
            },
        )
        return created["number"]

    current = existing[title]
    if current.get("description") != milestone["description"] or current.get("state") != "open":
        updated = gh_api_json(
            "PATCH",
            f"repos/{repo}/milestones/{current['number']}",
            {
                "title": title,
                "description": milestone["description"],
                "state": "open",
            },
        )
        return updated["number"]

    return current["number"]


def sync_milestones(repo: str, milestones: list[dict[str, Any]]) -> dict[str, int]:
    existing = list_milestones(repo)
    milestone_numbers: dict[str, int] = {}
    for milestone in milestones:
        number = ensure_milestone(repo, milestone, existing)
        milestone_numbers[milestone["title"]] = number
        existing[milestone["title"]] = {
            "title": milestone["title"],
            "description": milestone["description"],
            "state": "open",
            "number": number,
        }
    return milestone_numbers


def list_issues(repo: str) -> dict[str, dict[str, Any]]:
    issues = gh_paginated_items(f"repos/{repo}/issues?state=all&per_page=100")
    issue_map: dict[str, dict[str, Any]] = {}
    for item in issues:
        if "pull_request" in item:
            continue
        key = issue_key_from_title(item["title"])
        if key is not None:
            issue_map[key] = item
    return issue_map


def issue_payload(issue: dict[str, Any], milestone_numbers: dict[str, int]) -> dict[str, Any]:
    return {
        "title": issue_title(issue),
        "body": issue_body(issue),
        "milestone": milestone_numbers[issue["milestone"]],
    }


def ensure_issue(
    repo: str,
    issue: dict[str, Any],
    milestone_numbers: dict[str, int],
    existing: dict[str, dict[str, Any]],
    sync_issue_labels: bool,
) -> None:
    payload = issue_payload(issue, milestone_numbers)
    key = issue["key"]
    current = existing.get(key)
    if current is None:
        payload["labels"] = issue["labels"]
        created = gh_api_json("POST", f"repos/{repo}/issues", payload)
        existing[key] = created
        return

    current_milestone = None
    if current.get("milestone") is not None:
        current_milestone = current["milestone"]["title"]

    labels_match = True
    if sync_issue_labels:
        current_labels = sorted(label["name"] for label in current.get("labels", []))
        desired_labels = sorted(issue["labels"])
        labels_match = current_labels == desired_labels
        payload["labels"] = issue["labels"]

    if current["title"] == payload["title"] and current.get("body", "") == payload["body"] and current_milestone == issue["milestone"] and labels_match:
        return

    updated = gh_api_json("PATCH", f"repos/{repo}/issues/{current['number']}", payload)
    existing[key] = updated


def sync_issues(
    repo: str,
    issues: list[dict[str, Any]],
    milestone_numbers: dict[str, int],
    sync_issue_labels: bool,
) -> None:
    existing = list_issues(repo)
    for issue in issues:
        ensure_issue(repo, issue, milestone_numbers, existing, sync_issue_labels)


def delete_branch_protection_if_present(repo: str, branch: str) -> None:
    try:
        gh_api_json("DELETE", f"repos/{repo}/branches/{branch}/protection")
    except RuntimeError as exc:
        message = str(exc).lower()
        if "branch not protected" in message or "http 404" in message or "not found" in message:
            return
        raise


def build_pull_request_rule() -> dict[str, Any]:
    return {
        "type": "pull_request",
        "parameters": {
            "dismiss_stale_reviews_on_push": True,
            "require_code_owner_review": True,
            "require_last_push_approval": False,
            "required_approving_review_count": 1,
            "required_review_thread_resolution": True,
        },
    }


def build_branch_ruleset_payload(
    *,
    name: str,
    include_refs: list[str],
    required_status_checks: list[str],
) -> dict[str, Any]:
    return {
        "name": name,
        "target": "branch",
        "enforcement": "active",
        "conditions": {
            "ref_name": {
                "include": include_refs,
                "exclude": [],
            }
        },
        "bypass_actors": [],
        "rules": [
            {"type": "deletion"},
            {"type": "non_fast_forward"},
            build_pull_request_rule(),
            build_required_status_checks(required_status_checks),
        ],
    }


def upsert_ruleset(repo: str, name: str, payload: dict[str, Any]) -> None:
    existing = find_ruleset_by_name(repo, name)
    if existing is None:
        gh_api_json("POST", f"repos/{repo}/rulesets", payload)
        return
    gh_api_json("PUT", f"repos/{repo}/rulesets/{existing['id']}", payload)


def delete_ruleset_by_name(repo: str, name: str) -> None:
    existing = find_ruleset_by_name(repo, name)
    if existing is None:
        return
    gh_api_json("DELETE", f"repos/{repo}/rulesets/{existing['id']}")


def build_main_ruleset_payload() -> dict[str, Any]:
    return build_branch_ruleset_payload(
        name=MAIN_RULESET_NAME,
        include_refs=["refs/heads/main"],
        required_status_checks=MAIN_REQUIRED_STATUS_CHECKS,
    )


def protect_main(repo: str) -> None:
    try:
        upsert_ruleset(repo, MAIN_RULESET_NAME, build_main_ruleset_payload())
    except RuntimeError as exc:
        if "Upgrade to GitHub Pro or make this repository public" in str(exc):
            raise RuntimeError(
                "Repository rulesets are unavailable for this repository on the current GitHub plan. "
                "Make the repository public or upgrade the plan before rerunning with --protect-main."
            ) from exc
        raise
    delete_branch_protection_if_present(repo, "main")


def unprotect_main(repo: str) -> None:
    delete_ruleset_by_name(repo, MAIN_RULESET_NAME)
    delete_branch_protection_if_present(repo, "main")


def list_rulesets(repo: str) -> list[dict[str, Any]]:
    return gh_paginated_items(f"repos/{repo}/rulesets?per_page=100")


def find_ruleset_by_name(repo: str, name: str) -> dict[str, Any] | None:
    for ruleset in list_rulesets(repo):
        if ruleset.get("name") == name:
            return ruleset
    return None


def build_required_status_checks(contexts: list[str]) -> dict[str, Any]:
    return {
        "type": "required_status_checks",
        "parameters": {
            "strict_required_status_checks_policy": True,
            "required_status_checks": [{"context": context} for context in contexts],
        },
    }


def build_release_ruleset_payload() -> dict[str, Any]:
    return build_branch_ruleset_payload(
        name=RELEASE_RULESET_NAME,
        include_refs=["refs/heads/release/*"],
        required_status_checks=RELEASE_REQUIRED_STATUS_CHECKS,
    )


def protect_release(repo: str) -> None:
    upsert_ruleset(repo, RELEASE_RULESET_NAME, build_release_ruleset_payload())


def unprotect_release(repo: str) -> None:
    delete_ruleset_by_name(repo, RELEASE_RULESET_NAME)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--apply", action="store_true", help="Apply repository mutations instead of printing the plan")
    parser.add_argument("--sync-labels", action="store_true", help="Sync seeded labels")
    parser.add_argument("--sync-milestones", action="store_true", help="Sync seeded milestones")
    parser.add_argument("--sync-issues", action="store_true", help="Sync seeded issues")
    parser.add_argument(
        "--sync-issue-labels",
        action="store_true",
        help="When syncing existing issues, also reset their labels to the seeded set",
    )
    parser.add_argument(
        "--protect-main",
        action="store_true",
        help="Apply a repository ruleset that protects main and cleans up legacy branch protection",
    )
    parser.add_argument(
        "--unprotect-main",
        action="store_true",
        help="Remove the main ruleset and any legacy branch protection on main",
    )
    parser.add_argument(
        "--protect-release",
        action="store_true",
        help="Apply a repository ruleset that protects release/* branches",
    )
    parser.add_argument(
        "--unprotect-release",
        action="store_true",
        help="Remove the repository ruleset that protects release/* branches",
    )
    parser.add_argument("--delete-default-labels", action="store_true", help="Delete GitHub default labels")
    args = parser.parse_args()

    seed = load_seed()
    operations = requested_operations(args)

    if not args.apply:
        print(f"Plan for {args.repo}")
        if "sync_labels" in operations:
            print(f"- labels: sync {len(seed['labels'])}")
        if "sync_milestones" in operations:
            print(f"- milestones: sync {len(seed['milestones'])}")
        if "sync_issues" in operations:
            label_mode = " with label reset" if args.sync_issue_labels else " preserving existing labels"
            print(f"- issues: sync {len(seed['issues'])}{label_mode}")
        if "delete_default_labels" in operations:
            print("- default labels: delete requested")
        if "protect_main" in operations:
            print(
                f"- main ruleset: require PR + reviews + {', '.join(MAIN_REQUIRED_STATUS_CHECKS)} on main"
            )
        if "unprotect_main" in operations:
            print("- main ruleset: remove from main and clear any legacy branch protection")
        if "protect_release" in operations:
            print(
                f"- release ruleset: require PR + reviews + {', '.join(RELEASE_REQUIRED_STATUS_CHECKS)} on release/*"
            )
        if "unprotect_release" in operations:
            print("- release ruleset: remove from release/*")
        return 0

    try:
        if "sync_labels" in operations:
            sync_labels(args.repo, seed["labels"])

        if "delete_default_labels" in operations:
            delete_default_labels(args.repo)

        milestone_numbers: dict[str, int] = {}
        if "sync_milestones" in operations:
            milestone_numbers = sync_milestones(args.repo, seed["milestones"])
        elif "sync_issues" in operations:
            milestone_numbers = {
                title: details["number"]
                for title, details in list_milestones(args.repo).items()
            }

        if "sync_issues" in operations:
            sync_issues(args.repo, seed["issues"], milestone_numbers, args.sync_issue_labels)

        if "protect_main" in operations:
            protect_main(args.repo)

        if "unprotect_main" in operations:
            unprotect_main(args.repo)

        if "protect_release" in operations:
            protect_release(args.repo)

        if "unprotect_release" in operations:
            unprotect_release(args.repo)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"GitHub bootstrap complete for {args.repo}: {', '.join(operations)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
