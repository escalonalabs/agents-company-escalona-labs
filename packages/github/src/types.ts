import type {
  ApprovalDecision,
  Company,
  DriftAlert,
  GitHubSyncEvent,
  Objective,
  ProjectionHealth,
  Run,
  WorkItem,
} from '@escalonalabs/domain';

export type GitHubObjectType = 'issue' | 'comment' | 'check_run';

export type GitHubActionType =
  | 'create_issue'
  | 'update_issue'
  | 'add_comment'
  | 'update_comment'
  | 'create_check_run'
  | 'update_check_run'
  | 'post_drift_note';

export interface GitHubRepositoryRef {
  owner: string;
  name: string;
  id?: number;
}

export interface GitHubInstallationRef {
  companyId: string;
  installationId: number;
  accountLogin: string;
  repository: GitHubRepositoryRef;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubProjectionBinding {
  bindingId: string;
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  githubObjectType: GitHubObjectType;
  githubObjectId: string;
  githubObjectNumber?: number;
  repository: GitHubRepositoryRef;
  metadataVersion: string;
  lastSourceEventId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubProjectionMetadata {
  projectionVersion: string;
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  sourceEventId: string;
  projectionDeliveryId: string;
}

export interface GitHubIssueProjection {
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  metadata: GitHubProjectionMetadata;
}

export interface GitHubCommentProjection {
  body: string;
  metadata: GitHubProjectionMetadata;
}

export interface GitHubCheckRunProjection {
  name: string;
  headSha?: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'timed_out'
    | 'action_required';
  summary: string;
  text?: string;
  externalId: string;
  metadata: GitHubProjectionMetadata;
}

export interface GitHubProjectionDelivery {
  projectionDeliveryId: string;
  projectionName: 'github';
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  sourceEventId: string;
  githubObjectType: GitHubObjectType;
  actionType: GitHubActionType;
  deliveryKey: string;
  status: 'queued' | 'applied' | 'failed' | 'drift_detected';
  attemptCount: number;
  githubObjectRef?: string;
  lastError?: string;
  payload: Record<string, unknown>;
  appliedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubProjectionPlanItem {
  delivery: GitHubProjectionDelivery;
  repository: GitHubRepositoryRef;
  issueProjection?: GitHubIssueProjection;
  commentProjection?: GitHubCommentProjection;
  checkRunProjection?: GitHubCheckRunProjection;
  parentAggregateId?: string;
}

export interface GitHubIssueRecord {
  id: string;
  number: number;
  repository: GitHubRepositoryRef;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
}

export interface GitHubCommentRecord {
  id: string;
  repository: GitHubRepositoryRef;
  issueNumber: number;
  body: string;
}

export interface GitHubCheckRunRecord {
  id: string;
  repository: GitHubRepositoryRef;
  name: string;
  headSha?: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: GitHubCheckRunProjection['conclusion'];
  summary: string;
  text?: string;
  externalId: string;
}

export interface GitHubTransport {
  getIssue(input: {
    repository: GitHubRepositoryRef;
    issueNumber: number;
  }): Promise<GitHubIssueRecord | null>;
  createIssue(input: {
    repository: GitHubRepositoryRef;
    projection: GitHubIssueProjection;
  }): Promise<GitHubIssueRecord>;
  updateIssue(input: {
    repository: GitHubRepositoryRef;
    issueNumber: number;
    projection: GitHubIssueProjection;
  }): Promise<GitHubIssueRecord>;
  getComment(input: {
    repository: GitHubRepositoryRef;
    commentId: string;
  }): Promise<GitHubCommentRecord | null>;
  createComment(input: {
    repository: GitHubRepositoryRef;
    issueNumber: number;
    projection: GitHubCommentProjection;
  }): Promise<GitHubCommentRecord>;
  updateComment(input: {
    repository: GitHubRepositoryRef;
    commentId: string;
    projection: GitHubCommentProjection;
  }): Promise<GitHubCommentRecord>;
  getCheckRun(input: {
    repository: GitHubRepositoryRef;
    checkRunId: string;
  }): Promise<GitHubCheckRunRecord | null>;
  createCheckRun(input: {
    repository: GitHubRepositoryRef;
    projection: GitHubCheckRunProjection;
  }): Promise<GitHubCheckRunRecord>;
  updateCheckRun(input: {
    repository: GitHubRepositoryRef;
    checkRunId: string;
    projection: GitHubCheckRunProjection;
  }): Promise<GitHubCheckRunRecord>;
}

export interface GitHubCommandIntent {
  commandType:
    | 'approval.grant'
    | 'approval.deny'
    | 'work_item.cancel'
    | 'work_item.requeue';
  aggregateType: string;
  aggregateId: string;
}

export interface GitHubInboundEventRecord {
  inboundEventId: string;
  githubDeliveryId: string;
  githubEventName: string;
  action?: string;
  companyId?: string;
  aggregateType?: string;
  aggregateId?: string;
  classification:
    | 'accepted_intent'
    | 'benign_divergence'
    | 'authoritative_conflict'
    | 'missing_linkage'
    | 'ignored';
  status:
    | 'recorded'
    | 'requires_review'
    | 'reproject_required'
    | 'applied'
    | 'rejected';
  proposedCommand?: GitHubCommandIntent;
  notes?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface GitHubDriftCandidate {
  driftClass:
    | 'projection_lag'
    | 'delivery_failure'
    | 'unauthorized_mutation'
    | 'missing_object'
    | 'metadata_mismatch'
    | 'policy_mismatch';
  severity: DriftAlert['severity'];
  summary: string;
  githubObjectRef?: string;
  notes?: string;
}

export interface GitHubRuntimeSnapshot {
  company: Company;
  objectives: Objective[];
  workItems: WorkItem[];
  runs: Run[];
  approvals: ApprovalDecision[];
  latestEventByAggregate: Record<string, string>;
}

export interface GitHubSyncSummary {
  syncEvents: GitHubSyncEvent[];
  projectionHealth: ProjectionHealth;
  driftAlerts: DriftAlert[];
}
