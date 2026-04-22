import { describe, expect, it } from 'vitest';

import { createMetadataBlock } from './metadata';
import { applyGitHubSyncPlan } from './sync';
import type {
  GitHubCommentProjection,
  GitHubInstallationRef,
  GitHubIssueProjection,
  GitHubTransport,
} from './types';

function createInstallation(): GitHubInstallationRef {
  return {
    companyId: 'company_001',
    installationId: 42,
    accountLogin: 'escalonalabs',
    repository: {
      owner: 'escalonalabs',
      name: 'agents-company-escalona-labs',
      id: 7,
    },
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
  };
}

function createIssueProjection(): GitHubIssueProjection {
  const metadata = {
    projectionVersion: 'github.v1',
    companyId: 'company_001',
    aggregateType: 'work_item',
    aggregateId: 'work_item_001',
    sourceEventId: 'evt_001',
    projectionDeliveryId: 'projection_work_item_evt_001_issue',
  };

  return {
    title: 'Build M11',
    body: `## Runtime State\n\nlinked\n\n${createMetadataBlock(metadata)}`,
    labels: ['runtime:work-item', 'status:ready'],
    state: 'open',
    metadata,
  };
}

function createCommentProjection(): GitHubCommentProjection {
  const metadata = {
    projectionVersion: 'github.v1',
    companyId: 'company_001',
    aggregateType: 'run',
    aggregateId: 'run_001',
    sourceEventId: 'evt_002',
    projectionDeliveryId: 'projection_run_evt_002_comment',
  };

  return {
    body: `### Run Status\n\nall green\n\n${createMetadataBlock(metadata)}`,
    metadata,
  };
}

describe('applyGitHubSyncPlan', () => {
  it('creates bindings and applied deliveries for successful issue/comment sync', async () => {
    const installation = createInstallation();
    const transport: GitHubTransport = {
      async getIssue() {
        return null;
      },
      async createIssue({ repository, projection }) {
        return {
          id: '100',
          number: 99,
          repository,
          title: projection.title,
          body: projection.body,
          labels: projection.labels,
          state: projection.state,
        };
      },
      async updateIssue() {
        throw new Error('not used');
      },
      async getComment() {
        return null;
      },
      async createComment({ repository, issueNumber, projection }) {
        return {
          id: 'comment_1',
          repository,
          issueNumber,
          body: projection.body,
        };
      },
      async updateComment() {
        throw new Error('not used');
      },
      async getCheckRun() {
        return null;
      },
      async createCheckRun() {
        throw new Error('not used');
      },
      async updateCheckRun() {
        throw new Error('not used');
      },
    };

    const issueProjection = createIssueProjection();
    const commentProjection = createCommentProjection();
    const result = await applyGitHubSyncPlan({
      installation,
      transport,
      bindings: [],
      now: '2026-04-22T00:00:10.000Z',
      plan: [
        {
          delivery: {
            projectionDeliveryId: issueProjection.metadata.projectionDeliveryId,
            projectionName: 'github',
            companyId: 'company_001',
            aggregateType: 'work_item',
            aggregateId: 'work_item_001',
            sourceEventId: 'evt_001',
            githubObjectType: 'issue',
            actionType: 'create_issue',
            deliveryKey: 'delivery:issue',
            status: 'queued',
            attemptCount: 0,
            payload: issueProjection as unknown as Record<string, unknown>,
            createdAt: '2026-04-22T00:00:00.000Z',
            updatedAt: '2026-04-22T00:00:00.000Z',
          },
          repository: installation.repository,
          issueProjection,
        },
        {
          delivery: {
            projectionDeliveryId:
              commentProjection.metadata.projectionDeliveryId,
            projectionName: 'github',
            companyId: 'company_001',
            aggregateType: 'run',
            aggregateId: 'run_001',
            sourceEventId: 'evt_002',
            githubObjectType: 'comment',
            actionType: 'add_comment',
            deliveryKey: 'delivery:comment',
            status: 'queued',
            attemptCount: 0,
            payload: commentProjection as unknown as Record<string, unknown>,
            createdAt: '2026-04-22T00:00:00.000Z',
            updatedAt: '2026-04-22T00:00:00.000Z',
          },
          repository: installation.repository,
          commentProjection,
          parentAggregateId: 'work_item_001',
        },
      ],
    });

    expect(result.deliveries).toHaveLength(2);
    expect(
      result.deliveries.every((delivery) => delivery.status === 'applied'),
    ).toBe(true);
    expect(result.bindings).toHaveLength(2);
    expect(result.projectionHealth.status).toBe('healthy');
  });

  it('fails closed when a comment cannot resolve its parent issue binding', async () => {
    const installation = createInstallation();
    const transport: GitHubTransport = {
      async getIssue() {
        return null;
      },
      async createIssue() {
        throw new Error('not used');
      },
      async updateIssue() {
        throw new Error('not used');
      },
      async getComment() {
        return null;
      },
      async createComment() {
        throw new Error('not used');
      },
      async updateComment() {
        throw new Error('not used');
      },
      async getCheckRun() {
        return null;
      },
      async createCheckRun() {
        throw new Error('not used');
      },
      async updateCheckRun() {
        throw new Error('not used');
      },
    };
    const commentProjection = createCommentProjection();
    const result = await applyGitHubSyncPlan({
      installation,
      transport,
      bindings: [],
      now: '2026-04-22T00:00:10.000Z',
      plan: [
        {
          delivery: {
            projectionDeliveryId:
              commentProjection.metadata.projectionDeliveryId,
            projectionName: 'github',
            companyId: 'company_001',
            aggregateType: 'run',
            aggregateId: 'run_001',
            sourceEventId: 'evt_002',
            githubObjectType: 'comment',
            actionType: 'add_comment',
            deliveryKey: 'delivery:comment',
            status: 'queued',
            attemptCount: 0,
            payload: commentProjection as unknown as Record<string, unknown>,
            createdAt: '2026-04-22T00:00:00.000Z',
            updatedAt: '2026-04-22T00:00:00.000Z',
          },
          repository: installation.repository,
          commentProjection,
          parentAggregateId: 'work_item_001',
        },
      ],
    });

    expect(result.deliveries[0]?.status).toBe('failed');
    expect(result.projectionHealth.status).toBe('drifted');
    expect(result.driftAlerts[0]?.driftClass).toBe('delivery_failure');
  });
});
