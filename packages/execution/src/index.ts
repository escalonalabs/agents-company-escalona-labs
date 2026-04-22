export interface ExecutionPacket {
  executionPacketId: string;
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

  if (!result.runId) issues.push('runId is required');
  if (!result.executionPacketId) issues.push('executionPacketId is required');
  if (!result.summary) issues.push('summary is required');
  if (!result.validatorRef) issues.push('validatorRef is required');

  return { ok: issues.length === 0, issues };
}
