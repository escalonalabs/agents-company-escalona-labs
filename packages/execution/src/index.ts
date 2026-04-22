export interface ExecutionPacket {
  executionPacketId: string;
  companyId: string;
  workItemId: string;
  runId: string;
  assignedAgentId: string;
  objectiveContext: string;
  toolAllowlist: string[];
  scopeAllowlist: string[];
  inputArtifactRefs: string[];
  expectedResultSchemaRef: string;
  policySnapshotRef: string;
  createdAt: string;
}

export type TaskResultStatus =
  | 'valid_success'
  | 'invalid_output'
  | 'transient_failure'
  | 'permanent_failure'
  | 'cancelled';

export interface TaskResult {
  runId: string;
  executionPacketId: string;
  resultStatus: TaskResultStatus;
  resultSchemaVersion: number;
  artifactRefs: string[];
  summary: string;
  structuredOutput: Record<string, unknown>;
  failureClass?: string;
  validatorRef: string;
}

export function validateTaskResult(result: TaskResult): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const allowedStatuses: TaskResultStatus[] = [
    'valid_success',
    'invalid_output',
    'transient_failure',
    'permanent_failure',
    'cancelled',
  ];

  if (!result.runId) issues.push('runId is required');
  if (!result.executionPacketId) issues.push('executionPacketId is required');
  if (!allowedStatuses.includes(result.resultStatus)) {
    issues.push('resultStatus must be a supported task result status');
  }
  if (!Number.isInteger(result.resultSchemaVersion)) {
    issues.push('resultSchemaVersion must be an integer');
  }
  if (!result.summary) issues.push('summary is required');
  if (!result.validatorRef) issues.push('validatorRef is required');

  return { ok: issues.length === 0, issues };
}

export function createExecutionPacket(input: {
  companyId: string;
  executionPacketId: string;
  workItemId: string;
  runId: string;
  assignedAgentId: string;
  objectiveContext: string;
  toolAllowlist?: string[];
  scopeAllowlist?: string[];
  inputArtifactRefs?: string[];
  expectedResultSchemaRef?: string;
  policySnapshotRef?: string;
  createdAt: string;
}): ExecutionPacket {
  return {
    executionPacketId: input.executionPacketId,
    companyId: input.companyId,
    workItemId: input.workItemId,
    runId: input.runId,
    assignedAgentId: input.assignedAgentId,
    objectiveContext: input.objectiveContext,
    toolAllowlist: input.toolAllowlist ?? ['filesystem.read', 'github.read'],
    scopeAllowlist: input.scopeAllowlist ?? [],
    inputArtifactRefs: input.inputArtifactRefs ?? [],
    expectedResultSchemaRef:
      input.expectedResultSchemaRef ?? 'task-result.schema.v1',
    policySnapshotRef: input.policySnapshotRef ?? 'policy.default.v1',
    createdAt: input.createdAt,
  };
}

export function mapTaskResultToRunStatus(
  resultStatus: TaskResultStatus,
): TaskResultStatus {
  return resultStatus;
}
