import { describe, expect, it } from 'vitest';

import type {
  ApprovalDecision,
  Objective,
  WorkItem,
} from '@escalonalabs/domain';

import {
  createDispatchDecision,
  createObjectivePlan,
  deriveObjectiveStatus,
  mapTaskResultToWorkItemStatus,
  summarizeObjectiveGraph,
} from './index';

const baseObjective: Objective = {
  objectiveId: 'objective_001',
  companyId: 'company_001',
  title: 'Ship runtime',
  status: 'planned',
  createdAt: '2026-04-22T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z',
};

const baseWorkItem: WorkItem = {
  workItemId: 'work_item_001',
  companyId: 'company_001',
  objectiveId: 'objective_001',
  title: 'Implement dispatch',
  status: 'ready',
  attemptBudget: 2,
  requiresApproval: false,
  validationContractRef: 'validation.contract.default.v1',
  scopeRef: 'scope:runtime',
  createdAt: '2026-04-22T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z',
};

describe('orchestration helpers', () => {
  it('creates a default objective plan when no work items are provided', () => {
    const plan = createObjectivePlan({ objectiveTitle: 'Kernel v1' });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      title: 'Execute Kernel v1',
      attemptBudget: 2,
      requiresApproval: false,
      validationContractRef: 'validation.contract.default.v1',
      scopeRef: 'scope:default',
    });
  });

  it('derives blocked and completed objective status from work items', () => {
    expect(
      deriveObjectiveStatus([
        {
          ...baseWorkItem,
          status: 'blocked',
          blockingReason: 'approval_required',
        },
      ]),
    ).toBe('blocked');

    expect(
      deriveObjectiveStatus([
        { ...baseWorkItem, status: 'completed' },
        { ...baseWorkItem, workItemId: 'work_item_002', status: 'completed' },
      ]),
    ).toBe('completed');
  });

  it('withholds dispatch when approval is still pending', () => {
    const gatedWorkItem: WorkItem = {
      ...baseWorkItem,
      requiresApproval: true,
      status: 'blocked',
      blockingReason: 'approval_required',
    };
    const approval: ApprovalDecision = {
      approvalId: 'approval_001',
      companyId: gatedWorkItem.companyId,
      workItemId: gatedWorkItem.workItemId,
      status: 'pending',
      requestedAction: 'Approve dispatch',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };

    const decision = createDispatchDecision({
      workItem: gatedWorkItem,
      approval,
      currentSignature: {
        workItemId: gatedWorkItem.workItemId,
        blockingReason: gatedWorkItem.blockingReason ?? null,
        packetHash: 'packet-1',
        dependencyHash: 'dep-1',
        failureClass: null,
      },
    });

    expect(decision.status).toBe('withheld_missing_approval');
  });

  it('suppresses dispatch when there is no new causal input', () => {
    const decision = createDispatchDecision({
      workItem: baseWorkItem,
      currentSignature: {
        workItemId: baseWorkItem.workItemId,
        blockingReason: null,
        packetHash: 'packet-1',
        dependencyHash: 'dep-1',
        failureClass: 'transient_failure',
      },
      previousSignature: {
        workItemId: baseWorkItem.workItemId,
        blockingReason: null,
        packetHash: 'packet-1',
        dependencyHash: 'dep-1',
        failureClass: 'transient_failure',
      },
    });

    expect(decision.status).toBe('withheld_no_new_causal_input');
  });

  it('maps task results into work item states and graph summary counts', () => {
    expect(
      mapTaskResultToWorkItemStatus({ resultStatus: 'valid_success' }),
    ).toEqual({ workItemStatus: 'completed' });
    expect(
      mapTaskResultToWorkItemStatus({ resultStatus: 'invalid_output' }),
    ).toEqual({
      workItemStatus: 'blocked',
      blockingReason: 'invalid_output',
    });

    const summary = summarizeObjectiveGraph(baseObjective, [
      { ...baseWorkItem, status: 'completed' },
      {
        ...baseWorkItem,
        workItemId: 'work_item_002',
        status: 'blocked',
        requiresApproval: true,
        blockingReason: 'approval_required',
      },
    ]);

    expect(summary).toMatchObject({
      objectiveId: baseObjective.objectiveId,
      workItemCount: 2,
      completedCount: 1,
      blockedCount: 1,
      pendingApprovalCount: 1,
    });
  });
});
