import type {
  AggregateState,
  ApprovalDecision,
  ClaimLease,
  Company,
  DomainEvent,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';

export type DispatchSignature = {
  workItemId: string;
  blockingReason: string | null;
  packetHash: string | null;
  dependencyHash: string | null;
  failureClass: string | null;
};

export const createInitialState = (): AggregateState => ({
  companies: {},
  objectives: {},
  workItems: {},
  runs: {},
  approvals: {},
  claims: {},
});

const asCompany = <T extends Company>(value: T) => value;
const asObjective = <T extends Objective>(value: T) => value;
const asWorkItem = <T extends WorkItem>(value: T) => value;
const asRun = <T extends Run>(value: T) => value;
const asApproval = <T extends ApprovalDecision>(value: T) => value;
const asClaim = <T extends ClaimLease>(value: T) => value;

export function applyEvent(
  currentState: AggregateState,
  event: DomainEvent,
): AggregateState {
  const nextState: AggregateState = {
    ...currentState,
    companies: { ...currentState.companies },
    objectives: { ...currentState.objectives },
    workItems: { ...currentState.workItems },
    runs: { ...currentState.runs },
    approvals: { ...currentState.approvals },
    claims: { ...currentState.claims },
    lastEventId: event.eventId,
  };

  switch (event.eventType) {
    case 'company.created':
    case 'company.updated':
      nextState.companies[event.aggregateId] = asCompany(
        event.payload as Company,
      );
      return nextState;
    case 'objective.created':
    case 'objective.updated':
      nextState.objectives[event.aggregateId] = asObjective(
        event.payload as Objective,
      );
      return nextState;
    case 'work_item.created':
    case 'work_item.updated':
      nextState.workItems[event.aggregateId] = asWorkItem(
        event.payload as WorkItem,
      );
      return nextState;
    case 'run.started':
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
      nextState.runs[event.aggregateId] = asRun(event.payload as Run);
      return nextState;
    case 'approval.requested':
    case 'approval.updated':
      nextState.approvals[event.aggregateId] = asApproval(
        event.payload as ApprovalDecision,
      );
      return nextState;
    case 'claim.acquired':
    case 'claim.expired':
      nextState.claims[event.aggregateId] = asClaim(
        event.payload as ClaimLease,
      );
      return nextState;
    default:
      return nextState;
  }
}

export function replay(events: DomainEvent[]): AggregateState {
  return events.reduce(applyEvent, createInitialState());
}

export function hasNewCausalInput(
  previous: DispatchSignature,
  next: DispatchSignature,
): boolean {
  return (
    previous.workItemId !== next.workItemId ||
    previous.blockingReason !== next.blockingReason ||
    previous.packetHash !== next.packetHash ||
    previous.dependencyHash !== next.dependencyHash ||
    previous.failureClass !== next.failureClass
  );
}
