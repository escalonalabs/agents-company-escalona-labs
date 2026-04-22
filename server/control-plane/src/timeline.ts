import type {
  DomainEvent,
  DriftAlert,
  OperatorTimelineEvent,
} from '@escalonalabs/domain';
import type { GitHubInboundEventRecord } from '@escalonalabs/github';

function severityFromEvent(
  eventType: string,
): OperatorTimelineEvent['severity'] {
  if (
    eventType.includes('failed') ||
    eventType.includes('cancelled') ||
    eventType.includes('denied')
  ) {
    return 'high';
  }

  if (eventType.includes('updated')) {
    return 'warn';
  }

  return 'info';
}

function summarizeLedgerEvent(event: DomainEvent): string {
  switch (event.eventType) {
    case 'company.created':
      return 'Company created and entered the runtime ledger.';
    case 'company.updated':
      return 'Company rollout state or cohort enrollment changed.';
    case 'objective.created':
      return 'Objective created and planned into bounded work items.';
    case 'objective.updated':
      return 'Objective status or summary changed.';
    case 'work_item.created':
      return 'Work item created by the planner.';
    case 'work_item.updated':
      return 'Work item state changed.';
    case 'run.started':
      return 'Run started with a frozen execution packet.';
    case 'run.completed':
      return 'Run completed successfully.';
    case 'run.failed':
      return 'Run failed and may require retry or intervention.';
    case 'run.cancelled':
      return 'Run was cancelled before successful completion.';
    case 'approval.requested':
      return 'Approval requested from an operator.';
    case 'approval.updated':
      return 'Approval decision changed.';
    case 'claim.acquired':
      return 'A scope claim was acquired.';
    case 'claim.expired':
      return 'A scope claim expired.';
    default:
      return 'Runtime event recorded.';
  }
}

export function toOperatorTimelineEvent(
  event: DomainEvent,
): OperatorTimelineEvent {
  return {
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    summary: summarizeLedgerEvent(event),
    severity: severityFromEvent(event.eventType),
    actorRef: event.actorRef,
    source: 'ledger',
  };
}

export function fromDriftAlert(alert: DriftAlert): OperatorTimelineEvent {
  return {
    eventId: alert.alertId,
    occurredAt: alert.observedAt ?? new Date().toISOString(),
    aggregateType: alert.aggregateType,
    aggregateId: alert.aggregateId,
    eventType: `drift.${alert.driftClass ?? 'detected'}`,
    summary: `${alert.summary} Runtime remains authoritative.`,
    severity: alert.severity,
    source: 'drift',
  };
}

export function fromGitHubInboundEvent(
  event: GitHubInboundEventRecord,
): OperatorTimelineEvent {
  const classificationSeverity: OperatorTimelineEvent['severity'] =
    event.classification === 'authoritative_conflict'
      ? 'high'
      : event.classification === 'missing_linkage'
        ? 'warn'
        : event.status === 'rejected'
          ? 'warn'
          : 'info';

  return {
    eventId: event.inboundEventId,
    occurredAt: event.createdAt,
    aggregateType: event.aggregateType ?? 'github',
    aggregateId: event.aggregateId ?? event.githubDeliveryId,
    eventType: `github.${event.classification}`,
    summary:
      event.notes ??
      'GitHub activity was observed and reconciled against runtime truth.',
    severity: classificationSeverity,
    source: 'github_inbound',
  };
}

export function mergeTimelineEvents(input: {
  ledgerEvents: DomainEvent[];
  driftAlerts?: DriftAlert[];
  inboundEvents?: GitHubInboundEventRecord[];
  limit?: number;
}): OperatorTimelineEvent[] {
  const merged = [
    ...input.ledgerEvents.map(toOperatorTimelineEvent),
    ...(input.driftAlerts ?? []).map(fromDriftAlert),
    ...(input.inboundEvents ?? []).map(fromGitHubInboundEvent),
  ];

  return merged
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, input.limit ?? 100);
}
