import { createHash } from 'node:crypto';

import type {
  ApprovalDecision,
  KnowledgeMemory,
  MemoryCandidate,
  MemoryEvaluation,
  MemoryFreshness,
  MemoryInvalidationReason,
  MemoryRetentionClass,
  MemoryRetrievalAudit,
  MemoryStatus,
  Objective,
  ProvenanceEdge,
  Run,
  WorkItem,
} from '@escalonalabs/domain';

export interface GitHubInboundMemoryInput {
  inboundEventId: string;
  githubDeliveryId: string;
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
  notes?: string;
}

export interface ExtractedMemoryBatch {
  candidates: MemoryCandidate[];
  provenanceEdges: ProvenanceEdge[];
}

export interface MemoryRetrievalRequest {
  companyId: string;
  queryText?: string;
  objectiveId?: string;
  scopeRef?: string;
  retentionClasses?: MemoryRetentionClass[];
  minimumConfidence?: number;
  freshnessWindowHours?: number;
  limit?: number;
  now?: string;
}

export interface MemoryRetrievalItem {
  memory: KnowledgeMemory;
  freshness: MemoryFreshness;
  relevanceScore: number;
  withheld: boolean;
  reason?: string;
}

export interface MemoryRetrievalResult {
  items: MemoryRetrievalItem[];
  audits: MemoryRetrievalAudit[];
}

function stableId(prefix: string, parts: Array<string | undefined>) {
  const hash = createHash('sha256')
    .update(parts.filter(Boolean).join(':'))
    .digest('hex')
    .slice(0, 24);

  return `${prefix}_${hash}`;
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function detectFreshness(
  expiresAt: string | undefined,
  now: string,
): MemoryFreshness {
  if (!expiresAt) {
    return 'uncertain';
  }

  return new Date(expiresAt).getTime() > new Date(now).getTime()
    ? 'fresh'
    : 'stale';
}

function keywordOverlap(summary: string, queryText: string | undefined) {
  if (!queryText) {
    return 0;
  }

  const summaryTokens = new Set(
    summary
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 3),
  );
  const queryTokens = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3);

  if (queryTokens.length === 0) {
    return 0;
  }

  const matches = queryTokens.filter((token) =>
    summaryTokens.has(token),
  ).length;
  return matches / queryTokens.length;
}

function buildProvenanceEdge(input: {
  companyId: string;
  sourceNodeType: ProvenanceEdge['sourceNodeType'];
  sourceNodeId: string;
  targetNodeType: ProvenanceEdge['targetNodeType'];
  targetNodeId: string;
  edgeType: ProvenanceEdge['edgeType'];
  createdAt: string;
}): ProvenanceEdge {
  return {
    edgeId: stableId('prov', [
      input.companyId,
      input.sourceNodeType,
      input.sourceNodeId,
      input.targetNodeType,
      input.targetNodeId,
      input.edgeType,
    ]),
    companyId: input.companyId,
    sourceNodeType: input.sourceNodeType,
    sourceNodeId: input.sourceNodeId,
    targetNodeType: input.targetNodeType,
    targetNodeId: input.targetNodeId,
    edgeType: input.edgeType,
    createdAt: input.createdAt,
  };
}

function isMeaningfulText(value: string | undefined) {
  return Boolean(value && value.trim().length >= 12);
}

