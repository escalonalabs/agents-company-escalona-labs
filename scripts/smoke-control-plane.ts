import { closePool } from '../server/control-plane/src/db/pool';
import { buildControlPlaneServer } from '../server/control-plane/src/server';

async function main() {
  process.env.AGENTS_COMPANY_SESSION_SECRET ??= 'smoke-session-secret';
  process.env.AGENTS_COMPANY_INTERNAL_API_TOKEN ??= 'smoke-internal-token';

  const server = buildControlPlaneServer();
  const slugSuffix = Date.now().toString(36);
  const internalHeaders = {
    'x-agents-company-internal-token':
      process.env.AGENTS_COMPANY_INTERNAL_API_TOKEN ?? 'smoke-internal-token',
  };

  try {
    const createCompany = await server.inject({
      method: 'POST',
      url: '/companies',
      headers: {
        ...internalHeaders,
        'x-idempotency-key': `smoke-company-${slugSuffix}`,
      },
      payload: {
        slug: `validation-co-${slugSuffix}`,
        displayName: 'Validation Co',
      },
    });
    const companyPayload = createCompany.json();
    const companyId = companyPayload.company.companyId as string;

    const createGatedObjective = await server.inject({
      method: 'POST',
      url: '/objectives',
      headers: {
        ...internalHeaders,
        'x-idempotency-key': `smoke-objective-gated-${slugSuffix}`,
      },
      payload: {
        companyId,
        title: 'Approval gated objective',
        requestedWorkItems: [
          {
            title: 'Needs human approval',
            requiresApproval: true,
            scopeRef: 'scope:gated',
          },
        ],
      },
    });
    const gatedObjectivePayload = createGatedObjective.json();
    const gatedWorkItem = gatedObjectivePayload.workItems[0] as {
      workItemId: string;
    };
    const approval = gatedObjectivePayload.approvals[0] as {
      approvalId: string;
    };

    const withheldDispatch = await server.inject({
      method: 'POST',
      url: `/work-items/${gatedWorkItem.workItemId}/dispatch`,
      headers: internalHeaders,
    });
    const withheldPayload = withheldDispatch.json();

    const grantApproval = await server.inject({
      method: 'POST',
      url: `/approvals/${approval.approvalId}/grant`,
      headers: internalHeaders,
      payload: { decisionReason: 'validated in smoke script' },
    });
    const grantedPayload = grantApproval.json();

    const dispatchedRun = await server.inject({
      method: 'POST',
      url: `/work-items/${gatedWorkItem.workItemId}/dispatch`,
      headers: {
        ...internalHeaders,
        'x-idempotency-key': `smoke-dispatch-gated-${slugSuffix}`,
      },
      payload: { assignedAgentId: 'agent.validation.runner' },
    });
    const dispatchPayload = dispatchedRun.json();
    const runId = dispatchPayload.run.runId as string;

    const completedRun = await server.inject({
      method: 'POST',
      url: `/runs/${runId}/complete`,
      headers: {
        ...internalHeaders,
        'x-idempotency-key': `smoke-complete-gated-${slugSuffix}`,
      },
      payload: {
        resultStatus: 'valid_success',
        summary: 'Work item completed with valid output.',
        validatorRef: 'validator.integration.v1',
        structuredOutput: { ok: true },
        artifactRefs: ['artifact://validation/success-1'],
      },
    });
    const completedPayload = completedRun.json();

    const createFailClosedObjective = await server.inject({
      method: 'POST',
      url: '/objectives',
      headers: {
        ...internalHeaders,
        'x-idempotency-key': `smoke-objective-failclosed-${slugSuffix}`,
      },
      payload: {
        companyId,
        title: 'Fail closed objective',
        requestedWorkItems: [
          {
            title: 'Should fail closed',
            requiresApproval: false,
            scopeRef: 'scope:failclosed',
          },
        ],
      },
    });
    const failClosedObjectivePayload = createFailClosedObjective.json();
    const failClosedWorkItem = failClosedObjectivePayload.workItems[0] as {
      workItemId: string;
    };

    const failClosedDispatch = await server.inject({
      method: 'POST',
      url: `/work-items/${failClosedWorkItem.workItemId}/dispatch`,
      headers: {
        ...internalHeaders,
        'x-idempotency-key': `smoke-dispatch-failclosed-${slugSuffix}`,
      },
    });
    const failClosedDispatchPayload = failClosedDispatch.json();
    const failClosedRunId = failClosedDispatchPayload.run.runId as string;

    const failClosedCompletion = await server.inject({
      method: 'POST',
      url: `/runs/${failClosedRunId}/complete`,
      headers: {
        ...internalHeaders,
        'x-idempotency-key': `smoke-complete-failclosed-${slugSuffix}`,
      },
      payload: {
        resultStatus: 'valid_success',
        structuredOutput: { ok: false },
        artifactRefs: ['artifact://validation/fail-1'],
      },
    });
    const failClosedCompletionPayload = failClosedCompletion.json();

    const replay = await server.inject({
      method: 'GET',
      url: `/companies/${companyId}/replay`,
      headers: internalHeaders,
    });
    const replayPayload = replay.json();

    console.log(
      JSON.stringify(
        {
          createCompanyStatus: createCompany.statusCode,
          authMode: 'internal',
          createObjectiveStatus: createGatedObjective.statusCode,
          withheldDispatchStatus: withheldDispatch.statusCode,
          withheldDecision: withheldPayload.decision?.status,
          grantApprovalStatus: grantApproval.statusCode,
          grantedApprovalStatus: grantedPayload.approval?.status,
          dispatchStatus: dispatchedRun.statusCode,
          completionStatus: completedRun.statusCode,
          completionAccepted: completedPayload.accepted,
          completionWorkItemStatus: completedPayload.workItem?.status,
          failClosedDispatchStatus: failClosedDispatch.statusCode,
          failClosedCompletionStatus: failClosedCompletion.statusCode,
          failClosedAccepted: failClosedCompletionPayload.accepted,
          failClosedIssues: failClosedCompletionPayload.validation?.issues,
          failClosedWorkItemStatus:
            failClosedCompletionPayload.workItem?.status,
          replayEventCount: replayPayload.eventCount,
          replayObjectiveCount: replayPayload.replayedState?.objectives?.length,
          replayRunCount: replayPayload.replayedState?.runs?.length,
          internalTokenConfigured: Boolean(
            internalHeaders['x-agents-company-internal-token'],
          ),
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
