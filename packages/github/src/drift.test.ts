import { describe, expect, it } from 'vitest';

import {
  deriveProjectionHealth,
  detectCheckRunDrift,
  detectCommentDrift,
  detectIssueDrift,
} from './drift';
import { createMetadataBlock } from './metadata';
import type {
  GitHubCheckRunProjection,
  GitHubCommentProjection,
  GitHubIssueProjection,
} from './types';

function createMetadata() {
  return {
    projectionVersion: 'github.v1',
    companyId: 'company_001',
    aggregateType: 'work_item',
    aggregateId: 'work_item_001',
    sourceEventId: 'evt_001',
    projectionDeliveryId: 'projection_001',
  } as const;
}

describe('GitHub drift detection', () => {
  it('detects issue body divergence beyond metadata presence', () => {
    const metadata = createMetadata();
    const expected: GitHubIssueProjection = {
      title: 'Build M11',
      body: `## Runtime State\n\ncanonical body\n\n${createMetadataBlock(metadata)}`,
      labels: ['runtime:work-item', 'status:ready'],
      state: 'open',
      metadata,
    };

    const candidates = detectIssueDrift({
      expected,
      actual: {
        id: 'issue_1',
        number: 42,
        repository: { owner: 'escalonalabs', name: 'agents-company' },
        title: expected.title,
        body: `## Runtime State\n\nmanually edited\n\n${createMetadataBlock(metadata)}`,
        labels: expected.labels,
        state: expected.state,
      },
    });

    expect(
      candidates.some(
        (candidate) => candidate.driftClass === 'unauthorized_mutation',
      ),
    ).toBe(true);
  });

  it('detects comment body divergence and metadata mismatch', () => {
    const metadata = {
      ...createMetadata(),
      aggregateType: 'approval',
      aggregateId: 'approval_001',
    } as const;
    const expected: GitHubCommentProjection = {
      body: `### Approval Status\n\n- status: pending\n\n${createMetadataBlock(metadata)}`,
      metadata,
    };

    const candidates = detectCommentDrift({
      expected,
      actual: {
        id: 'comment_1',
        repository: { owner: 'escalonalabs', name: 'agents-company' },
        issueNumber: 42,
        body: `### Approval Status\n\n- status: granted\n\n${createMetadataBlock(metadata)}`,
      },
    });

    expect(
      candidates.some(
        (candidate) => candidate.driftClass === 'unauthorized_mutation',
      ),
    ).toBe(true);
  });

  it('detects check-run drift in head sha, conclusion, summary, and text', () => {
    const metadata = {
      ...createMetadata(),
      aggregateType: 'run',
      aggregateId: 'run_001',
    } as const;
    const expected: GitHubCheckRunProjection = {
      name: 'run/run_001',
      headSha: 'abc123',
      status: 'completed',
      conclusion: 'success',
      summary: 'Run completed successfully.',
      text: 'All checks passed.',
      externalId: 'run_001',
      metadata,
    };

    const candidates = detectCheckRunDrift({
      expected,
      actual: {
        id: 'check_1',
        repository: { owner: 'escalonalabs', name: 'agents-company' },
        name: 'run/run_001',
        headSha: 'def456',
        status: 'completed',
        conclusion: 'failure',
        summary: 'Run failed.',
        text: 'A human edited this check.',
        externalId: 'run_001',
      },
    });

    expect(
      candidates.some((candidate) => candidate.summary.includes('head SHA')),
    ).toBe(true);
    expect(
      candidates.some((candidate) => candidate.summary.includes('conclusion')),
    ).toBe(true);
    expect(
      candidates.some((candidate) => candidate.summary.includes('summary')),
    ).toBe(true);
    expect(
      candidates.some((candidate) => candidate.summary.includes('detail text')),
    ).toBe(true);
  });

  it('ignores repaired alerts when deriving projection health', () => {
    const projectionHealth = deriveProjectionHealth({
      companyId: 'company_001',
      deliveries: [
        {
          projectionDeliveryId: 'delivery_1',
          projectionName: 'github',
          companyId: 'company_001',
          aggregateType: 'work_item',
          aggregateId: 'work_item_001',
          sourceEventId: 'evt_001',
          githubObjectType: 'issue',
          actionType: 'update_issue',
          deliveryKey: 'github:work_item:work_item_001',
          status: 'applied',
          attemptCount: 1,
          payload: {},
          appliedAt: '2026-04-22T10:00:00.000Z',
          createdAt: '2026-04-22T09:59:00.000Z',
          updatedAt: '2026-04-22T10:00:00.000Z',
        },
      ],
      driftAlerts: [
        {
          alertId: 'alert_1',
          companyId: 'company_001',
          aggregateType: 'work_item',
          aggregateId: 'work_item_001',
          severity: 'high',
          summary: 'Drift repaired.',
          observedAt: '2026-04-22T09:59:30.000Z',
          repairStatus: 'repaired',
        },
      ],
    });

    expect(projectionHealth.status).toBe('healthy');
    expect(projectionHealth.openDriftCount).toBe(0);
  });
});