export function extractMemoryCandidatesFromRun(input: {
  run: Run;
  workItem: WorkItem;
  objective: Objective;
  now?: string;
}): ExtractedMemoryBatch {
  const now = input.now ?? new Date().toISOString();
  const candidates: MemoryCandidate[] = [];
  const provenanceEdges: ProvenanceEdge[] = [];
  const normalizedSummary = input.run.summary?.trim();

  if (
    input.run.status === 'valid_success' &&
    isMeaningfulText(normalizedSummary)
  ) {
    const candidate: MemoryCandidate = {
      candidateId: stableId('candidate', [
        input.run.companyId,
        'run',
        input.run.runId,
        'workflow_convention',
      ]),
      companyId: input.run.companyId,
      sourceKind: 'run',
      sourceRef: input.run.runId,
      aggregateType: 'run',
      aggregateId: input.run.runId,
      objectiveId: input.objective.objectiveId,
      scopeRef: input.workItem.scopeRef,
      candidateClass: input.workItem.requiresApproval
        ? 'workflow_convention'
        : 'integration_constraint',
      retentionClass: 'operational',
      summary: `Successful execution pattern for ${input.workItem.scopeRef}: ${normalizedSummary}`,
      detail: `Objective ${input.objective.title}; validation ${input.workItem.validationContractRef}.`,
      confidence: clampConfidence(
        input.workItem.requiresApproval ? 0.74 : 0.79,
      ),
      freshnessExpiresAt: addDays(now, 14),
      status: 'pending_review',
      createdAt: now,
      updatedAt: now,
    };

    candidates.push(candidate);
    provenanceEdges.push(
      buildProvenanceEdge({
        companyId: candidate.companyId,
        sourceNodeType: 'run',
        sourceNodeId: input.run.runId,
        targetNodeType: 'memory_candidate',
        targetNodeId: candidate.candidateId,
        edgeType: 'derived_from',
        createdAt: now,
      }),
    );
  }

  if (
    input.run.status !== 'valid_success' &&
    (isMeaningfulText(normalizedSummary) || input.run.failureClass)
  ) {
    const failureDescriptor = input.run.failureClass ?? input.run.status;
    const candidate: MemoryCandidate = {
      candidateId: stableId('candidate', [
        input.run.companyId,
        'run',
        input.run.runId,
        'failure_signature',
      ]),
      companyId: input.run.companyId,
      sourceKind: 'run',
      sourceRef: input.run.runId,
      aggregateType: 'run',
      aggregateId: input.run.runId,
      objectiveId: input.objective.objectiveId,
      scopeRef: input.workItem.scopeRef,
      candidateClass: 'failure_signature',
      retentionClass: 'operational',
      summary: `Failure signature ${failureDescriptor} on ${input.workItem.scopeRef}: ${
        normalizedSummary ?? 'No run summary captured.'
      }`,
      detail: `Objective ${input.objective.title}; validation ${input.workItem.validationContractRef}.`,
      confidence: clampConfidence(input.run.failureClass ? 0.71 : 0.58),
      freshnessExpiresAt: addDays(now, 7),
      status: 'pending_review',
      createdAt: now,
      updatedAt: now,
    };

    candidates.push(candidate);
    provenanceEdges.push(
      buildProvenanceEdge({
        companyId: candidate.companyId,
        sourceNodeType: 'run',
        sourceNodeId: input.run.runId,
        targetNodeType: 'memory_candidate',
        targetNodeId: candidate.candidateId,
        edgeType: 'derived_from',
        createdAt: now,
      }),
    );
  }

  return {
    candidates,
    provenanceEdges,
  };
}

export function extractMemoryCandidateFromApproval(input: {
  approval: ApprovalDecision;
  workItem: WorkItem;
  objective: Objective;
  now?: string;
}): ExtractedMemoryBatch {
  const now = input.now ?? new Date().toISOString();

  if (
    input.approval.status === 'pending' ||
    !isMeaningfulText(input.approval.decisionReason)
  ) {
    return {
      candidates: [],
      provenanceEdges: [],
    };
  }

  const candidate: MemoryCandidate = {
    candidateId: stableId('candidate', [
      input.approval.companyId,
      'approval',
      input.approval.approvalId,
      'operator_preference',
    ]),
    companyId: input.approval.companyId,
    sourceKind: 'approval',
    sourceRef: input.approval.approvalId,
    aggregateType: 'approval',
    aggregateId: input.approval.approvalId,
    objectiveId: input.objective.objectiveId,
    scopeRef: input.workItem.scopeRef,
    candidateClass: 'operator_preference',
    retentionClass: 'knowledge',
    summary: `Operator ${input.approval.status} guidance for ${input.workItem.scopeRef}: ${input.approval.decisionReason?.trim()}`,
    detail: `Requested action: ${input.approval.requestedAction}`,
    confidence: clampConfidence(0.86),
    status: 'pending_review',
    createdAt: now,
    updatedAt: now,
  };

  return {
    candidates: [candidate],
    provenanceEdges: [
      buildProvenanceEdge({
        companyId: candidate.companyId,
        sourceNodeType: 'approval',
        sourceNodeId: input.approval.approvalId,
        targetNodeType: 'memory_candidate',
        targetNodeId: candidate.candidateId,
        edgeType: 'derived_from',
        createdAt: now,
      }),
    ],
  };
}

