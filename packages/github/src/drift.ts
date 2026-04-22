import type { DriftAlert, ProjectionHealth } from '@escalonalabs/domain';

import { parseMetadataBlock } from './metadata';
import type {
  GitHubCheckRunProjection,
  GitHubCheckRunRecord,
  GitHubCommentProjection,
  GitHubCommentRecord,
  GitHubDriftCandidate,
  GitHubIssueProjection,
  GitHubIssueRecord,
  GitHubProjectionDelivery,
} from './types';

function sortLabels(labels: string[]): string[] {
  return [...labels].sort((left, right) => left.localeCompare(right));
}

function labelsMatch(expected: string[], actual: string[]): boolean {
  const left = sortLabels(expected);
  const right = sortLabels(actual);

  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function createDriftCandidate(
  input: GitHubDriftCandidate,
): GitHubDriftCandidate {
  return input;
}

export function detectIssueDrift(input: {
  expected: GitHubIssueProjection;
  actual: GitHubIssueRecord | null;
}): GitHubDriftCandidate[] {
  if (!input.actual) {
    return [
      createDriftCandidate({
        driftClass: 'missing_object',
        severity: 'high',
        summary: 'Expected GitHub issue is missing.',
      }),
    ];
  }

  const candidates: GitHubDriftCandidate[] = [];
  const metadata = parseMetadataBlock(input.actual.body);

  if (!metadata) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'metadata_mismatch',
        severity: 'high',
        summary: 'GitHub issue is missing the canonical metadata block.',
        githubObjectRef: `issue:${input.actual.number}`,
      }),
    );
  } else if (
    metadata.aggregateType !== input.expected.metadata.aggregateType ||
    metadata.aggregateId !== input.expected.metadata.aggregateId
  ) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'metadata_mismatch',
        severity: 'critical',
        summary: 'GitHub issue metadata points to a different aggregate.',
        githubObjectRef: `issue:${input.actual.number}`,
      }),
    );
  }

  if (input.actual.title !== input.expected.title) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'unauthorized_mutation',
        severity: 'high',
        summary: 'GitHub issue title diverged from runtime truth.',
        githubObjectRef: `issue:${input.actual.number}`,
      }),
    );
  }

  if (normalizeText(input.actual.body) !== normalizeText(input.expected.body)) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'unauthorized_mutation',
        severity: 'high',
        summary: 'GitHub issue body diverged from the canonical projection.',
        githubObjectRef: `issue:${input.actual.number}`,
      }),
    );
  }

  if (!labelsMatch(input.expected.labels, input.actual.labels)) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'policy_mismatch',
        severity: 'warn',
        summary: 'GitHub issue labels no longer match the runtime projection.',
        githubObjectRef: `issue:${input.actual.number}`,
      }),
    );
  }

  if (input.actual.state !== input.expected.state) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'policy_mismatch',
        severity: 'high',
        summary: 'GitHub issue open/closed state diverged from runtime truth.',
        githubObjectRef: `issue:${input.actual.number}`,
      }),
    );
  }

  return candidates;
}

export function detectCommentDrift(input: {
  expected: GitHubCommentProjection;
  actual: GitHubCommentRecord | null;
}): GitHubDriftCandidate[] {
  if (!input.actual) {
    return [
      createDriftCandidate({
        driftClass: 'missing_object',
        severity: 'warn',
        summary: 'Expected GitHub comment is missing.',
      }),
    ];
  }

  const candidates: GitHubDriftCandidate[] = [];
  const metadata = parseMetadataBlock(input.actual.body);
  if (!metadata) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'metadata_mismatch',
        severity: 'high',
        summary: 'GitHub comment is missing canonical metadata.',
        githubObjectRef: `comment:${input.actual.id}`,
      }),
    );
  } else if (
    metadata.aggregateType !== input.expected.metadata.aggregateType ||
    metadata.aggregateId !== input.expected.metadata.aggregateId
  ) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'metadata_mismatch',
        severity: 'critical',
        summary: 'GitHub comment metadata points to a different aggregate.',
        githubObjectRef: `comment:${input.actual.id}`,
      }),
    );
  }

  if (normalizeText(input.actual.body) !== normalizeText(input.expected.body)) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'unauthorized_mutation',
        severity: 'high',
        summary: 'GitHub comment body diverged from the canonical projection.',
        githubObjectRef: `comment:${input.actual.id}`,
      }),
    );
  }

  return candidates;
}

