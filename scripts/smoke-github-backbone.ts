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
};

type DispatchResponse = {
  run: {
    runId: string;
    status: string;
  };
};

type GitHubStatusResponse = {
  projectionHealth?: {
    status?: string;
    openDriftCount?: number;
  };
  metrics?: {
    failedDeliveries?: number;
    inboundNeedsReview?: number;
    openDriftCount?: number;
  };
};

type GitHubInboundEventsResponse = {
  inboundEvents: Array<{
    inboundEventId: string;
    classification?: string;
    status?: string;
  }>;
};

type GitHubDeliveriesResponse = {
  deliveries: Array<{
    githubObjectType?: string;
    status?: string;
  }>;
};

type GitHubDriftAlertsResponse = {
  driftAlerts: Array<{
    severity?: string;
    driftClass?: string;
    repairStatus?: string;
  }>;
};

type WorkItemDetailResponse = {
  workItem?: {
    status?: string;
    latestRunId?: string;
  };
};

async function main() {
  const runtime = await prepareSmokeRuntime({
    prefix: 'github_backbone',
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
      credentials: createSmokeOperatorCredentials('github-backbone'),
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
        'x-idempotency-key': `github-company-${suffix}`,
      },
      body: {
        slug: `github-smoke-${suffix}`,
        displayName: 'GitHub Smoke Company',
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
      throw new Error('GitHub smoke did not receive a company id.');
    }

    const linkInstallation = await requestJson<{
      installation?: { installationId?: number };
    }>({
      baseUrl: githubAppLive.baseUrl,
      path: '/installations/link',
      method: 'POST',
      body: {
        companyId,
        installationId: 42,
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

    const createObjective = await requestJson<ObjectiveCreateResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/objectives',
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `github-objective-${suffix}`,
      },
      body: {
        companyId,
        title: 'Validate GitHub backbone live path',
        summary:
          'Project runtime truth through the live github-app surface and keep drift fail-closed.',
        repositoryTarget: {
          owner: 'escalonalabs',
          name: 'agents-company-escalona-labs',
          id: 7,
        },
        requestedWorkItems: [
          {
            title: 'Mirror runtime state into GitHub',
            description: 'Project the work item through the live GitHub app.',
            scopeRef: 'scope:github-backbone',
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
    const workItemId = createObjective.json?.workItems[0]?.workItemId;
    if (!workItemId) {
      throw new Error('GitHub smoke did not receive a work item id.');
    }

    const dispatch = await requestJson<DispatchResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/work-items/${workItemId}/dispatch`,
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `github-dispatch-${suffix}`,
      },
      body: {
        assignedAgentId: 'agent.github.smoke',
        headSha: '0123456789abcdef0123456789abcdef01234567',
      },
    });
    expectStatus(dispatch.statusCode, [201], 'dispatch failed', dispatch.json);
    const runId = dispatch.json?.run.runId;
    if (!runId) {
      throw new Error('GitHub smoke did not receive a run id.');
    }

    const workItemBefore = await requestJson<WorkItemDetailResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/work-items/${workItemId}`,
      headers: operatorHeaders,
    });
    expectStatus(
      workItemBefore.statusCode,
      [200],
      'work item lookup before webhook failed',
      workItemBefore.json,
    );
    const workItemStatusBefore = workItemBefore.json?.workItem?.status;

    const sync = await requestJson<{
      batches?: Array<{
        sync?: {
          deliveries?: Array<{
            githubObjectType?: string;
            status?: string;
          }>;
        };
      }>;
      persisted?: {
        projectionHealth?: {
          status?: string;
        };
      };
    }>({
      baseUrl: githubAppLive.baseUrl,
      path: `/companies/${companyId}/sync`,
      method: 'POST',
    });
    expectStatus(sync.statusCode, [200], 'GitHub sync failed', sync.json);

    const linkedIssue = [...githubStub.state.issues.values()].find((issue) =>
      String(issue.body ?? '').includes(workItemId),
    );
    if (!linkedIssue) {
      throw new Error(
        'GitHub sync did not materialize a linked issue for the work item.',
      );
    }

    const webhookResponse = await postSignedGitHubWebhook({
      githubAppBaseUrl: githubAppLive.baseUrl,
      webhookSecret: githubCredentials.webhookSecret,
      deliveryId: `delivery-${suffix}`,
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

    const status = await requestJson<GitHubStatusResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/github/status`,
      headers: operatorHeaders,
    });
    expectStatus(
      status.statusCode,
      [200],
      'GitHub status lookup failed',
      status.json,
    );

    const inbound = await requestJson<GitHubInboundEventsResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/github/inbound-events`,
      headers: operatorHeaders,
    });
    expectStatus(
      inbound.statusCode,
      [200],
      'GitHub inbound event lookup failed',
      inbound.json,
    );

    const deliveries = await requestJson<GitHubDeliveriesResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/github/deliveries`,
      headers: operatorHeaders,
    });
    expectStatus(
      deliveries.statusCode,
      [200],
      'GitHub deliveries lookup failed',
      deliveries.json,
    );

    const driftAlerts = await requestJson<GitHubDriftAlertsResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyId}/github/drift-alerts`,
      headers: operatorHeaders,
    });
    expectStatus(
      driftAlerts.statusCode,
      [200],
      'GitHub drift alert lookup failed',
      driftAlerts.json,
    );

    const workItemAfter = await requestJson<WorkItemDetailResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/work-items/${workItemId}`,
      headers: operatorHeaders,
    });
    expectStatus(
      workItemAfter.statusCode,
      [200],
      'work item lookup after webhook failed',
      workItemAfter.json,
    );

    const inboundEvent = inbound.json?.inboundEvents[0];
    const projectionHealth = status.json?.projectionHealth?.status;
    const openDriftCount = status.json?.projectionHealth?.openDriftCount ?? 0;
    const appliedDeliveries =
      deliveries.json?.deliveries.filter(
        (delivery) => delivery.status === 'applied',
      ).length ?? 0;
    const workItemStatusAfter = workItemAfter.json?.workItem?.status;
    const workItemStillPinnedToRun =
      workItemAfter.json?.workItem?.latestRunId === runId;

    if (projectionHealth !== 'drifted') {
      throw new Error(
        `Expected GitHub projection health to become drifted after authoritative conflict, received ${projectionHealth ?? 'unknown'}.`,
      );
    }

    if (openDriftCount < 1) {
      throw new Error('Expected at least one open drift alert after webhook.');
    }

    if (inboundEvent?.classification !== 'authoritative_conflict') {
      throw new Error(
        `Expected authoritative_conflict inbound event, received ${inboundEvent?.classification ?? 'unknown'}.`,
      );
    }

    if (workItemStatusAfter !== workItemStatusBefore) {
      throw new Error(
        `GitHub webhook mutated runtime truth unexpectedly (${workItemStatusBefore ?? 'unknown'} -> ${workItemStatusAfter ?? 'unknown'}).`,
      );
    }

    if (!workItemStillPinnedToRun) {
      throw new Error(
        'GitHub webhook changed the active run reference unexpectedly.',
      );
    }

    console.log(
      JSON.stringify(
        {
          companyId,
          workItemId,
          runId,
          livePath: {
            controlPlaneBaseUrl: controlPlaneLive.baseUrl,
            githubAppBaseUrl: githubAppLive.baseUrl,
          },
          installationLinked:
            linkInstallation.json?.installation?.installationId,
          projectedIssues: githubStub.state.issues.size,
          projectedComments: githubStub.state.comments.size,
          projectedCheckRuns: githubStub.state.checkRuns.size,
          appliedDeliveries,
          projectionHealth,
          openDriftCount,
          inboundClassification: inboundEvent?.classification ?? null,
          inboundStatus: inboundEvent?.status ?? null,
          driftAlertCount: driftAlerts.json?.driftAlerts.length ?? 0,
          workItemStatusBefore,
          workItemStatusAfter,
          workItemStillPinnedToRun,
          syncBatches: sync.json?.batches?.length ?? 0,
          syncHealthAfterPersist:
            sync.json?.persisted?.projectionHealth?.status ?? null,
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
