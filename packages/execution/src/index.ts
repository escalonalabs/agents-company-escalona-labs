export const EXECUTION_PACKET_SCHEMA_VERSION = 2;

export const TOOL_KINDS = [
  'http',
  'file/artifact',
  'internal',
  'shell',
  'browser',
] as const;

export const EFFECT_STATUSES = [
  'succeeded',
  'failed_transient',
  'failed_permanent',
  'cancelled',
  'timed_out',
] as const;

export type ValidationResult = {
  ok: boolean;
  issues: string[];
};

export type ToolKind = (typeof TOOL_KINDS)[number];

export type EffectStatus = (typeof EFFECT_STATUSES)[number];

export interface ToolRequestEnvelope {
  toolCallId: string;
  runId: string;
  executionPacketId: string;
  toolKind: ToolKind;
  toolName: string;
  toolVersion: string;
  capabilityRef: string;
  scopeRef: string;
  timeoutMs: number;
  requestPayload: Record<string, unknown>;
  requestedAt: string;
}

export interface EffectEnvelope {
  toolCallId: string;
  runId: string;
  effectStatus: EffectStatus;
  startedAt: string;
  completedAt: string;
  artifactRefs: string[];
  resultPayload: Record<string, unknown>;
  errorClass?: string;
  errorMessage?: string;
}

export interface ExecutorResult {
  toolRequest: ToolRequestEnvelope;
  effect: EffectEnvelope;
}