export function extractMemoryCandidateFromGitHubEvent(input: {
  event: GitHubInboundMemoryInput;
  scopeRef?: string;
  objectiveId?: string;
  now?: string;
}): ExtractedMemoryBatch {
  const now = input.now ?? new Date().toISOString();

  if (
    !input.event.companyId ||
    !isMeaningfulText(input.event.notes) ||
    !['accepted_intent', 'authoritative_conflict'].includes(
      input.event.classification,
    )
  ) {
    return {
      candidates: [],
      provenanceEdges: [],
    };
  }

  const candidateClass =
    input.event.classification === 'accepted_intent'
      ? 'operator_preference'
      : 'integration_constraint';
  const candidate: MemoryCandidate = {
    candidateId: stableId('candidate', [
      input.event.companyId,
      'github_inbound',
      input.event.inboundEventId,
      candidateClass,
    ]),
    companyId: input.event.companyId,
    sourceKind: 'github_inbound',
    sourceRef: input.event.inboundEventId,
    aggregateType: input.event.aggregateType,
    aggregateId: input.event.aggregateId,
    objectiveId: input.objectiveId,
    scopeRef: input.scopeRef,
    candidateClass,
    retentionClass: 'operational',
    summary: `GitHub ${input.event.classification} memory: ${input.event.notes?.trim()}`,
    detail: `Delivery ${input.event.githubDeliveryId}; status ${input.event.status}.`,
    confidence: clampConfidence(
      input.event.classification === 'accepted_intent' ? 0.76 : 0.73,
    ),
    freshnessExpiresAt: addDays(now, 14),
    status: 'pending_review',
    createdAt: now,
    updatedAt: now,
  };

  return {
    candidates: [candidate],
    provenanceEdges: [
      buildProvenanceEdge({
        companyId: candidate.companyId,
        sourceNodeType: 'github_inbound',
        sourceNodeId: input.event.inboundEventId,
        targetNodeType: 'memory_candidate',
        targetNodeId: candidate.candidateId,
        edgeType: 'derived_from',
        createdAt: now,
      }),
    ],
  };
}

