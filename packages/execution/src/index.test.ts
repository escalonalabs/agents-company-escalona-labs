import { describe, expect, it } from 'vitest';

import {
  EXECUTION_PACKET_SCHEMA_VERSION,
  createEffectEnvelope,
  createExecutionPacket,
  createToolRequestEnvelope,
  mapTaskResultToRunStatus,
  validateEffectEnvelope,
  validateExecutorResult,
  validateTaskResult,
  validateToolRequestEnvelope,
} from './index';

describe('execution helpers', () => {
  it('creates canonical execution packets with defaults', () => {
    const packet = createExecutionPacket({
      companyId: 'company_001',
      executionPacketId: 'packet_001',
      workItemId: 'work_item_001',
      runId: 'run_001',
      assignedAgentId: 'agent.runtime.default',
      objectiveContext: 'Ship the runtime.',
      createdAt: '2026-04-22T00:00:00.000Z',
    });

    expect(packet).toMatchObject({
      companyId: 'company_001',
      executionPacketId: 'packet_001',
      packetSchemaVersion: EXECUTION_PACKET_SCHEMA_VERSION,
      workItemId: 'work_item_001',
      runId: 'run_001',
      expectedResultSchemaRef: 'task-result.schema.v1',
      policySnapshotRef: 'policy.default.v1',
      toolAllowlist: ['filesystem.read', 'github.read'],
      authorizedToolRequests: [],
    });
  });

  it('freezes explicit authorized tool requests inside the packet shape', () => {
    const request = createToolRequestEnvelope({
      toolCallId: 'tool_call_001',
      runId: 'run_001',
      executionPacketId: 'packet_001',
      toolKind: 'http',
      toolName: 'github.read',
      capabilityRef: 'cap.github.read',
      scopeRef: 'repo:agents-company',
      requestPayload: { url: 'https://api.github.com/repos/escalonalabs' },
      requestedAt: '2026-04-22T00:00:05.000Z',
    });

    const packet = createExecutionPacket({
      companyId: 'company_001',
      executionPacketId: 'packet_001',
      workItemId: 'work_item_001',
      runId: 'run_001',
      assignedAgentId: 'agent.runtime.default',
      objectiveContext: 'Fetch repository metadata.',
      authorizedToolRequests: [request],
      createdAt: '2026-04-22T00:00:00.000Z',
    });

    request.requestPayload.url = 'https://mutated.invalid';

    expect(packet.authorizedToolRequests).toHaveLength(1);
    expect(packet.authorizedToolRequests[0]).toMatchObject({
      toolCallId: 'tool_call_001',
      toolKind: 'http',
      toolName: 'github.read',
      requestPayload: {
        url: 'https://api.github.com/repos/escalonalabs',
      },
    });
  });

  it('rejects malformed task results fail-closed', () => {
    const validation = validateTaskResult({
      runId: '',
      executionPacketId: 'packet_001',
      resultStatus: 'unknown' as never,
      resultSchemaVersion: 1.5,
      artifactRefs: [],
      summary: '',
      structuredOutput: {},
      validatorRef: '',
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContain('runId is required');
    expect(validation.issues).toContain(
      'resultStatus must be a supported task result status',
    );
    expect(validation.issues).toContain(
      'resultSchemaVersion must be an integer',
    );
    expect(validation.issues).toContain('summary is required');
    expect(validation.issues).toContain('validatorRef is required');
  });

  it('validates tool request envelopes fail-closed', () => {
    const validation = validateToolRequestEnvelope({
      toolCallId: '',
      runId: '',
      executionPacketId: '',
      toolKind: 'desktop' as never,
      toolName: '',
      toolVersion: '',
      capabilityRef: '',
      scopeRef: '',
      timeoutMs: 0,
      requestPayload: [] as never,
      requestedAt: '',
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContain('toolCallId is required');
    expect(validation.issues).toContain('runId is required');
    expect(validation.issues).toContain('executionPacketId is required');
    expect(validation.issues).toContain(
      'toolKind must be a supported tool kind',
    );
    expect(validation.issues).toContain('toolName is required');
    expect(validation.issues).toContain('toolVersion is required');
    expect(validation.issues).toContain('capabilityRef is required');
    expect(validation.issues).toContain('scopeRef is required');
    expect(validation.issues).toContain('timeoutMs must be a positive integer');
    expect(validation.issues).toContain(
      'requestPayload must be a plain object',
    );
    expect(validation.issues).toContain('requestedAt is required');
  });

  it('validates effect envelopes and executor linkage', () => {
    const toolRequest = createToolRequestEnvelope({
      toolCallId: 'tool_call_002',
      runId: 'run_002',
      executionPacketId: 'packet_002',
      toolKind: 'browser',
      toolName: 'browser.capture',
      capabilityRef: 'cap.browser.capture',
      scopeRef: 'repo:agents-company',
      timeoutMs: 45_000,
      requestPayload: { url: 'https://example.com' },
      requestedAt: '2026-04-22T00:01:00.000Z',
    });
    const validEffect = createEffectEnvelope({
      toolCallId: 'tool_call_002',
      runId: 'run_002',
      effectStatus: 'succeeded',
      startedAt: '2026-04-22T00:01:01.000Z',
      completedAt: '2026-04-22T00:01:03.000Z',
      artifactRefs: ['artifact://screenshot'],
      resultPayload: { screenshotRef: 'artifact://screenshot' },
    });

    expect(validateEffectEnvelope(validEffect)).toEqual({
      ok: true,
      issues: [],
    });
    expect(
      validateExecutorResult({
        toolRequest,
        effect: validEffect,
      }),
    ).toEqual({
      ok: true,
      issues: [],
    });

    const invalidEffect = createEffectEnvelope({
      toolCallId: 'tool_call_other',
      runId: 'run_002',
      effectStatus: 'failed_transient',
      startedAt: '2026-04-22T00:01:01.000Z',
      completedAt: '2026-04-22T00:01:03.000Z',
      resultPayload: {},
    });

    const invalidEffectValidation = validateEffectEnvelope(invalidEffect);
    expect(invalidEffectValidation.ok).toBe(false);
    expect(invalidEffectValidation.issues).toContain(
      'errorMessage is required for non-success effect statuses',
    );

    const executorValidation = validateExecutorResult({
      toolRequest,
      effect: {
        ...invalidEffect,
        errorMessage: 'Timed out upstream.',
      },
    });
    expect(executorValidation.ok).toBe(false);
    expect(executorValidation.issues).toContain(
      'toolCallId must match between tool request and effect',
    );
  });

  it('maps valid task result status to run status without mutation', () => {
    expect(mapTaskResultToRunStatus('valid_success')).toBe('valid_success');
    expect(mapTaskResultToRunStatus('transient_failure')).toBe(
      'transient_failure',
    );
  });
});