export interface ExecutionPacket {
  executionPacketId: string;
  packetSchemaVersion: number;
  companyId: string;
  workItemId: string;
  runId: string;
  assignedAgentId: string;
  objectiveContext: string;
  toolAllowlist: string[];
  authorizedToolRequests: ToolRequestEnvelope[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneToolRequestEnvelope(
  request: ToolRequestEnvelope,
): ToolRequestEnvelope {
  return {
    toolCallId: request.toolCallId,
    runId: request.runId,
    executionPacketId: request.executionPacketId,
    toolKind: request.toolKind,
    toolName: request.toolName,
    toolVersion: request.toolVersion,
    capabilityRef: request.capabilityRef,
    scopeRef: request.scopeRef,
    timeoutMs: request.timeoutMs,
    requestPayload: { ...request.requestPayload },
    requestedAt: request.requestedAt,
  };
}

export function createToolRequestEnvelope(input: {
  toolCallId: string;
  runId: string;
  executionPacketId: string;
  toolKind: ToolKind;
  toolName: string;
  toolVersion?: string;
  capabilityRef: string;
  scopeRef: string;
  timeoutMs?: number;
  requestPayload?: Record<string, unknown>;
  requestedAt: string;
}): ToolRequestEnvelope {
  return {
    toolCallId: input.toolCallId,
    runId: input.runId,
    executionPacketId: input.executionPacketId,
    toolKind: input.toolKind,
    toolName: input.toolName,
    toolVersion: input.toolVersion ?? '1.0.0',
    capabilityRef: input.capabilityRef,
    scopeRef: input.scopeRef,
    timeoutMs: input.timeoutMs ?? 30_000,
    requestPayload: { ...(input.requestPayload ?? {}) },
    requestedAt: input.requestedAt,
  };
}

export function createEffectEnvelope(input: {
  toolCallId: string;
  runId: string;
  effectStatus: EffectStatus;
  startedAt: string;
  completedAt: string;
  artifactRefs?: string[];
  resultPayload?: Record<string, unknown>;
  errorClass?: string;
  errorMessage?: string;
}): EffectEnvelope {
  return {
    toolCallId: input.toolCallId,
    runId: input.runId,
    effectStatus: input.effectStatus,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    artifactRefs: [...(input.artifactRefs ?? [])],
    resultPayload: { ...(input.resultPayload ?? {}) },
    errorClass: input.errorClass,
    errorMessage: input.errorMessage,
  };
}

export function validateToolRequestEnvelope(
  request: ToolRequestEnvelope,
): ValidationResult {
  const issues: string[] = [];

  if (!hasText(request.toolCallId)) issues.push('toolCallId is required');
  if (!hasText(request.runId)) issues.push('runId is required');
  if (!hasText(request.executionPacketId)) {
    issues.push('executionPacketId is required');
  }
  if (!TOOL_KINDS.includes(request.toolKind)) {
    issues.push('toolKind must be a supported tool kind');
  }
  if (!hasText(request.toolName)) issues.push('toolName is required');
  if (!hasText(request.toolVersion)) issues.push('toolVersion is required');
  if (!hasText(request.capabilityRef)) issues.push('capabilityRef is required');
  if (!hasText(request.scopeRef)) issues.push('scopeRef is required');
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    issues.push('timeoutMs must be a positive integer');
  }
  if (!isRecord(request.requestPayload)) {
    issues.push('requestPayload must be a plain object');
  }
  if (!hasText(request.requestedAt)) issues.push('requestedAt is required');

  return { ok: issues.length === 0, issues };
}

export function validateEffectEnvelope(
  effect: EffectEnvelope,
): ValidationResult {
  const issues: string[] = [];

  if (!hasText(effect.toolCallId)) issues.push('toolCallId is required');
  if (!hasText(effect.runId)) issues.push('runId is required');
  if (!EFFECT_STATUSES.includes(effect.effectStatus)) {
    issues.push('effectStatus must be a supported effect status');
  }
  if (!hasText(effect.startedAt)) issues.push('startedAt is required');
  if (!hasText(effect.completedAt)) issues.push('completedAt is required');
  if (!Array.isArray(effect.artifactRefs)) {
    issues.push('artifactRefs must be an array');
  }
  if (!isRecord(effect.resultPayload)) {
    issues.push('resultPayload must be a plain object');
  }
  if (effect.effectStatus !== 'succeeded' && !hasText(effect.errorMessage)) {
    issues.push('errorMessage is required for non-success effect statuses');
  }

  return { ok: issues.length === 0, issues };
}

export function validateExecutorResult(
  result: ExecutorResult,
): ValidationResult {
  const issues: string[] = [];
  const requestValidation = validateToolRequestEnvelope(result.toolRequest);
  const effectValidation = validateEffectEnvelope(result.effect);

  issues.push(...requestValidation.issues, ...effectValidation.issues);

  if (result.toolRequest.toolCallId !== result.effect.toolCallId) {
    issues.push('toolCallId must match between tool request and effect');
  }
  if (result.toolRequest.runId !== result.effect.runId) {
    issues.push('runId must match between tool request and effect');
  }

  return { ok: issues.length === 0, issues };
}

export function validateTaskResult(result: TaskResult): ValidationResult {
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
  packetSchemaVersion?: number;
  workItemId: string;
  runId: string;
  assignedAgentId: string;
  objectiveContext: string;
  toolAllowlist?: string[];
  authorizedToolRequests?: ToolRequestEnvelope[];
  scopeAllowlist?: string[];
  inputArtifactRefs?: string[];
  expectedResultSchemaRef?: string;
  policySnapshotRef?: string;
  createdAt: string;
}): ExecutionPacket {
  return {
    executionPacketId: input.executionPacketId,
    packetSchemaVersion:
      input.packetSchemaVersion ?? EXECUTION_PACKET_SCHEMA_VERSION,
    companyId: input.companyId,
    workItemId: input.workItemId,
    runId: input.runId,
    assignedAgentId: input.assignedAgentId,
    objectiveContext: input.objectiveContext,
    toolAllowlist: [
      ...(input.toolAllowlist ?? ['filesystem.read', 'github.read']),
    ],
    authorizedToolRequests: (input.authorizedToolRequests ?? []).map(
      cloneToolRequestEnvelope,
    ),
    scopeAllowlist: [...(input.scopeAllowlist ?? [])],
    inputArtifactRefs: [...(input.inputArtifactRefs ?? [])],
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
