import { closePool } from '../server/control-plane/src/db/pool';
import { buildControlPlaneServer } from '../server/control-plane/src/server';
import { buildGitHubAppServer } from '../server/github-app/src/server';
import {
  bootstrapOperatorSession,
  createEphemeralGitHubAppCredentials,
  createGitHubFetchStub,
  createSmokeOperatorCredentials,
  expectStatus,
  postSignedGitHubWebhook,
  prepareSmokeRuntime,
  requestJson,
  startFastifyServer,
} from './smoke-harness';

type CompanyCreateResponse = {
  company: {
    companyId: string;
  };
};

type ObjectiveCreateResponse = {
  objective: {
    objectiveId: string;
  };
  workItems: Array<{
    workItemId: string;
  }>;
  approvals: Array<{
    approvalId: string;
  }>;
};

type DispatchResponse = {
  run: {
    runId: string;
  };
};

type CandidateListResponse = {
  candidates: Array<{
    candidateId: string;
    sourceKind?: string;
  }>;
};

type MemoryListResponse = {
  memories: Array<{
    memoryId: string;
    status?: string;
    scopeRef?: string;
  }>;
};

type MemoryPromoteResponse = {
  memory: {
    memoryId: string;
  };
};

type InboundEventListResponse = {
  inboundEvents: Array<{
    inboundEventId: string;
    classification?: string;
    status?: string;
  }>;
};

type RetrievalResponse = {
  items: Array<{
    memory: {
      memoryId: string;
      scopeRef?: string;
    };
    withheld: boolean;
  }>;
  audits: Array<{
    outcome?: string;
    reason?: string;
  }>;
};

type ProvenanceResponse = {
  inboundEdges: Array<{
    edgeType?: string;
    sourceNodeType?: string;
  }>;
  candidateInboundEdges: Array<{
    edgeType?: string;
    sourceNodeType?: string;
  }>;
};

type EvaluationResponse = {
  evaluation: {
    totalCandidates: number;
    totalMemories: number;
    contaminationRate: number;
    provenanceCompleteness: number;
  };
};

