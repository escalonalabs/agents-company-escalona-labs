import { describe, expect, it } from 'vitest';

import type {
  ApprovalDecision,
  Company,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';

import { createGitHubSyncPlan } from './projections';

const company: Company = {
  companyId: 'company_001',
  slug: 'company-001',
  displayName: 'Company 001',
  status: 'active',
  createdAt: '2026-04-22T00:00:00.000Z',
};

describe('createGitHubSyncPlan', () => {
  it('keeps multi-repo plan items isolated by explicit repository target', () => {
    const objectiveA: Objective = {
      objectiveId: 'objective_a',
      companyId: company.companyId,
      title: 'Repo A objective',
      repositoryTarget: { owner: 'escalonalabs', name: 'repo-a', id: 11 },
      status: 'planned',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const objectiveB: Objective = {
      objectiveId: 'objective_b',
      companyId: company.companyId,
      title: 'Repo B objective',
      repositoryTarget: { owner: 'escalonalabs', name: 'repo-b', id: 22 },
      status: 'in_progress',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const workItemA: WorkItem = {
      workItemId: 'work_item_a',
      companyId: company.companyId,
      objectiveId: objectiveA.objectiveId,
      title: 'A',
      repositoryTarget: objectiveA.repositoryTarget,
      status: 'ready',
      attemptBudget: 1,
      requiresApproval: false,
      validationContractRef: 'validation.contract.default.v1',
      scopeRef: 'scope:a',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const workItemB: WorkItem = {
      workItemId: 'work_item_b',
      companyId: company.companyId,
      objectiveId: objectiveB.objectiveId,
      title: 'B',
      repositoryTarget: objectiveB.repositoryTarget,
      status: 'running',
      attemptBudget: 2,
      requiresApproval: true,
      validationContractRef: 'validation.contract.default.v1',
      scopeRef: 'scope:b',
      blockingReason: 'approval_required',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const approval: ApprovalDecision = {
      approvalId: 'approval_b',
      companyId: company.companyId,
      workItemId: workItemB.workItemId,
      status: 'pending',
      requestedAction: 'Approve repo B',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const run: Run = {
      runId: 'run_b',
      companyId: company.companyId,
      workItemId: workItemB.workItemId,
      attempt: 1,
      status: 'running',
      headSha: '0123456789abcdef0123456789abcdef01234567',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
      availableAt: '2026-04-22T00:00:00.000Z',
    };

    const plan = createGitHubSyncPlan({
      snapshot: {
        company,
        objectives: [objectiveA, objectiveB],
        workItems: [workItemA, workItemB],
        runs: [run],
        approvals: [approval],
        latestEventByAggregate: {
          'objective:objective_a': 'evt_objective_a',
          'objective:objective_b': 'evt_objective_b',
          'work_item:work_item_a': 'evt_work_item_a',
          'work_item:work_item_b': 'evt_work_item_b',
          'approval:approval_b': 'evt_approval_b',
          'run:run_b': 'evt_run_b',
        },
      },
      bindings: [],
    });

    const repoAItems = plan.filter((item) => item.repository.name === 'repo-a');
    const repoBItems = plan.filter((item) => item.repository.name === 'repo-b');

    expect(repoAItems).toHaveLength(2);
    expect(
      repoAItems.every((item) =>
        ['objective_a', 'work_item_a'].includes(item.delivery.aggregateId),
      ),
    ).toBe(true);

    expect(repoBItems).toHaveLength(5);
    expect(repoBItems.map((item) => item.delivery.aggregateId)).toEqual(
      expect.arrayContaining([
        'objective_b',
        'work_item_b',
        'approval_b',
        'run_b',
      ]),
    );
  });

  it('uses the default repository when an aggregate has no explicit target', () => {
    const objective: Objective = {
      objectiveId: 'objective_default',
      companyId: company.companyId,
      title: 'Default repo objective',
      status: 'planned',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const workItem: WorkItem = {
      workItemId: 'work_item_default',
      companyId: company.companyId,
      objectiveId: objective.objectiveId,
      title: 'Default work item',
      status: 'ready',
      attemptBudget: 1,
      requiresApproval: false,
      validationContractRef: 'validation.contract.default.v1',
      scopeRef: 'scope:default',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };

    const plan = createGitHubSyncPlan({
      snapshot: {
        company,
        objectives: [objective],
        workItems: [workItem],
        runs: [],
        approvals: [],
        latestEventByAggregate: {
          'objective:objective_default': 'evt_objective_default',
          'work_item:work_item_default': 'evt_work_item_default',
        },
      },
      bindings: [],
      defaultRepository: {
        owner: 'escalonalabs',
        name: 'repo-default',
        id: 33,
      },
    });

    expect(plan).toHaveLength(2);
    expect(plan.every((item) => item.repository.name === 'repo-default')).toBe(
      true,
    );
  });
});