export function detectCheckRunDrift(input: {
  expected: GitHubCheckRunProjection;
  actual: GitHubCheckRunRecord | null;
}): GitHubDriftCandidate[] {
  if (!input.actual) {
    return [
      createDriftCandidate({
        driftClass: 'missing_object',
        severity: 'warn',
        summary: 'Expected GitHub check run is missing.',
      }),
    ];
  }

  const candidates: GitHubDriftCandidate[] = [];

  if (input.actual.externalId !== input.expected.externalId) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'metadata_mismatch',
        severity: 'critical',
        summary: 'GitHub check run external ID diverged from runtime truth.',
        githubObjectRef: `check_run:${input.actual.id}`,
      }),
    );
  }

  if (input.actual.name !== input.expected.name) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'unauthorized_mutation',
        severity: 'high',
        summary: 'GitHub check run name diverged from runtime truth.',
        githubObjectRef: `check_run:${input.actual.id}`,
      }),
    );
  }

  if (input.actual.status !== input.expected.status) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'policy_mismatch',
        severity: 'warn',
        summary: 'GitHub check run status diverged from runtime projection.',
        githubObjectRef: `check_run:${input.actual.id}`,
      }),
    );
  }

  if ((input.actual.headSha ?? null) !== (input.expected.headSha ?? null)) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'policy_mismatch',
        severity: 'high',
        summary: 'GitHub check run head SHA diverged from runtime truth.',
        githubObjectRef: `check_run:${input.actual.id}`,
      }),
    );
  }

  if (
    (input.actual.conclusion ?? null) !== (input.expected.conclusion ?? null)
  ) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'policy_mismatch',
        severity: 'high',
        summary: 'GitHub check run conclusion diverged from runtime truth.',
        githubObjectRef: `check_run:${input.actual.id}`,
      }),
    );
  }

  if (
    normalizeText(input.actual.summary) !==
    normalizeText(input.expected.summary)
  ) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'unauthorized_mutation',
        severity: 'high',
        summary: 'GitHub check run summary diverged from runtime truth.',
        githubObjectRef: `check_run:${input.actual.id}`,
      }),
    );
  }

  if (normalizeText(input.actual.text) !== normalizeText(input.expected.text)) {
    candidates.push(
      createDriftCandidate({
        driftClass: 'unauthorized_mutation',
        severity: 'warn',
        summary: 'GitHub check run detail text diverged from runtime truth.',
        githubObjectRef: `check_run:${input.actual.id}`,
      }),
    );
  }

  return candidates;
}

export function createDriftAlert(input: {
  alertId: string;
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  candidate: GitHubDriftCandidate;
  sourceEventId?: string;
  observedAt: string;
}): DriftAlert {
  return {
    alertId: input.alertId,
    companyId: input.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    severity: input.candidate.severity,
    summary: input.candidate.summary,
    githubObjectRef: input.candidate.githubObjectRef,
    driftClass: input.candidate.driftClass,
    sourceEventId: input.sourceEventId,
    observedAt: input.observedAt,
    repairStatus: 'open',
    notes: input.candidate.notes,
  };
}

export function toSyncEvent(
  delivery: GitHubProjectionDelivery,
): import('@escalonalabs/domain').GitHubSyncEvent {
  return {
    syncEventId: delivery.projectionDeliveryId,
    companyId: delivery.companyId,
    aggregateType: delivery.aggregateType,
    aggregateId: delivery.aggregateId,
    direction: 'outbound',
    status:
      delivery.status === 'queued'
        ? 'queued'
        : delivery.status === 'applied'
          ? 'accepted'
          : delivery.status,
    actionType: delivery.actionType,
    deliveryKey: delivery.deliveryKey,
    githubObjectRef: delivery.githubObjectRef,
    sourceEventId: delivery.sourceEventId,
    attemptCount: delivery.attemptCount,
    lastError: delivery.lastError,
    appliedAt: delivery.appliedAt,
  };
}

export function deriveProjectionHealth(input: {
  companyId: string;
  deliveries: GitHubProjectionDelivery[];
  driftAlerts: DriftAlert[];
}): ProjectionHealth {
  const lastSuccessfulDelivery = [...input.deliveries]
    .filter((delivery) => delivery.status === 'applied')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const lastAttempt = [...input.deliveries].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
  const openDriftAlerts = input.driftAlerts.filter(
    (alert) => alert.repairStatus !== 'repaired',
  );
  const hasCriticalDrift = openDriftAlerts.some((alert) =>
    ['high', 'critical'].includes(alert.severity),
  );
  const hasFailedDelivery = input.deliveries.some(
    (delivery) => delivery.status === 'failed',
  );

  return {
    companyId: input.companyId,
    projectionTarget: 'github',
    status: hasCriticalDrift
      ? 'drifted'
      : hasFailedDelivery
        ? 'lagging'
        : 'healthy',
    lastSuccessfulSyncAt: lastSuccessfulDelivery?.appliedAt,
    lastAttemptAt: lastAttempt?.updatedAt,
    openDriftCount: openDriftAlerts.length,
    lastError: [...input.deliveries]
      .reverse()
      .find((delivery) => delivery.lastError)?.lastError,
  };
}