async function main() {
  const runtime = await prepareSmokeRuntime({
    prefix: 'memory_smoke',
  });
  const controlPlaneServer = buildControlPlaneServer();
  let controlPlaneLive:
    | Awaited<ReturnType<typeof startFastifyServer>>
    | undefined;
  let githubAppLive: Awaited<ReturnType<typeof startFastifyServer>> | undefined;

  try {
    controlPlaneLive = await startFastifyServer(controlPlaneServer);

    const githubCredentials = createEphemeralGitHubAppCredentials();
    const githubStub = createGitHubFetchStub({
      controlPlaneBaseUrl: controlPlaneLive.baseUrl,
    });
    const githubAppServer = buildGitHubAppServer(
      {
        ...process.env,
        AGENTS_COMPANY_NODE_ENV: 'development',
        AGENTS_COMPANY_CONTROL_PLANE_URL: controlPlaneLive.baseUrl,
        AGENTS_COMPANY_INTERNAL_API_TOKEN: runtime.internalToken,
        AGENTS_COMPANY_GITHUB_APP_PORT: '3001',
        AGENTS_COMPANY_GITHUB_APP_ID: githubCredentials.appId,
        AGENTS_COMPANY_GITHUB_PRIVATE_KEY: githubCredentials.privateKey,
        AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: githubCredentials.webhookSecret,
      },
      {
        fetchFn: githubStub.fetchFn,
      },
    );
    githubAppLive = await startFastifyServer(githubAppServer);

    const operator = await bootstrapOperatorSession({
      baseUrl: controlPlaneLive.baseUrl,
      credentials: createSmokeOperatorCredentials('memory'),
    });
    const operatorHeaders = {
      cookie: operator.cookie,
    };
    const suffix = runtime.schemaName.slice(-8);

    const createCompany = await requestJson<CompanyCreateResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/companies',
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `memory-company-${suffix}`,
      },
      body: {
        slug: `memory-company-${suffix}`,
        displayName: 'Memory Validation Company',
      },
    });
    expectStatus(
      createCompany.statusCode,
      [201],
      'company creation failed',
      createCompany.json,
    );
    const companyId = createCompany.json?.company.companyId;
    if (!companyId) {
      throw new Error('Memory smoke did not receive a company id.');
    }

    const createObjective = await requestJson<ObjectiveCreateResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/objectives',
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `memory-objective-${suffix}`,
      },
      body: {
        companyId,
        title: 'Validate memory milestone',
        requestedWorkItems: [
          {
            title: 'Capture run memory',
            description:
              'A successful run should become a reviewed candidate with reusable guidance.',
            scopeRef: 'scope:memory-run',
            requiresApproval: false,
          },
          {
            title: 'Capture approval memory',
            description:
              'A human decision should become knowledge memory after review.',
            scopeRef: 'scope:memory-approval',
            requiresApproval: true,
          },
        ],
      },
    });
    expectStatus(
      createObjective.statusCode,
      [201],
      'objective creation failed',
      createObjective.json,
    );
    const objectiveId = createObjective.json?.objective.objectiveId;
    const runWorkItemId = createObjective.json?.workItems[0]?.workItemId;
    const approvalId = createObjective.json?.approvals[0]?.approvalId;
    if (!objectiveId || !runWorkItemId || !approvalId) {
      throw new Error(
        'Memory smoke is missing objective, work item, or approval ids.',
      );
    }

    const dispatchRun = await requestJson<DispatchResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/work-items/${runWorkItemId}/dispatch`,
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `memory-dispatch-${suffix}`,
      },
      body: {
        assignedAgentId: 'agent.memory.runner',
      },
    });
    expectStatus(
      dispatchRun.statusCode,
      [201],
      'dispatch failed',
      dispatchRun.json,
    );
    const runId = dispatchRun.json?.run.runId;
    if (!runId) {
      throw new Error('Memory smoke did not receive a run id.');
    }

    const completeRun = await requestJson<{
      accepted?: boolean;
    }>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/runs/${runId}/complete`,
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `memory-complete-${suffix}`,
      },
      body: {
        resultStatus: 'valid_success',
        summary:
          'Validated the memory extraction, promotion, retrieval, and provenance workflow for this scope.',
        validatorRef: 'validator.memory.v1',
        structuredOutput: { ok: true },
        artifactRefs: ['artifact://memory/run-proof-1'],
      },
    });
    expectStatus(
      completeRun.statusCode,
      [200],
      'run completion failed',
      completeRun.json,
    );

    const extractRun = await requestJson<{
      candidates: Array<{
        candidateId: string;
      }>;
    }>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/runs/${runId}/memory/extract`,
      method: 'POST',
      headers: operatorHeaders,
    });
    expectStatus(
      extractRun.statusCode,
      [201],
      'run memory extraction failed',
      extractRun.json,
    );
    const runCandidateId = extractRun.json?.candidates[0]?.candidateId;
    if (!runCandidateId) {
      throw new Error('Run memory extraction did not produce a candidate.');
    }

    const grantApproval = await requestJson<{
      approval?: {
        status?: string;
      };
    }>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/approvals/${approvalId}/grant`,
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `memory-approval-grant-${suffix}`,
      },
      body: {
        decisionReason:
          'This operator preference is stable, specific, and should be reused later.',
      },
    });
    expectStatus(
      grantApproval.statusCode,
      [200],
      'approval grant failed',
      grantApproval.json,
    );

    const extractApproval = await requestJson<{
      candidates: Array<{
        candidateId: string;
      }>;
    }>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/approvals/${approvalId}/memory/extract`,
      method: 'POST',
      headers: operatorHeaders,
    });
    expectStatus(
      extractApproval.statusCode,
      [201],
      'approval memory extraction failed',
      extractApproval.json,
    );
    const approvalCandidateId =
      extractApproval.json?.candidates[0]?.candidateId;
    if (!approvalCandidateId) {
      throw new Error(
        'Approval memory extraction did not produce a candidate.',
      );
    }

    const linkInstallation = await requestJson({
      baseUrl: githubAppLive.baseUrl,
      path: '/installations/link',
      method: 'POST',
      body: {
        companyId,
        installationId: 701,
        accountLogin: 'escalonalabs',
        repository: {
          owner: 'escalonalabs',
          name: 'agents-company-escalona-labs',
          id: 7,
        },
      },
    });
    expectStatus(
      linkInstallation.statusCode,
      [201],
      'GitHub installation link failed',
      linkInstallation.json,
    );

    const sync = await requestJson({
      baseUrl: githubAppLive.baseUrl,
      path: `/companies/${companyId}/sync`,
      method: 'POST',
    });
    expectStatus(sync.statusCode, [200], 'GitHub sync failed', sync.json);

    const linkedIssue = [...githubStub.state.issues.values()].find((issue) =>
      String(issue.body ?? '').includes(runWorkItemId),
    );
    if (!linkedIssue) {
      throw new Error(
        'GitHub sync did not materialize a linked issue for memory extraction.',
      );
    }

    const webhookResponse = await postSignedGitHubWebhook({
      githubAppBaseUrl: githubAppLive.baseUrl,
      webhookSecret: githubCredentials.webhookSecret,
      deliveryId: `memory-delivery-${suffix}`,
      eventName: 'issues',
      payload: {
        action: 'closed',
        issue: {
          state: 'closed',
          body: linkedIssue.body,
          user: {
            login: 'agents-company-by-escalona-labs[bot]',
            type: 'Bot',
            html_url: 'https://github.com/apps/agents-company-by-escalona-labs',
          },
        },
        sender: {
          login: 'escalona',
          type: 'User',
          html_url: 'https://github.com/escalona',
        },
      },
    });
    const webhookBody = await webhookResponse.json();
    expectStatus(
      webhookResponse.status,
      [202],
      'GitHub webhook forward failed',
      webhookBody,
    );

    const inboundEvents = await requestJson<InboundEventListResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/github/inbound-events`,
      headers: operatorHeaders,
    });
    expectStatus(
      inboundEvents.statusCode,
      [200],
      'GitHub inbound lookup failed',
      inboundEvents.json,
    );
    const inboundEvent = inboundEvents.json?.inboundEvents[0];
    if (!inboundEvent?.inboundEventId) {
      throw new Error(
        'GitHub inbound event was not recorded for memory extraction.',
      );
    }

    const extractInbound = await requestJson<{
      candidates: Array<{
        candidateId: string;
      }>;
    }>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/github/inbound-events/${inboundEvent.inboundEventId}/memory/extract`,
      method: 'POST',
      headers: operatorHeaders,
    });
    expectStatus(
      extractInbound.statusCode,
      [201],
      'GitHub inbound memory extraction failed',
      extractInbound.json,
    );
    const githubCandidateId = extractInbound.json?.candidates[0]?.candidateId;
    if (!githubCandidateId) {
      throw new Error('GitHub inbound extraction did not produce a candidate.');
    }

    const promoteRunCandidate = await requestJson<MemoryPromoteResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/memory-candidates/${runCandidateId}/promote`,
      method: 'POST',
      headers: operatorHeaders,
      body: {},
    });
    expectStatus(
      promoteRunCandidate.statusCode,
      [201],
      'run candidate promotion failed',
      promoteRunCandidate.json,
    );
    const runMemoryId = promoteRunCandidate.json?.memory.memoryId;
    if (!runMemoryId) {
      throw new Error('Run candidate promotion did not create a memory.');
    }

    const promoteApprovalCandidate = await requestJson<MemoryPromoteResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/memory-candidates/${approvalCandidateId}/promote`,
      method: 'POST',
      headers: operatorHeaders,
      body: {},
    });
    expectStatus(
      promoteApprovalCandidate.statusCode,
      [201],
      'approval candidate promotion failed',
      promoteApprovalCandidate.json,
    );
    const approvalMemoryId = promoteApprovalCandidate.json?.memory.memoryId;
    if (!approvalMemoryId) {
      throw new Error('Approval candidate promotion did not create a memory.');
    }

    const promoteGitHubCandidate = await requestJson<MemoryPromoteResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/memory-candidates/${githubCandidateId}/promote`,
      method: 'POST',
      headers: operatorHeaders,
      body: {},
    });
    expectStatus(
      promoteGitHubCandidate.statusCode,
      [201],
      'GitHub candidate promotion failed',
      promoteGitHubCandidate.json,
    );
    const githubMemoryId = promoteGitHubCandidate.json?.memory.memoryId;
    if (!githubMemoryId) {
      throw new Error('GitHub candidate promotion did not create a memory.');
    }

    const listCandidates = await requestJson<CandidateListResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/memory/candidates?limit=10`,
      headers: operatorHeaders,
    });
    expectStatus(
      listCandidates.statusCode,
      [200],
      'candidate listing failed',
      listCandidates.json,
    );

    const listMemories = await requestJson<MemoryListResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/memory?limit=10`,
      headers: operatorHeaders,
    });
    expectStatus(
      listMemories.statusCode,
      [200],
      'memory listing failed',
      listMemories.json,
    );

    const retrieveBeforeInvalidation = await requestJson<RetrievalResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/memory/retrieve?objectiveId=${encodeURIComponent(
        objectiveId,
      )}&scopeRef=${encodeURIComponent(
        'scope:memory-run',
      )}&retentionClasses=operational,knowledge`,
      headers: operatorHeaders,
    });
    expectStatus(
      retrieveBeforeInvalidation.statusCode,
      [200],
      'memory retrieval before invalidation failed',
      retrieveBeforeInvalidation.json,
    );

    const githubProvenance = await requestJson<ProvenanceResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/memory/${githubMemoryId}/provenance`,
      headers: operatorHeaders,
    });
    expectStatus(
      githubProvenance.statusCode,
      [200],
      'GitHub memory provenance failed',
      githubProvenance.json,
    );

    const invalidateApprovalMemory = await requestJson<{
      memory?: {
        status?: string;
      };
    }>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/memory/${approvalMemoryId}/invalidate`,
      method: 'POST',
      headers: operatorHeaders,
      body: {
        reason: 'revoked',
      },
    });
    expectStatus(
      invalidateApprovalMemory.statusCode,
      [200],
      'memory invalidation failed',
      invalidateApprovalMemory.json,
    );

    const retrieveAfterInvalidation = await requestJson<RetrievalResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/memory/retrieve?objectiveId=${encodeURIComponent(
        objectiveId,
      )}&retentionClasses=knowledge,operational`,
      headers: operatorHeaders,
    });
    expectStatus(
      retrieveAfterInvalidation.statusCode,
      [200],
      'memory retrieval after invalidation failed',
      retrieveAfterInvalidation.json,
    );

    const evaluation = await requestJson<EvaluationResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/memory/evaluation`,
      headers: operatorHeaders,
    });
    expectStatus(
      evaluation.statusCode,
      [200],
      'memory evaluation failed',
      evaluation.json,
    );

    const retrievalBeforeItems = retrieveBeforeInvalidation.json?.items ?? [];
    const retrievalAfterItems = retrieveAfterInvalidation.json?.items ?? [];
    const evaluationSnapshot = evaluation.json?.evaluation;

    if (
      !retrievalBeforeItems.some((item) => !item.withheld) ||
      !retrievalBeforeItems.every(
        (item) => item.memory.scopeRef === 'scope:memory-run',
      )
    ) {
      throw new Error(
        'Expected bounded retrieval before invalidation to return only scope:memory-run memories.',
      );
    }

    if (
      retrievalAfterItems.some(
        (item) => item.memory.memoryId === approvalMemoryId,
      )
    ) {
      throw new Error(
        'Revoked memory should not be returned after invalidation.',
      );
    }

    if (
      githubProvenance.json?.candidateInboundEdges.every(
        (edge) => edge.sourceNodeType !== 'github_inbound',
      )
    ) {
      throw new Error(
        'GitHub memory provenance did not preserve the inbound-event lineage.',
      );
    }

    if ((evaluationSnapshot?.totalCandidates ?? 0) < 3) {
      throw new Error(
        'Expected at least three memory candidates in evaluation.',
      );
    }

    if ((evaluationSnapshot?.totalMemories ?? 0) < 3) {
      throw new Error(
        'Expected at least three promoted memories in evaluation.',
      );
    }

    if ((evaluationSnapshot?.contaminationRate ?? 1) !== 0) {
      throw new Error(
        `Expected contamination rate to remain 0, received ${evaluationSnapshot?.contaminationRate ?? 'unknown'}.`,
      );
    }

    if ((evaluationSnapshot?.provenanceCompleteness ?? 0) < 1) {
      throw new Error(
        `Expected provenance completeness to be 1, received ${evaluationSnapshot?.provenanceCompleteness ?? 'unknown'}.`,
      );
    }

    console.log(
      JSON.stringify(
        {
          companyId,
          objectiveId,
          runId,
          approvalId,
          githubInboundEventId: inboundEvent.inboundEventId,
          runCandidateId,
          approvalCandidateId,
          githubCandidateId,
          runMemoryId,
          approvalMemoryId,
          githubMemoryId,
          inboundClassification: inboundEvent.classification ?? null,
          inboundStatus: inboundEvent.status ?? null,
          candidateCount: listCandidates.json?.candidates.length ?? 0,
          memoryCount: listMemories.json?.memories.length ?? 0,
          retrievalBeforeCount: retrievalBeforeItems.length,
          retrievalAfterCount: retrievalAfterItems.length,
          githubProvenanceInboundEdges:
            githubProvenance.json?.candidateInboundEdges.length ?? 0,
          evaluation: evaluationSnapshot,
        },
        null,
        2,
      ),
    );
  } finally {
    await githubAppLive?.close();
    await controlPlaneLive?.close();
    await runtime.restoreEnvironment();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