export function promoteMemoryCandidate(input: {
  candidate: MemoryCandidate;
  now?: string;
  supersedesMemoryId?: string;
}): { memory: KnowledgeMemory; provenanceEdges: ProvenanceEdge[] } {
  const now = input.now ?? new Date().toISOString();
  const nextStatus: MemoryStatus =
    input.candidate.status === 'quarantined' ? 'quarantined' : 'active';
  const memory: KnowledgeMemory = {
    memoryId: stableId('memory', [
      input.candidate.companyId,
      input.candidate.candidateId,
    ]),
    companyId: input.candidate.companyId,
    candidateId: input.candidate.candidateId,
    aggregateType: input.candidate.aggregateType,
    aggregateId: input.candidate.aggregateId,
    objectiveId: input.candidate.objectiveId,
    scopeRef: input.candidate.scopeRef,
    candidateClass: input.candidate.candidateClass,
    retentionClass: input.candidate.retentionClass,
    summary: input.candidate.summary,
    detail: input.candidate.detail,
    confidence: input.candidate.confidence,
    freshnessExpiresAt: input.candidate.freshnessExpiresAt,
    status: nextStatus,
    createdAt: now,
    updatedAt: now,
    invalidatedAt: nextStatus === 'quarantined' ? now : undefined,
    invalidationReason:
      nextStatus === 'quarantined' ? 'quarantined' : undefined,
  };

  const provenanceEdges = [
    buildProvenanceEdge({
      companyId: memory.companyId,
      sourceNodeType: 'memory_candidate',
      sourceNodeId: input.candidate.candidateId,
      targetNodeType: 'memory',
      targetNodeId: memory.memoryId,
      edgeType: 'approved_by',
      createdAt: now,
    }),
  ];

  if (input.supersedesMemoryId) {
    provenanceEdges.push(
      buildProvenanceEdge({
        companyId: memory.companyId,
        sourceNodeType: 'memory',
        sourceNodeId: memory.memoryId,
        targetNodeType: 'memory',
        targetNodeId: input.supersedesMemoryId,
        edgeType: 'supersedes',
        createdAt: now,
      }),
    );
  }

  return {
    memory,
    provenanceEdges,
  };
}

export function invalidateKnowledgeMemory(input: {
  memory: KnowledgeMemory;
  reason: MemoryInvalidationReason;
  now?: string;
}): KnowledgeMemory {
  const now = input.now ?? new Date().toISOString();
  const nextStatus: MemoryStatus =
    input.reason === 'expired'
      ? 'expired'
      : input.reason === 'superseded'
        ? 'superseded'
        : input.reason === 'revoked'
          ? 'revoked'
          : 'quarantined';

  return {
    ...input.memory,
    status: nextStatus,
    invalidatedAt: now,
    invalidationReason: input.reason,
    updatedAt: now,
  };
}

export function retrieveKnowledgeMemories(input: {
  memories: KnowledgeMemory[];
  provenanceEdges?: ProvenanceEdge[];
  request: MemoryRetrievalRequest;
}): MemoryRetrievalResult {
  const now = input.request.now ?? new Date().toISOString();
  const candidateMemories = input.memories.filter(
    (memory) =>
      memory.companyId === input.request.companyId &&
      memory.status === 'active' &&
      (input.request.retentionClasses?.length
        ? input.request.retentionClasses.includes(memory.retentionClass)
        : true) &&
      (input.request.objectiveId
        ? memory.objectiveId === input.request.objectiveId
        : true) &&
      (input.request.scopeRef
        ? memory.scopeRef === input.request.scopeRef
        : true),
  );

  const items = candidateMemories
    .map<MemoryRetrievalItem>((memory) => {
      const freshness = detectFreshness(memory.freshnessExpiresAt, now);
      const relevanceScore = clampConfidence(
        0.55 +
          (memory.scopeRef &&
          input.request.scopeRef &&
          memory.scopeRef === input.request.scopeRef
            ? 0.2
            : 0) +
          (memory.objectiveId &&
          input.request.objectiveId &&
          memory.objectiveId === input.request.objectiveId
            ? 0.15
            : 0) +
          keywordOverlap(
            `${memory.summary} ${memory.detail ?? ''}`,
            input.request.queryText,
          ) *
            0.1,
      );
      const belowConfidence =
        memory.confidence < (input.request.minimumConfidence ?? 0.65);
      const staleAndStrict =
        freshness === 'stale' &&
        input.request.freshnessWindowHours !== undefined;
      const uncertainAndStrict =
        freshness === 'uncertain' &&
        input.request.freshnessWindowHours !== undefined;

      return {
        memory,
        freshness,
        relevanceScore,
        withheld: belowConfidence || staleAndStrict || uncertainAndStrict,
        reason: belowConfidence
          ? 'confidence_below_threshold'
          : staleAndStrict
            ? 'stale_memory'
            : uncertainAndStrict
              ? 'freshness_uncertain'
              : undefined,
      };
    })
    .sort((left, right) => {
      if (left.withheld !== right.withheld) {
        return left.withheld ? 1 : -1;
      }

      return right.relevanceScore - left.relevanceScore;
    })
    .slice(0, input.request.limit ?? 10);

  return {
    items,
    audits: items.map((item) => ({
      retrievalId: stableId('retrieval', [
        input.request.companyId,
        item.memory.memoryId,
        input.request.scopeRef,
        input.request.objectiveId,
        input.request.queryText,
        now,
      ]),
      companyId: input.request.companyId,
      memoryId: item.memory.memoryId,
      scopeRef: input.request.scopeRef,
      objectiveId: input.request.objectiveId,
      queryText: input.request.queryText,
      freshness: item.freshness,
      outcome: item.withheld ? 'withheld' : 'returned',
      reason: item.reason,
      relevanceScore: item.relevanceScore,
      createdAt: now,
    })),
  };
}

