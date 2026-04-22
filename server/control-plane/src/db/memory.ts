import type {
  KnowledgeMemory,
  MemoryCandidate,
  MemoryInvalidationReason,
  MemoryRetrievalAudit,
  ProvenanceEdge,
} from '@escalonalabs/domain';

import type { Queryable } from './events';

interface MemoryCandidateRow {
  candidate_id: string;
  company_id: string;
  source_kind: MemoryCandidate['sourceKind'];
  source_ref: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  objective_id: string | null;
  scope_ref: string | null;
  candidate_class: MemoryCandidate['candidateClass'];
  retention_class: MemoryCandidate['retentionClass'];
  summary: string;
  detail: string | null;
  confidence: number;
  freshness_expires_at: string | Date | null;
  status: MemoryCandidate['status'];
  created_at: string | Date;
  updated_at: string | Date;
}

interface KnowledgeMemoryRow {
  memory_id: string;
  company_id: string;
  candidate_id: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  objective_id: string | null;
  scope_ref: string | null;
  candidate_class: KnowledgeMemory['candidateClass'];
  retention_class: KnowledgeMemory['retentionClass'];
  summary: string;
  detail: string | null;
  confidence: number;
  freshness_expires_at: string | Date | null;
  status: KnowledgeMemory['status'];
  created_at: string | Date;
  updated_at: string | Date;
  invalidated_at: string | Date | null;
  invalidation_reason: MemoryInvalidationReason | null;
}

interface ProvenanceEdgeRow {
  edge_id: string;
  company_id: string;
  source_node_type: ProvenanceEdge['sourceNodeType'];
  source_node_id: string;
  target_node_type: ProvenanceEdge['targetNodeType'];
  target_node_id: string;
  edge_type: ProvenanceEdge['edgeType'];
  created_at: string | Date;
}

interface MemoryRetrievalAuditRow {
  retrieval_id: string;
  company_id: string;
  memory_id: string | null;
  scope_ref: string | null;
  objective_id: string | null;
  query_text: string | null;
  freshness: MemoryRetrievalAudit['freshness'];
  outcome: MemoryRetrievalAudit['outcome'];
  reason: string | null;
  relevance_score: number;
  created_at: string | Date;
}

