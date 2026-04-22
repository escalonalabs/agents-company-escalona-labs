import { createHash, randomUUID } from 'node:crypto';

import type {
  ApprovalDecision,
  ClaimLease,
  Company,
  DomainEvent,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';
import {
  type DispatchSignature,
  createApprovalEvent,
  createClaimEvent,
  createCompanyCreatedEvent,
  createCompanyEvent,
  createObjectiveEvent,
  createRunEvent,
  createWorkItemEvent,
  nextStreamSequence,
} from '@escalonalabs/kernel';
import { deriveObjectiveStatus } from '@escalonalabs/orchestration';

import {
  type Queryable,
  appendDomainEvent,
  listDomainEvents,
} from './db/events';
import {
  insertCompany,
  listWorkItemsByObjective,
  upsertApproval,
  upsertCompany,
  upsertObjective,
  upsertRun,
  upsertWorkItem,
} from './db/runtime';

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function getNextSequence(
  db: Queryable,
  companyId: string,
  aggregateType: DomainEvent['aggregateType'],
  aggregateId: string,
): Promise<number> {
  const existingEvents = await listDomainEvents(db, {
    companyId,
    aggregateType,
    aggregateId,
    limit: 1000,
  });

  return nextStreamSequence(existingEvents, aggregateType, aggregateId);
}

export async function persistCompanyCreated(
  db: Queryable,
  input: {
    company: Company;
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<string> {
  const event = createCompanyCreatedEvent({
    company: input.company,
    eventId: `evt_${randomUUID()}`,
    streamSequence: await getNextSequence(
      db,
      input.company.companyId,
      'company',
      input.company.companyId,
    ),
    commandId: input.commandId,
    idempotencyKey: `${input.idempotencyKey}:company`,
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);
  await insertCompany(db, input.company);

  return event.eventId;
}

export async function persistCompanyUpdated(
  db: Queryable,
  input: {
    company: Company;
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<string> {
  const event = createCompanyEvent({
    company: input.company,
    eventId: `evt_${randomUUID()}`,
    eventType: 'company.updated',
    streamSequence: await getNextSequence(
      db,
      input.company.companyId,
      'company',
      input.company.companyId,
    ),
    commandId: input.commandId,
    idempotencyKey: `${input.idempotencyKey}:company`,
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);
  await upsertCompany(db, input.company);

  return event.eventId;
}

export async function persistObjectiveSnapshot(
  db: Queryable,
  input: {
    objective: Objective;
    eventType: 'objective.created' | 'objective.updated';
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<string> {
  const event = createObjectiveEvent({
    objective: input.objective,
    eventId: `evt_${randomUUID()}`,
    eventType: input.eventType,
    streamSequence: await getNextSequence(
      db,
      input.objective.companyId,
      'objective',
      input.objective.objectiveId,
    ),
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);
  await upsertObjective(db, input.objective);

  return event.eventId;
}

export async function persistWorkItemSnapshot(
  db: Queryable,
  input: {
    workItem: WorkItem;
    eventType: 'work_item.created' | 'work_item.updated';
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<string> {
  const event = createWorkItemEvent({
    workItem: input.workItem,
    eventId: `evt_${randomUUID()}`,
    eventType: input.eventType,
    streamSequence: await getNextSequence(
      db,
      input.workItem.companyId,
      'work_item',
      input.workItem.workItemId,
    ),
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);
  await upsertWorkItem(db, input.workItem);

  return event.eventId;
}

export async function persistRunSnapshot(
  db: Queryable,
  input: {
    run: Run;
    eventType: 'run.started' | 'run.completed' | 'run.failed' | 'run.cancelled';
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<string> {
  const event = createRunEvent({
    run: input.run,
    eventId: `evt_${randomUUID()}`,
    eventType: input.eventType,
    streamSequence: await getNextSequence(
      db,
      input.run.companyId,
      'run',
      input.run.runId,
    ),
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);
  await upsertRun(db, input.run);

  return event.eventId;
}

export async function persistApprovalSnapshot(
  db: Queryable,
  input: {
    approval: ApprovalDecision;
    eventType: 'approval.requested' | 'approval.updated';
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<string> {
  const event = createApprovalEvent({
    approval: input.approval,
    eventId: `evt_${randomUUID()}`,
    eventType: input.eventType,
    streamSequence: await getNextSequence(
      db,
      input.approval.companyId,
      'approval',
      input.approval.approvalId,
    ),
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);
  await upsertApproval(db, input.approval);

  return event.eventId;
}

export async function persistClaimEvent(
  db: Queryable,
  input: {
    claim: ClaimLease;
    occurredAt: string;
    eventType: 'claim.acquired' | 'claim.expired';
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<string> {
  const event = createClaimEvent({
    claim: input.claim,
    eventId: `evt_${randomUUID()}`,
    eventType: input.eventType,
    streamSequence: await getNextSequence(
      db,
      input.claim.companyId,
      'claim',
      input.claim.claimId,
    ),
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);

  return event.eventId;
}

export function buildDispatchSignature(input: {
  workItem: WorkItem;
  approval?: ApprovalDecision | null;
  packetSeed: unknown;
  failureClass?: string | null;
}): DispatchSignature {
  return {
    workItemId: input.workItem.workItemId,
    blockingReason: input.workItem.blockingReason ?? null,
    packetHash: hashValue(input.packetSeed),
    dependencyHash: hashValue({
      scopeRef: input.workItem.scopeRef,
      approvalRequired: input.workItem.requiresApproval,
      approvalStatus: input.approval?.status ?? 'none',
    }),
    failureClass: input.failureClass ?? null,
  };
}

export interface PacketSignatureSeed {
  assignedAgentId: string;
  objectiveContext: string;
  toolAllowlist: string[];
  authorizedToolRequests: Array<{
    toolKind: string;
    toolName: string;
    toolVersion: string;
    capabilityRef: string;
    scopeRef: string;
    timeoutMs: number;
    requestPayload: Record<string, unknown>;
  }>;
  scopeAllowlist: string[];
  inputArtifactRefs: string[];
  expectedResultSchemaRef: string;
  policySnapshotRef: string;
}

export function createPacketSignatureSeed(input: {
  assignedAgentId: string;
  objectiveContext: string;
  toolAllowlist: string[];
  authorizedToolRequests: Array<{
    toolKind: string;
    toolName: string;
    toolVersion?: string;
    capabilityRef: string;
    scopeRef: string;
    timeoutMs?: number;
    requestPayload: Record<string, unknown>;
  }>;
  scopeAllowlist: string[];
  inputArtifactRefs: string[];
  expectedResultSchemaRef: string;
  policySnapshotRef: string;
}): PacketSignatureSeed {
  return {
    assignedAgentId: input.assignedAgentId,
    objectiveContext: input.objectiveContext,
    toolAllowlist: input.toolAllowlist,
    authorizedToolRequests: input.authorizedToolRequests.map((request) => ({
      toolKind: request.toolKind,
      toolName: request.toolName,
      toolVersion: request.toolVersion ?? '1.0.0',
      capabilityRef: request.capabilityRef,
      scopeRef: request.scopeRef,
      timeoutMs: request.timeoutMs ?? 30_000,
      requestPayload: request.requestPayload,
    })),
    scopeAllowlist: input.scopeAllowlist,
    inputArtifactRefs: input.inputArtifactRefs,
    expectedResultSchemaRef: input.expectedResultSchemaRef,
    policySnapshotRef: input.policySnapshotRef,
  };
}

export async function syncObjectiveStatus(
  db: Queryable,
  input: {
    objective: Objective;
    commandId: string;
    idempotencyKey: string;
    actorRef: string;
  },
): Promise<{ objective: Objective; eventId?: string }> {
  const objectiveWorkItems = await listWorkItemsByObjective(
    db,
    input.objective.objectiveId,
  );
  const nextStatus = deriveObjectiveStatus(objectiveWorkItems);

  if (input.objective.status === nextStatus) {
    return { objective: input.objective };
  }

  const nextObjective: Objective = {
    ...input.objective,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  };

  const eventId = await persistObjectiveSnapshot(db, {
    objective: nextObjective,
    eventType: 'objective.updated',
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    actorRef: input.actorRef,
  });

  return { objective: nextObjective, eventId };
}

export function formatValidationFailureSummary(issues: string[]): string {
  return `Task result rejected by validator: ${issues.join('; ')}`;
}
