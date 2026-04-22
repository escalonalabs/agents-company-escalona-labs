export type CompanyRole =
  | 'owner'
  | 'admin'
  | 'operator'
  | 'reviewer'
  | 'viewer';
export type CompanyStatus = 'active' | 'disabled';
export type ObjectiveStatus =
  | 'draft'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'cancelled';
export type WorkItemStatus =
  | 'planned'
  | 'ready'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'escalated'
  | 'cancelled';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'valid_success'
  | 'invalid_output'
  | 'transient_failure'
  | 'permanent_failure'
  | 'cancelled';
export type ApprovalStatus = 'pending' | 'granted' | 'denied' | 'expired';
export type AggregateType =
  | 'company'
  | 'objective'
  | 'work_item'
  | 'run'
  | 'approval'
  | 'claim';
export type DomainEventType =
  | 'company.created'
  | 'objective.created'
  | 'objective.updated'
  | 'work_item.created'
  | 'work_item.updated'
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'approval.requested'
  | 'approval.updated'
  | 'claim.acquired'
  | 'claim.expired';

export interface Company {
  companyId: string;
  slug: string;
  displayName: string;
  status: CompanyStatus;
  createdAt: string;
}

export interface Objective {
  objectiveId: string;
  companyId: string;
  title: string;
  summary?: string;
  status: ObjectiveStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItem {
  workItemId: string;
  companyId: string;
  objectiveId: string;
  title: string;
  description?: string;
  status: WorkItemStatus;
  attemptBudget: number;
  requiresApproval: boolean;
  validationContractRef: string;
  scopeRef: string;
  blockingReason?: string;
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  runId: string;
  companyId: string;
  workItemId: string;
  attempt: number;
  status: RunStatus;
  executionPacketId?: string;
  summary?: string;
  failureClass?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDecision {
  approvalId: string;
  companyId: string;
  workItemId: string;
  status: ApprovalStatus;
  requestedAction: string;
  decisionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRef {
  artifactId: string;
  companyId: string;
  artifactKind: string;
  storageRef: string;
  contentHash: string;
}

export interface ProjectionHealth {
  companyId: string;
  projectionTarget: 'github' | 'control_plane';
  status: 'healthy' | 'lagging' | 'drifted';
  lastSuccessfulSyncAt?: string;
}

export interface DriftAlert {
  alertId: string;
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  severity: 'warning' | 'critical';
  summary: string;
}

export interface GitHubSyncEvent {
  syncEventId: string;
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  direction: 'outbound' | 'inbound';
  status: 'accepted' | 'failed' | 'drift_detected';
}

export interface ClaimLease {
  claimId: string;
  companyId: string;
  workItemId: string;
  scopeRef: string;
  holderRunId: string;
  leaseExpiresAt: string;
}

export interface DomainEvent<TPayload = unknown> {
  eventId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  companyId: string;
  eventType: DomainEventType;
  schemaVersion?: number;
  streamSequence?: number;
  occurredAt: string;
  payload: TPayload;
  actorRef?: string;
  commandId?: string;
  correlationId?: string;
  causationId?: string;
  causationKey?: string;
}

export interface CommandLogEntry {
  commandId: string;
  companyId: string;
  aggregateId: string;
  commandType: string;
  idempotencyKey: string;
  receivedAt: string;
  resolutionStatus: 'accepted' | 'duplicate';
  resultEventIds: string[];
}

export interface AggregateState {
  companies: Record<string, Company>;
  objectives: Record<string, Objective>;
  workItems: Record<string, WorkItem>;
  runs: Record<string, Run>;
  approvals: Record<string, ApprovalDecision>;
  claims: Record<string, ClaimLease>;
  lastEventId?: string;
}
