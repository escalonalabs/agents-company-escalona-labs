import type { DomainEvent, DriftAlert } from '@escalonalabs/domain';
import {
  type GitHubInboundEventRecord,
  type GitHubInstallationRef,
  type GitHubProjectionBinding,
  type GitHubProjectionDelivery,
  type GitHubRepositoryRef,
  classifyGitHubInboundEvent,
  createGitHubSyncPlan,
  deriveProjectionHealth,
} from '@escalonalabs/github';

import type { Queryable } from './db/events';
import {
  listDriftAlerts,
  listGitHubInboundEvents,
  listGitHubInstallations,
  listGitHubProjectionBindings,
  listGitHubProjectionDeliveries,
  upsertDriftAlert,
  upsertGitHubInboundEvent,
  upsertGitHubInstallation,
  upsertGitHubProjectionBinding,
  upsertGitHubProjectionDelivery,
} from './db/github';
import {
  getCompanyById,
  listApprovalsByCompany,
  listObjectives,
  listRuns,
  listWorkItems,
} from './db/runtime';

function createAggregateRef(
  aggregateType: string,
  aggregateId: string,
): string {
  return `${aggregateType}:${aggregateId}`;
}

function createRepositoryKey(repository: GitHubRepositoryRef): string {
  return `${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
}

function repositoryMatches(
  left: GitHubRepositoryRef,
  right: GitHubRepositoryRef,
) {
  if (left.id !== undefined && right.id !== undefined) {
    return left.id === right.id;
  }

  return createRepositoryKey(left) === createRepositoryKey(right);
}

export function mapLatestEventIds(
  events: DomainEvent[],
): Record<string, string> {
  const latestByAggregate = new Map<
    string,
    { eventId: string; occurredAt: string; streamSequence: number }
  >();

  for (const event of events) {
    const aggregateRef = createAggregateRef(
      event.aggregateType,
      event.aggregateId,
    );
    const existing = latestByAggregate.get(aggregateRef);

    if (!existing) {
      latestByAggregate.set(aggregateRef, {
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        streamSequence: event.streamSequence ?? 0,
      });
      continue;
    }

    const isNewer =
      event.occurredAt > existing.occurredAt ||
      (event.occurredAt === existing.occurredAt &&
        (event.streamSequence ?? 0) > existing.streamSequence);

    if (isNewer) {
      latestByAggregate.set(aggregateRef, {
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        streamSequence: event.streamSequence ?? 0,
      });
    }
  }

  return Object.fromEntries(
    [...latestByAggregate.entries()].map(([aggregateRef, event]) => [
      aggregateRef,
      event.eventId,
    ]),
  );
}

export async function loadGitHubStatus(db: Queryable, companyId: string) {
  const [company, installations, deliveries, driftAlerts, inboundEvents] =
    await Promise.all([
      getCompanyById(db, companyId),
      listGitHubInstallations(db, companyId),
      listGitHubProjectionDeliveries(db, { companyId, limit: 200 }),
      listDriftAlerts(db, { companyId, limit: 200 }),
      listGitHubInboundEvents(db, { companyId, limit: 200 }),
    ]);

  return {
    company,
    installations,
    deliveries,
    driftAlerts,
    inboundEvents,
    projectionHealth: deriveProjectionHealth({
      companyId,
      deliveries,
      driftAlerts,
    }),
  };
}

export async function queueGitHubSyncPlanForCompany(
  db: Queryable,
  companyId: string,
  events: DomainEvent[],
  now: string,
): Promise<{
  batches: Array<{
    installation: GitHubInstallationRef;
    bindings: GitHubProjectionBinding[];
    plan: ReturnType<typeof createGitHubSyncPlan>;
  }>;
  queuedDeliveries: GitHubProjectionDelivery[];
}> {
  const [
    company,
    installations,
    objectives,
    workItems,
    runs,
    approvals,
    bindings,
  ] = await Promise.all([
    getCompanyById(db, companyId),
    listGitHubInstallations(db, companyId),
    listObjectives(db, companyId),
    listWorkItems(db, { companyId }),
    listRuns(db, { companyId }),
    listApprovalsByCompany(db, companyId),
    listGitHubProjectionBindings(db, { companyId }),
  ]);

  if (!company) {
    throw new Error('Company not found for GitHub sync.');
  }

  if (installations.length === 0) {
    throw new Error('GitHub installation is not linked for this company.');
  }

  const plan = createGitHubSyncPlan({
    snapshot: {
      company,
      objectives,
      workItems,
      runs,
      approvals,
      latestEventByAggregate: mapLatestEventIds(events),
    },
    bindings,
    defaultRepository:
      installations.length === 1 ? installations[0]?.repository : undefined,
    now,
  });

  for (const planItem of plan) {
    await upsertGitHubProjectionDelivery(db, planItem.delivery);
  }

  const batches = installations.map((installation) => {
    const batchPlan = plan.filter((planItem) =>
      repositoryMatches(planItem.repository, installation.repository),
    );
    const batchBindings = bindings.filter((binding) =>
      repositoryMatches(binding.repository, installation.repository),
    );

    return {
      installation,
      bindings: batchBindings,
      plan: batchPlan,
    };
  });

  const unmatchedPlanItems = plan.filter(
    (planItem) =>
      !installations.some((installation) =>
        repositoryMatches(planItem.repository, installation.repository),
      ),
  );

  if (unmatchedPlanItems.length > 0) {
    throw new Error(
      `GitHub sync cannot find linked installations for repositories: ${[
        ...new Set(
          unmatchedPlanItems.map((planItem) =>
            createRepositoryKey(planItem.repository),
          ),
        ),
      ].join(', ')}.`,
    );
  }

  return {
    batches: batches.filter((batch) => batch.plan.length > 0),
    queuedDeliveries: plan.map((item) => item.delivery),
  };
}

export async function persistGitHubSyncResults(
  db: Queryable,
  input: {
    companyId: string;
    bindings: GitHubProjectionBinding[];
    deliveries: GitHubProjectionDelivery[];
    driftAlerts: DriftAlert[];
  },
) {
  for (const binding of input.bindings.filter(
    (binding) => binding.companyId === input.companyId,
  )) {
    await upsertGitHubProjectionBinding(db, binding);
  }

  for (const delivery of input.deliveries.filter(
    (delivery) => delivery.companyId === input.companyId,
  )) {
    await upsertGitHubProjectionDelivery(db, delivery);
  }

  for (const alert of input.driftAlerts.filter(
    (alert) => alert.companyId === input.companyId,
  )) {
    await upsertDriftAlert(db, alert);
  }

  const [deliveries, driftAlerts] = await Promise.all([
    listGitHubProjectionDeliveries(db, {
      companyId: input.companyId,
      limit: 200,
    }),
    listDriftAlerts(db, { companyId: input.companyId, limit: 200 }),
  ]);

  return {
    projectionHealth: deriveProjectionHealth({
      companyId: input.companyId,
      deliveries,
      driftAlerts,
    }),
  };
}

export async function linkGitHubInstallation(
  db: Queryable,
  installation: GitHubInstallationRef,
) {
  await upsertGitHubInstallation(db, installation);
  return {
    installation,
    installations: await listGitHubInstallations(db, installation.companyId),
  };
}

export async function recordGitHubInboundWebhook(
  db: Queryable,
  input: {
    inboundEventId: string;
    githubDeliveryId: string;
    githubEventName: string;
    action?: string | null;
    payload: Record<string, unknown>;
    receivedAt: string;
  },
): Promise<{
  inboundEvent: GitHubInboundEventRecord;
  driftAlert?: DriftAlert;
}> {
  const inboundEvent = classifyGitHubInboundEvent({
    inboundEventId: input.inboundEventId,
    githubDeliveryId: input.githubDeliveryId,
    githubEventName: input.githubEventName,
    action: input.action,
    payload: input.payload,
    receivedAt: input.receivedAt,
  });

  await upsertGitHubInboundEvent(db, inboundEvent);

  if (
    !inboundEvent.companyId ||
    !['authoritative_conflict', 'missing_linkage'].includes(
      inboundEvent.classification,
    )
  ) {
    return { inboundEvent };
  }

  const driftAlert: DriftAlert = {
    alertId: `${inboundEvent.githubDeliveryId}:reconcile`,
    companyId: inboundEvent.companyId,
    aggregateType: inboundEvent.aggregateType ?? 'unlinked',
    aggregateId: inboundEvent.aggregateId ?? inboundEvent.githubDeliveryId,
    severity:
      inboundEvent.classification === 'authoritative_conflict'
        ? 'high'
        : 'warn',
    summary:
      inboundEvent.notes ??
      'GitHub inbound activity requires reconciliation before runtime truth changes.',
    githubObjectRef: inboundEvent.githubDeliveryId,
    driftClass:
      inboundEvent.classification === 'authoritative_conflict'
        ? 'unauthorized_mutation'
        : 'metadata_mismatch',
    sourceEventId: inboundEvent.githubDeliveryId,
    observedAt: inboundEvent.createdAt,
    repairStatus: 'open',
    notes: inboundEvent.notes,
  };

  await upsertDriftAlert(db, driftAlert);

  return {
    inboundEvent,
    driftAlert,
  };
}
