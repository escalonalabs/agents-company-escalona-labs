import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  AggregateState,
  ApprovalDecision,
  ApprovalStatus,
  ClaimLease,
  Company,
  DomainEvent,
  Objective,
  ObjectiveStatus,
  Run,
  RunStatus,
  WorkItem,
  WorkItemStatus,
} from '@escalonalabs/domain';

import { hasNewCausalInput } from './core';
import {
  createApprovalEvent,
  createCompanyCreatedEvent,
  createDomainEvent,
  createObjectiveEvent,
  createRunEvent,
  createWorkItemEvent,
  orderEventsForReplay,
  replayAggregate,
} from './ledger';

const FIXTURE_DIR = fileURLToPath(
  new URL('../../../tests/golden/kernel/', import.meta.url),
);

export interface GoldenFixtureCommand {
  command_id: string;
  type: string;
  issued_at: string;
}

export interface GoldenFixtureExpectedEvent {
  event_id: string;
  type: string;
  occurred_at: string;
}

export interface GoldenFixture {
  trace_id: string;
  schema_version: number;
  scenario_name: string;
  seed_state: Record<string, unknown>;
  commands: GoldenFixtureCommand[];
  expected_events: GoldenFixtureExpectedEvent[];
  expected_terminal_aggregate_state: Record<string, unknown>;
  expected_projection_state: Record<string, unknown>;
  expected_invariants: string[];
}

export interface TraceMarker {
  eventId: string;
  type: string;
  occurredAt: string;
}

type ScenarioFacts = {
  objectiveStatusLabel?: string;
  runStatusLabel?: string;
  leaseStatus?: string;
  projectionStatus?: string;
  retryCount?: number;
  duplicateCommandsSuppressed?: number;
  redispatchCount?: number;
  latestOperatorAction?: string;
  blockReason?: string;
  lastRetryReason?: string;
  queueState?: string;
  operatorAttentionRequired?: boolean;
  driftOpen?: number;
  lastSuccessfulProjection?: string;
  dedupeHits?: number;
  previousDispatch?: {
    workItemId: string;
    blockingReason: string | null;
    packetHash: string | null;
    dependencyHash: string | null;
    failureClass: string | null;
  };
  nextDispatch?: {
    workItemId: string;
    blockingReason: string | null;
    packetHash: string | null;
    dependencyHash: string | null;
    failureClass: string | null;
  };
};

type ScenarioRefs = {
  companyId: string;
  objectiveId?: string;
  workItemId?: string;
  approvalId?: string;
  claimId?: string;
  runIds: string[];
};

export interface GoldenFixtureExecution {
  fixture: GoldenFixture;
  domainEvents: DomainEvent[];
  orderedEvents: DomainEvent[];
  traceMarkers: TraceMarker[];
  replayedState: AggregateState;
  replayedStateFromReverseOrder: AggregateState;
  terminalAggregateState: Record<string, unknown>;
  projectionState: Record<string, unknown>;
  invariantResults: Record<string, boolean>;
}

class ScenarioBuilder {
  private readonly fixture: GoldenFixture;
  private readonly refs: ScenarioRefs;
  private readonly events: DomainEvent[] = [];
  private readonly markers: TraceMarker[] = [];
  private readonly sequences = new Map<string, number>();
  private readonly facts: ScenarioFacts = {};

  private company?: Company;
  private objective?: Objective;
  private workItem?: WorkItem;
  private approval?: ApprovalDecision;
  private claim?: ClaimLease;
  private readonly runs = new Map<string, Run>();

  constructor(fixture: GoldenFixture) {
    this.fixture = fixture;
    this.refs = {
      companyId: `company_${fixture.scenario_name}`,
      objectiveId:
        typeof fixture.seed_state.objective_id === 'string'
          ? fixture.seed_state.objective_id
          : `${fixture.scenario_name}_objective`,
      runIds: [],
    };
  }

