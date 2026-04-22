import { closePool } from '../server/control-plane/src/db/pool';
import { buildControlPlaneServer } from '../server/control-plane/src/server';
import {
  bootstrapOperatorSession,
  createSmokeOperatorCredentials,
  expectStatus,
  prepareSmokeRuntime,
  requestJson,
  startFastifyServer,
} from './smoke-harness';

type CompanyCreateResponse = {
  company: {
    companyId: string;
  };
};

type InvitationResponse = {
  invitation: {
    invitationId: string;
    status?: string;
  };
  inviteToken: string;
  mailDelivery?: {
    status?: string;
  };
};

type InvitationPreviewResponse = {
  canAccept?: boolean;
};

type InvitationAcceptResponse = {
  accepted?: boolean;
};

type CompanyListResponse = Array<{
  companyId: string;
}>;

type CompanyAccessResponse = {
  currentRole?: string | null;
  memberships?: Array<unknown>;
  invitations?: Array<unknown>;
};

type CompanyOnboardingResponse = {
  beta?: {
    phase?: string;
    enrollmentStatus?: string;
    eligibleForControlledBeta?: boolean;
  };
};

type OutboxResponse = {
  outbox: Array<{
    recipient?: string;
    status?: string;
  }>;
};

type SyncPlanResponse = {
  batches?: Array<{
    installation?: {
      repository?: {
        name?: string;
      };
    };
    plan?: Array<{
      repository?: {
        name?: string;
      };
    }>;
  }>;
};

