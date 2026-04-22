import { randomUUID } from 'node:crypto';

import type {
  ClaimLease,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';
import {
  type ExecutionPacket,
  type TaskResult as ExecutionTaskResult,
  type ExecutorResult,
  createExecutionPacket,
  createToolRequestEnvelope,
  mapTaskResultToRunStatus,
  validateTaskResult,
} from '@escalonalabs/execution';
import {
  createDispatchDecision,
  mapTaskResultToWorkItemStatus,
} from '@escalonalabs/orchestration';

import { loadControlPlaneConfig } from './config';
import { recordCommandLogEntry } from './db/events';
import { closePool, getPool } from './db/pool';
import {
  dequeueQueuedRun,
  getActiveClaimLeaseByRunId,
  getApprovalByWorkItemId,
  getExecutionPacketByRunId,
  getObjectiveById,
  getRunById,
  getWorkItemById,
  listRunsByWorkItem,
  releaseClaimLeaseByRunId,
  storeExecutionPacket,
  storeRunEffect,
  updateClaimLease,
} from './db/runtime';
import { executeAuthorizedToolRequest } from './executors';
import {
  buildDispatchSignature,
  formatValidationFailureSummary,
  persistClaimEvent,
  persistRunSnapshot,
  persistWorkItemSnapshot,
  syncObjectiveStatus,
} from './runtime-ledger';

const RETRY_BACKOFF_MS = [15_000, 60_000, 300_000] as const;
const DEFAULT_CLAIM_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function makeEventCausationKey(base: string, suffix: string): string {
  return `${base}:${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseTimestamp(value: string): number {
  return new Date(value).getTime();
}

function getClaimLeaseTtlMs(): number {
  const value = Number(process.env.AGENTS_COMPANY_CLAIM_LEASE_TTL_MS ?? '');
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_CLAIM_LEASE_TTL_MS;
}

function getWorkerPollIntervalMs(): number {
  const value = Number(
    process.env.AGENTS_COMPANY_WORKER_POLL_INTERVAL_MS ?? '',
  );
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_POLL_INTERVAL_MS;
}

function addMs(isoTimestamp: string, milliseconds: number): string {
  return new Date(parseTimestamp(isoTimestamp) + milliseconds).toISOString();
}

function selectRetryBackoffMs(attempt: number): number {
  const index = Math.min(Math.max(attempt - 1, 0), RETRY_BACKOFF_MS.length - 1);
  const selected = RETRY_BACKOFF_MS[index];

  if (typeof selected === 'number') {
    return selected;
  }

  return 300_000;
}

function cloneAuthorizedToolRequests(input: {
  packet: ExecutionPacket;
  runId: string;
  executionPacketId: string;
  requestedAt: string;
}): ExecutionPacket['authorizedToolRequests'] {
  return input.packet.authorizedToolRequests.map((request) =>
    createToolRequestEnvelope({
      toolCallId: request.toolCallId,
      runId: input.runId,
      executionPacketId: input.executionPacketId,
      toolKind: request.toolKind,
      toolName: request.toolName,
      toolVersion: request.toolVersion,
      capabilityRef: request.capabilityRef,
      scopeRef: request.scopeRef,
      timeoutMs: request.timeoutMs,
      requestPayload: request.requestPayload,
      requestedAt: input.requestedAt,
    }),
  );
}

function deriveTaskResultFromEffects(input: {
  packet: ExecutionPacket;
  effects: ExecutorResult[];
}): ExecutionTaskResult {
  const artifactRefs = [
    ...new Set(input.effects.flatMap((effect) => effect.effect.artifactRefs)),
  ];
  const firstFailedEffect = input.effects.find(
    (effect) => effect.effect.effectStatus !== 'succeeded',
  );

  if (firstFailedEffect) {
    const failedStatus = firstFailedEffect.effect.effectStatus;
    const resultStatus =
      failedStatus === 'failed_transient' || failedStatus === 'timed_out'
        ? 'transient_failure'
        : failedStatus === 'cancelled'
          ? 'cancelled'
          : 'permanent_failure';

    return {
      runId: input.packet.runId,
      executionPacketId: input.packet.executionPacketId,
      resultStatus,
      resultSchemaVersion: 1,
      artifactRefs,
      summary:
        firstFailedEffect.effect.errorMessage ??
        'Executor returned a non-success effect.',
      structuredOutput: {
        failedToolCallId: firstFailedEffect.effect.toolCallId,
      },
      failureClass:
        firstFailedEffect.effect.errorClass ??
        firstFailedEffect.effect.effectStatus,
      validatorRef: 'worker.runtime.v1',
    };
  }

  const embeddedTaskResult = input.effects
    .map((effect) => effect.effect.resultPayload.taskResult)
    .find(isRecord);

  if (!embeddedTaskResult) {
    return {
      runId: input.packet.runId,
      executionPacketId: input.packet.executionPacketId,
      resultStatus: 'invalid_output',
      resultSchemaVersion: 1,
      artifactRefs,
      summary: 'Executors completed but emitted no task result.',
      structuredOutput: {
        issue: 'missing_task_result',
      },
      failureClass: 'missing_task_result',
      validatorRef: 'worker.runtime.v1',
    };
  }

  const candidate: ExecutionTaskResult = {
    runId: input.packet.runId,
    executionPacketId: input.packet.executionPacketId,
    resultStatus:
      typeof embeddedTaskResult.resultStatus === 'string'
        ? (embeddedTaskResult.resultStatus as ExecutionTaskResult['resultStatus'])
        : 'invalid_output',
    resultSchemaVersion:
      typeof embeddedTaskResult.resultSchemaVersion === 'number'
        ? embeddedTaskResult.resultSchemaVersion
        : 1,
    artifactRefs: Array.isArray(embeddedTaskResult.artifactRefs)
      ? embeddedTaskResult.artifactRefs.filter(
          (value): value is string => typeof value === 'string',
        )
      : artifactRefs,
    summary:
      typeof embeddedTaskResult.summary === 'string'
        ? embeddedTaskResult.summary
        : '',
    structuredOutput: isRecord(embeddedTaskResult.structuredOutput)
      ? embeddedTaskResult.structuredOutput
      : {},
    failureClass:
      typeof embeddedTaskResult.failureClass === 'string'
        ? embeddedTaskResult.failureClass
        : undefined,
    validatorRef:
      typeof embeddedTaskResult.validatorRef === 'string'
        ? embeddedTaskResult.validatorRef
        : 'worker.runtime.v1',
  };

  const validation = validateTaskResult(candidate);
  if (validation.ok) {
    return candidate;
  }

  return {
    runId: input.packet.runId,
    executionPacketId: input.packet.executionPacketId,
    resultStatus: 'invalid_output',
    resultSchemaVersion: 1,
    artifactRefs,
    summary: formatValidationFailureSummary(validation.issues),
    structuredOutput: {
      issues: validation.issues,
    },
    failureClass: 'task_result_validation_failed',
    validatorRef: 'worker.runtime.v1',
  };
}

async function releaseClaimForRun(input: {
  runId: string;
  releasedAt: string;
  leaseStatus: 'expired' | 'released';
  commandId: string;
  idempotencyKey: string;
  actorRef: string;
}): Promise<string | null> {
  const claim = await releaseClaimLeaseByRunId(getPool(), {
    runId: input.runId,
    releasedAt: input.releasedAt,
    leaseStatus: input.leaseStatus,
  });

  if (!claim) {
    return null;
  }

  return persistClaimEvent(getPool(), {
    claim: {
      claimId: claim.claimId,
      companyId: claim.companyId,
      workItemId: claim.workItemId,
      scopeRef: claim.scopeRef,
      holderRunId: claim.holderRunId,
      leaseExpiresAt: claim.leaseExpiresAt,
    },
    occurredAt: input.releasedAt,
    eventType: 'claim.expired',
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    actorRef: input.actorRef,
  });
}

async function settleRunWithExpiredClaim(input: {
  run: Run;
  workItem: WorkItem;
  objective: Objective;
  claim: ClaimLease;
}) {
  const pool = getPool();
  const now = nowIso();
  const nextRun: Run = {
    ...input.run,
    status: 'cancelled',
    summary: 'Run claim lease expired before execution could continue.',
    failureClass: 'claim_expired',
    updatedAt: now,
  };
  const nextWorkItem: WorkItem = {
    ...input.workItem,
    status: 'escalated',
    blockingReason: 'claim_expired',
    updatedAt: now,
  };
  const commandId = `cmd_${randomUUID()}`;
  const idempotencyKey = `worker:claim-expired:${input.run.runId}`;
  const client = await pool.connect();

  try {
    await client.query('begin');

    const eventIds = [
      await persistRunSnapshot(client, {
        run: nextRun,
        eventType: 'run.cancelled',
        commandId,
        idempotencyKey: makeEventCausationKey(
          idempotencyKey,
          `run:${nextRun.runId}`,
        ),
        actorRef: 'worker.runtime',
      }),
      await persistWorkItemSnapshot(client, {
        workItem: nextWorkItem,
        eventType: 'work_item.updated',
        commandId,
        idempotencyKey: makeEventCausationKey(
          idempotencyKey,
          `work-item:${nextWorkItem.workItemId}`,
        ),
        actorRef: 'worker.runtime',
      }),
    ];

    const expiredClaim = await releaseClaimLeaseByRunId(client, {
      runId: input.run.runId,
      releasedAt: now,
      leaseStatus: 'expired',
    });
    if (expiredClaim) {
      eventIds.push(
        await persistClaimEvent(client, {
          claim: {
            claimId: expiredClaim.claimId,
            companyId: expiredClaim.companyId,
            workItemId: expiredClaim.workItemId,
            scopeRef: expiredClaim.scopeRef,
            holderRunId: expiredClaim.holderRunId,
            leaseExpiresAt: expiredClaim.leaseExpiresAt,
          },
          occurredAt: now,
          eventType: 'claim.expired',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `claim:${expiredClaim.claimId}`,
          ),
          actorRef: 'worker.runtime',
        }),
      );
    }

    const syncedObjective = await syncObjectiveStatus(client, {
      objective: input.objective,
      commandId,
      idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
      actorRef: 'worker.runtime',
    });
    if (syncedObjective.eventId) {
      eventIds.push(syncedObjective.eventId);
    }

    await recordCommandLogEntry(client, {
      commandId,
      companyId: input.run.companyId,
      aggregateId: input.run.runId,
      commandType: 'run.worker.claim_expired',
      idempotencyKey,
      receivedAt: now,
      resolutionStatus: 'accepted',
      resultEventIds: eventIds,
    });

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function settleRunWithTaskResult(input: {
  run: Run;
  workItem: WorkItem;
  objective: Objective;
  packet: ExecutionPacket;
  taskResult: ExecutionTaskResult;
}) {
  const pool = getPool();
  const now = nowIso();
  const commandId = `cmd_${randomUUID()}`;
  const idempotencyKey = `worker:settle:${input.run.runId}:${input.taskResult.resultStatus}`;
  const attemptsConsumed = input.run.attempt;

  if (
    input.taskResult.resultStatus === 'transient_failure' &&
    attemptsConsumed < input.workItem.attemptBudget
  ) {
    const previousSignature = buildDispatchSignature({
      workItem: input.workItem,
      packetSeed: {
        assignedAgentId: input.packet.assignedAgentId,
        objectiveContext: input.packet.objectiveContext,
        toolAllowlist: input.packet.toolAllowlist,
        authorizedToolRequests: input.packet.authorizedToolRequests.map(
          (request) => ({
            toolKind: request.toolKind,
            toolName: request.toolName,
            capabilityRef: request.capabilityRef,
            scopeRef: request.scopeRef,
            requestPayload: request.requestPayload,
          }),
        ),
        scopeAllowlist: input.packet.scopeAllowlist,
        inputArtifactRefs: input.packet.inputArtifactRefs,
        expectedResultSchemaRef: input.packet.expectedResultSchemaRef,
        policySnapshotRef: input.packet.policySnapshotRef,
      },
      failureClass: input.taskResult.failureClass,
    });
    const retryDecision = createDispatchDecision({
      workItem: input.workItem,
      currentSignature: buildDispatchSignature({
        workItem: input.workItem,
        packetSeed: {
          assignedAgentId: input.packet.assignedAgentId,
          objectiveContext: input.packet.objectiveContext,
          toolAllowlist: input.packet.toolAllowlist,
          authorizedToolRequests: input.packet.authorizedToolRequests.map(
            (request) => ({
              toolKind: request.toolKind,
              toolName: request.toolName,
              capabilityRef: request.capabilityRef,
              scopeRef: request.scopeRef,
              requestPayload: request.requestPayload,
            }),
          ),
          scopeAllowlist: input.packet.scopeAllowlist,
          inputArtifactRefs: input.packet.inputArtifactRefs,
          expectedResultSchemaRef: input.packet.expectedResultSchemaRef,
          policySnapshotRef: `${input.packet.policySnapshotRef}:retry:${attemptsConsumed + 1}`,
          retrySequence: attemptsConsumed + 1,
        },
        failureClass: input.taskResult.failureClass,
      }),
      previousSignature,
      attemptsConsumed,
      escalateOnNoNewCausalInput: true,
    });

    if (retryDecision.status === 'dispatched') {
      const backoffMs = selectRetryBackoffMs(attemptsConsumed);
      const retryAvailableAt = addMs(now, backoffMs);
      const nextRunId = `run_${randomUUID()}`;
      const nextExecutionPacketId = `packet_${randomUUID()}`;
      const nextRun: Run = {
        runId: nextRunId,
        companyId: input.run.companyId,
        workItemId: input.run.workItemId,
        attempt: attemptsConsumed + 1,
        status: 'queued',
        executionPacketId: nextExecutionPacketId,
        headSha: input.run.headSha,
        summary: 'Retry scheduled after transient failure.',
        failureClass: undefined,
        availableAt: retryAvailableAt,
        createdAt: now,
        updatedAt: now,
      };
      const nextPacket = createExecutionPacket({
        companyId: input.packet.companyId,
        executionPacketId: nextExecutionPacketId,
        packetSchemaVersion: input.packet.packetSchemaVersion,
        workItemId: input.packet.workItemId,
        runId: nextRunId,
        assignedAgentId: input.packet.assignedAgentId,
        objectiveContext: input.packet.objectiveContext,
        toolAllowlist: input.packet.toolAllowlist,
        authorizedToolRequests: cloneAuthorizedToolRequests({
          packet: input.packet,
          runId: nextRunId,
          executionPacketId: nextExecutionPacketId,
          requestedAt: now,
        }),
        scopeAllowlist: input.packet.scopeAllowlist,
        inputArtifactRefs: input.packet.inputArtifactRefs,
        expectedResultSchemaRef: input.packet.expectedResultSchemaRef,
        policySnapshotRef: `${input.packet.policySnapshotRef}:retry:${nextRun.attempt}`,
        createdAt: now,
      });
      const settledRun: Run = {
        ...input.run,
        status: 'transient_failure',
        summary: input.taskResult.summary,
        failureClass: input.taskResult.failureClass ?? 'transient_failure',
        updatedAt: now,
      };
      const nextWorkItem: WorkItem = {
        ...input.workItem,
        status: 'running',
        blockingReason: undefined,
        latestRunId: nextRunId,
        updatedAt: now,
      };
      const client = await pool.connect();

      try {
        await client.query('begin');

        const eventIds = [
          await persistRunSnapshot(client, {
            run: settledRun,
            eventType: 'run.failed',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `run:${settledRun.runId}`,
            ),
            actorRef: 'worker.runtime',
          }),
          await persistRunSnapshot(client, {
            run: nextRun,
            eventType: 'run.started',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `run:${nextRun.runId}`,
            ),
            actorRef: 'worker.runtime',
          }),
          await persistWorkItemSnapshot(client, {
            workItem: nextWorkItem,
            eventType: 'work_item.updated',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `work-item:${nextWorkItem.workItemId}`,
            ),
            actorRef: 'worker.runtime',
          }),
        ];

        await storeExecutionPacket(client, nextPacket);

        const activeClaim = await getActiveClaimLeaseByRunId(
          client,
          input.run.runId,
        );
        if (activeClaim) {
          const transferredClaim = {
            ...activeClaim,
            holderRunId: nextRunId,
            leaseExpiresAt: addMs(retryAvailableAt, getClaimLeaseTtlMs()),
            updatedAt: now,
            leaseStatus: 'active' as const,
          };
          await updateClaimLease(client, transferredClaim);
          eventIds.push(
            await persistClaimEvent(client, {
              claim: {
                claimId: transferredClaim.claimId,
                companyId: transferredClaim.companyId,
                workItemId: transferredClaim.workItemId,
                scopeRef: transferredClaim.scopeRef,
                holderRunId: transferredClaim.holderRunId,
                leaseExpiresAt: transferredClaim.leaseExpiresAt,
              },
              occurredAt: now,
              eventType: 'claim.acquired',
              commandId,
              idempotencyKey: makeEventCausationKey(
                idempotencyKey,
                `claim:${transferredClaim.claimId}`,
              ),
              actorRef: 'worker.runtime',
            }),
          );
        }

        const syncedObjective = await syncObjectiveStatus(client, {
          objective: input.objective,
          commandId,
          idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
          actorRef: 'worker.runtime',
        });
        if (syncedObjective.eventId) {
          eventIds.push(syncedObjective.eventId);
        }

        await recordCommandLogEntry(client, {
          commandId,
          companyId: input.run.companyId,
          aggregateId: nextRun.runId,
          commandType: 'run.worker.retry',
          idempotencyKey,
          receivedAt: now,
          resolutionStatus: 'accepted',
          resultEventIds: eventIds,
        });

        await client.query('commit');
        return;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  }

  const runStatus = mapTaskResultToRunStatus(input.taskResult.resultStatus);
  const workItemMapping = mapTaskResultToWorkItemStatus({
    resultStatus: input.taskResult.resultStatus,
    attemptsConsumed,
    attemptBudget: input.workItem.attemptBudget,
  });
  const nextRun: Run = {
    ...input.run,
    status: runStatus,
    summary: input.taskResult.summary,
    failureClass:
      input.taskResult.resultStatus === 'valid_success'
        ? undefined
        : (input.taskResult.failureClass ?? input.taskResult.resultStatus),
    updatedAt: now,
  };
  const nextWorkItem: WorkItem = {
    ...input.workItem,
    status: workItemMapping.workItemStatus,
    blockingReason: workItemMapping.blockingReason,
    updatedAt: now,
  };
  const runEventType =
    input.taskResult.resultStatus === 'valid_success'
      ? 'run.completed'
      : input.taskResult.resultStatus === 'cancelled'
        ? 'run.cancelled'
        : 'run.failed';
  const client = await pool.connect();

  try {
    await client.query('begin');

    const eventIds = [
      await persistRunSnapshot(client, {
        run: nextRun,
        eventType: runEventType,
        commandId,
        idempotencyKey: makeEventCausationKey(
          idempotencyKey,
          `run:${nextRun.runId}`,
        ),
        actorRef: 'worker.runtime',
      }),
      await persistWorkItemSnapshot(client, {
        workItem: nextWorkItem,
        eventType: 'work_item.updated',
        commandId,
        idempotencyKey: makeEventCausationKey(
          idempotencyKey,
          `work-item:${nextWorkItem.workItemId}`,
        ),
        actorRef: 'worker.runtime',
      }),
    ];

    const releasedClaim = await releaseClaimLeaseByRunId(client, {
      runId: input.run.runId,
      releasedAt: now,
      leaseStatus: 'released',
    });
    if (releasedClaim) {
      eventIds.push(
        await persistClaimEvent(client, {
          claim: {
            claimId: releasedClaim.claimId,
            companyId: releasedClaim.companyId,
            workItemId: releasedClaim.workItemId,
            scopeRef: releasedClaim.scopeRef,
            holderRunId: releasedClaim.holderRunId,
            leaseExpiresAt: releasedClaim.leaseExpiresAt,
          },
          occurredAt: now,
          eventType: 'claim.expired',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `claim:${releasedClaim.claimId}`,
          ),
          actorRef: 'worker.runtime',
        }),
      );
    }

    const syncedObjective = await syncObjectiveStatus(client, {
      objective: input.objective,
      commandId,
      idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
      actorRef: 'worker.runtime',
    });
    if (syncedObjective.eventId) {
      eventIds.push(syncedObjective.eventId);
    }

    await recordCommandLogEntry(client, {
      commandId,
      companyId: input.run.companyId,
      aggregateId: input.run.runId,
      commandType: 'run.worker.settle',
      idempotencyKey,
      receivedAt: now,
      resolutionStatus: 'accepted',
      resultEventIds: eventIds,
    });

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function processRun(run: Run): Promise<void> {
  const pool = getPool();
  const [packet, workItem] = await Promise.all([
    getExecutionPacketByRunId(pool, run.runId),
    getWorkItemById(pool, run.workItemId),
  ]);

  if (!packet || !workItem) {
    throw new Error('Run is missing execution packet or work item context.');
  }

  const objective = await getObjectiveById(pool, workItem.objectiveId);
  if (!objective) {
    throw new Error('Run objective context is missing.');
  }

  const activeClaim = await getActiveClaimLeaseByRunId(pool, run.runId);
  if (activeClaim && parseTimestamp(activeClaim.leaseExpiresAt) <= Date.now()) {
    await settleRunWithExpiredClaim({
      run,
      workItem,
      objective,
      claim: {
        claimId: activeClaim.claimId,
        companyId: activeClaim.companyId,
        workItemId: activeClaim.workItemId,
        scopeRef: activeClaim.scopeRef,
        holderRunId: activeClaim.holderRunId,
        leaseExpiresAt: activeClaim.leaseExpiresAt,
      },
    });
    return;
  }

  const effects: ExecutorResult[] = [];
  for (const request of packet.authorizedToolRequests) {
    const result = await executeAuthorizedToolRequest({
      packet,
      request,
    });
    await storeRunEffect(pool, {
      companyId: run.companyId,
      ...result,
    });
    effects.push(result);

    if (result.effect.effectStatus !== 'succeeded') {
      break;
    }
  }

  const taskResult = deriveTaskResultFromEffects({
    packet,
    effects,
  });
  await settleRunWithTaskResult({
    run,
    workItem,
    objective,
    packet,
    taskResult,
  });
}

export async function processNextQueuedRun(): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  let run: Run | null = null;

  try {
    await client.query('begin');
    run = await dequeueQueuedRun(client, nowIso());
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  if (!run) {
    return false;
  }

  await processRun(run);
  return true;
}

export async function runWorkerLoop(): Promise<void> {
  loadControlPlaneConfig();
  const pollIntervalMs = getWorkerPollIntervalMs();

  while (true) {
    const processed = await processNextQueuedRun();
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorkerLoop()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