export function evaluateMemoryQuality(input: {
  companyId: string;
  candidates: MemoryCandidate[];
  memories: KnowledgeMemory[];
  provenanceEdges: ProvenanceEdge[];
  retrievalAudits: MemoryRetrievalAudit[];
}): MemoryEvaluation {
  const companyCandidates = input.candidates.filter(
    (candidate) => candidate.companyId === input.companyId,
  );
  const companyMemories = input.memories.filter(
    (memory) => memory.companyId === input.companyId,
  );
  const companyEdges = input.provenanceEdges.filter(
    (edge) => edge.companyId === input.companyId,
  );
  const companyRetrievals = input.retrievalAudits.filter(
    (retrieval) => retrieval.companyId === input.companyId,
  );
  const activeMemories = companyMemories.filter(
    (memory) => memory.status === 'active',
  );
  const invalidatedMemories = companyMemories.filter(
    (memory) => memory.status !== 'active',
  );
  const quarantinedMemories = companyMemories.filter(
    (memory) => memory.status === 'quarantined',
  );
  const staleRetrievals = companyRetrievals.filter(
    (retrieval) => retrieval.freshness === 'stale',
  ).length;
  const contaminationRetrievals = companyRetrievals.filter(
    (retrieval) =>
      retrieval.reason === 'confidence_below_threshold' ||
      retrieval.reason === 'stale_memory' ||
      retrieval.reason === 'freshness_uncertain',
  ).length;
  const activeMemoryWithProvenance = activeMemories.filter((memory) =>
    companyEdges.some(
      (edge) =>
        edge.targetNodeType === 'memory' &&
        edge.targetNodeId === memory.memoryId &&
        ['approved_by', 'validated_by', 'derived_from'].includes(edge.edgeType),
    ),
  ).length;

  return {
    companyId: input.companyId,
    totalCandidates: companyCandidates.length,
    totalMemories: companyMemories.length,
    activeMemories: activeMemories.length,
    invalidatedMemories: invalidatedMemories.length,
    quarantinedMemories: quarantinedMemories.length,
    retrievalCount: companyRetrievals.length,
    returnedRetrievalCount: companyRetrievals.filter(
      (retrieval) => retrieval.outcome === 'returned',
    ).length,
    withheldRetrievalCount: companyRetrievals.filter(
      (retrieval) => retrieval.outcome === 'withheld',
    ).length,
    staleRetrievalRate:
      companyRetrievals.length > 0
        ? Number((staleRetrievals / companyRetrievals.length).toFixed(4))
        : 0,
    contaminationRate:
      companyRetrievals.length > 0
        ? Number(
            (contaminationRetrievals / companyRetrievals.length).toFixed(4),
          )
        : 0,
    provenanceCompleteness:
      activeMemories.length > 0
        ? Number(
            (activeMemoryWithProvenance / activeMemories.length).toFixed(4),
          )
        : 1,
    overrideFrequency:
      companyMemories.length > 0
        ? Number(
            (invalidatedMemories.length / companyMemories.length).toFixed(4),
          )
        : 0,
  };
}
