import type {
  ApprovalDecision,
  Objective,
  ObjectiveStatus,
  WorkItem,
  WorkItemStatus,
} from '@escalonalabs/domain';
import {
  type DispatchSignature,
  hasNewCausalInput,
} from '@escalonalabs/kernel';

export type DispatchDecision =
  | { status: 'dispatched'; workItemId: string }
  | {
      status: 'withheld_missing_approval';
      workItemId: string;
      blockingReason: 'approval_required';
    }
  | {
      status: 'withheld_no_new_causal_input';
      workItemId: string;
      blockingReason: 'no_new_causal_input';
    }
  | {
      status: 'withheld_scope_conflict';
      workItemId: string;
      blockingReason: 'scope_conflict';
    }
  | {
      status: 'withheld_retry_budget_exhausted';
      workItemId: string;
      blockingReason: 'attempt_budget_exhausted';
    }
  | {
      status: 'escalated';
      workItemId: string;
      blockingReason: 'no_new_causal_input';
    };

export interface PlannedWorkItemInput {
  title: string;
  description?: string;
  attemptBudget?: number;
  requiresApproval?: boolean;
  validationContractRef?: string;
  scopeRef?: string;
}

export interface PlannedWorkItemDraft extends PlannedWorkItemInput {
  attemptBudget: number;
  requiresApproval: boolean;
  validationContractRef: string;
  scopeRef: string;
}

export function createObjectivePlan(input: {
  objectiveTitle: string;
  requestedWorkItems?: PlannedWorkItemInput[];
}): PlannedWorkItemDraft[] {
  if (input.requestedWorkItems && input.requestedWorkItems.length > 0) {
    return input.requestedWorkItems.map((workItem, index) => ({
      ...workItem,
      attemptBudget: workItem.attemptBudget ?? 2,
      requiresApproval: workItem.requiresApproval ?? false,
      validationContractRef:
        workItem.validationContractRef ?? `validation.contract.${index + 1}.v1`,
      scopeRef: workItem.scopeRef ?? `scope:${index + 1}`,
    }));
  }

  return [
    {
      title: `Execute ${input.objectiveTitle}`,
      description: `Default planned work item for objective: ${input.objectiveTitle}`,
      attemptBudget: 2,
      requiresApproval: false,
      validationContractRef: 'validation.contract.default.v1',
      scopeRef: 'scope:default',
    },
  ];
}

export function deriveObjectiveStatus(workItems: WorkItem[]): ObjectiveStatus {
  if (workItems.length === 0) {
    return 'draft';
  }

  if (workItems.every((workItem) => workItem.status === 'completed')) {
    return 'completed';
  }

  if (workItems.every((workItem) => workItem.status === 'cancelled')) {
    return 'cancelled';
  }

  if (workItems.some((workItem) => workItem.status === 'running')) {
    return 'in_progress';
  }

  if (
    workItems.some((workItem) =>
      ['ready', 'planned', 'completed'].includes(workItem.status),
    )
  ) {
    const hasStarted = workItems.some((workItem) =>
      ['running', 'completed', 'blocked', 'escalated', 'cancelled'].includes(
        workItem.status,
      ),
    );

    return hasStarted ? 'in_progress' : 'planned';
  }

  if (
    workItems.some((workItem) =>
      ['blocked', 'escalated', 'cancelled'].includes(workItem.status),
    )
  ) {
    return 'blocked';
  }

  return 'planned';
}

export function requiresApprovalBeforeDispatch(
  workItem: WorkItem,
  approval?: ApprovalDecision,
): boolean {
  if (!workItem.requiresApproval) {
    return false;
  }

  return approval?.status !== 'granted';
}

export function isRetryBudgetExhausted(input: {
  attemptsConsumed: number;
  attemptBudget: number;
}): boolean {
  return input.attemptsConsumed >= Math.max(input.attemptBudget, 0);
}

export function shouldWithholdForNoNewCausalInput(input: {
  currentSignature: DispatchSignature;
  previousSignature?: DispatchSignature;
}): boolean {
  if (!input.previousSignature) {
    return false;
  }

  return !hasNewCausalInput(input.previousSignature, input.currentSignature);
}

