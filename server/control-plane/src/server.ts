import { createHash, randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import type {
  ApprovalDecision,
  Company,
  CompanyInvitation,
  CompanyRole,
  DomainEvent,
  DriftAlert,
  KnowledgeMemory,
  MemoryCandidate,
  MemoryInvalidationReason,
  MemoryRetentionClass,
  Objective,
  OperatorTimelineEvent,
  ProvenanceEdge,
  RepositoryTarget,
  Run,
  WorkItem,
} from '@escalonalabs/domain';
import {
  createExecutionPacket,
  createToolRequestEnvelope,
  mapTaskResultToRunStatus,
  validateTaskResult,
} from '@escalonalabs/execution';
import type {
  GitHubInboundEventRecord,
  GitHubInstallationRef,
  GitHubProjectionBinding,
  GitHubProjectionDelivery,
} from '@escalonalabs/github';
import { replayAggregate } from '@escalonalabs/kernel';
import {
  evaluateMemoryQuality,
  extractMemoryCandidateFromApproval,
  extractMemoryCandidateFromGitHubEvent,
  extractMemoryCandidatesFromRun,
  invalidateKnowledgeMemory,
  promoteMemoryCandidate,
  retrieveKnowledgeMemories,
} from '@escalonalabs/memory';
import {
  type PlannedWorkItemInput,
  createDispatchDecision,
  createObjectivePlan,
  deriveObjectiveStatus,
  mapTaskResultToWorkItemStatus,
  summarizeObjectiveGraph,
} from '@escalonalabs/orchestration';

import {
  type AuthenticatedRequestContext,
  authenticateWithPassword,
  bootstrapRequired,
  canAssumeRole,
  clearSessionCookie,
  createAuthenticatedSession,
  createSessionCookie,
  hashOpaqueToken,
  hashPassword,
  loadAuthenticatedRequestContext,
  parseCookieValue,
} from './auth';
import { loadControlPlaneConfig } from './config';
import {
  acceptCompanyInvitation,
  addCompanyMembership,
  createCompanyInvitation,
  createUser,
  deleteUserSession,
  findActiveCompanyInvitationByEmail,
  getCompanyInvitationById,
  getCompanyInvitationByTokenHash,
  getCompanyMembership,
  getUserByEmail,
  listCompaniesForUser,
  listCompanyInvitationsForCompany,
  listCompanyMembershipsForCompany,
  listCompanyMembershipsForUser,
  revokeCompanyInvitation,
} from './db/auth';
import {
  type Queryable,
  appendDomainEvent,
  getCommandLogEntry,
  listDomainEvents,
  recordCommandLogEntry,
} from './db/events';
import {
  getGitHubInboundEventByDeliveryId,
  getGitHubInboundEventById,
  listDriftAlerts,
  listGitHubInboundEvents,
  listGitHubInstallations,
  upsertGitHubInboundEvent,
} from './db/github';
import { listOutboundMail } from './db/mail';
import {
  getKnowledgeMemoryByCandidateId,
  getKnowledgeMemoryById,
  getMemoryCandidateById,
  insertMemoryRetrievalAudits,
  insertProvenanceEdges,
  listKnowledgeMemories,
  listMemoryCandidates,
  listMemoryRetrievalAudits,
  listProvenanceEdges,
  updateMemoryCandidateStatus,
  upsertKnowledgeMemory,
  upsertMemoryCandidate,
} from './db/memory';
import { getPool } from './db/pool';
import {
  acquireClaimLease,
  expireActiveClaimLeases,
  getActiveClaimLeaseByScope,
  getApprovalById,
  getApprovalByWorkItemId,
  getCompanyById,
  getCompanyBySlug,
  getExecutionPacketByRunId,
  getObjectiveById,
  getRunById,
  getWorkItemById,
  listAllObjectives,
  listApprovals,
  listApprovalsByCompany,
  listCompanies,
  listObjectives,
  listRuns,
  listRunsByWorkItem,
  listWorkItems,
  listWorkItemsByObjective,
  releaseClaimLeaseByRunId,
  storeExecutionPacket,
  upsertApproval,
} from './db/runtime';
import {
  linkGitHubInstallation,
  loadGitHubStatus,
  persistGitHubSyncResults,
  queueGitHubSyncPlanForCompany,
  recordGitHubInboundWebhook,
} from './github';
import { sendInvitationEmail } from './mail';
import {
  loadControlPlaneMetricsSnapshot,
  renderControlPlanePrometheusMetrics,
} from './metrics';
import {
  type PacketSignatureSeed,
  buildDispatchSignature,
  createPacketSignatureSeed,
  formatValidationFailureSummary,
  persistApprovalSnapshot,
  persistClaimEvent,
  persistCompanyCreated,
  persistCompanyUpdated,
  persistObjectiveSnapshot,
  persistRunSnapshot,
  persistWorkItemSnapshot,
  syncObjectiveStatus,
} from './runtime-ledger';
import { mergeTimelineEvents } from './timeline';

declare module 'fastify' {
  interface FastifyRequest {
    authContextCache?: AuthenticatedRequestContext | null;
    isInternalRequest?: boolean;
  }
}

type AccessResolution =
  | {
      internal: true;
      context: null;
    }
  | {
      internal: false;
      context: AuthenticatedRequestContext;
    };

const sessionCookieName = 'agents_company_session';
const roleWeight: Record<CompanyRole, number> = {
  viewer: 1,
  reviewer: 2,
  operator: 3,
  admin: 4,
  owner: 5,
};
const defaultCompanyBetaPhase: NonNullable<Company['betaPhase']> =
  'internal_alpha';
const defaultCompanyBetaEnrollmentStatus: NonNullable<
  Company['betaEnrollmentStatus']
> = 'active';

type CompanyBetaSnapshot = {
  phase: NonNullable<Company['betaPhase']>;
  enrollmentStatus: NonNullable<Company['betaEnrollmentStatus']>;
  notes?: string;
  updatedAt?: string;
  eligibleForControlledBeta: boolean;
  allowlistConfigured: boolean;
};

function makeIdempotencyKey(headerValue: unknown, fallback: string): string {
  return typeof headerValue === 'string' && headerValue.trim().length > 0
    ? headerValue.trim()
    : fallback;
}

function makeEventCausationKey(base: string, suffix: string): string {
  return `${base}:${suffix}`;
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isCompanyEligibleForControlledBeta(
  company: Pick<Company, 'slug'>,
  config: ReturnType<typeof loadControlPlaneConfig>,
): boolean {
  return (
    config.controlledBetaCompanySlugs.length === 0 ||
    config.controlledBetaCompanySlugs.includes(company.slug)
  );
}

function normalizeCompanySnapshot(
  company: Company,
  config: ReturnType<typeof loadControlPlaneConfig>,
): Company {
  return {
    ...company,
    betaPhase: company.betaPhase ?? defaultCompanyBetaPhase,
    betaEnrollmentStatus:
      company.betaEnrollmentStatus ?? defaultCompanyBetaEnrollmentStatus,
    betaUpdatedAt: company.betaUpdatedAt ?? company.createdAt,
  };
}

function createCompanyBetaSnapshot(
  company: Company,
  config: ReturnType<typeof loadControlPlaneConfig>,
): CompanyBetaSnapshot {
  const normalizedCompany = normalizeCompanySnapshot(company, config);

  return {
    phase: normalizedCompany.betaPhase ?? defaultCompanyBetaPhase,
    enrollmentStatus:
      normalizedCompany.betaEnrollmentStatus ??
      defaultCompanyBetaEnrollmentStatus,
    notes: normalizedCompany.betaNotes,
    updatedAt: normalizedCompany.betaUpdatedAt,
    eligibleForControlledBeta: isCompanyEligibleForControlledBeta(
      normalizedCompany,
      config,
    ),
    allowlistConfigured: config.controlledBetaCompanySlugs.length > 0,
  };
}

function createMemoryProvenanceEdge(input: {
  companyId: string;
  sourceNodeType: ProvenanceEdge['sourceNodeType'];
  sourceNodeId: string;
  targetNodeType: ProvenanceEdge['targetNodeType'];
  targetNodeId: string;
  edgeType: ProvenanceEdge['edgeType'];
  createdAt: string;
}): ProvenanceEdge {
  const edgeId = createHash('sha256')
    .update(
      [
        input.companyId,
        input.sourceNodeType,
        input.sourceNodeId,
        input.targetNodeType,
        input.targetNodeId,
        input.edgeType,
      ].join(':'),
    )
    .digest('hex')
    .slice(0, 24);

  return {
    edgeId: `prov_${edgeId}`,
    companyId: input.companyId,
    sourceNodeType: input.sourceNodeType,
    sourceNodeId: input.sourceNodeId,
    targetNodeType: input.targetNodeType,
    targetNodeId: input.targetNodeId,
    edgeType: input.edgeType,
    createdAt: input.createdAt,
  };
}

function parseRetentionClasses(
  rawValue: string | undefined,
): MemoryRetentionClass[] | undefined {
  if (!rawValue) {
    return undefined;
  }

  const allowed = new Set<MemoryRetentionClass>([
    'operational',
    'knowledge',
    'audit',
  ]);
  const values = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is MemoryRetentionClass =>
      allowed.has(value as MemoryRetentionClass),
    );

  return values.length > 0 ? values : undefined;
}

async function resolveGitHubMemoryContext(
  db: Queryable,
  inboundEvent: GitHubInboundEventRecord,
): Promise<{
  objectiveId?: string;
  scopeRef?: string;
}> {
  if (!inboundEvent.aggregateId || !inboundEvent.aggregateType) {
    return {};
  }

  if (inboundEvent.aggregateType === 'work_item') {
    const workItem = await getWorkItemById(db, inboundEvent.aggregateId);
    return workItem
      ? {
          objectiveId: workItem.objectiveId,
          scopeRef: workItem.scopeRef,
        }
      : {};
  }

  if (inboundEvent.aggregateType === 'objective') {
    return {
      objectiveId: inboundEvent.aggregateId,
    };
  }

  if (inboundEvent.aggregateType === 'run') {
    const run = await getRunById(db, inboundEvent.aggregateId);
    if (!run) {
      return {};
    }

    const workItem = await getWorkItemById(db, run.workItemId);
    return workItem
      ? {
          objectiveId: workItem.objectiveId,
          scopeRef: workItem.scopeRef,
        }
      : {};
  }

  if (inboundEvent.aggregateType === 'approval') {
    const approval = await getApprovalById(db, inboundEvent.aggregateId);
    if (!approval) {
      return {};
    }

    const workItem = await getWorkItemById(db, approval.workItemId);
    return workItem
      ? {
          objectiveId: workItem.objectiveId,
          scopeRef: workItem.scopeRef,
        }
      : {};
  }

  return {};
}

function getSecureCookieFlag(
  config: ReturnType<typeof loadControlPlaneConfig>,
) {
  return (
    config.appUrl?.startsWith('https://') === true ||
    process.env.AGENTS_COMPANY_NODE_ENV === 'production'
  );
}

function getAppOrigin(config: ReturnType<typeof loadControlPlaneConfig>) {
  return config.appUrl ? new URL(config.appUrl).origin : null;
}

function getHighestRole(
  memberships: AuthenticatedRequestContext['memberships'],
) {
  return memberships.reduce<CompanyRole | null>((highest, membership) => {
    if (!highest || roleWeight[membership.role] > roleWeight[highest]) {
      return membership.role;
    }

    return highest;
  }, null);
}

function getMembershipRoleForCompany(
  memberships: AuthenticatedRequestContext['memberships'],
  companyId: string,
) {
  return (
    memberships.find((membership) => membership.companyId === companyId)
      ?.role ?? null
  );
}

function getInvitableRoles(actorRole: CompanyRole | null): CompanyRole[] {
  if (actorRole === 'owner') {
    return ['admin', 'operator', 'reviewer', 'viewer'];
  }

  if (actorRole === 'admin') {
    return ['operator', 'reviewer', 'viewer'];
  }

  return [];
}

function buildInvitationUrl(
  config: ReturnType<typeof loadControlPlaneConfig>,
  invitationToken: string,
) {
  const query = `?invite=${encodeURIComponent(invitationToken)}`;

  if (!config.appUrl) {
    return `/${query}`;
  }

  const url = new URL(config.appUrl);
  url.searchParams.set('invite', invitationToken);
  return url.toString();
}

function normalizeRepositoryTargetInput(
  value:
    | {
        owner?: string;
        name?: string;
        id?: number;
      }
    | undefined,
): RepositoryTarget | undefined {
  if (!value) {
    return undefined;
  }

  const owner = value.owner?.trim();
  const name = value.name?.trim();

  if (!owner && !name && value.id === undefined) {
    return undefined;
  }

  if (!owner || !name) {
    throw new Error('Repository target requires both owner and name.');
  }

  if (
    value.id !== undefined &&
    (!Number.isInteger(value.id) || Number(value.id) <= 0)
  ) {
    throw new Error('Repository target id must be a positive integer.');
  }

  return {
    owner,
    name,
    id: value.id,
  };
}

function repositoryTargetsMatch(
  left: RepositoryTarget,
  right: RepositoryTarget,
) {
  if (left.id !== undefined && right.id !== undefined) {
    return left.id === right.id;
  }

  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  );
}

async function resolveObjectiveRepositoryTarget(
  db: Queryable,
  companyId: string,
  requestedTarget: RepositoryTarget | undefined,
): Promise<RepositoryTarget | undefined> {
  const installations = await listGitHubInstallations(db, companyId);

  if (installations.length === 0) {
    if (requestedTarget) {
      throw new Error(
        'Cannot target a repository before linking a GitHub installation.',
      );
    }

    return undefined;
  }

  if (requestedTarget) {
    const installation = installations.find((candidate) =>
      repositoryTargetsMatch(candidate.repository, requestedTarget),
    );

    if (!installation) {
      throw new Error(
        'Repository target must match one of the linked GitHub repositories for this company.',
      );
    }

    return installation.repository;
  }

  if (installations.length === 1) {
    return installations[0]?.repository;
  }

  throw new Error(
    'Repository target is required when the company has multiple linked GitHub repositories.',
  );
}

