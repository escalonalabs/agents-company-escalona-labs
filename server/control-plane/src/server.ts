import { createHash, randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import type {
  ApprovalDecision,
  Company,
  DomainEvent,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';
import {
  createExecutionPacket,
  mapTaskResultToRunStatus,
  validateTaskResult,
} from '@escalonalabs/execution';
import {
  type DispatchSignature,
  createApprovalEvent,
  createCompanyCreatedEvent,
  createObjectiveEvent,
  createRunEvent,
  createWorkItemEvent,
  nextStreamSequence,
  replayAggregate,
} from '@escalonalabs/kernel';
import {
  type PlannedWorkItemInput,
  createDispatchDecision,
  createObjectivePlan,
  deriveObjectiveStatus,
  mapTaskResultToWorkItemStatus,
  summarizeObjectiveGraph,
} from '@escalonalabs/orchestration';

import { loadControlPlaneConfig } from './config';
import {
  type Queryable,
  appendDomainEvent,
  getCommandLogEntry,
  listDomainEvents,
  recordCommandLogEntry,
} from './db/events';
import { getPool } from './db/pool';
import {
  getApprovalById,
  getApprovalByWorkItemId,
  getCompanyById,
  getCompanyBySlug,
  getExecutionPacketByRunId,
  getObjectiveById,
  getRunById,
  getWorkItemById,
  insertCompany,
  listAllObjectives,
  listApprovals,
  listApprovalsByCompany,
  listCompanies,
  listObjectives,
  listRuns,
  listRunsByWorkItem,
  listWorkItems,
  listWorkItemsByObjective,
  upsertApproval,
  upsertObjective,
  upsertRun,
  upsertWorkItem,
} from './db/runtime';

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

async function getNextSequence(
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

async function persistCompanyCreated(
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
    idempotencyKey: makeEventCausationKey(input.idempotencyKey, 'company'),
    actorRef: input.actorRef,
  });

  await appendDomainEvent(db, event);
  await insertCompany(db, input.company);

  return event.eventId;
}

async function persistObjectiveSnapshot(
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

async function persistWorkItemSnapshot(
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

async function persistRunSnapshot(
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

async function persistApprovalSnapshot(
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

function buildDispatchSignature(input: {
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

async function syncObjectiveStatus(
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

function formatValidationFailureSummary(issues: string[]): string {
  return `Task result rejected by validator: ${issues.join('; ')}`;
}

export function buildControlPlaneServer() {
  const server = Fastify({ logger: true });

  server.get('/health', async () => {
    const pool = getPool();
    const [
      companyCount,
      objectiveCount,
      workItemCount,
      runCount,
      approvalCount,
    ] = await Promise.all([
      pool.query<{ count: string }>(
        'select count(*)::text as count from companies',
      ),
      pool.query<{ count: string }>(
        'select count(*)::text as count from objectives',
      ),
      pool.query<{ count: string }>(
        'select count(*)::text as count from work_items',
      ),
      pool.query<{ count: string }>('select count(*)::text as count from runs'),
      pool.query<{ count: string }>(
        'select count(*)::text as count from approvals',
      ),
    ]);

    return {
      service: 'control-plane',
      status: 'ok',
      companiesLoaded: Number(companyCount.rows[0]?.count ?? 0),
      counts: {
        companies: Number(companyCount.rows[0]?.count ?? 0),
        objectives: Number(objectiveCount.rows[0]?.count ?? 0),
        workItems: Number(workItemCount.rows[0]?.count ?? 0),
        runs: Number(runCount.rows[0]?.count ?? 0),
        approvals: Number(approvalCount.rows[0]?.count ?? 0),
      },
    };
  });

  server.get('/companies', async () => {
    const pool = getPool();
    return listCompanies(pool);
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

      return company;
    },
  );

  server.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/status',
    async (request, reply) => {
      const pool = getPool();
      const company = await getCompanyById(pool, request.params.companyId);

      if (!company) {
        reply.code(404);
        return { message: 'Company not found.' };
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

  server.get<{
    Querystring: {
      companyId?: string;
      aggregateType?: DomainEvent['aggregateType'];
      aggregateId?: string;
      limit?: string;
    };
  }>('/events', async (request) => {
    const pool = getPool();
    return listDomainEvents(pool, {
      companyId: request.query.companyId,
      aggregateType: request.query.aggregateType,
      aggregateId: request.query.aggregateId,
      limit: request.query.limit ? Number(request.query.limit) : 100,
    });
  });

  server.post<{ Body: { slug: string; displayName: string } }>(
    '/companies',
    async (request, reply) => {
      const pool = getPool();
      const idempotencyKey = makeIdempotencyKey(
        request.headers['x-idempotency-key'],
        `company:create:${request.body.slug}`,
      );

      const existingCompany = await getCompanyBySlug(pool, request.body.slug);
      if (existingCompany) {
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
          company: existingCompany,
          duplicate: true,
        };
      }

      const company: Company = {
        companyId: `company_${randomUUID()}`,
        slug: request.body.slug,
        displayName: request.body.displayName,
        status: 'active',
        createdAt: new Date().toISOString(),
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

        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }

      reply.code(201);
      return { company, duplicate: false };
    },
  );

  server.get<{
    Querystring: {
      companyId?: string;
    };
  }>('/objectives', async (request) => {
    const pool = getPool();

    if (request.query.companyId) {
      return listObjectives(pool, request.query.companyId);
    }

    return listAllObjectives(pool);
  });

  server.post<{
    Body: {
      companyId: string;
      title: string;
      summary?: string;
      requestedWorkItems?: PlannedWorkItemInput[];
    };
  }>('/objectives', async (request, reply) => {
    const pool = getPool();
    const company = await getCompanyById(pool, request.body.companyId);

    if (!company) {
      reply.code(404);
      return { message: 'Company not found.' };
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

  server.get<{ Params: { workItemId: string } }>(
    '/work-items/:workItemId',
    async (request, reply) => {
      const pool = getPool();
      const workItem = await getWorkItemById(pool, request.params.workItemId);

      if (!workItem) {
        reply.code(404);
        return { message: 'Work item not found.' };
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
      objectiveContext?: string;
      toolAllowlist?: string[];
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

    if (runs.length >= workItem.attemptBudget) {
      const now = new Date().toISOString();
      const nextWorkItem: WorkItem = {
        ...workItem,
        status: 'blocked',
        blockingReason: 'attempt_budget_exhausted',
        updatedAt: now,
      };
      const commandId = `cmd_${randomUUID()}`;
      const idempotencyKey = makeIdempotencyKey(
        request.headers['x-idempotency-key'],
        `work-item:dispatch:${workItem.workItemId}:budget`,
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

      reply.code(409);
      return {
        message: 'Attempt budget exhausted.',
        workItem: nextWorkItem,
      };
    }

    const objectiveContext =
      dispatchBody.objectiveContext ??
      [objective.title, objective.summary, workItem.description]
        .filter(Boolean)
        .join('\n\n');
    const packetSeed = {
      companyId: workItem.companyId,
      objectiveId: objective.objectiveId,
      workItemId: workItem.workItemId,
      assignedAgentId: dispatchBody.assignedAgentId ?? 'agent.runtime.default',
      objectiveContext,
      toolAllowlist: dispatchBody.toolAllowlist ?? [
        'filesystem.read',
        'github.read',
      ],
      scopeAllowlist: dispatchBody.scopeAllowlist ?? [workItem.scopeRef],
      inputArtifactRefs: dispatchBody.inputArtifactRefs ?? [],
      expectedResultSchemaRef:
        dispatchBody.expectedResultSchemaRef ?? workItem.validationContractRef,
      policySnapshotRef: dispatchBody.policySnapshotRef ?? 'policy.default.v1',
    };
    const previousPacket = latestRun
      ? await getExecutionPacketByRunId(pool, latestRun.runId)
      : null;
    const previousSignature = latestRun
      ? buildDispatchSignature({
          workItem,
          approval,
          packetSeed: previousPacket ?? {},
          failureClass: latestRun.failureClass,
        })
      : undefined;
    const currentSignature = buildDispatchSignature({
      workItem,
      approval,
      packetSeed,
      failureClass: latestRun?.failureClass,
    });
    const scopeConflict =
      (
        await listWorkItems(pool, {
          companyId: workItem.companyId,
          scopeRef: workItem.scopeRef,
          statuses: ['running'],
        })
      ).filter((candidate) => candidate.workItemId !== workItem.workItemId)
        .length > 0;
    const decision = createDispatchDecision({
      workItem,
      approval: approval ?? undefined,
      currentSignature,
      previousSignature,
      hasScopeConflict: scopeConflict,
    });

    if (decision.status !== 'dispatched') {
      const now = new Date().toISOString();
      const nextWorkItem: WorkItem = {
        ...workItem,
        status:
          decision.status === 'withheld_no_new_causal_input'
            ? 'escalated'
            : 'blocked',
        blockingReason:
          decision.status === 'withheld_missing_approval'
            ? 'approval_required'
            : decision.status === 'withheld_scope_conflict'
              ? 'scope_conflict'
              : 'no_new_causal_input',
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
      createdAt: now,
      updatedAt: now,
    };
    const executionPacket = createExecutionPacket({
      companyId: workItem.companyId,
      executionPacketId,
      workItemId: workItem.workItemId,
      runId,
      assignedAgentId: packetSeed.assignedAgentId,
      objectiveContext,
      toolAllowlist: packetSeed.toolAllowlist,
      scopeAllowlist: packetSeed.scopeAllowlist,
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

      await client.query(
        `
          insert into execution_packets (
            execution_packet_id,
            company_id,
            work_item_id,
            run_id,
            packet,
            created_at
          )
          values ($1, $2, $3, $4, $5::jsonb, $6)
          on conflict (execution_packet_id)
          do update set packet = excluded.packet
        `,
        [
          executionPacket.executionPacketId,
          executionPacket.companyId,
          executionPacket.workItemId,
          executionPacket.runId,
          JSON.stringify(executionPacket),
          executionPacket.createdAt,
        ],
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
  }>('/approvals', async (request) => {
    const pool = getPool();

    if (request.query.companyId) {
      return listApprovalsByCompany(
        pool,
        request.query.companyId,
        request.query.status,
      );
    }

    return listApprovals(pool, request.query.status);
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
