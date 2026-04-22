import { describe, expect, it } from 'vitest';

import {
  createExecutionPacket,
  mapTaskResultToRunStatus,
  validateTaskResult,
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
      workItemId: 'work_item_001',
      runId: 'run_001',
      expectedResultSchemaRef: 'task-result.schema.v1',
      policySnapshotRef: 'policy.default.v1',
      toolAllowlist: ['filesystem.read', 'github.read'],
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

  it('maps valid task result status to run status without mutation', () => {
    expect(mapTaskResultToRunStatus('valid_success')).toBe('valid_success');
    expect(mapTaskResultToRunStatus('transient_failure')).toBe(
      'transient_failure',
    );
  });
});