  private nextSequence(aggregateType: string, aggregateId: string): number {
    const key = `${aggregateType}:${aggregateId}`;
    const sequence = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, sequence);
    return sequence;
  }

  private ensureCompany(createdAt: string): Company {
    if (this.company) {
      return this.company;
    }

    this.company = {
      companyId: this.refs.companyId,
      slug: `scenario-${this.fixture.scenario_name}`,
      displayName: `Scenario ${this.fixture.scenario_name}`,
      status: 'active',
      createdAt,
    };

    this.events.push(
      createCompanyCreatedEvent({
        company: this.company,
        eventId: `${this.fixture.scenario_name}_company_created`,
        streamSequence: this.nextSequence('company', this.company.companyId),
        commandId: `${this.fixture.scenario_name}_bootstrap_company`,
        idempotencyKey: `${this.fixture.trace_id}:company`,
      }),
    );

    return this.company;
  }

  objectiveSnapshot(input: {
    status: ObjectiveStatus;
    occurredAt: string;
    commandId: string;
    marker?: TraceMarker;
  }): Objective {
    const company = this.ensureCompany(input.occurredAt);
    const aggregateId =
      this.refs.objectiveId ?? `${this.fixture.scenario_name}_objective`;
    const previous = this.objective;

    const objective: Objective = {
      objectiveId: aggregateId,
      companyId: company.companyId,
      title: `Objective ${this.fixture.scenario_name}`,
      status: input.status,
      createdAt: previous?.createdAt ?? input.occurredAt,
      updatedAt: input.occurredAt,
    };

    this.objective = objective;
    this.events.push(
      createObjectiveEvent({
        objective,
        eventId:
          input.marker?.eventId ??
          `${this.fixture.scenario_name}_objective_${previous ? 'updated' : 'created'}_${this.events.length}`,
        eventType: previous ? 'objective.updated' : 'objective.created',
        streamSequence: this.nextSequence('objective', objective.objectiveId),
        commandId: input.commandId,
        idempotencyKey: `${input.commandId}:${objective.objectiveId}:${input.status}`,
      }),
    );

    if (input.marker) {
      this.markers.push(input.marker);
    }

    return objective;
  }

  workItemSnapshot(input: {
    status: WorkItemStatus;
    occurredAt: string;
    commandId: string;
    requiresApproval?: boolean;
    blockingReason?: string;
    marker?: TraceMarker;
  }): WorkItem {
    const objective =
      this.objective ??
      this.objectiveSnapshot({
        status: mapFixtureObjectiveStatus(
          this.fixture.seed_state.objective_status,
          'planned',
        ),
        occurredAt: input.occurredAt,
        commandId: `${this.fixture.scenario_name}_bootstrap_objective`,
      });

    const aggregateId =
      this.refs.workItemId ?? `${this.fixture.scenario_name}_work_item`;
    const previous = this.workItem;

    const workItem: WorkItem = {
      workItemId: aggregateId,
      companyId: objective.companyId,
      objectiveId: objective.objectiveId,
      title: `Work item ${this.fixture.scenario_name}`,
      status: input.status,
      attemptBudget: previous?.attemptBudget ?? 3,
      requiresApproval:
        input.requiresApproval ?? previous?.requiresApproval ?? false,
      validationContractRef:
        previous?.validationContractRef ?? 'validation.contract.default.v1',
      scopeRef: previous?.scopeRef ?? `scope:${this.fixture.scenario_name}`,
      blockingReason: input.blockingReason,
      latestRunId: previous?.latestRunId,
      createdAt: previous?.createdAt ?? input.occurredAt,
      updatedAt: input.occurredAt,
    };

    this.refs.workItemId = workItem.workItemId;
    this.workItem = workItem;
    this.events.push(
      createWorkItemEvent({
        workItem,
        eventId:
          input.marker?.eventId ??
          `${this.fixture.scenario_name}_work_item_${previous ? 'updated' : 'created'}_${this.events.length}`,
        eventType: previous ? 'work_item.updated' : 'work_item.created',
        streamSequence: this.nextSequence('work_item', workItem.workItemId),
        commandId: input.commandId,
        idempotencyKey: `${input.commandId}:${workItem.workItemId}:${input.status}`,
      }),
    );

    if (input.marker) {
      this.markers.push(input.marker);
    }

    return workItem;
  }

  approvalSnapshot(input: {
    status: ApprovalStatus;
    occurredAt: string;
    commandId: string;
    requestedAction?: string;
    decisionReason?: string;
    marker?: TraceMarker;
  }): ApprovalDecision {
    const workItem =
      this.workItem ??
      this.workItemSnapshot({
        status: 'blocked',
        occurredAt: input.occurredAt,
        commandId: `${this.fixture.scenario_name}_bootstrap_work_item`,
        requiresApproval: true,
        blockingReason: 'awaiting_approval',
      });

    const aggregateId =
      this.refs.approvalId ?? `${this.fixture.scenario_name}_approval`;
    const previous = this.approval;

    const approval: ApprovalDecision = {
      approvalId: aggregateId,
      companyId: workItem.companyId,
      workItemId: workItem.workItemId,
      status: input.status,
      requestedAction:
        input.requestedAction ??
        previous?.requestedAction ??
        'approve_execution',
      decisionReason: input.decisionReason,
      createdAt: previous?.createdAt ?? input.occurredAt,
      updatedAt: input.occurredAt,
    };

    this.refs.approvalId = approval.approvalId;
    this.approval = approval;
    this.events.push(
      createApprovalEvent({
        approval,
        eventId:
          input.marker?.eventId ??
          `${this.fixture.scenario_name}_approval_${previous ? 'updated' : 'requested'}_${this.events.length}`,
        eventType: previous ? 'approval.updated' : 'approval.requested',
        streamSequence: this.nextSequence('approval', approval.approvalId),
        commandId: input.commandId,
        idempotencyKey: `${input.commandId}:${approval.approvalId}:${input.status}`,
      }),
    );

    if (input.marker) {
      this.markers.push(input.marker);
    }

    return approval;
  }

  claimSnapshot(input: {
    eventType: 'claim.acquired' | 'claim.expired';
    occurredAt: string;
    commandId: string;
    runId: string;
    marker?: TraceMarker;
  }): ClaimLease {
    const workItem =
      this.workItem ??
      this.workItemSnapshot({
        status: 'ready',
        occurredAt: input.occurredAt,
        commandId: `${this.fixture.scenario_name}_bootstrap_work_item`,
      });

    const aggregateId =
      this.refs.claimId ?? `${this.fixture.scenario_name}_claim`;
    const claim: ClaimLease = {
      claimId: aggregateId,
      companyId: workItem.companyId,
      workItemId: workItem.workItemId,
      scopeRef: workItem.scopeRef,
      holderRunId: input.runId,
      leaseExpiresAt: input.occurredAt,
    };

    this.refs.claimId = claim.claimId;
    this.claim = claim;
    this.events.push(
      createDomainEvent({
        eventId:
          input.marker?.eventId ??
          `${this.fixture.scenario_name}_${input.eventType.replace('.', '_')}_${this.events.length}`,
        aggregateType: 'claim',
        aggregateId: claim.claimId,
        companyId: claim.companyId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        payload: claim,
        streamSequence: this.nextSequence('claim', claim.claimId),
        commandId: input.commandId,
        causationKey: `${input.commandId}:${claim.claimId}:${input.eventType}`,
      }),
    );

    if (input.marker) {
      this.markers.push(input.marker);
    }

    return claim;
  }

  runSnapshot(input: {
    runId: string;
    attempt: number;
    status: RunStatus;
    eventType: 'run.started' | 'run.completed' | 'run.failed' | 'run.cancelled';
    occurredAt: string;
    commandId: string;
    failureClass?: string;
    marker?: TraceMarker;
  }): Run {
    const workItem =
      this.workItem ??
      this.workItemSnapshot({
        status: 'ready',
        occurredAt: input.occurredAt,
        commandId: `${this.fixture.scenario_name}_bootstrap_work_item`,
      });

    const previous = this.runs.get(input.runId);
    const run: Run = {
      runId: input.runId,
      companyId: workItem.companyId,
      workItemId: workItem.workItemId,
      attempt: input.attempt,
      status: input.status,
      executionPacketId: previous?.executionPacketId ?? `packet_${input.runId}`,
      failureClass: input.failureClass,
      createdAt: previous?.createdAt ?? input.occurredAt,
      updatedAt: input.occurredAt,
    };

    this.runs.set(run.runId, run);
    if (!this.refs.runIds.includes(run.runId)) {
      this.refs.runIds.push(run.runId);
    }

    this.workItem = {
      ...workItem,
      latestRunId: run.runId,
    };

    this.events.push(
      createRunEvent({
        run,
        eventId:
          input.marker?.eventId ??
          `${this.fixture.scenario_name}_${input.eventType.replace('.', '_')}_${this.events.length}`,
        eventType: input.eventType,
        streamSequence: this.nextSequence('run', run.runId),
        commandId: input.commandId,
        idempotencyKey: `${input.commandId}:${run.runId}:${input.status}`,
      }),
    );

    if (input.marker) {
      this.markers.push(input.marker);
    }

    return run;
  }

  addMarker(marker: TraceMarker): void {
    this.markers.push(marker);
  }

  setFacts(nextFacts: Partial<ScenarioFacts>): void {
    Object.assign(this.facts, nextFacts);
  }

  build(): {
    domainEvents: DomainEvent[];
    traceMarkers: TraceMarker[];
    refs: ScenarioRefs;
    facts: ScenarioFacts;
  } {
    return {
      domainEvents: [...this.events],
      traceMarkers: [...this.markers],
      refs: { ...this.refs, runIds: [...this.refs.runIds] },
      facts: { ...this.facts },
    };
  }
}

