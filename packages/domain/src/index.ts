export type CompanyRole =
  | 'owner'
  | 'admin'
  | 'operator'
  | 'reviewer'
  | 'viewer';
export type CompanyStatus = 'active' | 'disabled';
export type CompanyBetaPhase = 'internal_alpha' | 'controlled_beta';
export type CompanyBetaEnrollmentStatus =
  | 'invited'
  | 'active'
  | 'suspended'
  | 'graduated';
export type CompanyInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'expired';
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
  | 'company.updated'
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
  betaPhase?: CompanyBetaPhase;
  betaEnrollmentStatus?: CompanyBetaEnrollmentStatus;
  betaNotes?: string;
  betaUpdatedAt?: string;
  createdAt: string;
}

export interface RepositoryTarget {
  owner: string;
  name: string;
  id?: number;
}

export interface User {
  userId: string;
  email: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMembership {
  companyId: string;
  userId: string;
  role: CompanyRole;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyInvitation {
  invitationId: string;
  companyId: string;
  email: string;
  role: CompanyRole;
  status: CompanyInvitationStatus;
  invitedByUserId?: string;
  acceptedByUserId?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
}

export interface AuthSession {
  sessionId: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface Objective {
  objectiveId: string;
  companyId: string;
  title: string;
  summary?: string;
  repositoryTarget?: RepositoryTarget;
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
  repositoryTarget?: RepositoryTarget;
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
  headSha?: string;
  summary?: string;
  failureClass?: string;
  availableAt?: string;
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

export type MemorySourceKind =
  | 'run'
  | 'approval'
  | 'github_inbound'
  | 'artifact'
  | 'ledger_event';
export type MemoryCandidateClass =
  | 'workflow_convention'
  | 'integration_constraint'
  | 'operator_preference'
  | 'failure_signature';
export type MemoryRetentionClass = 'operational' | 'knowledge' | 'audit';
export type MemoryCandidateStatus =
  | 'pending_review'
  | 'promoted'
  | 'rejected'
  | 'quarantined';
export type MemoryStatus =
  | 'active'
  | 'expired'
  | 'superseded'
  | 'revoked'
  | 'quarantined';
export type MemoryInvalidationReason =
  | 'expired'
  | 'superseded'
  | 'revoked'
  | 'quarantined';
export type ProvenanceNodeType =
  | 'ledger_event'
  | 'artifact'
  | 'run'
  | 'approval'
  | 'github_inbound'
  | 'memory_candidate'
  | 'memory';
export type ProvenanceEdgeType =
  | 'derived_from'
  | 'validated_by'
  | 'supersedes'
  | 'invalidates'
  | 'approved_by';
export type MemoryFreshness = 'fresh' | 'stale' | 'uncertain';
export type MemoryRetrievalOutcome = 'returned' | 'withheld';

export interface MemoryCandidate {
  candidateId: string;
  companyId: string;
  sourceKind: MemorySourceKind;
  sourceRef: string;
  aggregateType?: string;
  aggregateId?: string;
  objectiveId?: string;
  scopeRef?: string;
  candidateClass: MemoryCandidateClass;
  retentionClass: MemoryRetentionClass;
  summary: string;
  detail?: string;
  confidence: number;
  freshnessExpiresAt?: string;
  status: MemoryCandidateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeMemory {
  memoryId: string;
  companyId: string;
  candidateId: string;
  aggregateType?: string;
  aggregateId?: string;
  objectiveId?: string;
  scopeRef?: string;
  candidateClass: MemoryCandidateClass;
  retentionClass: MemoryRetentionClass;
  summary: string;
  detail?: string;
  confidence: number;
  freshnessExpiresAt?: string;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  invalidatedAt?: string;
  invalidationReason?: MemoryInvalidationReason;
}

export interface ProvenanceEdge {
  edgeId: string;
  companyId: string;
  sourceNodeType: ProvenanceNodeType;
  sourceNodeId: string;
  targetNodeType: ProvenanceNodeType;
  targetNodeId: string;
  edgeType: ProvenanceEdgeType;
  createdAt: string;
}

export interface MemoryRetrievalAudit {
  retrievalId: string;
  companyId: string;
  memoryId?: string;
  scopeRef?: string;
  objectiveId?: string;
  queryText?: string;
  freshness: MemoryFreshness;
  outcome: MemoryRetrievalOutcome;
  reason?: string;
  relevanceScore: number;
  createdAt: string;
}

export interface MemoryEvaluation {
  companyId: string;
  totalCandidates: number;
  totalMemories: number;
  activeMemories: number;
  invalidatedMemories: number;
  quarantinedMemories: number;
  retrievalCount: number;
  returnedRetrievalCount: number;
  withheldRetrievalCount: number;
  staleRetrievalRate: number;
  contaminationRate: number;
  provenanceCompleteness: number;
  overrideFrequency: number;
}

export interface ProjectionHealth {
  companyId: string;
  projectionTarget: 'github' | 'control_plane';
  status: 'healthy' | 'lagging' | 'drifted';
  lastSuccessfulSyncAt?: string;
  lastAttemptAt?: string;
  openDriftCount?: number;
  lastError?: string;
}

export interface DriftAlert {
  alertId: string;
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  severity: 'info' | 'warn' | 'high' | 'critical';
  summary: string;
  githubObjectRef?: string;
  driftClass?: string;
  sourceEventId?: string;
  observedAt?: string;
  repairStatus?: 'open' | 'repaired' | 'ignored';
  notes?: string;
}

export interface GitHubSyncEvent {
  syncEventId: string;
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  direction: 'outbound' | 'inbound';
  status: 'queued' | 'accepted' | 'failed' | 'drift_detected';
  actionType?: string;
  deliveryKey?: string;
  githubObjectRef?: string;
  sourceEventId?: string;
  attemptCount?: number;
  lastError?: string;
  appliedAt?: string;
}

export interface OperatorTimelineEvent {
  eventId: string;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  summary: string;
  severity: 'info' | 'warn' | 'high' | 'critical';
  actorRef?: string;
  source: 'ledger' | 'github_inbound' | 'drift';
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