async function main() {
  const runtime = await prepareSmokeRuntime({
    prefix: 'customer_foundations',
  });
  const controlPlaneServer = buildControlPlaneServer();
  let controlPlaneLive:
    | Awaited<ReturnType<typeof startFastifyServer>>
    | undefined;

  try {
    controlPlaneLive = await startFastifyServer(controlPlaneServer);

    const ownerCredentials = createSmokeOperatorCredentials('customer-owner');
    const owner = await bootstrapOperatorSession({
      baseUrl: controlPlaneLive.baseUrl,
      credentials: ownerCredentials,
    });
    const ownerHeaders = {
      cookie: owner.cookie,
    };
    const suffix = runtime.schemaName.slice(-8);

    const createCompanyA = await requestJson<CompanyCreateResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/companies',
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'x-idempotency-key': `customer-company-a-${suffix}`,
      },
      body: {
        slug: `customer-a-${suffix}`,
        displayName: 'Customer A',
      },
    });
    expectStatus(
      createCompanyA.statusCode,
      [201],
      'company A creation failed',
      createCompanyA.json,
    );
    const companyAId = createCompanyA.json?.company.companyId;

    const createCompanyB = await requestJson<CompanyCreateResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/companies',
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'x-idempotency-key': `customer-company-b-${suffix}`,
      },
      body: {
        slug: `customer-b-${suffix}`,
        displayName: 'Customer B',
      },
    });
    expectStatus(
      createCompanyB.statusCode,
      [201],
      'company B creation failed',
      createCompanyB.json,
    );
    const companyBId = createCompanyB.json?.company.companyId;

    if (!companyAId || !companyBId) {
      throw new Error('Customer foundations smoke is missing company ids.');
    }

    const betaEnrollment = await requestJson<{
      company?: {
        betaPhase?: string;
        betaEnrollmentStatus?: string;
      };
    }>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/beta-enrollment`,
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'x-idempotency-key': `company-beta-${suffix}`,
      },
      body: {
        phase: 'controlled_beta',
        enrollmentStatus: 'active',
        notes: 'Customer B is approved for the controlled beta smoke.',
      },
    });
    expectStatus(
      betaEnrollment.statusCode,
      [200],
      'beta enrollment update failed',
      betaEnrollment.json,
    );
    if (
      betaEnrollment.json?.company?.betaPhase !== 'controlled_beta' ||
      betaEnrollment.json?.company?.betaEnrollmentStatus !== 'active'
    ) {
      throw new Error(
        `Company beta enrollment did not persist correctly: ${JSON.stringify(betaEnrollment.json, null, 2)}`,
      );
    }

    const onboarding = await requestJson<CompanyOnboardingResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/onboarding`,
      headers: ownerHeaders,
    });
    expectStatus(
      onboarding.statusCode,
      [200],
      'company onboarding fetch failed',
      onboarding.json,
    );
    if (
      onboarding.json?.beta?.phase !== 'controlled_beta' ||
      onboarding.json?.beta?.enrollmentStatus !== 'active'
    ) {
      throw new Error(
        `Onboarding beta snapshot is stale or missing: ${JSON.stringify(onboarding.json, null, 2)}`,
      );
    }

    const invitedEmail = `invited-${suffix}@escalonalabs.dev`;
    const invitedPassword = `InvitedPass!${suffix}`;

    const invite = await requestJson<InvitationResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/invitations`,
      method: 'POST',
      headers: ownerHeaders,
      body: {
        email: invitedEmail,
        role: 'operator',
      },
    });
    expectStatus(
      invite.statusCode,
      [201],
      'company invitation failed',
      invite.json,
    );
    const inviteToken = invite.json?.inviteToken;
    const invitationId = invite.json?.invitation.invitationId;
    const inviteMailStatus = invite.json?.mailDelivery?.status;
    if (!inviteToken || !invitationId) {
      throw new Error('Invitation response is missing token or invitation id.');
    }
    if (inviteMailStatus !== 'sent') {
      throw new Error(
        `Invitation mail was not sent successfully: ${JSON.stringify(invite.json, null, 2)}`,
      );
    }

    const preview = await requestJson<InvitationPreviewResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/company-invitations/${inviteToken}/preview`,
    });
    expectStatus(
      preview.statusCode,
      [200],
      'invitation preview failed',
      preview.json,
    );

    const accept = await requestJson<InvitationAcceptResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/company-invitations/accept',
      method: 'POST',
      body: {
        invitationToken: inviteToken,
        password: invitedPassword,
        displayName: 'Invited Operator',
      },
    });
    expectStatus(
      accept.statusCode,
      [201],
      'invitation acceptance failed',
      accept.json,
    );
    const invitedCookie = accept.headers.get('set-cookie')?.split(';', 1)[0];
    if (!invitedCookie) {
      throw new Error('Invitation acceptance did not return a session cookie.');
    }
    const invitedHeaders = {
      cookie: invitedCookie,
    };

    const invitedCompanies = await requestJson<CompanyListResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/companies',
      headers: invitedHeaders,
    });
    expectStatus(
      invitedCompanies.statusCode,
      [200],
      'invited company listing failed',
      invitedCompanies.json,
    );
    const invitedCompanyList = invitedCompanies.json ?? [];

    const invitedAccessCompanyB = await requestJson<CompanyAccessResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/access`,
      headers: invitedHeaders,
    });
    expectStatus(
      invitedAccessCompanyB.statusCode,
      [200],
      'invited company access failed',
      invitedAccessCompanyB.json,
    );

    const invitedAccessCompanyA = await requestJson({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyAId}`,
      headers: invitedHeaders,
    });
    expectStatus(
      invitedAccessCompanyA.statusCode,
      [403],
      'cross-company access should be forbidden',
      invitedAccessCompanyA.json,
    );

    const invitedCannotManage = await requestJson({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/invitations`,
      method: 'POST',
      headers: invitedHeaders,
      body: {
        email: `blocked-${suffix}@escalonalabs.dev`,
        role: 'viewer',
      },
    });
    expectStatus(
      invitedCannotManage.statusCode,
      [403],
      'operator should not be able to manage invitations',
      invitedCannotManage.json,
    );

    const revokeCandidate = await requestJson<InvitationResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/invitations`,
      method: 'POST',
      headers: ownerHeaders,
      body: {
        email: `revoked-${suffix}@escalonalabs.dev`,
        role: 'viewer',
      },
    });
    expectStatus(
      revokeCandidate.statusCode,
      [201],
      'second invitation creation failed',
      revokeCandidate.json,
    );
    const revokeToken = revokeCandidate.json?.inviteToken;
    const revokeInvitationId = revokeCandidate.json?.invitation.invitationId;
    if (!revokeToken || !revokeInvitationId) {
      throw new Error(
        'Revocation candidate is missing token or invitation id.',
      );
    }

    const revoke = await requestJson<InvitationResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/invitations/${revokeInvitationId}/revoke`,
      method: 'POST',
      headers: ownerHeaders,
      body: {},
    });
    expectStatus(
      revoke.statusCode,
      [200],
      'invitation revoke failed',
      revoke.json,
    );

    const revokedPreview = await requestJson<InvitationPreviewResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/company-invitations/${revokeToken}/preview`,
    });
    expectStatus(
      revokedPreview.statusCode,
      [200],
      'revoked invitation preview failed',
      revokedPreview.json,
    );

    const outbox = await requestJson<OutboxResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/mail/outbox`,
      headers: ownerHeaders,
    });
    expectStatus(
      outbox.statusCode,
      [200],
      'company outbox retrieval failed',
      outbox.json,
    );

    const linkRepoA = await requestJson({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/github/installations`,
      method: 'POST',
      headers: ownerHeaders,
      body: {
        installationId: 8101,
        accountLogin: 'escalonalabs',
        repository: {
          owner: 'escalonalabs',
          name: 'repo-a',
          id: 101,
        },
      },
    });
    expectStatus(
      linkRepoA.statusCode,
      [201],
      'repo A installation link failed',
      linkRepoA.json,
    );

    const linkRepoB = await requestJson({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/github/installations`,
      method: 'POST',
      headers: ownerHeaders,
      body: {
        installationId: 8102,
        accountLogin: 'escalonalabs',
        repository: {
          owner: 'escalonalabs',
          name: 'repo-b',
          id: 102,
        },
      },
    });
    expectStatus(
      linkRepoB.statusCode,
      [201],
      'repo B installation link failed',
      linkRepoB.json,
    );

    const objectiveMissingTarget = await requestJson({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/objectives',
      method: 'POST',
      headers: ownerHeaders,
      body: {
        companyId: companyBId,
        title: 'Objective without repo target',
      },
    });
    expectStatus(
      objectiveMissingTarget.statusCode,
      [400],
      'objective without target should fail closed in multi-repo mode',
      objectiveMissingTarget.json,
    );

    const createObjectiveA = await requestJson({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/objectives',
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'x-idempotency-key': `objective-a-${suffix}`,
      },
      body: {
        companyId: companyBId,
        title: 'Objective for Repo A',
        repositoryTarget: {
          owner: 'escalonalabs',
          name: 'repo-a',
          id: 101,
        },
        requestedWorkItems: [
          {
            title: 'Repo A work item',
            scopeRef: 'scope:repo-a',
          },
        ],
      },
    });
    expectStatus(
      createObjectiveA.statusCode,
      [201],
      'repo A objective creation failed',
      createObjectiveA.json,
    );

    const createObjectiveB = await requestJson({
      baseUrl: controlPlaneLive.baseUrl,
      path: '/objectives',
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'x-idempotency-key': `objective-b-${suffix}`,
      },
      body: {
        companyId: companyBId,
        title: 'Objective for Repo B',
        repositoryTarget: {
          owner: 'escalonalabs',
          name: 'repo-b',
          id: 102,
        },
        requestedWorkItems: [
          {
            title: 'Repo B work item',
            scopeRef: 'scope:repo-b',
          },
        ],
      },
    });
    expectStatus(
      createObjectiveB.statusCode,
      [201],
      'repo B objective creation failed',
      createObjectiveB.json,
    );

    const syncPlan = await requestJson<SyncPlanResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/github/sync-plan`,
      method: 'POST',
      headers: ownerHeaders,
      body: {},
    });
    expectStatus(syncPlan.statusCode, [202], 'sync plan failed', syncPlan.json);
    const batchRepositories =
      syncPlan.json?.batches?.map(
        (batch) => batch.installation?.repository?.name ?? 'unknown',
      ) ?? [];

    if (
      !batchRepositories.includes('repo-a') ||
      !batchRepositories.includes('repo-b')
    ) {
      throw new Error(
        `Expected sync plan batches for repo-a and repo-b, received ${JSON.stringify(syncPlan.json, null, 2)}`,
      );
    }

    const hasRepoMismatch = syncPlan.json?.batches?.some((batch) =>
      (batch.plan ?? []).some(
        (planItem) =>
          planItem.repository?.name !== batch.installation?.repository?.name,
      ),
    );
    if (hasRepoMismatch) {
      throw new Error(
        `Sync plan batches contain cross-repo items: ${JSON.stringify(syncPlan.json, null, 2)}`,
      );
    }

    const companyBAccessForOwner = await requestJson<CompanyAccessResponse>({
      baseUrl: controlPlaneLive.baseUrl,
      path: `/companies/${companyBId}/access`,
      headers: ownerHeaders,
    });
    expectStatus(
      companyBAccessForOwner.statusCode,
      [200],
      'owner access snapshot failed',
      companyBAccessForOwner.json,
    );

    console.log(
      JSON.stringify(
        {
          companyAId,
          companyBId,
          invitationId,
          invitationPreviewCanAccept: preview.json?.canAccept ?? null,
          invitationAcceptedStatus: accept.statusCode,
          invitedCompanyCount: invitedCompanyList.length,
          invitedOnlySeesCompanyB:
            invitedCompanyList.length === 1 &&
            invitedCompanyList[0]?.companyId === companyBId,
          crossCompanyForbiddenStatus: invitedAccessCompanyA.statusCode,
          invitedAccessStatus: invitedAccessCompanyB.statusCode,
          invitedMembershipCount:
            invitedAccessCompanyB.json?.memberships?.length ?? 0,
          invitedCurrentRole: invitedAccessCompanyB.json?.currentRole ?? null,
          inviteMailStatus,
          outboxSentToInvitedUser:
            outbox.json?.outbox.some(
              (entry) =>
                entry.recipient === invitedEmail && entry.status === 'sent',
            ) ?? false,
          inviteManageForbiddenStatus: invitedCannotManage.statusCode,
          revokedInvitationStatus: revoke.json?.invitation.status ?? null,
          revokedPreviewCanAccept: revokedPreview.json?.canAccept ?? null,
          ownerInvitationCount:
            companyBAccessForOwner.json?.invitations?.length ?? 0,
          objectiveMissingTargetStatus: objectiveMissingTarget.statusCode,
          syncBatchRepositories: batchRepositories,
        },
        null,
        2,
      ),
    );
  } finally {
    await controlPlaneLive?.close();
    await runtime.restoreEnvironment();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
