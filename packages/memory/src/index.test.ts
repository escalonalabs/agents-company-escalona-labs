import { describe, expect, it } from 'vitest';

import type {
  ApprovalDecision,
  KnowledgeMemory,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';

import {
  evaluateMemoryQuality,
  extractMemoryCandidateFromApproval,
  extractMemoryCandidateFromGitHubEvent,
  extractMemoryCandidatesFromRun,
  invalidateKnowledgeMemory,
  promoteMemoryCandidate,
  retrieveKnowledgeMemories,
} from './index';

const now = '2026-04-22T12:00:00.000Z';

function makeObjective(): Objective {
  return {
    objectiveId: 'objective_001',
    companyId: 'company_001',
    title: 'Stabilize orchestration',
    summary: 'Keep runtime deterministic and observable.',
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
  };
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workItemId: 'work_item_001',
    companyId: 'company_001',
    objectiveId: 'objective_001',
    title: 'Finish memory plumbing',
    description: 'Integrate memory extraction and retrieval.',
    status: 'running',
    attemptBudget: 3,
    requiresApproval: false,
    validationContractRef: 'validation.memory.v1',
    scopeRef: 'scope:memory',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'run_001',
    companyId: 'company_001',
    workItemId: 'work_item_001',
    attempt: 1,
    status: 'valid_success',
    executionPacketId: 'packet_001',
    summary: 'Validated the memory-aware execution flow end to end.',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeApproval(
  overrides: Partial<ApprovalDecision> = {},
): ApprovalDecision {
  return {
    approvalId: 'approval_001',
    companyId: 'company_001',
    workItemId: 'work_item_001',
    status: 'granted',
    requestedAction: 'Promote the validated pattern',
    decisionReason:
      'This guidance proved stable across repeated validation cycles.',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function requireValue<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

describe('memory extraction', () => {
  it('extracts a successful run as an integration constraint by default', () => {
    const objective = makeObjective();
    const workItem = makeWorkItem();
    const run = makeRun();

    const result = extractMemoryCandidatesFromRun({
      run,
      workItem,
      objective,
      now,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      companyId: 'company_001',
      sourceKind: 'run',
      sourceRef: 'run_001',
      candidateClass: 'integration_constraint',
      retentionClass: 'operational',
      confidence: 0.79,
      status: 'pending_review',
      scopeRef: 'scope:memory',
      objectiveId: 'objective_001',
    });
    expect(result.provenanceEdges).toHaveLength(1);
    expect(result.provenanceEdges[0]).toMatchObject({
      sourceNodeType: 'run',
      sourceNodeId: 'run_001',
      targetNodeType: 'memory_candidate',
      edgeType: 'derived_from',
    });
  });

  it('extracts approval-gated success as a workflow convention', () => {
    const result = extractMemoryCandidatesFromRun({
      run: makeRun(),
      workItem: makeWorkItem({ requiresApproval: true }),
      objective: makeObjective(),
      now,
    });

    expect(result.candidates[0]).toMatchObject({
      candidateClass: 'workflow_convention',
      confidence: 0.74,
    });
  });

  it('extracts failure signatures from unsuccessful runs', () => {
    const result = extractMemoryCandidatesFromRun({
      run: makeRun({
        runId: 'run_002',
        status: 'permanent_failure',
        summary: undefined,
        failureClass: 'validator_rejected',
      }),
      workItem: makeWorkItem(),
      objective: makeObjective(),
      now,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      sourceRef: 'run_002',
      candidateClass: 'failure_signature',
      confidence: 0.71,
    });
    expect(requireValue(result.candidates[0]).summary).toContain(
      'validator_rejected',
    );
  });

  it('ignores low-signal successful runs', () => {
    const result = extractMemoryCandidatesFromRun({
      run: makeRun({
        runId: 'run_003',
        summary: 'done',
      }),
      workItem: makeWorkItem(),
      objective: makeObjective(),
      now,
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.provenanceEdges).toHaveLength(0);
  });

  it('extracts approval guidance only after a substantive decision', () => {
    const objective = makeObjective();
    const workItem = makeWorkItem({ requiresApproval: true });
    const granted = extractMemoryCandidateFromApproval({
      approval: makeApproval(),
      workItem,
      objective,
      now,
    });
    const pending = extractMemoryCandidateFromApproval({
      approval: makeApproval({
        approvalId: 'approval_002',
        status: 'pending',
      }),
      workItem,
      objective,
      now,
    });

    expect(granted.candidates).toHaveLength(1);
    expect(granted.candidates[0]).toMatchObject({
      candidateClass: 'operator_preference',
      retentionClass: 'knowledge',
      confidence: 0.86,
    });
    expect(pending.candidates).toHaveLength(0);
  });

  it('extracts GitHub inbound events only when they are authoritative enough', () => {
    const accepted = extractMemoryCandidateFromGitHubEvent({
      event: {
        inboundEventId: 'inbound_001',
        githubDeliveryId: 'delivery_001',
        companyId: 'company_001',
        aggregateType: 'work_item',
        aggregateId: 'work_item_001',
        classification: 'accepted_intent',
        status: 'applied',
        notes: 'GitHub instruction aligned with the existing execution policy.',
      },
      objectiveId: 'objective_001',
      scopeRef: 'scope:memory',
      now,
    });
    const ignored = extractMemoryCandidateFromGitHubEvent({
      event: {
        inboundEventId: 'inbound_002',
        githubDeliveryId: 'delivery_002',
        companyId: 'company_001',
        classification: 'ignored',
        status: 'recorded',
        notes: 'This will not be extracted because it is ignored.',
      },
      now,
    });

    expect(accepted.candidates).toHaveLength(1);
    expect(accepted.candidates[0]).toMatchObject({
      candidateClass: 'operator_preference',
      retentionClass: 'operational',
    });
    expect(ignored.candidates).toHaveLength(0);
  });
});

describe('memory lifecycle', () => {
  it('promotes reviewed candidates into active memories', () => {
    const candidate = requireValue(
      extractMemoryCandidatesFromRun({
        run: makeRun(),
        workItem: makeWorkItem(),
        objective: makeObjective(),
        now,
      }).candidates[0],
    );

    const promotion = promoteMemoryCandidate({
      candidate,
      now,
    });

    expect(promotion.memory).toMatchObject({
      companyId: candidate.companyId,
      candidateId: candidate.candidateId,
      status: 'active',
      candidateClass: candidate.candidateClass,
    });
    expect(promotion.provenanceEdges[0]).toMatchObject({
      sourceNodeType: 'memory_candidate',
      targetNodeType: 'memory',
      edgeType: 'approved_by',
    });
  });

  it('keeps quarantined candidates quarantined when promoted', () => {
    const candidate = requireValue(
      extractMemoryCandidateFromApproval({
        approval: makeApproval(),
        workItem: makeWorkItem({ requiresApproval: true }),
        objective: makeObjective(),
        now,
      }).candidates[0],
    );

    const promotion = promoteMemoryCandidate({
      candidate: {
        ...candidate,
        status: 'quarantined',
      },
      now,
      supersedesMemoryId: 'memory_previous',
    });

    expect(promotion.memory).toMatchObject({
      status: 'quarantined',
      invalidationReason: 'quarantined',
      invalidatedAt: now,
    });
    expect(
      promotion.provenanceEdges.some((edge) => edge.edgeType === 'supersedes'),
    ).toBe(true);
  });

  it('invalidates memories with the expected terminal status', () => {
    const activeMemory: KnowledgeMemory = {
      memoryId: 'memory_001',
      companyId: 'company_001',
      candidateId: 'candidate_001',
      candidateClass: 'operator_preference',
      retentionClass: 'knowledge',
      summary: 'Reviewed guidance for future runs.',
      confidence: 0.91,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const revoked = invalidateKnowledgeMemory({
      memory: activeMemory,
      reason: 'revoked',
      now,
    });

    expect(revoked).toMatchObject({
      status: 'revoked',
      invalidationReason: 'revoked',
      invalidatedAt: now,
      updatedAt: now,
    });
  });
});

describe('retrieval and evaluation', () => {
  it('retrieves only active memories and withholds stale or low-confidence ones', () => {
    const memories: KnowledgeMemory[] = [
      {
        memoryId: 'memory_fresh',
        companyId: 'company_001',
        candidateId: 'candidate_fresh',
        objectiveId: 'objective_001',
        scopeRef: 'scope:memory',
        candidateClass: 'operator_preference',
        retentionClass: 'knowledge',
        summary: 'Always attach provenance to promoted operational knowledge.',
        detail: 'Validated in control-plane M13.',
        confidence: 0.95,
        freshnessExpiresAt: '2026-04-29T00:00:00.000Z',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        memoryId: 'memory_stale',
        companyId: 'company_001',
        candidateId: 'candidate_stale',
        objectiveId: 'objective_001',
        scopeRef: 'scope:memory',
        candidateClass: 'integration_constraint',
        retentionClass: 'operational',
        summary: 'Old execution guidance that is now stale.',
        confidence: 0.88,
        freshnessExpiresAt: '2026-04-01T00:00:00.000Z',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        memoryId: 'memory_low_confidence',
        companyId: 'company_001',
        candidateId: 'candidate_low_confidence',
        objectiveId: 'objective_001',
        scopeRef: 'scope:memory',
        candidateClass: 'failure_signature',
        retentionClass: 'operational',
        summary: 'Weak signal that should be withheld.',
        confidence: 0.4,
        freshnessExpiresAt: '2026-04-29T00:00:00.000Z',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        memoryId: 'memory_other_company',
        companyId: 'company_999',
        candidateId: 'candidate_other_company',
        candidateClass: 'operator_preference',
        retentionClass: 'knowledge',
        summary: 'Wrong company scope.',
        confidence: 0.99,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ];

    const result = retrieveKnowledgeMemories({
      memories,
      request: {
        companyId: 'company_001',
        objectiveId: 'objective_001',
        scopeRef: 'scope:memory',
        queryText: 'provenance promoted knowledge',
        retentionClasses: ['knowledge', 'operational'],
        minimumConfidence: 0.65,
        freshnessWindowHours: 24,
        limit: 10,
        now,
      },
    });

    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      memory: expect.objectContaining({ memoryId: 'memory_fresh' }),
      withheld: false,
      freshness: 'fresh',
    });
    expect(
      result.items.some(
        (item) =>
          item.memory.memoryId === 'memory_stale' &&
          item.withheld &&
          item.reason === 'stale_memory',
      ),
    ).toBe(true);
    expect(
      result.items.some(
        (item) =>
          item.memory.memoryId === 'memory_low_confidence' &&
          item.withheld &&
          item.reason === 'confidence_below_threshold',
      ),
    ).toBe(true);
    expect(result.audits).toHaveLength(3);
    expect(result.audits[0]?.outcome).toBe('returned');
  });

  it('calculates evaluation metrics from candidates, provenance, and retrieval audits', () => {
    const activeMemory: KnowledgeMemory = {
      memoryId: 'memory_active',
      companyId: 'company_001',
      candidateId: 'candidate_active',
      candidateClass: 'operator_preference',
      retentionClass: 'knowledge',
      summary: 'Stable reviewed memory.',
      confidence: 0.92,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const supersededMemory: KnowledgeMemory = {
      memoryId: 'memory_superseded',
      companyId: 'company_001',
      candidateId: 'candidate_superseded',
      candidateClass: 'integration_constraint',
      retentionClass: 'operational',
      summary: 'Older guidance replaced by newer evidence.',
      confidence: 0.82,
      status: 'superseded',
      createdAt: now,
      updatedAt: now,
      invalidatedAt: now,
      invalidationReason: 'superseded',
    };

    const evaluation = evaluateMemoryQuality({
      companyId: 'company_001',
      candidates: [
        {
          candidateId: 'candidate_active',
          companyId: 'company_001',
          sourceKind: 'run',
          sourceRef: 'run_001',
          candidateClass: 'operator_preference',
          retentionClass: 'knowledge',
          summary: 'Candidate 1',
          confidence: 0.9,
          status: 'promoted',
          createdAt: now,
          updatedAt: now,
        },
      ],
      memories: [activeMemory, supersededMemory],
      provenanceEdges: [
        {
          edgeId: 'edge_001',
          companyId: 'company_001',
          sourceNodeType: 'memory_candidate',
          sourceNodeId: 'candidate_active',
          targetNodeType: 'memory',
          targetNodeId: 'memory_active',
          edgeType: 'approved_by',
          createdAt: now,
        },
      ],
      retrievalAudits: [
        {
          retrievalId: 'retrieval_001',
          companyId: 'company_001',
          memoryId: 'memory_active',
          freshness: 'fresh',
          outcome: 'returned',
          relevanceScore: 0.9,
          createdAt: now,
        },
        {
          retrievalId: 'retrieval_002',
          companyId: 'company_001',
          memoryId: 'memory_superseded',
          freshness: 'stale',
          outcome: 'withheld',
          reason: 'stale_memory',
          relevanceScore: 0.4,
          createdAt: now,
        },
      ],
    });

    expect(evaluation).toMatchObject({
      totalCandidates: 1,
      totalMemories: 2,
      activeMemories: 1,
      invalidatedMemories: 1,
      retrievalCount: 2,
      returnedRetrievalCount: 1,
      withheldRetrievalCount: 1,
      staleRetrievalRate: 0.5,
      contaminationRate: 0.5,
      provenanceCompleteness: 1,
      overrideFrequency: 0.5,
    });
  });
});