async function getRequestAuthContext(
  request: {
    authContextCache?: AuthenticatedRequestContext | null;
    headers: Record<string, unknown>;
  },
  db: Queryable,
  config: ReturnType<typeof loadControlPlaneConfig>,
) {
  if (request.authContextCache !== undefined) {
    return request.authContextCache;
  }

  if (!config.sessionSecret) {
    request.authContextCache = null;
    return null;
  }

  const cookieHeader = request.headers.cookie;
  request.authContextCache = await loadAuthenticatedRequestContext(db, {
    cookieHeader: typeof cookieHeader === 'string' ? cookieHeader : undefined,
    sessionSecret: config.sessionSecret,
  });
  return request.authContextCache;
}

async function requireAuthenticatedAccess(
  request: {
    headers: Record<string, unknown>;
    isInternalRequest?: boolean;
    authContextCache?: AuthenticatedRequestContext | null;
  },
  reply: {
    code: (statusCode: number) => unknown;
  },
  db: Queryable,
  config: ReturnType<typeof loadControlPlaneConfig>,
): Promise<AccessResolution | null> {
  if (request.isInternalRequest) {
    return {
      internal: true,
      context: null,
    };
  }

  const context = await getRequestAuthContext(request, db, config);

  if (!context) {
    reply.code(401);
    return null;
  }

  return {
    internal: false,
    context,
  };
}

async function requireCompanyAccess(
  request: {
    headers: Record<string, unknown>;
    isInternalRequest?: boolean;
    authContextCache?: AuthenticatedRequestContext | null;
  },
  reply: {
    code: (statusCode: number) => unknown;
  },
  db: Queryable,
  config: ReturnType<typeof loadControlPlaneConfig>,
  input: {
    companyId: string;
    minimumRole: CompanyRole;
  },
): Promise<AccessResolution | null> {
  const access = await requireAuthenticatedAccess(request, reply, db, config);

  if (!access) {
    return null;
  }

  if (access.internal) {
    return access;
  }

  if (
    !canAssumeRole(
      access.context.memberships,
      input.companyId,
      input.minimumRole,
    )
  ) {
    reply.code(403);
    return null;
  }

  return access;
}

async function listAccessibleCompanies(
  request: {
    headers: Record<string, unknown>;
    isInternalRequest?: boolean;
    authContextCache?: AuthenticatedRequestContext | null;
  },
  db: Queryable,
  config: ReturnType<typeof loadControlPlaneConfig>,
) {
  if (request.isInternalRequest) {
    return listCompanies(db);
  }

  const context = await getRequestAuthContext(request, db, config);
  if (!context) {
    return null;
  }

  return listCompaniesForUser(db, context.user.userId);
}

async function buildMergedTimeline(
  db: Queryable,
  input: {
    companyIds: string[];
    limit: number;
    aggregateType?: string;
    aggregateId?: string;
  },
): Promise<OperatorTimelineEvent[]> {
  if (input.companyIds.length === 0) {
    return [];
  }

  const batches = await Promise.all(
    input.companyIds.map(async (companyId) => ({
      ledgerEvents: await listDomainEvents(db, {
        companyId,
        limit: input.limit,
        order: 'desc',
      }),
      driftAlerts: await listDriftAlerts(db, {
        companyId,
        limit: input.limit,
      }),
      inboundEvents: await listGitHubInboundEvents(db, {
        companyId,
        limit: input.limit,
      }),
    })),
  );

  const merged = mergeTimelineEvents({
    ledgerEvents: batches.flatMap((batch) => batch.ledgerEvents),
    driftAlerts: batches.flatMap((batch) => batch.driftAlerts),
    inboundEvents: batches.flatMap((batch) => batch.inboundEvents),
    limit: input.limit,
  });

  return merged
    .filter((event) =>
      input.aggregateType ? event.aggregateType === input.aggregateType : true,
    )
    .filter((event) =>
      input.aggregateId ? event.aggregateId === input.aggregateId : true,
    )
    .slice(0, input.limit);
}