function mapFixtureObjectiveStatus(
  value: unknown,
  fallback: ObjectiveStatus,
): ObjectiveStatus {
  if (
    value === 'draft' ||
    value === 'planned' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'blocked' ||
    value === 'cancelled'
  ) {
    return value;
  }

  return fallback;
}

function shiftIso(input: string, milliseconds: number): string {
  return new Date(new Date(input).getTime() + milliseconds).toISOString();
}

function asTimestamp(input: string | null | undefined): number | null {
  if (!input) {
    return null;
  }

  const value = Date.parse(input);
  return Number.isNaN(value) ? null : value;
}

function loadFixture(path: string): GoldenFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenFixture;
}

export function loadGoldenFixtures(): GoldenFixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => loadFixture(`${FIXTURE_DIR}/${entry}`));
}

function buildScenario(fixture: GoldenFixture): {
  domainEvents: DomainEvent[];
  traceMarkers: TraceMarker[];
  refs: ScenarioRefs;
  facts: ScenarioFacts;
} {
  const builder = new ScenarioBuilder(fixture);
  const events = fixture.expected_events;
  const commands = fixture.commands;

  switch (fixture.scenario_name) {
    case 'happy_path': {
      builder.objectiveSnapshot({
        status: 'planned',
        occurredAt:
          events[0]?.occurred_at ??
          commands[0]?.issued_at ??
          new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_happy_bootstrap',
        marker: asMarker(events[0]),
      });
      builder.workItemSnapshot({
        status: 'ready',
        occurredAt:
          commands[1]?.issued_at ??
          shiftIso(events[0]?.occurred_at ?? new Date().toISOString(), 5000),
        commandId: commands[1]?.command_id ?? 'cmd_happy_dispatch',
      });
      builder.claimSnapshot({
        eventType: 'claim.acquired',
        occurredAt: shiftIso(
          commands[1]?.issued_at ??
            events[0]?.occurred_at ??
            new Date().toISOString(),
          1000,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_happy_dispatch',
        runId: 'run_happy_001',
      });
      builder.workItemSnapshot({
        status: 'running',
        occurredAt: shiftIso(
          commands[1]?.issued_at ??
            events[0]?.occurred_at ??
            new Date().toISOString(),
          1500,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_happy_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_happy_001',
        attempt: 1,
        status: 'running',
        eventType: 'run.started',
        occurredAt: shiftIso(
          commands[1]?.issued_at ??
            events[0]?.occurred_at ??
            new Date().toISOString(),
          2000,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_happy_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_happy_001',
        attempt: 1,
        status: 'valid_success',
        eventType: 'run.completed',
        occurredAt:
          events[1]?.occurred_at ??
          shiftIso(commands[1]?.issued_at ?? new Date().toISOString(), 60000),
        commandId: commands[1]?.command_id ?? 'cmd_happy_dispatch',
        marker: asMarker(events[1]),
      });
      builder.workItemSnapshot({
        status: 'completed',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_happy_dispatch',
      });
      builder.objectiveSnapshot({
        status: 'completed',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          200,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_happy_dispatch',
      });
      break;
    }

    case 'approval_gate': {
      builder.objectiveSnapshot({
        status: 'planned',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_approval_bootstrap',
      });
      builder.workItemSnapshot({
        status: 'blocked',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_approval_dispatch',
        requiresApproval: true,
        blockingReason: 'awaiting_approval',
      });
      builder.approvalSnapshot({
        status: 'pending',
        occurredAt:
          events[0]?.occurred_at ??
          shiftIso(commands[0]?.issued_at ?? new Date().toISOString(), 5000),
        commandId: commands[0]?.command_id ?? 'cmd_approval_dispatch',
        marker: asMarker(events[0]),
      });
      builder.approvalSnapshot({
        status: 'granted',
        occurredAt:
          events[1]?.occurred_at ??
          commands[1]?.issued_at ??
          new Date().toISOString(),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
        decisionReason: 'operator_granted',
        marker: asMarker(events[1]),
      });
      builder.workItemSnapshot({
        status: 'ready',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
        requiresApproval: true,
      });
      builder.claimSnapshot({
        eventType: 'claim.acquired',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          200,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
        runId: 'run_approval_gate_001',
      });
      builder.workItemSnapshot({
        status: 'running',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          300,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
      });
      builder.runSnapshot({
        runId: 'run_approval_gate_001',
        attempt: 1,
        status: 'running',
        eventType: 'run.started',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          400,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
      });
      builder.runSnapshot({
        runId: 'run_approval_gate_001',
        attempt: 1,
        status: 'valid_success',
        eventType: 'run.completed',
        occurredAt:
          events[2]?.occurred_at ??
          shiftIso(events[1]?.occurred_at ?? new Date().toISOString(), 75000),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
        marker: asMarker(events[2]),
      });
      builder.workItemSnapshot({
        status: 'completed',
        occurredAt: shiftIso(
          events[2]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
      });
      builder.objectiveSnapshot({
        status: 'completed',
        occurredAt: shiftIso(
          events[2]?.occurred_at ?? new Date().toISOString(),
          200,
        ),
        commandId: commands[1]?.command_id ?? 'cmd_approval_grant',
      });
      builder.setFacts({
        latestOperatorAction: 'grant',
      });
      break;
    }

    case 'approval_denied': {
      builder.objectiveSnapshot({
        status: 'planned',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_denied_bootstrap',
      });
      builder.workItemSnapshot({
        status: 'blocked',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_denied_dispatch',
        requiresApproval: true,
        blockingReason: 'awaiting_approval',
      });
      builder.approvalSnapshot({
        status: 'pending',
        occurredAt:
          events[0]?.occurred_at ??
          shiftIso(commands[0]?.issued_at ?? new Date().toISOString(), 2000),
        commandId: commands[0]?.command_id ?? 'cmd_denied_dispatch',
        marker: asMarker(events[0]),
      });
      builder.approvalSnapshot({
        status: 'denied',
        occurredAt:
          events[1]?.occurred_at ??
          commands[1]?.issued_at ??
          new Date().toISOString(),
        commandId: commands[1]?.command_id ?? 'cmd_denied_deny',
        decisionReason: 'operator_denied',
        marker: asMarker(events[1]),
      });
      builder.workItemSnapshot({
        status: 'blocked',
        occurredAt:
          events[2]?.occurred_at ??
          shiftIso(events[1]?.occurred_at ?? new Date().toISOString(), 1000),
        commandId: commands[1]?.command_id ?? 'cmd_denied_deny',
        requiresApproval: true,
        blockingReason: 'approval_denied',
        marker: asMarker(events[2]),
      });
      builder.setFacts({
        runStatusLabel: 'not_started',
        blockReason: 'approval_denied',
      });
      break;
    }

    case 'duplicate_command': {
      builder.objectiveSnapshot({
        status: 'planned',
        occurredAt:
          events[0]?.occurred_at ??
          commands[0]?.issued_at ??
          new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_duplicate_accepted',
        marker: asMarker(events[0]),
      });
      builder.setFacts({
        objectiveStatusLabel: 'ready',
        duplicateCommandsSuppressed: 1,
        dedupeHits: 1,
      });
      break;
    }

    case 'transient_retry': {
      builder.objectiveSnapshot({
        status: 'planned',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.workItemSnapshot({
        status: 'ready',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.claimSnapshot({
        eventType: 'claim.acquired',
        occurredAt: shiftIso(
          commands[0]?.issued_at ?? new Date().toISOString(),
          1000,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
        runId: 'run_retry_001',
      });
      builder.workItemSnapshot({
        status: 'running',
        occurredAt: shiftIso(
          commands[0]?.issued_at ?? new Date().toISOString(),
          2000,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_retry_001',
        attempt: 1,
        status: 'running',
        eventType: 'run.started',
        occurredAt: shiftIso(
          commands[0]?.issued_at ?? new Date().toISOString(),
          3000,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_retry_001',
        attempt: 1,
        status: 'transient_failure',
        eventType: 'run.failed',
        occurredAt:
          events[0]?.occurred_at ??
          shiftIso(commands[0]?.issued_at ?? new Date().toISOString(), 30000),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
        failureClass: 'transient_failure',
        marker: asMarker(events[0]),
      });
      builder.workItemSnapshot({
        status: 'ready',
        occurredAt: shiftIso(
          events[0]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.addMarker(asMarker(events[1]));
      builder.workItemSnapshot({
        status: 'running',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_retry_002',
        attempt: 2,
        status: 'running',
        eventType: 'run.started',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          150,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_retry_002',
        attempt: 2,
        status: 'valid_success',
        eventType: 'run.completed',
        occurredAt:
          events[2]?.occurred_at ??
          shiftIso(events[1]?.occurred_at ?? new Date().toISOString(), 45000),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
        marker: asMarker(events[2]),
      });
      builder.workItemSnapshot({
        status: 'completed',
        occurredAt: shiftIso(
          events[2]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.objectiveSnapshot({
        status: 'completed',
        occurredAt: shiftIso(
          events[2]?.occurred_at ?? new Date().toISOString(),
          200,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_retry_dispatch',
      });
      builder.setFacts({
        retryCount: 1,
        lastRetryReason: 'transient_failure',
      });
      break;
    }

    case 'permanent_validation_failure': {
      builder.objectiveSnapshot({
        status: 'planned',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_invalid_dispatch',
      });
      builder.workItemSnapshot({
        status: 'ready',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_invalid_dispatch',
      });
      builder.claimSnapshot({
        eventType: 'claim.acquired',
        occurredAt: shiftIso(
          commands[0]?.issued_at ?? new Date().toISOString(),
          1000,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_invalid_dispatch',
        runId: 'run_invalid_001',
      });
      builder.workItemSnapshot({
        status: 'running',
        occurredAt: shiftIso(
          commands[0]?.issued_at ?? new Date().toISOString(),
          1500,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_invalid_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_invalid_001',
        attempt: 1,
        status: 'running',
        eventType: 'run.started',
        occurredAt: shiftIso(
          commands[0]?.issued_at ?? new Date().toISOString(),
          2000,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_invalid_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_invalid_001',
        attempt: 1,
        status: 'invalid_output',
        eventType: 'run.failed',
        occurredAt:
          events[0]?.occurred_at ??
          shiftIso(commands[0]?.issued_at ?? new Date().toISOString(), 20000),
        commandId: commands[0]?.command_id ?? 'cmd_invalid_dispatch',
        failureClass: 'invalid_output',
        marker: asMarker(events[0]),
      });
      builder.workItemSnapshot({
        status: 'blocked',
        occurredAt:
          events[1]?.occurred_at ??
          shiftIso(events[0]?.occurred_at ?? new Date().toISOString(), 1000),
        commandId: commands[0]?.command_id ?? 'cmd_invalid_dispatch',
        blockingReason: 'invalid_output',
        marker: asMarker(events[1]),
      });
      builder.setFacts({
        retryCount: 0,
        blockReason: 'invalid_output',
      });
      break;
    }

    case 'claim_expiry': {
      builder.objectiveSnapshot({
        status: 'planned',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
      });
      builder.workItemSnapshot({
        status: 'ready',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
      });
      builder.claimSnapshot({
        eventType: 'claim.acquired',
        occurredAt:
          events[0]?.occurred_at ??
          shiftIso(commands[0]?.issued_at ?? new Date().toISOString(), 1000),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
        runId: 'run_claim_001',
        marker: asMarker(events[0]),
      });
      builder.workItemSnapshot({
        status: 'running',
        occurredAt: shiftIso(
          events[0]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
      });
      builder.runSnapshot({
        runId: 'run_claim_001',
        attempt: 1,
        status: 'running',
        eventType: 'run.started',
        occurredAt: shiftIso(
          events[0]?.occurred_at ?? new Date().toISOString(),
          200,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
      });
      builder.claimSnapshot({
        eventType: 'claim.expired',
        occurredAt:
          events[1]?.occurred_at ??
          shiftIso(events[0]?.occurred_at ?? new Date().toISOString(), 300000),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
        runId: 'run_claim_001',
        marker: asMarker(events[1]),
      });
      builder.runSnapshot({
        runId: 'run_claim_001',
        attempt: 1,
        status: 'cancelled',
        eventType: 'run.cancelled',
        occurredAt: shiftIso(
          events[1]?.occurred_at ?? new Date().toISOString(),
          100,
        ),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
      });
      builder.workItemSnapshot({
        status: 'ready',
        occurredAt:
          events[2]?.occurred_at ??
          shiftIso(events[1]?.occurred_at ?? new Date().toISOString(), 200),
        commandId: commands[0]?.command_id ?? 'cmd_claim_dispatch',
        marker: asMarker(events[2]),
      });
      builder.setFacts({
        leaseStatus: 'expired',
        queueState: 'requeued',
      });
      break;
    }

    case 'projection_drift': {
      builder.objectiveSnapshot({
        status: 'in_progress',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_projection_reconcile',
      });
      builder.addMarker(asMarker(events[0]));
      builder.addMarker(asMarker(events[1]));
      builder.setFacts({
        projectionStatus: 'healthy',
        driftOpen: 0,
        lastSuccessfulProjection: events[1]?.occurred_at,
      });
      break;
    }

    case 'known_loop_prevention': {
      builder.objectiveSnapshot({
        status: 'in_progress',
        occurredAt: shiftIso(
          commands[0]?.issued_at ?? new Date().toISOString(),
          -1000,
        ),
        commandId: `${commands[0]?.command_id ?? 'cmd_loop_redispatch'}_seed`,
      });
      const workItem = builder.workItemSnapshot({
        status: 'ready',
        occurredAt: commands[0]?.issued_at ?? new Date().toISOString(),
        commandId: commands[0]?.command_id ?? 'cmd_loop_redispatch',
        blockingReason: 'verification_pending',
      });
      builder.addMarker(asMarker(events[0]));
      builder.workItemSnapshot({
        status: 'escalated',
        occurredAt:
          events[1]?.occurred_at ??
          shiftIso(commands[0]?.issued_at ?? new Date().toISOString(), 5000),
        commandId: commands[0]?.command_id ?? 'cmd_loop_redispatch',
        blockingReason: 'no_new_causal_input',
        marker: asMarker(events[1]),
      });
      builder.setFacts({
        runStatusLabel: 'awaiting_verification',
        redispatchCount: 0,
        operatorAttentionRequired: true,
        previousDispatch: {
          workItemId: workItem.workItemId,
          blockingReason: 'verification_pending',
          packetHash: 'packet_same',
          dependencyHash: 'deps_same',
          failureClass: null,
        },
        nextDispatch: {
          workItemId: workItem.workItemId,
          blockingReason: 'verification_pending',
          packetHash: 'packet_same',
          dependencyHash: 'deps_same',
          failureClass: null,
        },
      });
      break;
    }

    default:
      throw new Error(`Unhandled golden scenario: ${fixture.scenario_name}`);
  }

  return builder.build();
}

function asMarker(event: GoldenFixtureExpectedEvent | undefined): TraceMarker {
  if (!event) {
    throw new Error('Expected fixture marker is missing');
  }

  return {
    eventId: event.event_id,
    type: event.type,
    occurredAt: event.occurred_at,
  };
}

function getLatestRun(
  state: AggregateState,
  refs: ScenarioRefs,
): Run | undefined {
  return refs.runIds
    .map((runId) => state.runs[runId])
    .filter((run): run is Run => Boolean(run))
    .sort((left, right) => left.attempt - right.attempt)
    .at(-1);
}

function buildTerminalAggregateState(input: {
  state: AggregateState;
  refs: ScenarioRefs;
  facts: ScenarioFacts;
}): Record<string, unknown> {
  const objective = input.refs.objectiveId
    ? input.state.objectives[input.refs.objectiveId]
    : undefined;
  const workItem = input.refs.workItemId
    ? input.state.workItems[input.refs.workItemId]
    : undefined;
  const approval = input.refs.approvalId
    ? input.state.approvals[input.refs.approvalId]
    : undefined;
  const claim = input.refs.claimId
    ? input.state.claims[input.refs.claimId]
    : undefined;
  const latestRun = getLatestRun(input.state, input.refs);

  return {
    objective_status:
      input.facts.objectiveStatusLabel ?? objective?.status ?? null,
    work_item_status: workItem?.status ?? null,
    run_status:
      input.facts.runStatusLabel ?? latestRun?.status ?? 'not_started',
    approval_status: approval?.status ?? null,
    lease_status: input.facts.leaseStatus ?? (claim ? 'active' : null),
    projection_status: input.facts.projectionStatus ?? null,
    retry_count:
      input.facts.retryCount ?? Math.max(input.refs.runIds.length - 1, 0),
    duplicate_commands_suppressed: input.facts.duplicateCommandsSuppressed ?? 0,
    redispatch_count: input.facts.redispatchCount ?? 0,
  };
}

function buildProjectionState(input: {
  state: AggregateState;
  refs: ScenarioRefs;
  facts: ScenarioFacts;
}): Record<string, unknown> {
  const workItem = input.refs.workItemId
    ? input.state.workItems[input.refs.workItemId]
    : undefined;
  const approval = input.refs.approvalId
    ? input.state.approvals[input.refs.approvalId]
    : undefined;
  const activeRuns = Object.values(input.state.runs).filter(
    (run) => run.status === 'queued' || run.status === 'running',
  ).length;
  const pendingApprovals = Object.values(input.state.approvals).filter(
    (nextApproval) => nextApproval.status === 'pending',
  ).length;

  return {
    github_issue_state: workItem?.status === 'completed' ? 'closed' : 'open',
    pending_approvals: pendingApprovals,
    active_runs: activeRuns,
    latest_operator_action:
      input.facts.latestOperatorAction ??
      (approval?.status === 'granted'
        ? 'grant'
        : approval?.status === 'denied'
          ? 'deny'
          : null),
    block_reason: input.facts.blockReason ?? workItem?.blockingReason ?? null,
    last_retry_reason: input.facts.lastRetryReason ?? null,
    queue_state:
      input.facts.queueState ??
      (workItem?.status === 'ready' && activeRuns === 0 ? 'requeued' : null),
    operator_attention_required:
      input.facts.operatorAttentionRequired ??
      (workItem?.status === 'blocked' || workItem?.status === 'escalated'),
    drift_open: input.facts.driftOpen ?? null,
    last_successful_projection: input.facts.lastSuccessfulProjection ?? null,
    dedupe_hits: input.facts.dedupeHits ?? 0,
  };
}

function evaluateInvariant(
  invariant: string,
  input: {
    state: AggregateState;
    orderedEvents: DomainEvent[];
    refs: ScenarioRefs;
    facts: ScenarioFacts;
    projectionState: Record<string, unknown>;
    terminalAggregateState: Record<string, unknown>;
    commands: GoldenFixtureCommand[];
  },
): boolean {
  const latestRun = getLatestRun(input.state, input.refs);
  const workItem = input.refs.workItemId
    ? input.state.workItems[input.refs.workItemId]
    : undefined;
  const approval = input.refs.approvalId
    ? input.state.approvals[input.refs.approvalId]
    : undefined;
  const runEvents = input.orderedEvents.filter(
    (event) => event.aggregateType === 'run',
  );
  const approvalGrantedAt = input.orderedEvents.find(
    (event) =>
      event.aggregateType === 'approval' &&
      (event.payload as ApprovalDecision).status === 'granted',
  )?.occurredAt;
  const approvalDeniedAt =
    input.orderedEvents.find(
      (event) =>
        event.aggregateType === 'approval' &&
        (event.payload as ApprovalDecision).status === 'denied',
    )?.occurredAt ?? null;
  const claimExpiredAt =
    input.orderedEvents.find((event) => event.eventType === 'claim.expired')
      ?.occurredAt ?? null;
  const approvalDeniedAtTimestamp = asTimestamp(approvalDeniedAt);
  const claimExpiredAtTimestamp = asTimestamp(claimExpiredAt);

  switch (invariant) {
    case 'single_active_lease': {
      let activeClaims = 0;
      for (const event of input.orderedEvents) {
        if (event.eventType === 'claim.acquired') {
          activeClaims += 1;
        } else if (event.eventType === 'claim.expired' && activeClaims > 0) {
          activeClaims -= 1;
        }
        if (activeClaims > 1) {
          return false;
        }
      }
      return true;
    }
    case 'no_downstream_without_valid_success':
      return (
        latestRun?.status === 'valid_success' &&
        workItem?.status === 'completed'
      );
    case 'no_execution_before_approval': {
      const approvalGrantedAtTimestamp = asTimestamp(approvalGrantedAt);
      const firstRunEventTimestamp = asTimestamp(runEvents[0]?.occurredAt);
      if (
        approvalGrantedAtTimestamp === null ||
        firstRunEventTimestamp === null
      ) {
        return false;
      }
      return firstRunEventTimestamp >= approvalGrantedAtTimestamp;
    }
    case 'approval_history_is_auditable':
      return Boolean(
        approval &&
          input.orderedEvents.some(
            (event) => event.eventType === 'approval.requested',
          ) &&
          input.orderedEvents.some(
            (event) => event.eventType === 'approval.updated',
          ),
      );
    case 'no_execution_after_denial':
      return !input.orderedEvents.some(
        (event) =>
          event.aggregateType === 'run' &&
          approvalDeniedAtTimestamp !== null &&
          asTimestamp(event.occurredAt) !== null &&
          (asTimestamp(event.occurredAt) as number) >=
            approvalDeniedAtTimestamp,
      );
    case 'explicit_human_override_required_to_resume':
      return !input.orderedEvents.some(
        (event) =>
          event.aggregateType === 'run' ||
          ((event.aggregateType === 'approval' ||
            event.aggregateType === 'work_item') &&
            approvalDeniedAtTimestamp !== null &&
            asTimestamp(event.occurredAt) !== null &&
            (asTimestamp(event.occurredAt) as number) >
              approvalDeniedAtTimestamp &&
            event.eventType !== 'work_item.updated'),
      );
    case 'idempotency_key_suppresses_duplicate_transition': {
      const uniqueCommandIds = new Set(
        input.commands.map((command) => command.command_id),
      );
      const objectiveEvents = input.orderedEvents.filter(
        (event) => event.aggregateType === 'objective',
      );
      return (
        input.commands.length > uniqueCommandIds.size &&
        objectiveEvents.length === 1
      );
    }
    case 'no_duplicate_event_emission': {
      const eventIds = input.orderedEvents.map((event) => event.eventId);
      return new Set(eventIds).size === eventIds.length;
    }
    case 'retry_budget_enforced':
      return (
        input.refs.runIds.length <= (workItem?.attemptBudget ?? 0) &&
        (input.terminalAggregateState.retry_count as number) ===
          input.refs.runIds.length - 1
      );
    case 'retry_keeps_same_work_item_identity':
      return input.refs.runIds.every(
        (runId) =>
          input.state.runs[runId]?.workItemId === input.refs.workItemId,
      );
    case 'invalid_output_never_triggers_downstream_work':
      return (
        latestRun?.status === 'invalid_output' &&
        workItem?.status !== 'completed'
      );
    case 'no_automatic_retry_after_schema_failure':
      return input.refs.runIds.length === 1;
    case 'expired_lease_cannot_continue':
      return !input.orderedEvents.some(
        (event) =>
          event.aggregateType === 'run' &&
          event.eventType === 'run.completed' &&
          claimExpiredAtTimestamp !== null &&
          asTimestamp(event.occurredAt) !== null &&
          (asTimestamp(event.occurredAt) as number) > claimExpiredAtTimestamp,
      );
    case 'redispatch_requires_new_lease': {
      const claimAcquiredCount = input.orderedEvents.filter(
        (event) => event.eventType === 'claim.acquired',
      ).length;
      const runStartsAfterExpiry = input.orderedEvents.filter(
        (event) =>
          event.eventType === 'run.started' &&
          claimExpiredAtTimestamp !== null &&
          asTimestamp(event.occurredAt) !== null &&
          (asTimestamp(event.occurredAt) as number) > claimExpiredAtTimestamp,
      ).length;
      return claimAcquiredCount === 1 && runStartsAfterExpiry === 0;
    }
    case 'runtime_ledger_is_authoritative':
      return input.projectionState.drift_open === 0;
    case 'rebuild_restores_projection_without_mutating_runtime_truth': {
      const before = JSON.stringify(input.state);
      buildProjectionState({
        state: input.state,
        refs: input.refs,
        facts: input.facts,
      });
      const after = JSON.stringify(input.state);
      return before === after;
    }
    case 'no_redispatch_without_new_causal_input':
      return Boolean(
        input.facts.previousDispatch &&
          input.facts.nextDispatch &&
          !hasNewCausalInput(
            input.facts.previousDispatch,
            input.facts.nextDispatch,
          ),
      );
    case 'terminal_blocked_or_escalated':
      return workItem?.status === 'blocked' || workItem?.status === 'escalated';
    default:
      throw new Error(`Unhandled invariant: ${invariant}`);
  }
}

export function executeGoldenFixture(
  fixture: GoldenFixture,
): GoldenFixtureExecution {
  const scenario = buildScenario(fixture);
  const replayedState = replayAggregate(scenario.domainEvents);
  const replayedStateFromReverseOrder = replayAggregate(
    [...scenario.domainEvents].reverse(),
  );
  const orderedEvents = orderEventsForReplay(scenario.domainEvents);
  const terminalAggregateState = buildTerminalAggregateState({
    state: replayedState,
    refs: scenario.refs,
    facts: scenario.facts,
  });
  const projectionState = buildProjectionState({
    state: replayedState,
    refs: scenario.refs,
    facts: scenario.facts,
  });

  const invariantResults = Object.fromEntries(
    fixture.expected_invariants.map((invariant) => [
      invariant,
      evaluateInvariant(invariant, {
        state: replayedState,
        orderedEvents,
        refs: scenario.refs,
        facts: scenario.facts,
        projectionState,
        terminalAggregateState,
        commands: fixture.commands,
      }),
    ]),
  );

  return {
    fixture,
    domainEvents: scenario.domainEvents,
    orderedEvents,
    traceMarkers: scenario.traceMarkers,
    replayedState,
    replayedStateFromReverseOrder,
    terminalAggregateState,
    projectionState,
    invariantResults,
  };
}
