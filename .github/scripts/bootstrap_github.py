from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "docs" / "backlog" / "github-seed.json"


def gh(*args: str, cwd: Path | None = None) -> str:
    cmd = ["gh", *args]
    completed = subprocess.run(
        cmd,
        cwd=cwd or REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed:\n{completed.stderr.strip()}")
    return completed.stdout


def load_seed() -> dict:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def ensure_label(repo: str, label: dict) -> None:
    name = label["name"]
    try:
        gh("label", "create", name, "--repo", repo, "--color", label["color"], "--description", label["description"])
    except RuntimeError:
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


def milestone_number_by_title(repo: str, state: str = "all") -> dict[str, int]:
    output = gh("api", f"repos/{repo}/milestones?state={state}&per_page=100")
    milestones = json.loads(output)
    return {item["title"]: item["number"] for item in milestones}


def ensure_milestone(repo: str, milestone: dict) -> int:
    existing = milestone_number_by_title(repo)
    title = milestone["title"]
    if title in existing:
        gh(
            "api",
            f"repos/{repo}/milestones/{existing[title]}",
            "-X",
            "PATCH",
            "-f",
            f"title={title}",
            "-f",
            f"description={milestone['description']}",
            "-f",
            "state=open",
        )
        return existing[title]
    output = gh(
        "api",
        f"repos/{repo}/milestones",
        "-X",
        "POST",
        "-f",
        f"title={title}",
        "-f",
        f"description={milestone['description']}",
    )
    return json.loads(output)["number"]


def issue_number_by_title(repo: str) -> dict[str, int]:
    output = gh("issue", "list", "--repo", repo, "--state", "all", "--limit", "200", "--json", "number,title")
    issues = json.loads(output)
    return {item["title"]: item["number"] for item in issues}


def issue_body(issue: dict) -> str:
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
            "- Remaining work, if any, is written back into GitHub"
        ]
    )


def ensure_issue(repo: str, issue: dict, milestone_numbers: dict[str, int]) -> None:
    title = f"{issue['key']} {issue['title']}"
    body = issue_body(issue)
    labels = ",".join(issue["labels"])
    issue_map = issue_number_by_title(repo)
    if title in issue_map:
        gh(
            "issue",
            "edit",
            str(issue_map[title]),
            "--repo",
            repo,
            "--title",
            title,
            "--body",
            body,
            "--milestone",
            issue["milestone"],
            "--add-label",
            labels,
        )
        return
    gh(
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        title,
        "--body",
        body,
        "--milestone",
        issue["milestone"],
        "--label",
        labels,
    )


def protect_main(repo: str) -> None:
    payload = {
        "required_status_checks": {"strict": True, "contexts": ["repo-guardrails"]},
        "enforce_admins": True,
        "required_pull_request_reviews": {
            "dismiss_stale_reviews": False,
            "require_code_owner_reviews": True,
            "required_approving_review_count": 1
        },
        "restrictions": None,
        "required_conversation_resolution": True,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "block_creations": False,
        "lock_branch": False,
        "allow_fork_syncing": True
    }
    gh(
        "api",
        f"repos/{repo}/branches/main/protection",
        "-X",
        "PUT",
        "--input",
        "-",
        cwd=REPO_ROOT,
    )


def protect_main_with_curl_style(repo: str) -> None:
    payload = json.dumps(
        {
            "required_status_checks": {"strict": True, "contexts": ["repo-guardrails"]},
            "enforce_admins": True,
            "required_pull_request_reviews": {
                "dismiss_stale_reviews": False,
                "require_code_owner_reviews": True,
                "required_approving_review_count": 1
            },
            "restrictions": None,
            "required_conversation_resolution": True,
            "allow_force_pushes": False,
            "allow_deletions": False,
            "block_creations": False,
            "lock_branch": False,
            "allow_fork_syncing": True
        }
    )
    completed = subprocess.run(
        ["gh", "api", f"repos/{repo}/branches/main/protection", "-X", "PUT", "--input", "-"],
        cwd=REPO_ROOT,
        text=True,
        input=payload,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--protect-main", action="store_true")
    args = parser.parse_args()

    seed = load_seed()

    for label in seed["labels"]:
        ensure_label(args.repo, label)

    milestone_numbers: dict[str, int] = {}
    for milestone in seed["milestones"]:
        milestone_numbers[milestone["title"]] = ensure_milestone(args.repo, milestone)

    for issue in seed["issues"]:
        ensure_issue(args.repo, issue, milestone_numbers)

    if args.protect_main:
        protect_main_with_curl_style(args.repo)

    print(f"GitHub bootstrap complete for {args.repo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