function normalizeTimestamp(
  value: string | Date | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapMemoryCandidateRow(row: MemoryCandidateRow): MemoryCandidate {
  return {
    candidateId: row.candidate_id,
    companyId: row.company_id,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    aggregateType: row.aggregate_type ?? undefined,
    aggregateId: row.aggregate_id ?? undefined,
    objectiveId: row.objective_id ?? undefined,
    scopeRef: row.scope_ref ?? undefined,
    candidateClass: row.candidate_class,
    retentionClass: row.retention_class,
    summary: row.summary,
    detail: row.detail ?? undefined,
    confidence: row.confidence,
    freshnessExpiresAt: normalizeTimestamp(row.freshness_expires_at),
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapKnowledgeMemoryRow(row: KnowledgeMemoryRow): KnowledgeMemory {
  return {
    memoryId: row.memory_id,
    companyId: row.company_id,
    candidateId: row.candidate_id,
    aggregateType: row.aggregate_type ?? undefined,
    aggregateId: row.aggregate_id ?? undefined,
    objectiveId: row.objective_id ?? undefined,
    scopeRef: row.scope_ref ?? undefined,
    candidateClass: row.candidate_class,
    retentionClass: row.retention_class,
    summary: row.summary,
    detail: row.detail ?? undefined,
    confidence: row.confidence,
    freshnessExpiresAt: normalizeTimestamp(row.freshness_expires_at),
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
    invalidatedAt: normalizeTimestamp(row.invalidated_at),
    invalidationReason: row.invalidation_reason ?? undefined,
  };
}

function mapProvenanceEdgeRow(row: ProvenanceEdgeRow): ProvenanceEdge {
  return {
    edgeId: row.edge_id,
    companyId: row.company_id,
    sourceNodeType: row.source_node_type,
    sourceNodeId: row.source_node_id,
    targetNodeType: row.target_node_type,
    targetNodeId: row.target_node_id,
    edgeType: row.edge_type,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
  };
}

function mapMemoryRetrievalAuditRow(
  row: MemoryRetrievalAuditRow,
): MemoryRetrievalAudit {
  return {
    retrievalId: row.retrieval_id,
    companyId: row.company_id,
    memoryId: row.memory_id ?? undefined,
    scopeRef: row.scope_ref ?? undefined,
    objectiveId: row.objective_id ?? undefined,
    queryText: row.query_text ?? undefined,
    freshness: row.freshness,
    outcome: row.outcome,
    reason: row.reason ?? undefined,
    relevanceScore: row.relevance_score,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
  };
}

export async function getMemoryCandidateById(
  db: Queryable,
  candidateId: string,
): Promise<MemoryCandidate | null> {
  const result = await db.query<MemoryCandidateRow>(
    `
      select
        candidate_id,
        company_id,
        source_kind,
        source_ref,
        aggregate_type,
        aggregate_id,
        objective_id,
        scope_ref,
        candidate_class,
        retention_class,
        summary,
        detail,
        confidence,
        freshness_expires_at,
        status,
        created_at,
        updated_at
      from memory_candidates
      where candidate_id = $1
      limit 1
    `,
    [candidateId],
  );

  return result.rows[0] ? mapMemoryCandidateRow(result.rows[0]) : null;
}

export async function listMemoryCandidates(
  db: Queryable,
  filters: {
    companyId: string;
    status?: MemoryCandidate['status'];
    sourceKind?: MemoryCandidate['sourceKind'];
    objectiveId?: string;
    scopeRef?: string;
    limit?: number;
  },
): Promise<MemoryCandidate[]> {
  const values: Array<number | string> = [filters.companyId];
  const clauses = [`company_id = $${values.length}`];

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  if (filters.sourceKind) {
    values.push(filters.sourceKind);
    clauses.push(`source_kind = $${values.length}`);
  }

  if (filters.objectiveId) {
    values.push(filters.objectiveId);
    clauses.push(`objective_id = $${values.length}`);
  }

  if (filters.scopeRef) {
    values.push(filters.scopeRef);
    clauses.push(`scope_ref = $${values.length}`);
  }

  const limit = filters.limit ?? 100;
  values.push(limit);

  const result = await db.query<MemoryCandidateRow>(
    `
      select
        candidate_id,
        company_id,
        source_kind,
        source_ref,
        aggregate_type,
        aggregate_id,
        objective_id,
        scope_ref,
        candidate_class,
        retention_class,
        summary,
        detail,
        confidence,
        freshness_expires_at,
        status,
        created_at,
        updated_at
      from memory_candidates
      where ${clauses.join(' and ')}
      order by updated_at desc, created_at desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(mapMemoryCandidateRow);
}

export async function upsertMemoryCandidate(
  db: Queryable,
  candidate: MemoryCandidate,
): Promise<void> {
  await db.query(
    `
      insert into memory_candidates (
        candidate_id,
        company_id,
        source_kind,
        source_ref,
        aggregate_type,
        aggregate_id,
        objective_id,
        scope_ref,
        candidate_class,
        retention_class,
        summary,
        detail,
        confidence,
        freshness_expires_at,
        status,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17
      )
      on conflict (candidate_id)
      do update set
        aggregate_type = excluded.aggregate_type,
        aggregate_id = excluded.aggregate_id,
        objective_id = excluded.objective_id,
        scope_ref = excluded.scope_ref,
        retention_class = excluded.retention_class,
        summary = excluded.summary,
        detail = excluded.detail,
        confidence = excluded.confidence,
        freshness_expires_at = excluded.freshness_expires_at,
        status = case
          when memory_candidates.status in ('promoted', 'rejected', 'quarantined')
            then memory_candidates.status
          else excluded.status
        end,
        updated_at = excluded.updated_at
    `,
    [
      candidate.candidateId,
      candidate.companyId,
      candidate.sourceKind,
      candidate.sourceRef,
      candidate.aggregateType ?? null,
      candidate.aggregateId ?? null,
      candidate.objectiveId ?? null,
      candidate.scopeRef ?? null,
      candidate.candidateClass,
      candidate.retentionClass,
      candidate.summary,
      candidate.detail ?? null,
      candidate.confidence,
      candidate.freshnessExpiresAt ?? null,
      candidate.status,
      candidate.createdAt,
      candidate.updatedAt,
    ],
  );
}

export async function updateMemoryCandidateStatus(
  db: Queryable,
  input: {
    candidateId: string;
    status: MemoryCandidate['status'];
    updatedAt: string;
  },
): Promise<void> {
  await db.query(
    `
      update memory_candidates
      set status = $2, updated_at = $3
      where candidate_id = $1
    `,
    [input.candidateId, input.status, input.updatedAt],
  );
}

export async function getKnowledgeMemoryById(
  db: Queryable,
  memoryId: string,
): Promise<KnowledgeMemory | null> {
  const result = await db.query<KnowledgeMemoryRow>(
    `
      select
        memory_id,
        company_id,
        candidate_id,
        aggregate_type,
        aggregate_id,
        objective_id,
        scope_ref,
        candidate_class,
        retention_class,
        summary,
        detail,
        confidence,
        freshness_expires_at,
        status,
        created_at,
        updated_at,
        invalidated_at,
        invalidation_reason
      from knowledge_memories
      where memory_id = $1
      limit 1
    `,
    [memoryId],
  );

  return result.rows[0] ? mapKnowledgeMemoryRow(result.rows[0]) : null;
}

export async function getKnowledgeMemoryByCandidateId(
  db: Queryable,
  candidateId: string,
): Promise<KnowledgeMemory | null> {
  const result = await db.query<KnowledgeMemoryRow>(
    `
      select
        memory_id,
        company_id,
        candidate_id,
        aggregate_type,
        aggregate_id,
        objective_id,
        scope_ref,
        candidate_class,
        retention_class,
        summary,
        detail,
        confidence,
        freshness_expires_at,
        status,
        created_at,
        updated_at,
        invalidated_at,
        invalidation_reason
      from knowledge_memories
      where candidate_id = $1
      limit 1
    `,
    [candidateId],
  );

  return result.rows[0] ? mapKnowledgeMemoryRow(result.rows[0]) : null;
}

export async function listKnowledgeMemories(
  db: Queryable,
  filters: {
    companyId: string;
    status?: KnowledgeMemory['status'];
    objectiveId?: string;
    scopeRef?: string;
    limit?: number;
  },
): Promise<KnowledgeMemory[]> {
  const values: Array<number | string> = [filters.companyId];
  const clauses = [`company_id = $${values.length}`];

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  if (filters.objectiveId) {
    values.push(filters.objectiveId);
    clauses.push(`objective_id = $${values.length}`);
  }

  if (filters.scopeRef) {
    values.push(filters.scopeRef);
    clauses.push(`scope_ref = $${values.length}`);
  }

  const limit = filters.limit ?? 250;
  values.push(limit);

  const result = await db.query<KnowledgeMemoryRow>(
    `
      select
        memory_id,
        company_id,
        candidate_id,
        aggregate_type,
        aggregate_id,
        objective_id,
        scope_ref,
        candidate_class,
        retention_class,
        summary,
        detail,
        confidence,
        freshness_expires_at,
        status,
        created_at,
        updated_at,
        invalidated_at,
        invalidation_reason
      from knowledge_memories
      where ${clauses.join(' and ')}
      order by updated_at desc, created_at desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(mapKnowledgeMemoryRow);
}

export async function upsertKnowledgeMemory(
  db: Queryable,
  memory: KnowledgeMemory,
): Promise<void> {
  await db.query(
    `
      insert into knowledge_memories (
        memory_id,
        company_id,
        candidate_id,
        aggregate_type,
        aggregate_id,
        objective_id,
        scope_ref,
        candidate_class,
        retention_class,
        summary,
        detail,
        confidence,
        freshness_expires_at,
        status,
        created_at,
        updated_at,
        invalidated_at,
        invalidation_reason
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18
      )
      on conflict (memory_id)
      do update set
        aggregate_type = excluded.aggregate_type,
        aggregate_id = excluded.aggregate_id,
        objective_id = excluded.objective_id,
        scope_ref = excluded.scope_ref,
        retention_class = excluded.retention_class,
        summary = excluded.summary,
        detail = excluded.detail,
        confidence = excluded.confidence,
        freshness_expires_at = excluded.freshness_expires_at,
        status = excluded.status,
        updated_at = excluded.updated_at,
        invalidated_at = excluded.invalidated_at,
        invalidation_reason = excluded.invalidation_reason
    `,
    [
      memory.memoryId,
      memory.companyId,
      memory.candidateId,
      memory.aggregateType ?? null,
      memory.aggregateId ?? null,
      memory.objectiveId ?? null,
      memory.scopeRef ?? null,
      memory.candidateClass,
      memory.retentionClass,
      memory.summary,
      memory.detail ?? null,
      memory.confidence,
      memory.freshnessExpiresAt ?? null,
      memory.status,
      memory.createdAt,
      memory.updatedAt,
      memory.invalidatedAt ?? null,
      memory.invalidationReason ?? null,
    ],
  );
}

export async function listProvenanceEdges(
  db: Queryable,
  filters: {
    companyId: string;
    sourceNodeId?: string;
    targetNodeId?: string;
  },
): Promise<ProvenanceEdge[]> {
  const values: string[] = [filters.companyId];
  const clauses = [`company_id = $${values.length}`];

  if (filters.sourceNodeId) {
    values.push(filters.sourceNodeId);
    clauses.push(`source_node_id = $${values.length}`);
  }

  if (filters.targetNodeId) {
    values.push(filters.targetNodeId);
    clauses.push(`target_node_id = $${values.length}`);
  }

  const result = await db.query<ProvenanceEdgeRow>(
    `
      select
        edge_id,
        company_id,
        source_node_type,
        source_node_id,
        target_node_type,
        target_node_id,
        edge_type,
        created_at
      from memory_provenance_edges
      where ${clauses.join(' and ')}
      order by created_at asc
    `,
    values,
  );

  return result.rows.map(mapProvenanceEdgeRow);
}

export async function insertProvenanceEdges(
  db: Queryable,
  edges: ProvenanceEdge[],
): Promise<void> {
  for (const edge of edges) {
    await db.query(
      `
        insert into memory_provenance_edges (
          edge_id,
          company_id,
          source_node_type,
          source_node_id,
          target_node_type,
          target_node_id,
          edge_type,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (edge_id) do nothing
      `,
      [
        edge.edgeId,
        edge.companyId,
        edge.sourceNodeType,
        edge.sourceNodeId,
        edge.targetNodeType,
        edge.targetNodeId,
        edge.edgeType,
        edge.createdAt,
      ],
    );
  }
}

export async function listMemoryRetrievalAudits(
  db: Queryable,
  filters: {
    companyId: string;
    memoryId?: string;
    limit?: number;
  },
): Promise<MemoryRetrievalAudit[]> {
  const values: Array<number | string> = [filters.companyId];
  const clauses = [`company_id = $${values.length}`];

  if (filters.memoryId) {
    values.push(filters.memoryId);
    clauses.push(`memory_id = $${values.length}`);
  }

  const limit = filters.limit ?? 500;
  values.push(limit);

  const result = await db.query<MemoryRetrievalAuditRow>(
    `
      select
        retrieval_id,
        company_id,
        memory_id,
        scope_ref,
        objective_id,
        query_text,
        freshness,
        outcome,
        reason,
        relevance_score,
        created_at
      from memory_retrieval_audits
      where ${clauses.join(' and ')}
      order by created_at desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(mapMemoryRetrievalAuditRow);
}

export async function insertMemoryRetrievalAudits(
  db: Queryable,
  audits: MemoryRetrievalAudit[],
): Promise<void> {
  for (const audit of audits) {
    await db.query(
      `
        insert into memory_retrieval_audits (
          retrieval_id,
          company_id,
          memory_id,
          scope_ref,
          objective_id,
          query_text,
          freshness,
          outcome,
          reason,
          relevance_score,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (retrieval_id) do nothing
      `,
      [
        audit.retrievalId,
        audit.companyId,
        audit.memoryId ?? null,
        audit.scopeRef ?? null,
        audit.objectiveId ?? null,
        audit.queryText ?? null,
        audit.freshness,
        audit.outcome,
        audit.reason ?? null,
        audit.relevanceScore,
        audit.createdAt,
      ],
    );
  }
}