export function buildControlPlaneServer() {
  const config = loadControlPlaneConfig();
  const appOrigin = getAppOrigin(config);
  const secureCookie = getSecureCookieFlag(config);
  const internalApiHeader = 'x-agents-company-internal-token';
  const server = Fastify({ logger: true });

  const applyCorsHeaders = (
    request: { headers: Record<string, unknown> },
    reply: { header: (name: string, value: string) => unknown },
  ) => {
    const origin = request.headers.origin;

    if (!appOrigin || origin !== appOrigin) {
      return;
    }

    reply.header('Access-Control-Allow-Origin', appOrigin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header(
      'Access-Control-Allow-Headers',
      'content-type, x-idempotency-key, x-agents-company-internal-token',
    );
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Vary', 'Origin');
  };

  const executeAcceptedGitHubIntent = async (
    inboundEvent: GitHubInboundEventRecord,
  ) => {
    const command = inboundEvent.proposedCommand;

    if (!command) {
      return inboundEvent;
    }

    const route =
      command.commandType === 'approval.grant'
        ? `/approvals/${command.aggregateId}/grant`
        : command.commandType === 'approval.deny'
          ? `/approvals/${command.aggregateId}/deny`
          : command.commandType === 'work_item.cancel'
            ? `/work-items/${command.aggregateId}/cancel`
            : `/work-items/${command.aggregateId}/requeue`;
    const payload = command.commandType.startsWith('approval.')
      ? {
          decisionReason: `Accepted GitHub intent ${inboundEvent.githubDeliveryId}.`,
        }
      : {};
    const response = await server.inject({
      method: 'POST',
      url: route,
      headers: {
        [internalApiHeader]: config.internalApiToken ?? '',
        'x-idempotency-key': `github:${inboundEvent.githubDeliveryId}:${command.commandType}`,
      },
      payload,
    });
    const body = response.json() as { message?: string };
    const nextStatus =
      response.statusCode >= 200 && response.statusCode < 300
        ? 'applied'
        : 'rejected';

    return {
      ...inboundEvent,
      status: nextStatus,
      notes:
        nextStatus === 'applied'
          ? `GitHub intent executed through ${route}.`
          : `GitHub intent rejected by ${route}: ${
              body.message ?? `HTTP ${response.statusCode}`
            }`,
    } satisfies GitHubInboundEventRecord;
  };

  server.addHook('onRequest', async (request, reply) => {
    applyCorsHeaders(request, reply);

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
      return;
    }

    request.isInternalRequest = false;
    const providedInternalToken = request.headers[internalApiHeader];

    if (
      config.internalApiToken &&
      providedInternalToken === config.internalApiToken
    ) {
      request.isInternalRequest = true;
    }

    if (!request.url.startsWith('/internal/')) {
      return;
    }

    if (!config.internalApiToken) {
      reply.code(503).send({
        message:
          'Internal API token is not configured for control-plane ingress.',
      });
      return;
    }

    if (providedInternalToken !== config.internalApiToken) {
      reply.code(401).send({
        message:
          'Internal API token is required for internal control-plane routes.',
      });
      return;
    }

    request.isInternalRequest = true;
  });

  server.get('/health', async () => {
    const pool = getPool();
    const snapshot = await loadControlPlaneMetricsSnapshot({
      pool,
      sessionReady: Boolean(config.sessionSecret),
      internalApiReady: Boolean(config.internalApiToken),
      appOrigin,
    });

    return {
      service: 'control-plane',
      status: 'ok',
      auth: {
        ...snapshot.auth,
        appOrigin: snapshot.appOrigin,
      },
      companiesLoaded: snapshot.counts.companies,
      counts: snapshot.counts,
    };
  });

  server.get('/metrics', async (_request, reply) => {
    const snapshot = await loadControlPlaneMetricsSnapshot({
      pool: getPool(),
      sessionReady: Boolean(config.sessionSecret),
      internalApiReady: Boolean(config.internalApiToken),
      appOrigin,
    });

    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    reply.header('cache-control', 'no-store');

    return renderControlPlanePrometheusMetrics(snapshot);
  });

  server.get('/auth/session', async (request, reply) => {
    if (!config.sessionSecret) {
      reply.code(503);
      return {
        message: 'Session auth is not configured for this control-plane.',
      };
    }

    const pool = getPool();
    const needsBootstrap = await bootstrapRequired(pool);
    const context = await getRequestAuthContext(request, pool, config);

    if (!context) {
      return {
        authenticated: false,
        bootstrapRequired: needsBootstrap,
        loginUrl: '/auth/login',
        logoutUrl: '/auth/logout',
      };
    }

    return {
      authenticated: true,
      bootstrapRequired: false,
      loginUrl: '/auth/login',
      logoutUrl: '/auth/logout',
      session: context.session,
      operator: {
        displayName: context.user.displayName,
        email: context.user.email,
        role: getHighestRole(context.memberships) ?? 'viewer',
      },
    };
  });

  server.post<{
    Body: {
      email: string;
      password: string;
      displayName?: string;
    };
  }>('/auth/bootstrap', async (request, reply) => {
    if (!config.sessionSecret) {
      reply.code(503);
      return {
        message: 'Session auth is not configured for this control-plane.',
      };
    }

    const pool = getPool();
    if (!(await bootstrapRequired(pool))) {
      reply.code(409);
      return {
        message: 'Bootstrap is already complete. Use login instead.',
      };
    }

    const email = request.body.email.trim().toLowerCase();
    const password = request.body.password;

    if (!email || !password) {
      reply.code(400);
      return {
        message: 'Bootstrap requires email and password.',
      };
    }

    if (await getUserByEmail(pool, email)) {
      reply.code(409);
      return {
        message: 'A user with that email already exists.',
      };
    }

    const now = new Date().toISOString();
    const user = {
      userId: `user_${randomUUID()}`,
      email,
      displayName: request.body.displayName?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await createUser(pool, {
        user,
        passwordHash: hashPassword(password),
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        reply.code(409);
        return {
          message: 'Bootstrap is already complete. Use login instead.',
        };
      }

      throw error;
    }

    const { session, sessionToken } = await createAuthenticatedSession(pool, {
      userId: user.userId,
      sessionSecret: config.sessionSecret,
      ttlHours: config.sessionTtlHours,
    });

    reply.header(
      'set-cookie',
      createSessionCookie({
        sessionToken,
        expiresAt: session.expiresAt,
        secure: secureCookie,
      }),
    );
    reply.code(201);
    return {
      authenticated: true,
      bootstrapRequired: false,
      session,
      operator: {
        displayName: user.displayName,
        email: user.email,
        role: 'owner',
      },
    };
  });

  server.post<{
    Body: {
      email: string;
      password: string;
    };
  }>('/auth/login', async (request, reply) => {
    if (!config.sessionSecret) {
      reply.code(503);
      return {
        message: 'Session auth is not configured for this control-plane.',
      };
    }

    const pool = getPool();
    if (await bootstrapRequired(pool)) {
      reply.code(409);
      return {
        message: 'Bootstrap must complete before login is available.',
      };
    }

    const user = await authenticateWithPassword(pool, {
      email: request.body.email.trim().toLowerCase(),
      password: request.body.password,
    });

    if (!user) {
      reply.code(401);
      return {
        message: 'Email or password is invalid.',
      };
    }

    const { session, sessionToken } = await createAuthenticatedSession(pool, {
      userId: user.userId,
      sessionSecret: config.sessionSecret,
      ttlHours: config.sessionTtlHours,
    });
    const memberships = await listCompanyMembershipsForUser(pool, user.userId);

    reply.header(
      'set-cookie',
      createSessionCookie({
        sessionToken,
        expiresAt: session.expiresAt,
        secure: secureCookie,
      }),
    );

    return {
      authenticated: true,
      bootstrapRequired: false,
      session,
      operator: {
        displayName: user.displayName,
        email: user.email,
        role: getHighestRole(memberships) ?? 'viewer',
      },
    };
  });

  server.post('/auth/logout', async (request, reply) => {
    if (!config.sessionSecret) {
      reply.code(503);
      return {
        message: 'Session auth is not configured for this control-plane.',
      };
    }

    const pool = getPool();
    const context = await getRequestAuthContext(request, pool, config);

    if (context) {
      await deleteUserSession(pool, context.session.sessionId);
    } else {
      const sessionToken = parseCookieValue(
        typeof request.headers.cookie === 'string'
          ? request.headers.cookie
          : undefined,
        sessionCookieName,
      );
      if (sessionToken) {
        request.authContextCache = null;
      }
    }

    reply.header('set-cookie', clearSessionCookie({ secure: secureCookie }));
    return {
      authenticated: false,
      bootstrapRequired: await bootstrapRequired(pool),
    };
  });

  server.get<{ Params: { invitationToken: string } }>(
    '/company-invitations/:invitationToken/preview',
    async (request, reply) => {
      if (!config.sessionSecret) {
        reply.code(503);
        return {
          message: 'Invitation flows require session auth to be configured.',
        };
      }

      const invitationToken = request.params.invitationToken.trim();
      if (!invitationToken) {
        reply.code(400);
        return {
          message: 'Invitation token is required.',
        };
      }

      const pool = getPool();
      const invitation = await getCompanyInvitationByTokenHash(
        pool,
        hashOpaqueToken(invitationToken, config.sessionSecret),
      );

      if (!invitation) {
        reply.code(404);
        return {
          message: 'Invitation not found.',
        };
      }

      const company = await getCompanyById(pool, invitation.companyId);
      if (!company) {
        reply.code(404);
        return {
          message: 'Invitation company not found.',
        };
      }

      return {
        company,
        invitation,
        canAccept:
          invitation.status === 'pending' && company.status === 'active',
        message:
          company.status === 'disabled'
            ? 'Invitation company is disabled.'
            : undefined,
      };
    },
  );

  server.post<{
    Body: {
      invitationToken: string;
      password?: string;
      displayName?: string;
    };
  }>('/company-invitations/accept', async (request, reply) => {
    if (!config.sessionSecret) {
      reply.code(503);
      return {
        message: 'Invitation flows require session auth to be configured.',
      };
    }

    const invitationToken = request.body.invitationToken.trim();

    if (!invitationToken) {
      reply.code(400);
      return {
        message: 'Invitation token is required.',
      };
    }

    const pool = getPool();
    const authContext = await getRequestAuthContext(request, pool, config);
    const client = await pool.connect();

    try {
      await client.query('begin');

      const invitation = await getCompanyInvitationByTokenHash(
        client,
        hashOpaqueToken(invitationToken, config.sessionSecret),
      );

      if (!invitation) {
        await client.query('rollback');
        reply.code(404);
        return {
          message: 'Invitation not found.',
        };
      }

      const company = await getCompanyById(client, invitation.companyId);
      if (!company) {
        await client.query('rollback');
        reply.code(404);
        return {
          message: 'Invitation company not found.',
        };
      }

      if (company.status !== 'active') {
        await client.query('rollback');
        reply.code(409);
        return {
          message: 'Invitation company is disabled and cannot accept members.',
          company,
          invitation,
        };
      }

      if (invitation.status !== 'pending') {
        await client.query('rollback');
        reply.code(409);
        return {
          message: `Invitation is ${invitation.status} and can no longer be accepted.`,
          company,
          invitation,
        };
      }

      let user = authContext?.user ?? null;
      let sessionPayload:
        | {
            cookie: string;
            session: Awaited<
              ReturnType<typeof createAuthenticatedSession>
            >['session'];
          }
        | undefined;

      if (user) {
        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
          await client.query('rollback');
          reply.code(409);
          return {
            message:
              'Invitation email does not match the authenticated operator session.',
            company,
            invitation,
          };
        }
      } else {
        const password = request.body.password?.trim();

        if (!password) {
          await client.query('rollback');
          reply.code(400);
          return {
            message:
              'Accepting an invitation without an active session requires a password.',
            company,
            invitation,
          };
        }

        user = await authenticateWithPassword(client, {
          email: invitation.email,
          password,
        });

        if (!user) {
          const existingUser = await getUserByEmail(client, invitation.email);

          if (existingUser) {
            await client.query('rollback');
            reply.code(401);
            return {
              message:
                'Existing invited user authentication failed. Sign in with the invited email or provide the correct password.',
              company,
              invitation,
            };
          }

          const now = new Date().toISOString();
          user = {
            userId: `user_${randomUUID()}`,
            email: invitation.email.toLowerCase(),
            displayName: request.body.displayName?.trim() || undefined,
            createdAt: now,
            updatedAt: now,
          };

          await createUser(client, {
            user,
            passwordHash: hashPassword(password),
          });
        }

        const createdSession = await createAuthenticatedSession(client, {
          userId: user.userId,
          sessionSecret: config.sessionSecret,
          ttlHours: config.sessionTtlHours,
        });

        sessionPayload = {
          session: createdSession.session,
          cookie: createSessionCookie({
            sessionToken: createdSession.sessionToken,
            expiresAt: createdSession.session.expiresAt,
            secure: secureCookie,
          }),
        };
      }

      const acceptedAt = new Date().toISOString();
      await addCompanyMembership(client, {
        companyId: invitation.companyId,
        userId: user.userId,
        role: invitation.role,
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      });
      await acceptCompanyInvitation(client, {
        invitationId: invitation.invitationId,
        acceptedByUserId: user.userId,
        acceptedAt,
      });

      await client.query('commit');

      if (sessionPayload) {
        reply.header('set-cookie', sessionPayload.cookie);
      }

      reply.code(201);
      return {
        authenticated: true,
        company,
        invitation: {
          ...invitation,
          status: 'accepted' as const,
          acceptedByUserId: user.userId,
          acceptedAt,
          updatedAt: acceptedAt,
        },
        membership: {
          companyId: invitation.companyId,
          userId: user.userId,
          role: invitation.role,
          createdAt: acceptedAt,
          updatedAt: acceptedAt,
        },
        session: sessionPayload?.session,
        operator: {
          displayName: user.displayName,
          email: user.email,
          role: invitation.role,
        },
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  server.get('/companies', async (request, reply) => {
    const pool = getPool();
    const companies = await listAccessibleCompanies(request, pool, config);

    if (!companies) {
      reply.code(401);
      return {
        message: 'Operator session required.',
      };
    }

    return companies.map((company) =>
      normalizeCompanySnapshot(company, config),
    );
  });

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: company.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      return normalizeCompanySnapshot(company, config);
    },
  );

  server.post<{
    Params: { companyId: string };
    Body: {
      phase: NonNullable<Company['betaPhase']>;
      enrollmentStatus: NonNullable<Company['betaEnrollmentStatus']>;
      notes?: string;
    };
  }>('/companies/:companyId/beta-enrollment', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.params.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'admin',
      }))
    ) {
      return { message: 'Admin access required.' };
    }

    const normalizedCompany = normalizeCompanySnapshot(company, config);
    const phase = request.body.phase;
    const enrollmentStatus = request.body.enrollmentStatus;
    const notes = request.body.notes?.trim() || undefined;

    if (!['internal_alpha', 'controlled_beta'].includes(phase)) {
      reply.code(400);
      return { message: 'Invalid beta phase.' };
    }

    if (
      !['invited', 'active', 'suspended', 'graduated'].includes(
        enrollmentStatus,
      )
    ) {
      reply.code(400);
      return { message: 'Invalid beta enrollment status.' };
    }

    if (phase === 'internal_alpha' && enrollmentStatus === 'graduated') {
      reply.code(400);
      return {
        message:
          'Graduated status is only valid for controlled beta companies.',
      };
    }

    if (
      phase === 'controlled_beta' &&
      !isCompanyEligibleForControlledBeta(normalizedCompany, config)
    ) {
      reply.code(409);
      return {
        message:
          'This company is not allowlisted for controlled beta in the current environment.',
      };
    }

    if (
      normalizedCompany.status !== 'active' &&
      enrollmentStatus === 'active'
    ) {
      reply.code(409);
      return {
        message: 'Disabled companies cannot be marked as beta-active.',
      };
    }

    const idempotencyKey = makeIdempotencyKey(
      request.headers['x-idempotency-key'],
      `company:beta:${company.companyId}:${phase}:${enrollmentStatus}`,
    );
    const duplicateLog = await getCommandLogEntry(
      pool,
      company.companyId,
      idempotencyKey,
    );

    if (duplicateLog) {
      reply.code(200);
      return {
        company: normalizedCompany,
        beta: createCompanyBetaSnapshot(normalizedCompany, config),
        duplicate: true,
      };
    }

    const now = new Date().toISOString();
    const updatedCompany: Company = {
      ...normalizedCompany,
      betaPhase: phase,
      betaEnrollmentStatus: enrollmentStatus,
      betaNotes: notes,
      betaUpdatedAt: now,
    };
    const commandId = `cmd_${randomUUID()}`;
    const actorRef = 'control-plane';
    const client = await pool.connect();

    try {
      await client.query('begin');

      const eventId = await persistCompanyUpdated(client, {
        company: updatedCompany,
        commandId,
        idempotencyKey,
        actorRef,
      });

      await recordCommandLogEntry(client, {
        commandId,
        companyId: updatedCompany.companyId,
        aggregateId: updatedCompany.companyId,
        commandType: 'company.beta.update',
        idempotencyKey,
        receivedAt: now,
        resolutionStatus: 'accepted',
        resultEventIds: [eventId],
      });

      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    reply.code(200);
    return {
      company: updatedCompany,
      beta: createCompanyBetaSnapshot(updatedCompany, config),
      duplicate: false,
    };
  });

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/access',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      const access = await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'viewer',
      });

      if (!access) {
        return { message: 'Viewer access required.' };
      }

      const [memberships, invitations] = await Promise.all([
        listCompanyMembershipsForCompany(pool, company.companyId),
        listCompanyInvitationsForCompany(pool, company.companyId),
      ]);

      const currentRole = access.internal
        ? 'owner'
        : getMembershipRoleForCompany(
            access.context.memberships,
            company.companyId,
          );

      return {
        company: normalizeCompanySnapshot(company, config),
        currentRole,
        canManageInvitations: getInvitableRoles(currentRole).length > 0,
        allowedInvitationRoles: getInvitableRoles(currentRole),
        memberships,
        invitations,
      };
    },
  );

  server.post<{
    Params: { companyId: string };
    Body: { email: string; role: CompanyRole };
  }>('/companies/:companyId/invitations', async (request, reply) => {
    if (!config.sessionSecret) {
      reply.code(503);
      return {
        message: 'Invitation flows require session auth to be configured.',
      };
    }

    const pool = getPool();
    const company = await getCompanyById(pool, request.params.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (company.status !== 'active') {
      reply.code(409);
      return {
        message: 'Disabled companies cannot create new invitations.',
      };
    }

    const access = await requireCompanyAccess(request, reply, pool, config, {
      companyId: company.companyId,
      minimumRole: 'admin',
    });

    if (!access || access.internal) {
      if (!access) {
        return { message: 'Admin access required.' };
      }
    }

    const email = request.body.email.trim().toLowerCase();
    const role = request.body.role;

    if (!email || !role) {
      reply.code(400);
      return {
        message: 'Invitation email and role are required.',
      };
    }

    if (!access || access.internal) {
      reply.code(403);
      return {
        message: 'Interactive operator session required to create invitations.',
      };
    }

    const actorRole = getMembershipRoleForCompany(
      access.context.memberships,
      company.companyId,
    );
    const allowedRoles = getInvitableRoles(actorRole);

    if (!allowedRoles.includes(role)) {
      reply.code(403);
      return {
        message: `Current role can only invite: ${allowedRoles.join(', ') || 'none'}.`,
      };
    }

    const activeInvitation = await findActiveCompanyInvitationByEmail(pool, {
      companyId: company.companyId,
      email,
    });

    if (activeInvitation) {
      reply.code(409);
      return {
        message: 'A pending invitation already exists for that email.',
        invitation: activeInvitation,
      };
    }

    const existingUser = await getUserByEmail(pool, email);
    if (existingUser) {
      const membership = await getCompanyMembership(
        pool,
        company.companyId,
        existingUser.user.userId,
      );

      if (membership) {
        reply.code(409);
        return {
          message: 'That user already has access to the selected company.',
        };
      }
    }

    const createdAt = new Date().toISOString();
    const invitationToken = `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    const invitation: CompanyInvitation = {
      invitationId: `invite_${randomUUID()}`,
      companyId: company.companyId,
      email,
      role,
      status: 'pending',
      invitedByUserId: access.context.user.userId,
      expiresAt: new Date(
        Date.now() + config.invitationTtlHours * 60 * 60 * 1000,
      ).toISOString(),
      createdAt,
      updatedAt: createdAt,
    };

    await createCompanyInvitation(pool, {
      invitation,
      invitationTokenHash: hashOpaqueToken(
        invitationToken,
        config.sessionSecret,
      ),
    });
    const inviteUrl = buildInvitationUrl(config, invitationToken);
    const mailDelivery = await sendInvitationEmail({
      db: pool,
      config,
      company,
      invitation,
      inviteUrl,
    });

    reply.code(201);
    return {
      company,
      invitation,
      inviteToken: invitationToken,
      inviteUrl,
      mailDelivery,
    };
  });

  server.post<{
    Params: {
      companyId: string;
      invitationId: string;
    };
  }>(
    '/companies/:companyId/invitations/:invitationId/revoke',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      const access = await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'admin',
      });

      if (!access || access.internal) {
        if (!access) {
          return { message: 'Admin access required.' };
        }

        reply.code(403);
        return {
          message:
            'Interactive operator session required to revoke invitations.',
        };
      }

      const invitation = await getCompanyInvitationById(pool, {
        companyId: company.companyId,
        invitationId: request.params.invitationId,
      });

      if (!invitation) {
        reply.code(404);
        return {
          message: 'Invitation not found.',
        };
      }

      if (invitation.status !== 'pending') {
        reply.code(409);
        return {
          message: `Only pending invitations can be revoked. Current status: ${invitation.status}.`,
          invitation,
        };
      }

      const updatedAt = new Date().toISOString();
      await revokeCompanyInvitation(pool, {
        invitationId: invitation.invitationId,
        updatedAt,
      });

      return {
        company,
        invitation: {
          ...invitation,
          status: 'revoked' as const,
          updatedAt,
        },
      };
    },
  );

  server.get<{
    Params: { companyId: string };
    Querystring: { status?: 'queued' | 'sent' | 'failed' | 'skipped' };
  }>('/companies/:companyId/mail/outbox', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.params.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'viewer',
      }))
    ) {
      return { message: 'Viewer access required.' };
    }

    return {
      company,
      outbox: await listOutboundMail(pool, {
        companyId: company.companyId,
        status: request.query.status,
        limit: 100,
      }),
    };
  });

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/status',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: company.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const [objectives, workItems, approvals, runs, events] =
        await Promise.all([
          listObjectives(pool, company.companyId),
          listWorkItems(pool, { companyId: company.companyId }),
          listApprovalsByCompany(pool, company.companyId),
          listRuns(pool, { companyId: company.companyId }),
          listDomainEvents(pool, { companyId: company.companyId, limit: 1000 }),
        ]);

      return {
        company,
        metrics: {
          objectives: objectives.length,
          workItems: workItems.length,
          runs: runs.length,
          approvalsPending: approvals.filter(
            (approval) => approval.status === 'pending',
          ).length,
          runningWorkItems: workItems.filter(
            (workItem) => workItem.status === 'running',
          ).length,
          blockedWorkItems: workItems.filter((workItem) =>
            ['blocked', 'escalated', 'cancelled'].includes(workItem.status),
          ).length,
        },
        projectionHealth: {
          companyId: company.companyId,
          projectionTarget: 'control_plane',
          status: 'healthy',
          lastSuccessfulSyncAt:
            events[events.length - 1]?.occurredAt ?? company.createdAt,
        },
      };
    },
  );

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/replay',
    async (request, reply) => {
      const pool = getPool();
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.params.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }
      const events = await listDomainEvents(pool, {
        companyId: request.params.companyId,
        limit: 1000,
      });

      if (events.length === 0) {
        reply.code(404);
        return { message: 'No ledger events found for company.' };
      }

      const replayedState = replayAggregate(events);

      return {
        companyId: request.params.companyId,
        eventCount: events.length,
        lastEventId: replayedState.lastEventId ?? null,
        replayedState: {
          company: replayedState.companies[request.params.companyId] ?? null,
          objectives: Object.values(replayedState.objectives).filter(
            (objective) => objective.companyId === request.params.companyId,
          ),
          workItems: Object.values(replayedState.workItems).filter(
            (workItem) => workItem.companyId === request.params.companyId,
          ),
          runs: Object.values(replayedState.runs).filter(
            (run) => run.companyId === request.params.companyId,
          ),
          approvals: Object.values(replayedState.approvals).filter(
            (approval) => approval.companyId === request.params.companyId,
          ),
        },
      };
    },
  );

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/github/status',
    async (request, reply) => {
      const pool = getPool();
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.params.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }
      const status = await loadGitHubStatus(pool, request.params.companyId);

      if (!status.company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      return {
        company: status.company,
        installations: status.installations,
        projectionHealth: status.projectionHealth,
        metrics: {
          queuedDeliveries: status.deliveries.filter(
            (delivery) => delivery.status === 'queued',
          ).length,
          failedDeliveries: status.deliveries.filter(
            (delivery) => delivery.status === 'failed',
          ).length,
          openDriftCount: status.driftAlerts.filter(
            (alert) => alert.repairStatus !== 'repaired',
          ).length,
          inboundNeedsReview: status.inboundEvents.filter(
            (event) => event.status === 'requires_review',
          ).length,
        },
      };
    },
  );

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/github/installations',
    async (request, reply) => {
      const pool = getPool();
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.params.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }
      const status = await loadGitHubStatus(pool, request.params.companyId);

      if (!status.company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      return {
        company: status.company,
        installations: status.installations,
      };
    },
  );

  server.post<{
    Params: { companyId: string };
    Body: {
      installationId: number;
      accountLogin: string;
      repository: {
        owner: string;
        name: string;
        id?: number;
      };
    };
  }>('/companies/:companyId/github/installations', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.params.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (company.status !== 'active') {
      reply.code(409);
      return {
        message: 'Disabled companies cannot mutate invitations.',
      };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'admin',
      }))
    ) {
      return { message: 'Admin access required.' };
    }

    const now = new Date().toISOString();
    const installation: GitHubInstallationRef = {
      companyId: company.companyId,
      installationId: request.body.installationId,
      accountLogin: request.body.accountLogin,
      repository: request.body.repository,
      createdAt: now,
      updatedAt: now,
    };
    const result = await linkGitHubInstallation(pool, installation);

    reply.code(201);
    return result;
  });

  server.get<{
    Params: { companyId: string };
    Querystring: {
      status?: GitHubProjectionDelivery['status'];
    };
  }>('/companies/:companyId/github/deliveries', async (request, reply) => {
    const pool = getPool();
    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: request.params.companyId,
        minimumRole: 'viewer',
      }))
    ) {
      return { message: 'Viewer access required.' };
    }
    const status = await loadGitHubStatus(pool, request.params.companyId);

    if (!status.company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    return {
      company: status.company,
      deliveries: request.query.status
        ? status.deliveries.filter(
            (delivery) => delivery.status === request.query.status,
          )
        : status.deliveries,
    };
  });

  server.get<{
    Params: { companyId: string };
    Querystring: {
      severity?: DriftAlert['severity'];
    };
  }>('/companies/:companyId/github/drift-alerts', async (request, reply) => {
    const pool = getPool();
    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: request.params.companyId,
        minimumRole: 'viewer',
      }))
    ) {
      return { message: 'Viewer access required.' };
    }
    const status = await loadGitHubStatus(pool, request.params.companyId);

    if (!status.company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    return {
      company: status.company,
      driftAlerts: request.query.severity
        ? status.driftAlerts.filter(
            (alert) => alert.severity === request.query.severity,
          )
        : status.driftAlerts,
    };
  });

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/github/inbound-events',
    async (request, reply) => {
      const pool = getPool();
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.params.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }
      const status = await loadGitHubStatus(pool, request.params.companyId);

      if (!status.company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      return {
        company: status.company,
        inboundEvents: status.inboundEvents,
      };
    },
  );

  server.post<{ Params: { companyId: string } }>(
    '/companies/:companyId/github/sync-plan',
    async (request, reply) => {
      const pool = getPool();
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.params.companyId,
          minimumRole: 'operator',
        }))
      ) {
        return { message: 'Operator access required.' };
      }
      const events = await listDomainEvents(pool, {
        companyId: request.params.companyId,
        limit: 2000,
        order: 'desc',
      });

      try {
        const result = await queueGitHubSyncPlanForCompany(
          pool,
          request.params.companyId,
          events,
          new Date().toISOString(),
        );

        reply.code(202);
        return result;
      } catch (error) {
        reply.code(409);
        return {
          message:
            error instanceof Error
              ? error.message
              : 'Unable to queue GitHub sync plan.',
        };
      }
    },
  );

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/onboarding',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      const normalizedCompany = normalizeCompanySnapshot(company, config);

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: normalizedCompany.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const [status, installations, memberships] = await Promise.all([
        loadGitHubStatus(pool, normalizedCompany.companyId),
        listGitHubInstallations(pool, normalizedCompany.companyId),
        listCompanyMembershipsForCompany(pool, normalizedCompany.companyId),
      ]);
      const projectionHealthy = status.projectionHealth.status === 'healthy';
      const beta = createCompanyBetaSnapshot(normalizedCompany, config);
      const controlledBetaActive =
        beta.phase === 'controlled_beta' && beta.enrollmentStatus === 'active';

      return {
        company: normalizedCompany,
        status:
          installations.length > 0 && projectionHealthy
            ? 'ready'
            : installations.length > 0
              ? 'pending_projection'
              : 'needs_installation',
        beta,
        linkedInstallations: installations,
        repository: installations[0]?.repository,
        checklist: [
          {
            id: 'company',
            label: 'Company created',
            description:
              'A company must exist before GitHub can project runtime state.',
            completed: true,
          },
          {
            id: 'team',
            label: 'Company access baseline',
            description:
              'At least one member must exist before invited operators can onboard safely.',
            completed: memberships.length > 0,
          },
          {
            id: 'beta',
            label: 'Controlled beta cohort active',
            description: beta.allowlistConfigured
              ? beta.eligibleForControlledBeta
                ? 'This company is allowlisted and can be promoted into the controlled beta cohort.'
                : 'This company is not in the current controlled beta allowlist, so it stays in internal alpha.'
              : 'No allowlist is configured yet, so controlled beta is governed by operator action.',
            completed: controlledBetaActive,
          },
          {
            id: 'installation',
            label: 'GitHub App installation linked',
            description:
              'Link the GitHub installation that owns the repository projection surface.',
            completed: installations.length > 0,
          },
          {
            id: 'projection',
            label: 'Projection health green',
            description:
              'Projection health must be healthy before operators trust GitHub as the human-facing mirror.',
            completed: projectionHealthy,
          },
          {
            id: 'drift',
            label: 'No open high drift alerts',
            description:
              'Critical or high drift must be cleared before routine operator use.',
            completed: !status.driftAlerts.some(
              (alert) =>
                ['high', 'critical'].includes(alert.severity) &&
                alert.repairStatus !== 'repaired',
            ),
          },
        ],
      };
    },
  );

  server.post<{
    Body: {
      companyId: string;
      installationId: number;
      accountLogin: string;
      repository: {
        owner: string;
        name: string;
        id?: number;
      };
    };
  }>('/internal/github/installations/link', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.body.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    const now = new Date().toISOString();
    const installation: GitHubInstallationRef = {
      companyId: company.companyId,
      installationId: request.body.installationId,
      accountLogin: request.body.accountLogin,
      repository: request.body.repository,
      createdAt: now,
      updatedAt: now,
    };

    reply.code(201);
    return linkGitHubInstallation(pool, installation);
  });

  server.post<{ Params: { companyId: string } }>(
    '/internal/github/companies/:companyId/sync-plan',
    async (request, reply) => {
      const pool = getPool();
      const events = await listDomainEvents(pool, {
        companyId: request.params.companyId,
        limit: 2000,
        order: 'desc',
      });

      try {
        return await queueGitHubSyncPlanForCompany(
          pool,
          request.params.companyId,
          events,
          new Date().toISOString(),
        );
      } catch (error) {
        reply.code(409);
        return {
          message:
            error instanceof Error
              ? error.message
              : 'Unable to build GitHub sync plan.',
        };
      }
    },
  );

  server.post<{
    Params: { companyId: string };
    Body: {
      bindings: GitHubProjectionBinding[];
      deliveries: GitHubProjectionDelivery[];
      driftAlerts: DriftAlert[];
    };
  }>(
    '/internal/github/companies/:companyId/sync-results',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      return persistGitHubSyncResults(pool, {
        companyId: request.params.companyId,
        bindings: request.body.bindings ?? [],
        deliveries: request.body.deliveries ?? [],
        driftAlerts: request.body.driftAlerts ?? [],
      });
    },
  );

  server.post<{
    Body: {
      deliveryId: string;
      eventName: string;
      action?: string | null;
      receivedAt: string;
      payload: Record<string, unknown>;
    };
  }>('/internal/github/webhooks/ingest', async (request, reply) => {
    const pool = getPool();
    const existingInboundEvent = await getGitHubInboundEventByDeliveryId(
      pool,
      request.body.deliveryId,
    );

    if (
      existingInboundEvent &&
      ['applied', 'rejected'].includes(existingInboundEvent.status)
    ) {
      return {
        inboundEvent: existingInboundEvent,
        duplicate: true,
      };
    }

    const recorded = existingInboundEvent
      ? { inboundEvent: existingInboundEvent }
      : await recordGitHubInboundWebhook(pool, {
          inboundEventId: `inbound_${randomUUID()}`,
          githubDeliveryId: request.body.deliveryId,
          githubEventName: request.body.eventName,
          action: request.body.action,
          payload: request.body.payload,
          receivedAt: request.body.receivedAt,
        });
    let inboundEvent = recorded.inboundEvent;

    if (
      inboundEvent.classification === 'accepted_intent' &&
      inboundEvent.proposedCommand
    ) {
      inboundEvent = await executeAcceptedGitHubIntent(inboundEvent);
      await upsertGitHubInboundEvent(pool, inboundEvent);

      if (inboundEvent.status === 'rejected') {
        reply.code(409);
      }
    }

    return {
      inboundEvent,
      driftAlert: recorded.driftAlert,
      duplicate: false,
    };
  });

  server.get<{
    Querystring: {
      companyId?: string;
      aggregateType?: DomainEvent['aggregateType'];
      aggregateId?: string;
      limit?: string;
      order?: 'asc' | 'desc';
    };
  }>('/events', async (request, reply) => {
    const pool = getPool();
    const limit = request.query.limit ? Number(request.query.limit) : 100;

    if (request.query.companyId) {
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.query.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      return buildMergedTimeline(pool, {
        companyIds: [request.query.companyId],
        limit,
        aggregateType: request.query.aggregateType,
        aggregateId: request.query.aggregateId,
      });
    }

    const companies = await listAccessibleCompanies(request, pool, config);
    if (!companies) {
      reply.code(401);
      return { message: 'Operator session required.' };
    }

    return buildMergedTimeline(pool, {
      companyIds: companies.map((company) => company.companyId),
      limit,
      aggregateType: request.query.aggregateType,
      aggregateId: request.query.aggregateId,
    });
  });

  server.get<{
    Querystring: {
      companyId?: string;
      limit?: string;
      intervalMs?: string;
      order?: 'asc' | 'desc';
    };
  }>('/events/stream', async (request, reply) => {
    const pool = getPool();
    const limit = request.query.limit ? Number(request.query.limit) : 25;
    const intervalMs = request.query.intervalMs
      ? Number(request.query.intervalMs)
      : 5000;
    let lastFingerprint = '';

    let companyIds: string[] = [];

    if (request.query.companyId) {
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.query.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      companyIds = [request.query.companyId];
    } else {
      const companies = await listAccessibleCompanies(request, pool, config);
      if (!companies) {
        reply.code(401);
        return { message: 'Operator session required.' };
      }

      companyIds = companies.map((company) => company.companyId);
    }

    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      ...(appOrigin
        ? {
            'Access-Control-Allow-Origin': appOrigin,
            'Access-Control-Allow-Credentials': 'true',
            Vary: 'Origin',
          }
        : {}),
    });

    const publishSnapshot = async () => {
      const events = await buildMergedTimeline(pool, {
        companyIds,
        limit,
        aggregateType: undefined,
        aggregateId: undefined,
      });
      const fingerprint = events.map((event) => event.eventId).join(':');

      if (fingerprint === lastFingerprint) {
        reply.raw.write(
          `event: heartbeat\ndata: ${JSON.stringify({
            sentAt: new Date().toISOString(),
          })}\n\n`,
        );
        return;
      }

      lastFingerprint = fingerprint;
      reply.raw.write(
        `event: snapshot\ndata: ${JSON.stringify({
          sentAt: new Date().toISOString(),
          events,
        })}\n\n`,
      );
    };

    await publishSnapshot();

    const timer = setInterval(
      () => {
        void publishSnapshot().catch((error: unknown) => {
          request.log.error(error, 'Failed to publish event stream snapshot');
        });
      },
      Math.max(intervalMs, 1000),
    );

    request.raw.on('close', () => {
      clearInterval(timer);
      reply.raw.end();
    });

    return reply;
  });

  server.post<{ Body: { slug: string; displayName: string } }>(
    '/companies',
    async (request, reply) => {
      const pool = getPool();
      const access = await requireAuthenticatedAccess(
        request,
        reply,
        pool,
        config,
      );

      if (!access) {
        return { message: 'Operator session required.' };
      }

      const idempotencyKey = makeIdempotencyKey(
        request.headers['x-idempotency-key'],
        `company:create:${request.body.slug}`,
      );

      const existingCompany = await getCompanyBySlug(pool, request.body.slug);
      if (existingCompany) {
        if (
          !(await requireCompanyAccess(request, reply, pool, config, {
            companyId: existingCompany.companyId,
            minimumRole: 'viewer',
          }))
        ) {
          return { message: 'Company slug is already in use.' };
        }

        const duplicateLog = await getCommandLogEntry(
          pool,
          existingCompany.companyId,
          idempotencyKey,
        );

        if (!duplicateLog) {
          await recordCommandLogEntry(pool, {
            commandId: `cmd_duplicate_${randomUUID()}`,
            companyId: existingCompany.companyId,
            aggregateId: existingCompany.companyId,
            commandType: 'company.create',
            idempotencyKey,
            receivedAt: new Date().toISOString(),
            resolutionStatus: 'duplicate',
            resultEventIds: [],
          });
        }

        reply.code(200);
        return {
          company: normalizeCompanySnapshot(existingCompany, config),
          beta: createCompanyBetaSnapshot(existingCompany, config),
          duplicate: true,
        };
      }

      const createdAt = new Date().toISOString();
      const betaPhase = config.controlledBetaCompanySlugs.includes(
        request.body.slug,
      )
        ? 'controlled_beta'
        : defaultCompanyBetaPhase;
      const company: Company = {
        companyId: `company_${randomUUID()}`,
        slug: request.body.slug,
        displayName: request.body.displayName,
        status: 'active',
        betaPhase,
        betaEnrollmentStatus: defaultCompanyBetaEnrollmentStatus,
        betaUpdatedAt: createdAt,
        createdAt,
      };
      const commandId = `cmd_${randomUUID()}`;
      const actorRef = 'control-plane';
      const client = await pool.connect();

      try {
        await client.query('begin');

        const eventId = await persistCompanyCreated(client, {
          company,
          commandId,
          idempotencyKey,
          actorRef,
        });

        await recordCommandLogEntry(client, {
          commandId,
          companyId: company.companyId,
          aggregateId: company.companyId,
          commandType: 'company.create',
          idempotencyKey,
          receivedAt: company.createdAt,
          resolutionStatus: 'accepted',
          resultEventIds: [eventId],
        });

        if (!access.internal) {
          await addCompanyMembership(client, {
            companyId: company.companyId,
            userId: access.context.user.userId,
            role: 'owner',
            createdAt: company.createdAt,
            updatedAt: company.createdAt,
          });
        }

        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }

      reply.code(201);
      return {
        company: normalizeCompanySnapshot(company, config),
        beta: createCompanyBetaSnapshot(company, config),
        duplicate: false,
      };
    },
  );

  server.get<{
    Querystring: {
      companyId?: string;
    };
  }>('/objectives', async (request, reply) => {
    const pool = getPool();

    if (request.query.companyId) {
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.query.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      return listObjectives(pool, request.query.companyId);
    }

    const companies = await listAccessibleCompanies(request, pool, config);
    if (!companies) {
      reply.code(401);
      return { message: 'Operator session required.' };
    }

    const objectives = await Promise.all(
      companies.map((company) => listObjectives(pool, company.companyId)),
    );

    return objectives.flat();
  });

  server.post<{
    Body: {
      companyId: string;
      title: string;
      summary?: string;
      repositoryTarget?: {
        owner?: string;
        name?: string;
        id?: number;
      };
      requestedWorkItems?: PlannedWorkItemInput[];
    };
  }>('/objectives', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.body.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'operator',
      }))
    ) {
      return { message: 'Operator access required.' };
    }

    const idempotencyKey = makeIdempotencyKey(
      request.headers['x-idempotency-key'],
      `objective:create:${company.companyId}:${request.body.title}`,
    );
    const duplicateLog = await getCommandLogEntry(
      pool,
      company.companyId,
      idempotencyKey,
    );

    if (duplicateLog) {
      const existingObjective = await getObjectiveById(
        pool,
        duplicateLog.aggregateId,
      );

      if (existingObjective) {
        const existingWorkItems = await listWorkItemsByObjective(
          pool,
          existingObjective.objectiveId,
        );
        const existingApprovals = (
          await Promise.all(
            existingWorkItems.map((workItem) =>
              getApprovalByWorkItemId(pool, workItem.workItemId),
            ),
          )
        ).filter((approval): approval is ApprovalDecision => approval !== null);

        return {
          objective: existingObjective,
          workItems: existingWorkItems,
          approvals: existingApprovals,
          duplicate: true,
        };
      }
    }

    let repositoryTarget: RepositoryTarget | undefined;
    try {
      repositoryTarget = await resolveObjectiveRepositoryTarget(
        pool,
        company.companyId,
        normalizeRepositoryTargetInput(request.body.repositoryTarget),
      );
    } catch (error) {
      reply.code(400);
      return {
        message:
          error instanceof Error
            ? error.message
            : 'Repository target is invalid for this company.',
      };
    }

    const commandId = `cmd_${randomUUID()}`;
    const actorRef = 'control-plane';
    const now = new Date().toISOString();
    const objectiveId = `objective_${randomUUID()}`;
    const plannedWorkItems = createObjectivePlan({
      objectiveTitle: request.body.title,
      requestedWorkItems: request.body.requestedWorkItems,
    });

    const initialWorkItems: WorkItem[] = plannedWorkItems.map((draft) => ({
      workItemId: `work_item_${randomUUID()}`,
      companyId: company.companyId,
      objectiveId,
      title: draft.title,
      description: draft.description,
      repositoryTarget,
      status: draft.requiresApproval ? 'blocked' : 'ready',
      attemptBudget: draft.attemptBudget,
      requiresApproval: draft.requiresApproval,
      validationContractRef: draft.validationContractRef,
      scopeRef: draft.scopeRef,
      blockingReason: draft.requiresApproval ? 'approval_required' : undefined,
      createdAt: now,
      updatedAt: now,
    }));
    const objective: Objective = {
      objectiveId,
      companyId: company.companyId,
      title: request.body.title,
      summary: request.body.summary,
      repositoryTarget,
      status: deriveObjectiveStatus(initialWorkItems),
      createdAt: now,
      updatedAt: now,
    };
    const approvals = initialWorkItems
      .filter((workItem) => workItem.requiresApproval)
      .map<ApprovalDecision>((workItem) => ({
        approvalId: `approval_${randomUUID()}`,
        companyId: company.companyId,
        workItemId: workItem.workItemId,
        status: 'pending',
        requestedAction: `Approve dispatch for ${workItem.title}`,
        createdAt: now,
        updatedAt: now,
      }));

    const client = await pool.connect();

    try {
      await client.query('begin');

      const resultEventIds: string[] = [];
      resultEventIds.push(
        await persistObjectiveSnapshot(client, {
          objective,
          eventType: 'objective.created',
          commandId,
          idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
          actorRef,
        }),
      );

      for (const workItem of initialWorkItems) {
        resultEventIds.push(
          await persistWorkItemSnapshot(client, {
            workItem,
            eventType: 'work_item.created',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `work-item:${workItem.workItemId}`,
            ),
            actorRef,
          }),
        );
      }

      for (const approval of approvals) {
        resultEventIds.push(
          await persistApprovalSnapshot(client, {
            approval,
            eventType: 'approval.requested',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `approval:${approval.approvalId}`,
            ),
            actorRef,
          }),
        );
      }

      await recordCommandLogEntry(client, {
        commandId,
        companyId: company.companyId,
        aggregateId: objective.objectiveId,
        commandType: 'objective.create',
        idempotencyKey,
        receivedAt: now,
        resolutionStatus: 'accepted',
        resultEventIds,
      });

      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    reply.code(201);
    return {
      objective,
      workItems: initialWorkItems,
      approvals,
      duplicate: false,
    };
  });

  server.get<{ Params: { objectiveId: string } }>(
    '/objectives/:objectiveId',
    async (request, reply) => {
      const pool = getPool();
      const objective = await getObjectiveById(
        pool,
        request.params.objectiveId,
      );

      if (!objective) {
        reply.code(404);
        return { message: 'Objective not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: objective.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const workItems = await listWorkItemsByObjective(
        pool,
        objective.objectiveId,
      );

      return {
        objective,
        workItems,
      };
    },
  );

  server.get<{ Params: { objectiveId: string } }>(
    '/objectives/:objectiveId/graph',
    async (request, reply) => {
      const pool = getPool();
      const objective = await getObjectiveById(
        pool,
        request.params.objectiveId,
      );

      if (!objective) {
        reply.code(404);
        return { message: 'Objective not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: objective.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const workItems = await listWorkItemsByObjective(
        pool,
        objective.objectiveId,
      );
      const approvals = (
        await Promise.all(
          workItems.map((workItem) =>
            getApprovalByWorkItemId(pool, workItem.workItemId),
          ),
        )
      ).filter((approval): approval is ApprovalDecision => approval !== null);

      return {
        objective,
        summary: summarizeObjectiveGraph(objective, workItems),
        workItems,
        approvals,
      };
    },
  );

  server.post<{ Params: { objectiveId: string } }>(
    '/objectives/:objectiveId/replan',
    async (request, reply) => {
      const pool = getPool();
      const objective = await getObjectiveById(
        pool,
        request.params.objectiveId,
      );

      if (!objective) {
        reply.code(404);
        return { message: 'Objective not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: objective.companyId,
          minimumRole: 'operator',
        }))
      ) {
        return { message: 'Operator access required.' };
      }

      const workItems = await listWorkItemsByObjective(
        pool,
        objective.objectiveId,
      );
      const approvalsByWorkItem = new Map<string, ApprovalDecision | null>(
        await Promise.all(
          workItems.map(
            async (workItem) =>
              [
                workItem.workItemId,
                await getApprovalByWorkItemId(pool, workItem.workItemId),
              ] as const,
          ),
        ),
      );
      const now = new Date().toISOString();
      const nextWorkItems = workItems.map((workItem) => {
        if (['running', 'completed', 'cancelled'].includes(workItem.status)) {
          return workItem;
        }

        const approval = approvalsByWorkItem.get(workItem.workItemId);
        const isGranted = approval?.status === 'granted';

        return {
          ...workItem,
          status: workItem.requiresApproval && !isGranted ? 'blocked' : 'ready',
          blockingReason:
            workItem.requiresApproval && !isGranted
              ? approval?.status === 'denied'
                ? 'approval_denied'
                : 'approval_required'
              : undefined,
          updatedAt: now,
        } satisfies WorkItem;
      });
      const changedWorkItems = nextWorkItems.filter(
        (workItem, index) =>
          workItem.status !== workItems[index]?.status ||
          workItem.blockingReason !== workItems[index]?.blockingReason,
      );

      if (changedWorkItems.length === 0) {
        return {
          objective,
          summary: summarizeObjectiveGraph(objective, workItems),
          workItems,
          changed: false,
        };
      }

      const commandId = `cmd_${randomUUID()}`;
      const idempotencyKey = makeIdempotencyKey(
        request.headers['x-idempotency-key'],
        `objective:replan:${objective.objectiveId}:${now}`,
      );
      const client = await pool.connect();

      try {
        await client.query('begin');

        const eventIds: string[] = [];
        for (const workItem of changedWorkItems) {
          eventIds.push(
            await persistWorkItemSnapshot(client, {
              workItem,
              eventType: 'work_item.updated',
              commandId,
              idempotencyKey: makeEventCausationKey(
                idempotencyKey,
                `work-item:${workItem.workItemId}`,
              ),
              actorRef: 'control-plane',
            }),
          );
        }

        const syncedObjective = await syncObjectiveStatus(client, {
          objective: {
            ...objective,
            updatedAt: now,
          },
          commandId,
          idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
          actorRef: 'control-plane',
        });

        if (syncedObjective.eventId) {
          eventIds.push(syncedObjective.eventId);
        }

        await recordCommandLogEntry(client, {
          commandId,
          companyId: objective.companyId,
          aggregateId: objective.objectiveId,
          commandType: 'objective.replan',
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

      const refreshedObjective = await getObjectiveById(
        pool,
        objective.objectiveId,
      );

      return {
        objective: refreshedObjective ?? objective,
        summary: summarizeObjectiveGraph(
          refreshedObjective ?? objective,
          nextWorkItems,
        ),
        workItems: nextWorkItems,
        changed: true,
      };
    },
  );

  server.get<{ Params: { workItemId: string } }>(
    '/work-items/:workItemId',
    async (request, reply) => {
      const pool = getPool();
      const workItem = await getWorkItemById(pool, request.params.workItemId);

      if (!workItem) {
        reply.code(404);
        return { message: 'Work item not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: workItem.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const [objective, runs, approval] = await Promise.all([
        getObjectiveById(pool, workItem.objectiveId),
        listRunsByWorkItem(pool, workItem.workItemId),
        getApprovalByWorkItemId(pool, workItem.workItemId),
      ]);

      return {
        workItem,
        objective,
        runs,
        approval,
      };
    },
  );

  server.post<{
    Params: { workItemId: string };
    Body: {
      assignedAgentId?: string;
      headSha?: string;
      objectiveContext?: string;
      toolAllowlist?: string[];
      authorizedToolRequests?: Array<{
        toolCallId: string;
        toolKind: 'http' | 'file/artifact' | 'internal' | 'shell' | 'browser';
        toolName: string;
        toolVersion?: string;
        capabilityRef: string;
        scopeRef?: string;
        timeoutMs?: number;
        requestPayload?: Record<string, unknown>;
      }>;
      scopeAllowlist?: string[];
      inputArtifactRefs?: string[];
      expectedResultSchemaRef?: string;
      policySnapshotRef?: string;
    };
  }>('/work-items/:workItemId/dispatch', async (request, reply) => {
    const pool = getPool();
    const dispatchBody = request.body ?? {};
    const workItem = await getWorkItemById(pool, request.params.workItemId);

    if (!workItem) {
      reply.code(404);
      return { message: 'Work item not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: workItem.companyId,
        minimumRole: 'operator',
      }))
    ) {
      return { message: 'Operator access required.' };
    }

    const objective = await getObjectiveById(pool, workItem.objectiveId);
    if (!objective) {
      reply.code(404);
      return { message: 'Objective not found for work item.' };
    }

    if (['completed', 'cancelled'].includes(workItem.status)) {
      reply.code(409);
      return { message: 'Work item is not dispatchable in its current state.' };
    }

    const approval = await getApprovalByWorkItemId(pool, workItem.workItemId);
    const runs = await listRunsByWorkItem(pool, workItem.workItemId);
    const latestRun = workItem.latestRunId
      ? await getRunById(pool, workItem.latestRunId)
      : (runs[runs.length - 1] ?? null);

    if (latestRun && ['queued', 'running'].includes(latestRun.status)) {
      reply.code(409);
      return {
        message: 'Work item already has an active run.',
        run: latestRun,
      };
    }

    const objectiveContext =
      dispatchBody.objectiveContext ??
      [objective.title, objective.summary, workItem.description]
        .filter(Boolean)
        .join('\n\n');
    const toolAllowlist = dispatchBody.toolAllowlist ?? [
      'filesystem.read',
      'github.read',
    ];
    const scopeAllowlist = dispatchBody.scopeAllowlist ?? [workItem.scopeRef];
    const authorizedToolRequestSeed =
      dispatchBody.authorizedToolRequests?.map((toolRequest) => ({
        toolCallId: toolRequest.toolCallId,
        toolKind: toolRequest.toolKind,
        toolName: toolRequest.toolName,
        toolVersion: toolRequest.toolVersion ?? '1.0.0',
        capabilityRef: toolRequest.capabilityRef,
        scopeRef: toolRequest.scopeRef ?? workItem.scopeRef,
        timeoutMs: toolRequest.timeoutMs ?? 30_000,
        requestPayload: toolRequest.requestPayload ?? {},
      })) ?? [];
    const packetSeed: PacketSignatureSeed = createPacketSignatureSeed({
      assignedAgentId: dispatchBody.assignedAgentId ?? 'agent.runtime.default',
      objectiveContext,
      toolAllowlist,
      authorizedToolRequests: authorizedToolRequestSeed,
      scopeAllowlist,
      inputArtifactRefs: dispatchBody.inputArtifactRefs ?? [],
      expectedResultSchemaRef:
        dispatchBody.expectedResultSchemaRef ?? workItem.validationContractRef,
      policySnapshotRef: dispatchBody.policySnapshotRef ?? 'policy.default.v1',
    });
    const previousPacket = latestRun
      ? await getExecutionPacketByRunId(pool, latestRun.runId)
      : null;
    const previousSignature = latestRun
      ? buildDispatchSignature({
          workItem,
          approval,
          packetSeed: previousPacket
            ? createPacketSignatureSeed({
                assignedAgentId: previousPacket.assignedAgentId,
                objectiveContext: previousPacket.objectiveContext,
                toolAllowlist: previousPacket.toolAllowlist,
                authorizedToolRequests:
                  previousPacket.authorizedToolRequests.map((request) => ({
                    toolKind: request.toolKind,
                    toolName: request.toolName,
                    toolVersion: request.toolVersion,
                    capabilityRef: request.capabilityRef,
                    scopeRef: request.scopeRef,
                    timeoutMs: request.timeoutMs,
                    requestPayload: request.requestPayload,
                  })),
                scopeAllowlist: previousPacket.scopeAllowlist,
                inputArtifactRefs: previousPacket.inputArtifactRefs,
                expectedResultSchemaRef: previousPacket.expectedResultSchemaRef,
                policySnapshotRef: previousPacket.policySnapshotRef,
              })
            : {},
          failureClass: latestRun.failureClass,
        })
      : undefined;
    const currentSignature = buildDispatchSignature({
      workItem,
      approval,
      packetSeed,
      failureClass: latestRun?.failureClass,
    });
    const signatureAttemptsConsumed =
      latestRun?.status === 'transient_failure'
        ? latestRun.attempt
        : runs.length;
    const signatureScopeRef = scopeAllowlist[0] ?? workItem.scopeRef;
    await expireActiveClaimLeases(pool, {
      companyId: workItem.companyId,
      scopeRef: signatureScopeRef,
      asOf: new Date().toISOString(),
    });
    const activeClaim = await getActiveClaimLeaseByScope(
      pool,
      workItem.companyId,
      signatureScopeRef,
    );
    const scopeConflict =
      activeClaim !== null && activeClaim.workItemId !== workItem.workItemId;
    const decision = createDispatchDecision({
      workItem,
      approval: approval ?? undefined,
      currentSignature,
      previousSignature,
      hasScopeConflict: scopeConflict,
      attemptsConsumed: signatureAttemptsConsumed,
      escalateOnNoNewCausalInput: true,
    });

    if (decision.status !== 'dispatched') {
      const now = new Date().toISOString();
      const nextWorkItem: WorkItem = {
        ...workItem,
        status: decision.status === 'escalated' ? 'escalated' : 'blocked',
        blockingReason: decision.blockingReason,
        updatedAt: now,
      };
      const commandId = `cmd_${randomUUID()}`;
      const idempotencyKey = makeIdempotencyKey(
        request.headers['x-idempotency-key'],
        `work-item:dispatch:${workItem.workItemId}:${decision.status}`,
      );
      const client = await pool.connect();

      try {
        await client.query('begin');

        const eventIds = [
          await persistWorkItemSnapshot(client, {
            workItem: nextWorkItem,
            eventType: 'work_item.updated',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `work-item:${workItem.workItemId}`,
            ),
            actorRef: 'control-plane',
          }),
        ];
        const syncedObjective = await syncObjectiveStatus(client, {
          objective,
          commandId,
          idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
          actorRef: 'control-plane',
        });

        if (syncedObjective.eventId) {
          eventIds.push(syncedObjective.eventId);
        }

        await recordCommandLogEntry(client, {
          commandId,
          companyId: workItem.companyId,
          aggregateId: workItem.workItemId,
          commandType: 'work_item.dispatch',
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

      reply.code(202);
      return {
        decision,
        workItem: nextWorkItem,
      };
    }

    const now = new Date().toISOString();
    const runId = `run_${randomUUID()}`;
    const executionPacketId = `packet_${randomUUID()}`;
    const run: Run = {
      runId,
      companyId: workItem.companyId,
      workItemId: workItem.workItemId,
      attempt: runs.length + 1,
      status: 'queued',
      executionPacketId,
      headSha: dispatchBody.headSha,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const executionPacket = createExecutionPacket({
      companyId: workItem.companyId,
      packetSchemaVersion: 2,
      executionPacketId,
      workItemId: workItem.workItemId,
      runId,
      assignedAgentId: packetSeed.assignedAgentId,
      objectiveContext,
      toolAllowlist,
      authorizedToolRequests: authorizedToolRequestSeed.map((toolRequest) =>
        createToolRequestEnvelope({
          toolCallId: toolRequest.toolCallId,
          runId,
          executionPacketId,
          toolKind: toolRequest.toolKind,
          toolName: toolRequest.toolName,
          toolVersion: toolRequest.toolVersion,
          capabilityRef: toolRequest.capabilityRef,
          scopeRef: toolRequest.scopeRef,
          timeoutMs: toolRequest.timeoutMs,
          requestPayload: toolRequest.requestPayload,
          requestedAt: now,
        }),
      ),
      scopeAllowlist,
      inputArtifactRefs: packetSeed.inputArtifactRefs,
      expectedResultSchemaRef: packetSeed.expectedResultSchemaRef,
      policySnapshotRef: packetSeed.policySnapshotRef,
      createdAt: now,
    });
    const nextWorkItem: WorkItem = {
      ...workItem,
      status: 'running',
      blockingReason: undefined,
      latestRunId: run.runId,
      updatedAt: now,
    };
    const commandId = `cmd_${randomUUID()}`;
    const idempotencyKey = makeIdempotencyKey(
      request.headers['x-idempotency-key'],
      `work-item:dispatch:${workItem.workItemId}:${run.attempt}`,
    );
    const client = await pool.connect();

    try {
      await client.query('begin');

      const eventIds = [
        await persistWorkItemSnapshot(client, {
          workItem: nextWorkItem,
          eventType: 'work_item.updated',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `work-item:${workItem.workItemId}`,
          ),
          actorRef: 'control-plane',
        }),
        await persistRunSnapshot(client, {
          run,
          eventType: 'run.started',
          commandId,
          idempotencyKey: makeEventCausationKey(idempotencyKey, `run:${runId}`),
          actorRef: 'control-plane',
        }),
      ];

      await storeExecutionPacket(client, executionPacket);

      const claimLease = await acquireClaimLease(client, {
        claimId: `claim_${workItem.workItemId}`,
        companyId: workItem.companyId,
        workItemId: workItem.workItemId,
        scopeRef: signatureScopeRef,
        holderRunId: runId,
        leaseExpiresAt: new Date(
          Date.parse(now) +
            Number(process.env.AGENTS_COMPANY_CLAIM_LEASE_TTL_MS ?? '300000'),
        ).toISOString(),
        leaseStatus: 'active',
        createdAt: now,
        updatedAt: now,
      });
      if (!claimLease) {
        throw new Error('Unable to acquire claim lease for dispatch.');
      }
      eventIds.push(
        await persistClaimEvent(client, {
          claim: {
            claimId: claimLease.claimId,
            companyId: claimLease.companyId,
            workItemId: claimLease.workItemId,
            scopeRef: claimLease.scopeRef,
            holderRunId: claimLease.holderRunId,
            leaseExpiresAt: claimLease.leaseExpiresAt,
          },
          occurredAt: now,
          eventType: 'claim.acquired',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `claim:${claimLease.claimId}`,
          ),
          actorRef: 'control-plane',
        }),
      );

      const syncedObjective = await syncObjectiveStatus(client, {
        objective,
        commandId,
        idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
        actorRef: 'control-plane',
      });

      if (syncedObjective.eventId) {
        eventIds.push(syncedObjective.eventId);
      }

      await recordCommandLogEntry(client, {
        commandId,
        companyId: workItem.companyId,
        aggregateId: workItem.workItemId,
        commandType: 'work_item.dispatch',
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

    reply.code(201);
    return {
      decision,
      workItem: nextWorkItem,
      run,
      executionPacket,
    };
  });

  server.post<{ Params: { workItemId: string } }>(
    '/work-items/:workItemId/cancel',
    async (request, reply) => {
      const pool = getPool();
      const workItem = await getWorkItemById(pool, request.params.workItemId);

      if (!workItem) {
        reply.code(404);
        return { message: 'Work item not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: workItem.companyId,
          minimumRole: 'operator',
        }))
      ) {
        return { message: 'Operator access required.' };
      }

      const objective = await getObjectiveById(pool, workItem.objectiveId);
      if (!objective) {
        reply.code(404);
        return { message: 'Objective not found for work item.' };
      }

      if (workItem.status === 'completed') {
        reply.code(409);
        return { message: 'Completed work items cannot be cancelled.' };
      }

      const latestRun = workItem.latestRunId
        ? await getRunById(pool, workItem.latestRunId)
        : null;
      const now = new Date().toISOString();
      const nextWorkItem: WorkItem = {
        ...workItem,
        status: 'cancelled',
        blockingReason: 'cancelled_by_operator',
        updatedAt: now,
      };
      const nextRun =
        latestRun && ['queued', 'running'].includes(latestRun.status)
          ? {
              ...latestRun,
              status: 'cancelled' as const,
              summary:
                latestRun.summary ??
                'Run cancelled by operator before completion.',
              failureClass: 'cancelled_by_operator',
              updatedAt: now,
            }
          : null;
      const commandId = `cmd_${randomUUID()}`;
      const idempotencyKey = makeIdempotencyKey(
        request.headers['x-idempotency-key'],
        `work-item:cancel:${workItem.workItemId}`,
      );
      const client = await pool.connect();

      try {
        await client.query('begin');

        const eventIds = [
          await persistWorkItemSnapshot(client, {
            workItem: nextWorkItem,
            eventType: 'work_item.updated',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `work-item:${workItem.workItemId}`,
            ),
            actorRef: 'control-plane',
          }),
        ];

        if (nextRun) {
          eventIds.push(
            await persistRunSnapshot(client, {
              run: nextRun,
              eventType: 'run.cancelled',
              commandId,
              idempotencyKey: makeEventCausationKey(
                idempotencyKey,
                `run:${nextRun.runId}`,
              ),
              actorRef: 'control-plane',
            }),
          );

          const releasedClaim = await releaseClaimLeaseByRunId(client, {
            runId: nextRun.runId,
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
                actorRef: 'control-plane',
              }),
            );
          }
        }

        const syncedObjective = await syncObjectiveStatus(client, {
          objective,
          commandId,
          idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
          actorRef: 'control-plane',
        });

        if (syncedObjective.eventId) {
          eventIds.push(syncedObjective.eventId);
        }

        await recordCommandLogEntry(client, {
          commandId,
          companyId: workItem.companyId,
          aggregateId: workItem.workItemId,
          commandType: 'work_item.cancel',
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

      return {
        workItem: nextWorkItem,
        run: nextRun,
      };
    },
  );

  server.post<{ Params: { workItemId: string } }>(
    '/work-items/:workItemId/requeue',
    async (request, reply) => {
      const pool = getPool();
      const workItem = await getWorkItemById(pool, request.params.workItemId);

      if (!workItem) {
        reply.code(404);
        return { message: 'Work item not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: workItem.companyId,
          minimumRole: 'operator',
        }))
      ) {
        return { message: 'Operator access required.' };
      }

      const objective = await getObjectiveById(pool, workItem.objectiveId);
      if (!objective) {
        reply.code(404);
        return { message: 'Objective not found for work item.' };
      }

      if (['running', 'completed'].includes(workItem.status)) {
        reply.code(409);
        return {
          message:
            'Only blocked, escalated, or cancelled work items can be requeued.',
        };
      }

      const [runs, approval] = await Promise.all([
        listRunsByWorkItem(pool, workItem.workItemId),
        getApprovalByWorkItemId(pool, workItem.workItemId),
      ]);

      if (runs.length >= workItem.attemptBudget) {
        reply.code(409);
        return { message: 'Attempt budget exhausted.' };
      }

      const now = new Date().toISOString();
      const nextWorkItem: WorkItem = {
        ...workItem,
        status:
          workItem.requiresApproval && approval?.status !== 'granted'
            ? 'blocked'
            : 'ready',
        blockingReason:
          workItem.requiresApproval && approval?.status !== 'granted'
            ? approval?.status === 'denied'
              ? 'approval_denied'
              : 'approval_required'
            : undefined,
        updatedAt: now,
      };
      const commandId = `cmd_${randomUUID()}`;
      const idempotencyKey = makeIdempotencyKey(
        request.headers['x-idempotency-key'],
        `work-item:requeue:${workItem.workItemId}:${runs.length + 1}`,
      );
      const client = await pool.connect();

      try {
        await client.query('begin');

        const eventIds = [
          await persistWorkItemSnapshot(client, {
            workItem: nextWorkItem,
            eventType: 'work_item.updated',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `work-item:${workItem.workItemId}`,
            ),
            actorRef: 'control-plane',
          }),
        ];
        const syncedObjective = await syncObjectiveStatus(client, {
          objective,
          commandId,
          idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
          actorRef: 'control-plane',
        });

        if (syncedObjective.eventId) {
          eventIds.push(syncedObjective.eventId);
        }

        await recordCommandLogEntry(client, {
          commandId,
          companyId: workItem.companyId,
          aggregateId: workItem.workItemId,
          commandType: 'work_item.requeue',
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

      return { workItem: nextWorkItem };
    },
  );

  server.get<{ Params: { runId: string } }>(
    '/runs/:runId',
    async (request, reply) => {
      const pool = getPool();
      const run = await getRunById(pool, request.params.runId);

      if (!run) {
        reply.code(404);
        return { message: 'Run not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: run.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const [packet, workItem] = await Promise.all([
        getExecutionPacketByRunId(pool, run.runId),
        getWorkItemById(pool, run.workItemId),
      ]);

      return {
        run,
        executionPacket: packet,
        workItem,
      };
    },
  );

  server.post<{
    Params: { runId: string };
    Body: {
      resultStatus:
        | 'valid_success'
        | 'invalid_output'
        | 'transient_failure'
        | 'permanent_failure'
        | 'cancelled';
      artifactRefs?: string[];
      summary?: string;
      structuredOutput?: Record<string, unknown>;
      failureClass?: string;
      validatorRef?: string;
      resultSchemaVersion?: number;
    };
  }>('/runs/:runId/complete', async (request, reply) => {
    const pool = getPool();
    const run = await getRunById(pool, request.params.runId);

    if (!run) {
      reply.code(404);
      return { message: 'Run not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: run.companyId,
        minimumRole: 'operator',
      }))
    ) {
      return { message: 'Operator access required.' };
    }

    if (!['queued', 'running'].includes(run.status)) {
      reply.code(409);
      return { message: 'Run is already settled.', run };
    }

    const [packet, workItem] = await Promise.all([
      getExecutionPacketByRunId(pool, run.runId),
      getWorkItemById(pool, run.workItemId),
    ]);

    if (!packet || !workItem) {
      reply.code(409);
      return {
        message: 'Run is missing execution packet or work item context.',
      };
    }

    const objective = await getObjectiveById(pool, workItem.objectiveId);
    if (!objective) {
      reply.code(404);
      return { message: 'Objective not found for run.' };
    }

    const validation = validateTaskResult({
      runId: run.runId,
      executionPacketId: packet.executionPacketId,
      resultStatus: request.body.resultStatus,
      resultSchemaVersion: request.body.resultSchemaVersion ?? 1,
      artifactRefs: request.body.artifactRefs ?? [],
      summary: request.body.summary ?? '',
      structuredOutput: request.body.structuredOutput ?? {},
      failureClass: request.body.failureClass,
      validatorRef: request.body.validatorRef ?? '',
    });
    const finalResultStatus = validation.ok
      ? request.body.resultStatus
      : 'invalid_output';
    const runStatus = mapTaskResultToRunStatus(finalResultStatus);
    const workItemMapping = mapTaskResultToWorkItemStatus({
      resultStatus: finalResultStatus,
    });
    const priorRuns = await listRunsByWorkItem(pool, workItem.workItemId);
    const attemptsConsumed = priorRuns.length;
    const nextWorkItemStatus =
      finalResultStatus === 'transient_failure' &&
      attemptsConsumed >= workItem.attemptBudget
        ? 'blocked'
        : workItemMapping.workItemStatus;
    const nextBlockingReason =
      finalResultStatus === 'transient_failure' &&
      attemptsConsumed >= workItem.attemptBudget
        ? 'attempt_budget_exhausted'
        : workItemMapping.blockingReason;
    const now = new Date().toISOString();
    const nextRun: Run = {
      ...run,
      status: runStatus,
      summary: validation.ok
        ? request.body.summary
        : formatValidationFailureSummary(validation.issues),
      failureClass:
        finalResultStatus === 'valid_success'
          ? undefined
          : (request.body.failureClass ?? finalResultStatus),
      updatedAt: now,
    };
    const nextWorkItem: WorkItem = {
      ...workItem,
      status: nextWorkItemStatus,
      blockingReason: nextBlockingReason,
      updatedAt: now,
    };
    const runEventType =
      finalResultStatus === 'valid_success'
        ? 'run.completed'
        : finalResultStatus === 'cancelled'
          ? 'run.cancelled'
          : 'run.failed';
    const commandId = `cmd_${randomUUID()}`;
    const idempotencyKey = makeIdempotencyKey(
      request.headers['x-idempotency-key'],
      `run:complete:${run.runId}:${finalResultStatus}`,
    );
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
            `run:${run.runId}`,
          ),
          actorRef: 'control-plane',
        }),
        await persistWorkItemSnapshot(client, {
          workItem: nextWorkItem,
          eventType: 'work_item.updated',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `work-item:${workItem.workItemId}`,
          ),
          actorRef: 'control-plane',
        }),
      ];
      const releasedClaim = await releaseClaimLeaseByRunId(client, {
        runId: run.runId,
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
            actorRef: 'control-plane',
          }),
        );
      }
      const syncedObjective = await syncObjectiveStatus(client, {
        objective,
        commandId,
        idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
        actorRef: 'control-plane',
      });

      if (syncedObjective.eventId) {
        eventIds.push(syncedObjective.eventId);
      }

      await recordCommandLogEntry(client, {
        commandId,
        companyId: run.companyId,
        aggregateId: run.runId,
        commandType: 'run.complete',
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

    reply.code(validation.ok ? 200 : 422);
    return {
      accepted: validation.ok,
      validation,
      run: nextRun,
      workItem: nextWorkItem,
    };
  });

  server.get<{
    Querystring: {
      companyId?: string;
      status?: ApprovalDecision['status'];
    };
  }>('/approvals', async (request, reply) => {
    const pool = getPool();

    if (request.query.companyId) {
      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: request.query.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      return listApprovalsByCompany(
        pool,
        request.query.companyId,
        request.query.status,
      );
    }

    const companies = await listAccessibleCompanies(request, pool, config);
    if (!companies) {
      reply.code(401);
      return { message: 'Operator session required.' };
    }

    const approvals = await Promise.all(
      companies.map((company) =>
        listApprovalsByCompany(pool, company.companyId, request.query.status),
      ),
    );

    return approvals.flat();
  });

  server.post<{
    Params: { approvalId: string };
    Body: { decisionReason?: string };
  }>('/approvals/:approvalId/grant', async (request, reply) => {
    const pool = getPool();
    const decisionReason = request.body?.decisionReason;
    const approval = await getApprovalById(pool, request.params.approvalId);

    if (!approval) {
      reply.code(404);
      return { message: 'Approval not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: approval.companyId,
        minimumRole: 'reviewer',
      }))
    ) {
      return { message: 'Reviewer access required.' };
    }

    const workItem = await getWorkItemById(pool, approval.workItemId);
    if (!workItem) {
      reply.code(404);
      return { message: 'Work item not found for approval.' };
    }

    const objective = await getObjectiveById(pool, workItem.objectiveId);
    if (!objective) {
      reply.code(404);
      return { message: 'Objective not found for approval.' };
    }

    const now = new Date().toISOString();
    const nextApproval: ApprovalDecision = {
      ...approval,
      status: 'granted',
      decisionReason,
      updatedAt: now,
    };
    const nextWorkItem = ['running', 'completed', 'cancelled'].includes(
      workItem.status,
    )
      ? workItem
      : {
          ...workItem,
          status: 'ready' as const,
          blockingReason: undefined,
          updatedAt: now,
        };
    const commandId = `cmd_${randomUUID()}`;
    const idempotencyKey = makeIdempotencyKey(
      request.headers['x-idempotency-key'],
      `approval:grant:${approval.approvalId}`,
    );
    const client = await pool.connect();

    try {
      await client.query('begin');

      const eventIds = [
        await persistApprovalSnapshot(client, {
          approval: nextApproval,
          eventType: 'approval.updated',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `approval:${approval.approvalId}`,
          ),
          actorRef: 'control-plane',
        }),
      ];

      if (nextWorkItem !== workItem) {
        eventIds.push(
          await persistWorkItemSnapshot(client, {
            workItem: nextWorkItem,
            eventType: 'work_item.updated',
            commandId,
            idempotencyKey: makeEventCausationKey(
              idempotencyKey,
              `work-item:${workItem.workItemId}`,
            ),
            actorRef: 'control-plane',
          }),
        );
      }

      const syncedObjective = await syncObjectiveStatus(client, {
        objective,
        commandId,
        idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
        actorRef: 'control-plane',
      });

      if (syncedObjective.eventId) {
        eventIds.push(syncedObjective.eventId);
      }

      await recordCommandLogEntry(client, {
        commandId,
        companyId: approval.companyId,
        aggregateId: approval.approvalId,
        commandType: 'approval.grant',
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

    return {
      approval: nextApproval,
      workItem: nextWorkItem,
    };
  });

  server.post<{
    Params: { approvalId: string };
    Body: { decisionReason?: string };
  }>('/approvals/:approvalId/deny', async (request, reply) => {
    const pool = getPool();
    const decisionReason = request.body?.decisionReason;
    const approval = await getApprovalById(pool, request.params.approvalId);

    if (!approval) {
      reply.code(404);
      return { message: 'Approval not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: approval.companyId,
        minimumRole: 'reviewer',
      }))
    ) {
      return { message: 'Reviewer access required.' };
    }

    const workItem = await getWorkItemById(pool, approval.workItemId);
    if (!workItem) {
      reply.code(404);
      return { message: 'Work item not found for approval.' };
    }

    if (['running', 'completed', 'cancelled'].includes(workItem.status)) {
      reply.code(409);
      return {
        message:
          'Approval cannot be denied once work item has started or settled.',
      };
    }

    const objective = await getObjectiveById(pool, workItem.objectiveId);
    if (!objective) {
      reply.code(404);
      return { message: 'Objective not found for approval.' };
    }

    const now = new Date().toISOString();
    const nextApproval: ApprovalDecision = {
      ...approval,
      status: 'denied',
      decisionReason,
      updatedAt: now,
    };
    const nextWorkItem: WorkItem = {
      ...workItem,
      status: 'blocked',
      blockingReason: 'approval_denied',
      updatedAt: now,
    };
    const commandId = `cmd_${randomUUID()}`;
    const idempotencyKey = makeIdempotencyKey(
      request.headers['x-idempotency-key'],
      `approval:deny:${approval.approvalId}`,
    );
    const client = await pool.connect();

    try {
      await client.query('begin');

      const eventIds = [
        await persistApprovalSnapshot(client, {
          approval: nextApproval,
          eventType: 'approval.updated',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `approval:${approval.approvalId}`,
          ),
          actorRef: 'control-plane',
        }),
        await persistWorkItemSnapshot(client, {
          workItem: nextWorkItem,
          eventType: 'work_item.updated',
          commandId,
          idempotencyKey: makeEventCausationKey(
            idempotencyKey,
            `work-item:${workItem.workItemId}`,
          ),
          actorRef: 'control-plane',
        }),
      ];
      const syncedObjective = await syncObjectiveStatus(client, {
        objective,
        commandId,
        idempotencyKey: makeEventCausationKey(idempotencyKey, 'objective'),
        actorRef: 'control-plane',
      });

      if (syncedObjective.eventId) {
        eventIds.push(syncedObjective.eventId);
      }

      await recordCommandLogEntry(client, {
        commandId,
        companyId: approval.companyId,
        aggregateId: approval.approvalId,
        commandType: 'approval.deny',
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

    return {
      approval: nextApproval,
      workItem: nextWorkItem,
    };
  });

  server.post<{ Params: { runId: string } }>(
    '/runs/:runId/memory/extract',
    async (request, reply) => {
      const pool = getPool();
      const run = await getRunById(pool, request.params.runId);

      if (!run) {
        reply.code(404);
        return { message: 'Run not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: run.companyId,
          minimumRole: 'operator',
        }))
      ) {
        return { message: 'Operator access required.' };
      }

      const workItem = await getWorkItemById(pool, run.workItemId);
      if (!workItem) {
        reply.code(404);
        return { message: 'Work item not found for run.' };
      }

      const objective = await getObjectiveById(pool, workItem.objectiveId);
      if (!objective) {
        reply.code(404);
        return { message: 'Objective not found for run.' };
      }

      const batch = extractMemoryCandidatesFromRun({
        run,
        workItem,
        objective,
      });

      if (batch.candidates.length === 0) {
        return {
          source: 'run',
          candidates: [],
          provenanceEdges: [],
          extractedCount: 0,
        };
      }

      const client = await pool.connect();

      try {
        await client.query('begin');

        for (const candidate of batch.candidates) {
          await upsertMemoryCandidate(client, candidate);
        }
        await insertProvenanceEdges(client, batch.provenanceEdges);

        const persistedCandidates = (
          await Promise.all(
            batch.candidates.map((candidate) =>
              getMemoryCandidateById(client, candidate.candidateId),
            ),
          )
        ).filter(
          (candidate): candidate is MemoryCandidate => candidate !== null,
        );

        await client.query('commit');

        reply.code(201);
        return {
          source: 'run',
          candidates: persistedCandidates,
          provenanceEdges: batch.provenanceEdges,
          extractedCount: persistedCandidates.length,
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    '/approvals/:approvalId/memory/extract',
    async (request, reply) => {
      const pool = getPool();
      const approval = await getApprovalById(pool, request.params.approvalId);

      if (!approval) {
        reply.code(404);
        return { message: 'Approval not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: approval.companyId,
          minimumRole: 'reviewer',
        }))
      ) {
        return { message: 'Reviewer access required.' };
      }

      const workItem = await getWorkItemById(pool, approval.workItemId);
      if (!workItem) {
        reply.code(404);
        return { message: 'Work item not found for approval.' };
      }

      const objective = await getObjectiveById(pool, workItem.objectiveId);
      if (!objective) {
        reply.code(404);
        return { message: 'Objective not found for approval.' };
      }

      const batch = extractMemoryCandidateFromApproval({
        approval,
        workItem,
        objective,
      });

      if (batch.candidates.length === 0) {
        return {
          source: 'approval',
          candidates: [],
          provenanceEdges: [],
          extractedCount: 0,
        };
      }

      const client = await pool.connect();

      try {
        await client.query('begin');

        for (const candidate of batch.candidates) {
          await upsertMemoryCandidate(client, candidate);
        }
        await insertProvenanceEdges(client, batch.provenanceEdges);

        const persistedCandidates = (
          await Promise.all(
            batch.candidates.map((candidate) =>
              getMemoryCandidateById(client, candidate.candidateId),
            ),
          )
        ).filter(
          (candidate): candidate is MemoryCandidate => candidate !== null,
        );

        await client.query('commit');

        reply.code(201);
        return {
          source: 'approval',
          candidates: persistedCandidates,
          provenanceEdges: batch.provenanceEdges,
          extractedCount: persistedCandidates.length,
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  server.post<{
    Params: { companyId: string; inboundEventId: string };
  }>(
    '/companies/:companyId/github/inbound-events/:inboundEventId/memory/extract',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: company.companyId,
          minimumRole: 'operator',
        }))
      ) {
        return { message: 'Operator access required.' };
      }

      const inboundEvent = await getGitHubInboundEventById(
        pool,
        request.params.inboundEventId,
      );

      if (!inboundEvent || inboundEvent.companyId !== company.companyId) {
        reply.code(404);
        return { message: 'GitHub inbound event not found.' };
      }

      const context = await resolveGitHubMemoryContext(pool, inboundEvent);
      const batch = extractMemoryCandidateFromGitHubEvent({
        event: {
          inboundEventId: inboundEvent.inboundEventId,
          githubDeliveryId: inboundEvent.githubDeliveryId,
          companyId: inboundEvent.companyId,
          aggregateType: inboundEvent.aggregateType,
          aggregateId: inboundEvent.aggregateId,
          classification: inboundEvent.classification,
          status: inboundEvent.status,
          notes: inboundEvent.notes,
        },
        objectiveId: context.objectiveId,
        scopeRef: context.scopeRef,
      });

      if (batch.candidates.length === 0) {
        return {
          source: 'github_inbound',
          candidates: [],
          provenanceEdges: [],
          extractedCount: 0,
        };
      }

      const client = await pool.connect();

      try {
        await client.query('begin');

        for (const candidate of batch.candidates) {
          await upsertMemoryCandidate(client, candidate);
        }
        await insertProvenanceEdges(client, batch.provenanceEdges);

        const persistedCandidates = (
          await Promise.all(
            batch.candidates.map((candidate) =>
              getMemoryCandidateById(client, candidate.candidateId),
            ),
          )
        ).filter(
          (candidate): candidate is MemoryCandidate => candidate !== null,
        );

        await client.query('commit');

        reply.code(201);
        return {
          source: 'github_inbound',
          candidates: persistedCandidates,
          provenanceEdges: batch.provenanceEdges,
          extractedCount: persistedCandidates.length,
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  server.get<{
    Params: { companyId: string };
    Querystring: {
      status?: MemoryCandidate['status'];
      sourceKind?: MemoryCandidate['sourceKind'];
      objectiveId?: string;
      scopeRef?: string;
      limit?: string;
    };
  }>('/companies/:companyId/memory/candidates', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.params.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'viewer',
      }))
    ) {
      return { message: 'Viewer access required.' };
    }

    return {
      company,
      candidates: await listMemoryCandidates(pool, {
        companyId: company.companyId,
        status: request.query.status,
        sourceKind: request.query.sourceKind,
        objectiveId: request.query.objectiveId,
        scopeRef: request.query.scopeRef,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      }),
    };
  });

  server.post<{
    Params: { candidateId: string };
    Body: { supersedesMemoryId?: string };
  }>('/memory-candidates/:candidateId/promote', async (request, reply) => {
    const pool = getPool();
    const candidate = await getMemoryCandidateById(
      pool,
      request.params.candidateId,
    );

    if (!candidate) {
      reply.code(404);
      return { message: 'Memory candidate not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: candidate.companyId,
        minimumRole: 'reviewer',
      }))
    ) {
      return { message: 'Reviewer access required.' };
    }

    const predictedMemory = promoteMemoryCandidate({
      candidate,
      now: new Date().toISOString(),
      supersedesMemoryId: request.body?.supersedesMemoryId,
    });

    if (request.body?.supersedesMemoryId) {
      const supersededMemory = await getKnowledgeMemoryById(
        pool,
        request.body.supersedesMemoryId,
      );

      if (
        !supersededMemory ||
        supersededMemory.companyId !== candidate.companyId
      ) {
        reply.code(404);
        return { message: 'Superseded memory not found.' };
      }

      if (supersededMemory.memoryId === predictedMemory.memory.memoryId) {
        reply.code(409);
        return { message: 'A memory cannot supersede itself.' };
      }
    }

    const now = new Date().toISOString();
    const promotion = {
      ...predictedMemory,
      memory: {
        ...predictedMemory.memory,
        createdAt: now,
        updatedAt: now,
      },
      provenanceEdges: predictedMemory.provenanceEdges.map((edge) => ({
        ...edge,
        createdAt: now,
      })),
    };
    const client = await pool.connect();

    try {
      await client.query('begin');

      await upsertKnowledgeMemory(client, promotion.memory);
      await updateMemoryCandidateStatus(client, {
        candidateId: candidate.candidateId,
        status: candidate.status === 'quarantined' ? 'quarantined' : 'promoted',
        updatedAt: now,
      });

      const relatedEdges = [...promotion.provenanceEdges];
      let supersededMemory: KnowledgeMemory | null = null;

      if (request.body?.supersedesMemoryId) {
        const existingSuperseded = await getKnowledgeMemoryById(
          client,
          request.body.supersedesMemoryId,
        );

        if (existingSuperseded) {
          supersededMemory = invalidateKnowledgeMemory({
            memory: existingSuperseded,
            reason: 'superseded',
            now,
          });
          await upsertKnowledgeMemory(client, supersededMemory);
        }
      }

      await insertProvenanceEdges(client, relatedEdges);

      const storedCandidate = await getMemoryCandidateById(
        client,
        candidate.candidateId,
      );
      const storedMemory =
        (await getKnowledgeMemoryByCandidateId(
          client,
          candidate.candidateId,
        )) ?? promotion.memory;

      await client.query('commit');

      reply.code(201);
      return {
        candidate: storedCandidate ?? candidate,
        memory: storedMemory,
        supersededMemory,
        provenanceEdges: relatedEdges,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  server.get<{
    Params: { companyId: string };
    Querystring: {
      status?: KnowledgeMemory['status'];
      objectiveId?: string;
      scopeRef?: string;
      limit?: string;
    };
  }>('/companies/:companyId/memory', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.params.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'viewer',
      }))
    ) {
      return { message: 'Viewer access required.' };
    }

    return {
      company,
      memories: await listKnowledgeMemories(pool, {
        companyId: company.companyId,
        status: request.query.status,
        objectiveId: request.query.objectiveId,
        scopeRef: request.query.scopeRef,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      }),
    };
  });

  server.post<{
    Params: { memoryId: string };
    Body: {
      reason: MemoryInvalidationReason;
      supersededByMemoryId?: string;
    };
  }>('/memory/:memoryId/invalidate', async (request, reply) => {
    const pool = getPool();
    const memory = await getKnowledgeMemoryById(pool, request.params.memoryId);

    if (!memory) {
      reply.code(404);
      return { message: 'Memory not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: memory.companyId,
        minimumRole: 'reviewer',
      }))
    ) {
      return { message: 'Reviewer access required.' };
    }

    const now = new Date().toISOString();
    const nextMemory = invalidateKnowledgeMemory({
      memory,
      reason: request.body.reason,
      now,
    });
    const edges: ProvenanceEdge[] = [];

    if (request.body.supersededByMemoryId) {
      const supersedingMemory = await getKnowledgeMemoryById(
        pool,
        request.body.supersededByMemoryId,
      );

      if (
        !supersedingMemory ||
        supersedingMemory.companyId !== memory.companyId
      ) {
        reply.code(404);
        return { message: 'Superseding memory not found.' };
      }

      if (supersedingMemory.memoryId === memory.memoryId) {
        reply.code(409);
        return { message: 'A memory cannot supersede itself.' };
      }

      edges.push(
        createMemoryProvenanceEdge({
          companyId: memory.companyId,
          sourceNodeType: 'memory',
          sourceNodeId: supersedingMemory.memoryId,
          targetNodeType: 'memory',
          targetNodeId: memory.memoryId,
          edgeType: 'supersedes',
          createdAt: now,
        }),
      );
    }

    const client = await pool.connect();

    try {
      await client.query('begin');
      await upsertKnowledgeMemory(client, nextMemory);

      if (edges.length > 0) {
        await insertProvenanceEdges(client, edges);
      }

      await client.query('commit');

      return {
        memory: nextMemory,
        provenanceEdges: edges,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  server.get<{
    Params: { companyId: string };
    Querystring: {
      queryText?: string;
      objectiveId?: string;
      scopeRef?: string;
      retentionClasses?: string;
      minimumConfidence?: string;
      freshnessWindowHours?: string;
      limit?: string;
    };
  }>('/companies/:companyId/memory/retrieve', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.params.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
    }

    if (
      !(await requireCompanyAccess(request, reply, pool, config, {
        companyId: company.companyId,
        minimumRole: 'viewer',
      }))
    ) {
      return { message: 'Viewer access required.' };
    }

    const memories = await listKnowledgeMemories(pool, {
      companyId: company.companyId,
      limit: 500,
    });
    const provenanceEdges = await listProvenanceEdges(pool, {
      companyId: company.companyId,
    });
    const retrieval = retrieveKnowledgeMemories({
      memories,
      provenanceEdges,
      request: {
        companyId: company.companyId,
        queryText: request.query.queryText,
        objectiveId: request.query.objectiveId,
        scopeRef: request.query.scopeRef,
        retentionClasses: parseRetentionClasses(request.query.retentionClasses),
        minimumConfidence: request.query.minimumConfidence
          ? Number(request.query.minimumConfidence)
          : undefined,
        freshnessWindowHours: request.query.freshnessWindowHours
          ? Number(request.query.freshnessWindowHours)
          : undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      },
    });

    await insertMemoryRetrievalAudits(pool, retrieval.audits);

    return {
      company,
      items: retrieval.items,
      audits: retrieval.audits,
    };
  });

  server.get<{ Params: { memoryId: string } }>(
    '/memory/:memoryId/provenance',
    async (request, reply) => {
      const pool = getPool();
      const memory = await getKnowledgeMemoryById(
        pool,
        request.params.memoryId,
      );

      if (!memory) {
        reply.code(404);
        return { message: 'Memory not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: memory.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const [candidate, inboundEdges, outboundEdges, candidateInboundEdges] =
        await Promise.all([
          getMemoryCandidateById(pool, memory.candidateId),
          listProvenanceEdges(pool, {
            companyId: memory.companyId,
            targetNodeId: memory.memoryId,
          }),
          listProvenanceEdges(pool, {
            companyId: memory.companyId,
            sourceNodeId: memory.memoryId,
          }),
          listProvenanceEdges(pool, {
            companyId: memory.companyId,
            targetNodeId: memory.candidateId,
          }),
        ]);

      return {
        memory,
        candidate,
        inboundEdges,
        outboundEdges,
        candidateInboundEdges,
      };
    },
  );

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/memory/evaluation',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
      }

      if (
        !(await requireCompanyAccess(request, reply, pool, config, {
          companyId: company.companyId,
          minimumRole: 'viewer',
        }))
      ) {
        return { message: 'Viewer access required.' };
      }

      const [candidates, memories, provenanceEdges, retrievalAudits] =
        await Promise.all([
          listMemoryCandidates(pool, {
            companyId: company.companyId,
            limit: 1000,
          }),
          listKnowledgeMemories(pool, {
            companyId: company.companyId,
            limit: 1000,
          }),
          listProvenanceEdges(pool, {
            companyId: company.companyId,
          }),
          listMemoryRetrievalAudits(pool, {
            companyId: company.companyId,
            limit: 1000,
          }),
        ]);

      return {
        company,
        evaluation: evaluateMemoryQuality({
          companyId: company.companyId,
          candidates,
          memories,
          provenanceEdges,
          retrievalAudits,
        }),
      };
    },
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadControlPlaneConfig();
  const server = buildControlPlaneServer();

  server.listen({ port: config.port, host: '0.0.0.0' }).catch((error) => {
    server.log.error(error);
    process.exitCode = 1;
  });
}