export function mapTaskResultToWorkItemStatus(input: {
  resultStatus:
    | 'valid_success'
    | 'invalid_output'
    | 'transient_failure'
    | 'permanent_failure'
    | 'cancelled';
  attemptsConsumed?: number;
  attemptBudget?: number;
}): {
  workItemStatus: WorkItemStatus;
  blockingReason?: string;
} {
  switch (input.resultStatus) {
    case 'valid_success':
      return { workItemStatus: 'completed' };
    case 'transient_failure':
      if (
        typeof input.attemptsConsumed === 'number' &&
        typeof input.attemptBudget === 'number' &&
        isRetryBudgetExhausted({
          attemptsConsumed: input.attemptsConsumed,
          attemptBudget: input.attemptBudget,
        })
      ) {
        return {
          workItemStatus: 'blocked',
          blockingReason: 'attempt_budget_exhausted',
        };
      }

      return {
        workItemStatus: 'ready',
        blockingReason: 'retry_available',
      };
    case 'cancelled':
      return {
        workItemStatus: 'cancelled',
        blockingReason: 'cancelled_by_operator',
      };
    case 'invalid_output':
      return {
        workItemStatus: 'blocked',
        blockingReason: 'invalid_output',
      };
    case 'permanent_failure':
      return {
        workItemStatus: 'blocked',
        blockingReason: 'permanent_failure',
      };
  }
}

export function createDispatchDecision(input: {
  workItem: WorkItem;
  approval?: ApprovalDecision;
  currentSignature: DispatchSignature;
  previousSignature?: DispatchSignature;
  hasScopeConflict?: boolean;
  attemptsConsumed?: number;
  escalateOnNoNewCausalInput?: boolean;
}): DispatchDecision {
  if (requiresApprovalBeforeDispatch(input.workItem, input.approval)) {
    return {
      status: 'withheld_missing_approval',
      workItemId: input.workItem.workItemId,
      blockingReason: 'approval_required',
    };
  }

  if (input.hasScopeConflict) {
    return {
      status: 'withheld_scope_conflict',
      workItemId: input.workItem.workItemId,
      blockingReason: 'scope_conflict',
    };
  }

  if (
    typeof input.attemptsConsumed === 'number' &&
    isRetryBudgetExhausted({
      attemptsConsumed: input.attemptsConsumed,
      attemptBudget: input.workItem.attemptBudget,
    })
  ) {
    return {
      status: 'withheld_retry_budget_exhausted',
      workItemId: input.workItem.workItemId,
      blockingReason: 'attempt_budget_exhausted',
    };
  }

  if (
    shouldWithholdForNoNewCausalInput({
      currentSignature: input.currentSignature,
      previousSignature: input.previousSignature,
    })
  ) {
    if (input.escalateOnNoNewCausalInput) {
      return {
        status: 'escalated',
        workItemId: input.workItem.workItemId,
        blockingReason: 'no_new_causal_input',
      };
    }

    return {
      status: 'withheld_no_new_causal_input',
      workItemId: input.workItem.workItemId,
      blockingReason: 'no_new_causal_input',
    };
  }

  return { status: 'dispatched', workItemId: input.workItem.workItemId };
}

export function summarizeObjectiveGraph(
  objective: Objective,
  workItems: WorkItem[],
): {
  objectiveId: string;
  title: string;
  status: ObjectiveStatus;
  workItemCount: number;
  completedCount: number;
  blockedCount: number;
  pendingApprovalCount: number;
} {
  return {
    objectiveId: objective.objectiveId,
    title: objective.title,
    status: objective.status,
    workItemCount: workItems.length,
    completedCount: workItems.filter(
      (workItem) => workItem.status === 'completed',
    ).length,
    blockedCount: workItems.filter((workItem) =>
      ['blocked', 'escalated', 'cancelled'].includes(workItem.status),
    ).length,
    pendingApprovalCount: workItems.filter(
      (workItem) => workItem.requiresApproval && workItem.status === 'blocked',
    ).length,
  };
}
