from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "tests" / "golden" / "kernel"
REQUIRED_FIXTURES = {
    "happy-path.json": "happy_path",
    "approval-gate.json": "approval_gate",
    "approval-denied.json": "approval_denied",
    "duplicate-command.json": "duplicate_command",
    "transient-retry.json": "transient_retry",
    "permanent-validation-failure.json": "permanent_validation_failure",
    "claim-expiry.json": "claim_expiry",
    "projection-drift.json": "projection_drift",
    "known-loop-prevention.json": "known_loop_prevention",
}
REQUIRED_FIELDS = (
    "trace_id",
    "schema_version",
    "scenario_name",
    "seed_state",
    "commands",
    "expected_events",
    "expected_terminal_aggregate_state",
    "expected_projection_state",
    "expected_invariants",
)
REQUIRED_INVARIANTS = {
    "known-loop-prevention.json": {
        "no_redispatch_without_new_causal_input",
        "terminal_blocked_or_escalated",
    },
    "approval-denied.json": {
        "no_execution_after_denial",
    },
    "claim-expiry.json": {
        "expired_lease_cannot_continue",
    },
}


def append(findings: list[str], message: str) -> None:
    findings.append(message)


def validate_command_entries(path: Path, commands: object, findings: list[str]) -> None:
    if not isinstance(commands, list) or not commands:
        append(findings, f"{path} must declare a non-empty commands array")
        return
    for index, item in enumerate(commands):
        if not isinstance(item, dict):
            append(findings, f"{path} command[{index}] must be an object")
            continue
        for key in ("command_id", "type", "issued_at"):
            value = item.get(key)
            if not isinstance(value, str) or not value.strip():
                append(findings, f"{path} command[{index}] is missing string field {key}")


def validate_event_entries(path: Path, events: object, findings: list[str]) -> None:
    if not isinstance(events, list) or not events:
        append(findings, f"{path} must declare a non-empty expected_events array")
        return
    for index, item in enumerate(events):
        if not isinstance(item, dict):
            append(findings, f"{path} expected_events[{index}] must be an object")
            continue
        for key in ("event_id", "type", "occurred_at"):
            value = item.get(key)
            if not isinstance(value, str) or not value.strip():
                append(findings, f"{path} expected_events[{index}] is missing string field {key}")


def validate_fixture(path: Path, data: object, seen_trace_ids: set[str], findings: list[str]) -> None:
    if not isinstance(data, dict):
        append(findings, f"{path} must contain a top-level object")
        return

    for field in REQUIRED_FIELDS:
        if field not in data:
            append(findings, f"{path} is missing required field {field}")

    trace_id = data.get("trace_id")
    if isinstance(trace_id, str) and trace_id.strip():
        if trace_id in seen_trace_ids:
            append(findings, f"{path} reuses duplicate trace_id {trace_id}")
        seen_trace_ids.add(trace_id)
    else:
        append(findings, f"{path} must declare a non-empty trace_id")

    schema_version = data.get("schema_version")
    if schema_version != 1:
        append(findings, f"{path} must use schema_version 1, found {schema_version!r}")

    scenario_name = data.get("scenario_name")
    if not isinstance(scenario_name, str) or not scenario_name.strip():
        append(findings, f"{path} must declare a non-empty scenario_name")

    for dict_field in ("seed_state", "expected_terminal_aggregate_state", "expected_projection_state"):
        value = data.get(dict_field)
        if not isinstance(value, dict):
            append(findings, f"{path} field {dict_field} must be an object")

    validate_command_entries(path, data.get("commands"), findings)
    validate_event_entries(path, data.get("expected_events"), findings)

    invariants = data.get("expected_invariants")
    if not isinstance(invariants, list) or not invariants:
        append(findings, f"{path} must declare a non-empty expected_invariants array")
        invariant_set: set[str] = set()
    else:
        invariant_set = set()
        for index, item in enumerate(invariants):
            if not isinstance(item, str) or not item.strip():
                append(findings, f"{path} expected_invariants[{index}] must be a non-empty string")
                continue
            invariant_set.add(item)

    required_invariants = REQUIRED_INVARIANTS.get(path.name, set())
    missing = sorted(required_invariants - invariant_set)
    if missing:
        append(findings, f"{path} is missing required invariants: {', '.join(missing)}")


def main() -> int:
    findings: list[str] = []
    seen_trace_ids: set[str] = set()

    if not FIXTURE_DIR.exists():
        append(findings, f"Missing fixture directory: {FIXTURE_DIR.relative_to(REPO_ROOT)}")
    else:
        fixture_paths = sorted(FIXTURE_DIR.glob("*.json"))
        fixture_names = {path.name for path in fixture_paths}

        missing_fixtures = sorted(set(REQUIRED_FIXTURES) - fixture_names)
        for name in missing_fixtures:
            append(findings, f"Missing required replay fixture: tests/golden/kernel/{name}")

        for path in fixture_paths:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                append(findings, f"{path.relative_to(REPO_ROOT)} is not valid JSON: {exc}")
                continue

            validate_fixture(path.relative_to(REPO_ROOT), data, seen_trace_ids, findings)

            expected_scenario = REQUIRED_FIXTURES.get(path.name)
            scenario_name = data.get("scenario_name") if isinstance(data, dict) else None
            if expected_scenario is not None and scenario_name != expected_scenario:
                append(
                    findings,
                    f"{path.relative_to(REPO_ROOT)} must use scenario_name {expected_scenario}, found {scenario_name!r}",
                )

    if findings:
        print("Replay regression check failed:")
        for finding in findings:
            print(f"- {finding}")
        return 1

    print("Replay regression fixtures passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
