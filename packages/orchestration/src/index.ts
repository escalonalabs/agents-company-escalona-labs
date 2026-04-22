import type { WorkItem } from '@escalonalabs/domain';
import {
  type DispatchSignature,
  hasNewCausalInput,
} from '@escalonalabs/kernel';

export type DispatchDecision =
  | { status: 'dispatched'; workItemId: string }
  | { status: 'withheld_no_new_causal_input'; workItemId: string }
  | { status: 'withheld_scope_conflict'; workItemId: string };

export function createDispatchDecision(input: {
  workItem: WorkItem;
  currentSignature: DispatchSignature;
  previousSignature?: DispatchSignature;
  hasScopeConflict?: boolean;
}): DispatchDecision {
  if (input.hasScopeConflict) {
    return {
      status: 'withheld_scope_conflict',
      workItemId: input.workItem.workItemId,
    };
  }

  if (
    input.previousSignature &&
    !hasNewCausalInput(input.previousSignature, input.currentSignature)
  ) {
    return {
      status: 'withheld_no_new_causal_input',
      workItemId: input.workItem.workItemId,
    };
  }

  return { status: 'dispatched', workItemId: input.workItem.workItemId };
}
