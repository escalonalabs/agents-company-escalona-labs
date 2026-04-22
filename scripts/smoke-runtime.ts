import { randomUUID } from 'node:crypto';

import {
  createExecutionPacket,
  createToolRequestEnvelope,
} from '@escalonalabs/execution';

import { closePool, getPool } from '../server/control-plane/src/db/pool';
import {
  getExecutionPacketByRunId,
  getRunById,
  getWorkItemById,
  listRunsByWorkItem,
  storeExecutionPacket,
} from '../server/control-plane/src/db/runtime';
import { buildControlPlaneServer } from '../server/control-plane/src/server';
import { processRun } from '../server/control-plane/src/worker';

function requireRun<T>(value: T | null, message: string): T {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

type AuthSession = {
  companyId: string;
  headers: Record<string, string>;
};

async function authenticate(
  server: ReturnType<typeof buildControlPlaneServer>,
  slugSuffix: string,
): Promise<AuthSession> {
  const headers = {
    'x-agents-company-internal-token':
      process.env.AGENTS_COMPANY_INTERNAL_API_TOKEN ?? 'smoke-internal-token',
    'x-idempotency-key': `runtime-company-${slugSuffix}`,
  };

  const createCompany = await server.inject({
    method: 'POST',
    url: '/companies',
    headers,
    payload: {
      slug: `runtime-co-${slugSuffix}`,
      displayName: 'Runtime Co',
    },
  });
  const payload = createCompany.json();

  return {
    companyId: payload.company.companyId as string,
    headers,
  };
}

async function createObjectiveWithWorkItem(input: {
  server: ReturnType<typeof buildControlPlaneServer>;
  headers: Record<string, string>;
  companyId: string;
  slugSuffix: string;
  title: string;
  requestedWorkItems: Array<Record<string, unknown>>;
}) {
  const response = await input.server.inject({
    method: 'POST',
    url: '/objectives',
    headers: {
      ...input.headers,
      'x-idempotency-key': `runtime-objective-${input.slugSuffix}-${input.title}`,
    },
    payload: {
      companyId: input.companyId,
      title: input.title,
      requestedWorkItems: input.requestedWorkItems,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(
      `Failed to create objective ${input.title}: ${response.body}`,
    );
  }

  return response.json();
}

async function dispatchWorkItem(input: {
  server: ReturnType<typeof buildControlPlaneServer>;
  headers: Record<string, string>;
  workItemId: string;
  idempotencyKey: string;
  body: Record<string, unknown>;
}) {
  const response = await input.server.inject({
    method: 'POST',
    url: `/work-items/${input.workItemId}/dispatch`,
    headers: {
      ...input.headers,
      'x-idempotency-key': input.idempotencyKey,
    },
    payload: input.body,
  });

  return response;
}

async function main() {
  process.env.AGENTS_COMPANY_SESSION_SECRET ??= 'smoke-session-secret';
  process.env.AGENTS_COMPANY_INTERNAL_API_TOKEN ??= 'smoke-internal-token';

  const server = buildControlPlaneServer();
  const pool = getPool();
  const slugSuffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

  try {
    const auth = await authenticate(server, slugSuffix);

    const happyObjective = await createObjectiveWithWorkItem({
      server,
      headers: auth.headers,
      companyId: auth.companyId,
      slugSuffix,
      title: 'Runtime happy path',
      requestedWorkItems: [
        {
          title: 'Happy path work item',
          scopeRef: 'scope:happy',
        },
      ],
    });
    const happyWorkItemId = happyObjective.workItems[0].workItemId as string;
    const happyDispatch = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: happyWorkItemId,
      idempotencyKey: `runtime-dispatch-happy-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.return_task_result'],
        authorizedToolRequests: [
          {
            toolCallId: 'happy-call',
            toolKind: 'internal',
            toolName: 'internal.return_task_result',
            capabilityRef: 'cap.internal.return_task_result',
            requestPayload: {
              action: 'return_task_result',
              taskResult: {
                resultStatus: 'valid_success',
                resultSchemaVersion: 1,
                summary: 'Happy path completed.',
                structuredOutput: { ok: true },
                validatorRef: 'validator.runtime.v1',
              },
            },
          },
        ],
      },
    });
    const happyRunId = happyDispatch.json().run.runId as string;
    await processRun(
      requireRun(
        await getRunById(pool, happyRunId),
        'Happy path run not found.',
      ),
    );
    const happyRun = await getRunById(pool, happyRunId);
    const happyWorkItem = await getWorkItemById(pool, happyWorkItemId);

    const invalidObjective = await createObjectiveWithWorkItem({
      server,
      headers: auth.headers,
      companyId: auth.companyId,
      slugSuffix,
      title: 'Runtime invalid output',
      requestedWorkItems: [
        {
          title: 'Invalid output work item',
          scopeRef: 'scope:invalid',
        },
      ],
    });
    const invalidWorkItemId = invalidObjective.workItems[0]
      .workItemId as string;
    const invalidDispatch = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: invalidWorkItemId,
      idempotencyKey: `runtime-dispatch-invalid-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.return_task_result'],
        authorizedToolRequests: [
          {
            toolCallId: 'invalid-call',
            toolKind: 'internal',
            toolName: 'internal.return_task_result',
            capabilityRef: 'cap.internal.return_task_result',
            requestPayload: {
              action: 'return_task_result',
              taskResult: {
                resultStatus: 'valid_success',
              },
            },
          },
        ],
      },
    });
    const invalidRunId = invalidDispatch.json().run.runId as string;
    await processRun(
      requireRun(
        await getRunById(pool, invalidRunId),
        'Invalid output run not found.',
      ),
    );
    const invalidRun = await getRunById(pool, invalidRunId);
    const invalidWorkItem = await getWorkItemById(pool, invalidWorkItemId);

    const retryObjective = await createObjectiveWithWorkItem({
      server,
      headers: auth.headers,
      companyId: auth.companyId,
      slugSuffix,
      title: 'Runtime retry path',
      requestedWorkItems: [
        {
          title: 'Retry work item',
          scopeRef: 'scope:retry',
          attemptBudget: 3,
        },
      ],
    });
    const retryWorkItemId = retryObjective.workItems[0].workItemId as string;
    const retryDispatch = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: retryWorkItemId,
      idempotencyKey: `runtime-dispatch-retry-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.simulate_transient_failure'],
        authorizedToolRequests: [
          {
            toolCallId: 'retry-call-1',
            toolKind: 'internal',
            toolName: 'internal.simulate_transient_failure',
            capabilityRef: 'cap.internal.transient',
            requestPayload: {
              action: 'simulate_transient_failure',
            },
          },
        ],
      },
    });
    const retryFirstRunId = retryDispatch.json().run.runId as string;
    await processRun(
      requireRun(
        await getRunById(pool, retryFirstRunId),
        'Retry first run not found.',
      ),
    );
    const retryRunsAfterFirstAttempt = await listRunsByWorkItem(
      pool,
      retryWorkItemId,
    );
    const retryQueuedRun = retryRunsAfterFirstAttempt.find(
      (run) => run.status === 'queued',
    );
    if (!retryQueuedRun) {
      throw new Error('Retry scenario did not schedule a queued retry run.');
    }
    const retryQueuedPacket = await getExecutionPacketByRunId(
      pool,
      retryQueuedRun.runId,
    );
    if (!retryQueuedPacket) {
      throw new Error('Queued retry run is missing its execution packet.');
    }
    await pool.query('update runs set available_at = $2 where run_id = $1', [
      retryQueuedRun.runId,
      new Date().toISOString(),
    ]);
    await storeExecutionPacket(
      pool,
      createExecutionPacket({
        ...retryQueuedPacket,
        authorizedToolRequests: [
          createToolRequestEnvelope({
            toolCallId: 'retry-call-2',
            runId: retryQueuedRun.runId,
            executionPacketId: retryQueuedPacket.executionPacketId,
            toolKind: 'internal',
            toolName: 'internal.return_task_result',
            capabilityRef: 'cap.internal.return_task_result',
            scopeRef: retryQueuedPacket.scopeAllowlist[0] ?? 'scope:retry',
            requestPayload: {
              action: 'return_task_result',
              taskResult: {
                resultStatus: 'valid_success',
                resultSchemaVersion: 1,
                summary: 'Retry completed successfully.',
                structuredOutput: { retry: true },
                validatorRef: 'validator.runtime.v1',
              },
            },
            requestedAt: new Date().toISOString(),
          }),
        ],
        toolAllowlist: ['internal.return_task_result'],
      }),
    );
    await processRun(
      requireRun(
        await getRunById(pool, retryQueuedRun.runId),
        'Retry queued run not found.',
      ),
    );
    const retryFinalRuns = await listRunsByWorkItem(pool, retryWorkItemId);
    const retryFinalWorkItem = await getWorkItemById(pool, retryWorkItemId);

    const expiryObjective = await createObjectiveWithWorkItem({
      server,
      headers: auth.headers,
      companyId: auth.companyId,
      slugSuffix,
      title: 'Runtime lease expiry',
      requestedWorkItems: [
        {
          title: 'Expiry work item',
          scopeRef: 'scope:expiry',
        },
      ],
    });
    const expiryWorkItemId = expiryObjective.workItems[0].workItemId as string;
    const expiryDispatch = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: expiryWorkItemId,
      idempotencyKey: `runtime-dispatch-expiry-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.return_task_result'],
        authorizedToolRequests: [
          {
            toolCallId: 'expiry-call',
            toolKind: 'internal',
            toolName: 'internal.return_task_result',
            capabilityRef: 'cap.internal.return_task_result',
            requestPayload: {
              action: 'return_task_result',
              taskResult: {
                resultStatus: 'valid_success',
                resultSchemaVersion: 1,
                summary: 'This should never execute.',
                structuredOutput: { expired: false },
                validatorRef: 'validator.runtime.v1',
              },
            },
          },
        ],
      },
    });
    const expiryRunId = expiryDispatch.json().run.runId as string;
    await pool.query(
      `
        update claim_leases
        set lease_expires_at = $2
        where holder_run_id = $1
      `,
      [expiryRunId, new Date(Date.now() - 1_000).toISOString()],
    );
    await processRun(
      requireRun(await getRunById(pool, expiryRunId), 'Expiry run not found.'),
    );
    const expiryRun = await getRunById(pool, expiryRunId);
    const expiryWorkItem = await getWorkItemById(pool, expiryWorkItemId);

    const loopObjective = await createObjectiveWithWorkItem({
      server,
      headers: auth.headers,
      companyId: auth.companyId,
      slugSuffix,
      title: 'Runtime no-op loop prevention',
      requestedWorkItems: [
        {
          title: 'Loop prevention work item',
          scopeRef: 'scope:loop',
          attemptBudget: 2,
        },
      ],
    });
    const loopWorkItemId = loopObjective.workItems[0].workItemId as string;
    const loopDispatch = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: loopWorkItemId,
      idempotencyKey: `runtime-dispatch-loop-initial-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.simulate_transient_failure'],
        authorizedToolRequests: [
          {
            toolCallId: 'loop-call-1',
            toolKind: 'internal',
            toolName: 'internal.simulate_transient_failure',
            capabilityRef: 'cap.internal.transient',
            requestPayload: {
              action: 'simulate_transient_failure',
            },
          },
        ],
      },
    });
    const loopRunId = loopDispatch.json().run.runId as string;
    const loopCompletion = await server.inject({
      method: 'POST',
      url: `/runs/${loopRunId}/complete`,
      headers: {
        ...auth.headers,
        'x-idempotency-key': `runtime-loop-complete-${slugSuffix}`,
      },
      payload: {
        resultStatus: 'transient_failure',
        summary: 'Loop reproduction transient failure.',
        validatorRef: 'validator.runtime.v1',
        structuredOutput: { loop: true },
        failureClass: 'transient_failure',
      },
    });
    const loopRedispatch = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: loopWorkItemId,
      idempotencyKey: `runtime-dispatch-loop-repeat-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.simulate_transient_failure'],
        authorizedToolRequests: [
          {
            toolCallId: 'loop-call-1',
            toolKind: 'internal',
            toolName: 'internal.simulate_transient_failure',
            capabilityRef: 'cap.internal.transient',
            requestPayload: {
              action: 'simulate_transient_failure',
            },
          },
        ],
      },
    });
    const loopWorkItem = await getWorkItemById(pool, loopWorkItemId);

    const conflictObjective = await createObjectiveWithWorkItem({
      server,
      headers: auth.headers,
      companyId: auth.companyId,
      slugSuffix,
      title: 'Runtime scope conflict',
      requestedWorkItems: [
        {
          title: 'Conflict work item A',
          scopeRef: 'scope:conflict',
        },
        {
          title: 'Conflict work item B',
          scopeRef: 'scope:conflict',
        },
      ],
    });
    const conflictWorkItemA = conflictObjective.workItems[0]
      .workItemId as string;
    const conflictWorkItemB = conflictObjective.workItems[1]
      .workItemId as string;
    const conflictDispatchA = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: conflictWorkItemA,
      idempotencyKey: `runtime-dispatch-conflict-a-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.return_task_result'],
        authorizedToolRequests: [
          {
            toolCallId: 'conflict-call',
            toolKind: 'internal',
            toolName: 'internal.return_task_result',
            capabilityRef: 'cap.internal.return_task_result',
            requestPayload: {
              action: 'return_task_result',
              taskResult: {
                resultStatus: 'valid_success',
                resultSchemaVersion: 1,
                summary: 'Conflict holder.',
                structuredOutput: { ok: true },
                validatorRef: 'validator.runtime.v1',
              },
            },
          },
        ],
      },
    });
    const conflictDispatchB = await dispatchWorkItem({
      server,
      headers: auth.headers,
      workItemId: conflictWorkItemB,
      idempotencyKey: `runtime-dispatch-conflict-b-${slugSuffix}`,
      body: {
        toolAllowlist: ['internal.return_task_result'],
        authorizedToolRequests: [
          {
            toolCallId: 'conflict-call-b',
            toolKind: 'internal',
            toolName: 'internal.return_task_result',
            capabilityRef: 'cap.internal.return_task_result',
            requestPayload: {
              action: 'return_task_result',
              taskResult: {
                resultStatus: 'valid_success',
                resultSchemaVersion: 1,
                summary: 'Should be withheld.',
                structuredOutput: { ok: true },
                validatorRef: 'validator.runtime.v1',
              },
            },
          },
        ],
      },
    });

    console.log(
      JSON.stringify(
        {
          happyPath: {
            runStatus: happyRun?.status,
            workItemStatus: happyWorkItem?.status,
          },
          invalidOutput: {
            runStatus: invalidRun?.status,
            workItemStatus: invalidWorkItem?.status,
            blockingReason: invalidWorkItem?.blockingReason,
          },
          transientRetry: {
            firstRunId: retryFirstRunId,
            runStatuses: retryFinalRuns.map((run) => ({
              runId: run.runId,
              status: run.status,
              attempt: run.attempt,
            })),
            workItemStatus: retryFinalWorkItem?.status,
          },
          leaseExpiry: {
            runStatus: expiryRun?.status,
            workItemStatus: expiryWorkItem?.status,
            blockingReason: expiryWorkItem?.blockingReason,
          },
          noOpLoopPrevention: {
            completionStatus: loopCompletion.statusCode,
            redispatchStatus: loopRedispatch.statusCode,
            decisionStatus: loopRedispatch.json().decision?.status,
            workItemStatus: loopWorkItem?.status,
            blockingReason: loopWorkItem?.blockingReason,
          },
          claimConflict: {
            firstDispatchStatus: conflictDispatchA.statusCode,
            secondDispatchStatus: conflictDispatchB.statusCode,
            secondDecisionStatus: conflictDispatchB.json().decision?.status,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await server.close();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
