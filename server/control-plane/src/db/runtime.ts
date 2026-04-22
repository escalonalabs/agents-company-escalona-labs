import type {
  ApprovalDecision,
  ClaimLease,
  Company,
  Objective,
  RepositoryTarget,
  Run,
  WorkItem,
} from '@escalonalabs/domain';
import type {
  EffectEnvelope,
  ExecutionPacket,
  ExecutorResult,
  ToolKind,
} from '@escalonalabs/execution';

import type { Queryable } from './events';

export interface CompanyRow {
  company_id: string;
  slug: string;
  display_name: string;
  status: Company['status'];
  beta_phase: Company['betaPhase'] | null;
  beta_enrollment_status: Company['betaEnrollmentStatus'] | null;
  beta_notes: string | null;
  beta_updated_at: string | Date | null;
  created_at: string | Date;
}

export interface ObjectiveRow {
  objective_id: string;
  company_id: string;
  title: string;
  summary: string | null;
  target_repository_owner: string | null;
  target_repository_name: string | null;
  target_repository_id: string | number | null;
  status: Objective['status'];
  created_at: string | Date;
  updated_at: string | Date;
}

export interface WorkItemRow {
  work_item_id: string;
  company_id: string;
  objective_id: string;
  title: string;
  description: string | null;
  target_repository_owner: string | null;
  target_repository_name: string | null;
  target_repository_id: string | number | null;
  status: WorkItem['status'];
  attempt_budget: number;
  requires_approval: boolean;
  validation_contract_ref: string;
  scope_ref: string;
  blocking_reason: string | null;
  latest_run_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface RunRow {
  run_id: string;
  company_id: string;
  work_item_id: string;
  attempt: number;
  status: Run['status'];
  execution_packet_id: string | null;
  head_sha: string | null;
  summary: string | null;
  failure_class: string | null;
  available_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface ApprovalRow {
  approval_id: string;
  company_id: string;
  work_item_id: string;
  status: ApprovalDecision['status'];
  requested_action: string;
  decision_reason: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface ExecutionPacketRow {
  execution_packet_id: string;
  company_id: string;
  work_item_id: string;
  run_id: string;
  packet: ExecutionPacket;
  created_at: string | Date;
}

export interface ClaimLeaseRow {
  claim_id: string;
  company_id: string;
  work_item_id: string;
  scope_ref: string;
  holder_run_id: string;
  lease_expires_at: string | Date;
  lease_status: 'active' | 'expired' | 'released';
  created_at: string | Date;
  updated_at: string | Date;
}

export interface PersistedClaimLease extends ClaimLease {
  leaseStatus: 'active' | 'expired' | 'released';
  createdAt: string;
  updatedAt: string;
}

export interface RunEffectRow {
  effect_id: string;
  company_id: string;
  run_id: string;
  execution_packet_id: string;
  tool_call_id: string;
  tool_kind: ToolKind;
  tool_name: string;
  effect_status: EffectEnvelope['effectStatus'];
  started_at: string | Date;
  completed_at: string | Date;
  artifact_refs: string[];
  result_payload: Record<string, unknown>;
  error_class: string | null;
  error_message: string | null;
  created_at: string | Date;
}

export interface PersistedRunEffect extends EffectEnvelope {
  effectId: string;
  companyId: string;
  executionPacketId: string;
  toolKind: ToolKind;
  toolName: string;
  createdAt: string;
}

function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeOptionalNumber(
  value: string | number | null | undefined,
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const numericValue =
    typeof value === 'number' ? value : Number.parseInt(value, 10);

  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function mapRepositoryTarget(
  owner: string | null,
  name: string | null,
  id: string | number | null,
): RepositoryTarget | undefined {
  if (!owner || !name) {
    return undefined;
  }

  return {
    owner,
    name,
    id: normalizeOptionalNumber(id),
  };
}

export function mapCompanyRow(row: CompanyRow): Company {
  return {
    companyId: row.company_id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    betaPhase: row.beta_phase ?? 'internal_alpha',
    betaEnrollmentStatus: row.beta_enrollment_status ?? 'active',
    betaNotes: row.beta_notes ?? undefined,
    betaUpdatedAt: row.beta_updated_at
      ? normalizeTimestamp(row.beta_updated_at)
      : normalizeTimestamp(row.created_at),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function mapObjectiveRow(row: ObjectiveRow): Objective {
  return {
    objectiveId: row.objective_id,
    companyId: row.company_id,
    title: row.title,
    summary: row.summary ?? undefined,
    repositoryTarget: mapRepositoryTarget(
      row.target_repository_owner,
      row.target_repository_name,
      row.target_repository_id,
    ),
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapWorkItemRow(row: WorkItemRow): WorkItem {
  return {
    workItemId: row.work_item_id,
    companyId: row.company_id,
    objectiveId: row.objective_id,
    title: row.title,
    description: row.description ?? undefined,
    repositoryTarget: mapRepositoryTarget(
      row.target_repository_owner,
      row.target_repository_name,
      row.target_repository_id,
    ),
    status: row.status,
    attemptBudget: row.attempt_budget,
    requiresApproval: row.requires_approval,
    validationContractRef: row.validation_contract_ref,
    scopeRef: row.scope_ref,
    blockingReason: row.blocking_reason ?? undefined,
    latestRunId: row.latest_run_id ?? undefined,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapRunRow(row: RunRow): Run {
  return {
    runId: row.run_id,
    companyId: row.company_id,
    workItemId: row.work_item_id,
    attempt: row.attempt,
    status: row.status,
    executionPacketId: row.execution_packet_id ?? undefined,
    headSha: row.head_sha ?? undefined,
    summary: row.summary ?? undefined,
    failureClass: row.failure_class ?? undefined,
    availableAt: normalizeTimestamp(row.available_at),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapApprovalRow(row: ApprovalRow): ApprovalDecision {
  return {
    approvalId: row.approval_id,
    companyId: row.company_id,
    workItemId: row.work_item_id,
    status: row.status,
    requestedAction: row.requested_action,
    decisionReason: row.decision_reason ?? undefined,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapClaimLeaseRow(row: ClaimLeaseRow): PersistedClaimLease {
  return {
    claimId: row.claim_id,
    companyId: row.company_id,
    workItemId: row.work_item_id,
    scopeRef: row.scope_ref,
    holderRunId: row.holder_run_id,
    leaseExpiresAt: normalizeTimestamp(row.lease_expires_at),
    leaseStatus: row.lease_status,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapRunEffectRow(row: RunEffectRow): PersistedRunEffect {
  return {
    effectId: row.effect_id,
    companyId: row.company_id,
    runId: row.run_id,
    executionPacketId: row.execution_packet_id,
    toolCallId: row.tool_call_id,
    toolKind: row.tool_kind,
    toolName: row.tool_name,
    effectStatus: row.effect_status,
    startedAt: normalizeTimestamp(row.started_at),
    completedAt: normalizeTimestamp(row.completed_at),
    artifactRefs: row.artifact_refs,
    resultPayload: row.result_payload,
    errorClass: row.error_class ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export async function getCompanyById(
  db: Queryable,
  companyId: string,
): Promise<Company | null> {
  const result = await db.query<CompanyRow>(
    `
      select
        company_id,
        slug,
        display_name,
        status,
        beta_phase,
        beta_enrollment_status,
        beta_notes,
        beta_updated_at,
        created_at
      from companies
      where company_id = $1
      limit 1
    `,
    [companyId],
  );

  return result.rows[0] ? mapCompanyRow(result.rows[0]) : null;
}

export async function getCompanyBySlug(
  db: Queryable,
  slug: string,
): Promise<Company | null> {
  const result = await db.query<CompanyRow>(
    `
      select
        company_id,
        slug,
        display_name,
        status,
        beta_phase,
        beta_enrollment_status,
        beta_notes,
        beta_updated_at,
        created_at
      from companies
      where slug = $1
      limit 1
    `,
    [slug],
  );

  return result.rows[0] ? mapCompanyRow(result.rows[0]) : null;
}

export async function listCompanies(db: Queryable): Promise<Company[]> {
  const result = await db.query<CompanyRow>(
    `
      select
        company_id,
        slug,
        display_name,
        status,
        beta_phase,
        beta_enrollment_status,
        beta_notes,
        beta_updated_at,
        created_at
      from companies
      order by created_at asc
    `,
  );

  return result.rows.map(mapCompanyRow);
}

export async function insertCompany(
  db: Queryable,
  company: Company,
): Promise<void> {
  await db.query(
    `
      insert into companies (
        company_id,
        slug,
        display_name,
        status,
        beta_phase,
        beta_enrollment_status,
        beta_notes,
        beta_updated_at,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      company.companyId,
      company.slug,
      company.displayName,
      company.status,
      company.betaPhase ?? null,
      company.betaEnrollmentStatus ?? null,
      company.betaNotes ?? null,
      company.betaUpdatedAt ?? null,
      company.createdAt,
    ],
  );
}

export async function upsertCompany(
  db: Queryable,
  company: Company,
): Promise<void> {
  await db.query(
    `
      insert into companies (
        company_id,
        slug,
        display_name,
        status,
        beta_phase,
        beta_enrollment_status,
        beta_notes,
        beta_updated_at,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (company_id)
      do update set
        slug = excluded.slug,
        display_name = excluded.display_name,
        status = excluded.status,
        beta_phase = excluded.beta_phase,
        beta_enrollment_status = excluded.beta_enrollment_status,
        beta_notes = excluded.beta_notes,
        beta_updated_at = excluded.beta_updated_at
    `,
    [
      company.companyId,
      company.slug,
      company.displayName,
      company.status,
      company.betaPhase ?? null,
      company.betaEnrollmentStatus ?? null,
      company.betaNotes ?? null,
      company.betaUpdatedAt ?? null,
      company.createdAt,
    ],
  );
}

export async function listObjectives(
  db: Queryable,
  companyId: string,
): Promise<Objective[]> {
  const result = await db.query<ObjectiveRow>(
    `
      select
        objective_id,
        company_id,
        title,
        summary,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        created_at,
        updated_at
      from objectives
      where company_id = $1
      order by created_at asc
    `,
    [companyId],
  );

  return result.rows.map(mapObjectiveRow);
}

export async function listAllObjectives(db: Queryable): Promise<Objective[]> {
  const result = await db.query<ObjectiveRow>(
    `
      select
        objective_id,
        company_id,
        title,
        summary,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        created_at,
        updated_at
      from objectives
      order by created_at asc
    `,
  );

  return result.rows.map(mapObjectiveRow);
}

export async function getObjectiveById(
  db: Queryable,
  objectiveId: string,
): Promise<Objective | null> {
  const result = await db.query<ObjectiveRow>(
    `
      select
        objective_id,
        company_id,
        title,
        summary,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        created_at,
        updated_at
      from objectives
      where objective_id = $1
      limit 1
    `,
    [objectiveId],
  );

  return result.rows[0] ? mapObjectiveRow(result.rows[0]) : null;
}

export async function upsertObjective(
  db: Queryable,
  objective: Objective,
): Promise<void> {
  await db.query(
    `
      insert into objectives (
        objective_id,
        company_id,
        title,
        summary,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (objective_id)
      do update set
        title = excluded.title,
        summary = excluded.summary,
        target_repository_owner = excluded.target_repository_owner,
        target_repository_name = excluded.target_repository_name,
        target_repository_id = excluded.target_repository_id,
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
    [
      objective.objectiveId,
      objective.companyId,
      objective.title,
      objective.summary ?? null,
      objective.repositoryTarget?.owner ?? null,
      objective.repositoryTarget?.name ?? null,
      objective.repositoryTarget?.id ?? null,
      objective.status,
      objective.createdAt,
      objective.updatedAt,
    ],
  );
}

export async function listWorkItemsByObjective(
  db: Queryable,
  objectiveId: string,
): Promise<WorkItem[]> {
  const result = await db.query<WorkItemRow>(
    `
      select
        work_item_id,
        company_id,
        objective_id,
        title,
        description,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        attempt_budget,
        requires_approval,
        validation_contract_ref,
        scope_ref,
        blocking_reason,
        latest_run_id,
        created_at,
        updated_at
      from work_items
      where objective_id = $1
      order by created_at asc
    `,
    [objectiveId],
  );

  return result.rows.map(mapWorkItemRow);
}

export async function listWorkItems(
  db: Queryable,
  filters: {
    companyId?: string;
    objectiveId?: string;
    scopeRef?: string;
    statuses?: WorkItem['status'][];
  } = {},
): Promise<WorkItem[]> {
  const values: Array<string | string[]> = [];
  const clauses: string[] = [];

  if (filters.companyId) {
    values.push(filters.companyId);
    clauses.push(`company_id = $${values.length}`);
  }

  if (filters.objectiveId) {
    values.push(filters.objectiveId);
    clauses.push(`objective_id = $${values.length}`);
  }

  if (filters.scopeRef) {
    values.push(filters.scopeRef);
    clauses.push(`scope_ref = $${values.length}`);
  }

  if (filters.statuses && filters.statuses.length > 0) {
    values.push(filters.statuses);
    clauses.push(`status = any($${values.length}::text[])`);
  }

  const whereClause =
    clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';

  const result = await db.query<WorkItemRow>(
    `
      select
        work_item_id,
        company_id,
        objective_id,
        title,
        description,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        attempt_budget,
        requires_approval,
        validation_contract_ref,
        scope_ref,
        blocking_reason,
        latest_run_id,
        created_at,
        updated_at
      from work_items
      ${whereClause}
      order by created_at asc
    `,
    values,
  );

  return result.rows.map(mapWorkItemRow);
}

export async function getWorkItemById(
  db: Queryable,
  workItemId: string,
): Promise<WorkItem | null> {
  const result = await db.query<WorkItemRow>(
    `
      select
        work_item_id,
        company_id,
        objective_id,
        title,
        description,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        attempt_budget,
        requires_approval,
        validation_contract_ref,
        scope_ref,
        blocking_reason,
        latest_run_id,
        created_at,
        updated_at
      from work_items
      where work_item_id = $1
      limit 1
    `,
    [workItemId],
  );

  return result.rows[0] ? mapWorkItemRow(result.rows[0]) : null;
}

export async function upsertWorkItem(
  db: Queryable,
  workItem: WorkItem,
): Promise<void> {
  await db.query(
    `
      insert into work_items (
        work_item_id,
        company_id,
        objective_id,
        title,
        description,
        target_repository_owner,
        target_repository_name,
        target_repository_id,
        status,
        attempt_budget,
        requires_approval,
        validation_contract_ref,
        scope_ref,
        blocking_reason,
        latest_run_id,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      on conflict (work_item_id)
      do update set
        title = excluded.title,
        description = excluded.description,
        target_repository_owner = excluded.target_repository_owner,
        target_repository_name = excluded.target_repository_name,
        target_repository_id = excluded.target_repository_id,
        status = excluded.status,
        attempt_budget = excluded.attempt_budget,
        requires_approval = excluded.requires_approval,
        validation_contract_ref = excluded.validation_contract_ref,
        scope_ref = excluded.scope_ref,
        blocking_reason = excluded.blocking_reason,
        latest_run_id = excluded.latest_run_id,
        updated_at = excluded.updated_at
    `,
    [
      workItem.workItemId,
      workItem.companyId,
      workItem.objectiveId,
      workItem.title,
      workItem.description ?? null,
      workItem.repositoryTarget?.owner ?? null,
      workItem.repositoryTarget?.name ?? null,
      workItem.repositoryTarget?.id ?? null,
      workItem.status,
      workItem.attemptBudget,
      workItem.requiresApproval,
      workItem.validationContractRef,
      workItem.scopeRef,
      workItem.blockingReason ?? null,
      workItem.latestRunId ?? null,
      workItem.createdAt,
      workItem.updatedAt,
    ],
  );
}

export async function listRunsByWorkItem(
  db: Queryable,
  workItemId: string,
): Promise<Run[]> {
  const result = await db.query<RunRow>(
    `
      select
        run_id,
        company_id,
        work_item_id,
        attempt,
        status,
        execution_packet_id,
        head_sha,
        summary,
        failure_class,
        available_at,
        created_at,
        updated_at
      from runs
      where work_item_id = $1
      order by attempt asc
    `,
    [workItemId],
  );

  return result.rows.map(mapRunRow);
}

export async function listRuns(
  db: Queryable,
  filters: {
    companyId?: string;
    workItemId?: string;
    statuses?: Run['status'][];
  } = {},
): Promise<Run[]> {
  const values: Array<string | string[]> = [];
  const clauses: string[] = [];

  if (filters.companyId) {
    values.push(filters.companyId);
    clauses.push(`company_id = $${values.length}`);
  }

  if (filters.workItemId) {
    values.push(filters.workItemId);
    clauses.push(`work_item_id = $${values.length}`);
  }

  if (filters.statuses && filters.statuses.length > 0) {
    values.push(filters.statuses);
    clauses.push(`status = any($${values.length}::text[])`);
  }

  const whereClause =
    clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';

  const result = await db.query<RunRow>(
    `
      select
        run_id,
        company_id,
        work_item_id,
        attempt,
        status,
        execution_packet_id,
        head_sha,
        summary,
        failure_class,
        available_at,
        created_at,
        updated_at
      from runs
      ${whereClause}
      order by created_at asc, attempt asc
    `,
    values,
  );

  return result.rows.map(mapRunRow);
}

export async function getRunById(
  db: Queryable,
  runId: string,
): Promise<Run | null> {
  const result = await db.query<RunRow>(
    `
      select
        run_id,
        company_id,
        work_item_id,
        attempt,
        status,
        execution_packet_id,
        head_sha,
        summary,
        failure_class,
        available_at,
        created_at,
        updated_at
      from runs
      where run_id = $1
      limit 1
    `,
    [runId],
  );

  return result.rows[0] ? mapRunRow(result.rows[0]) : null;
}

export async function upsertRun(db: Queryable, run: Run): Promise<void> {
  await db.query(
    `
      insert into runs (
        run_id,
        company_id,
        work_item_id,
        attempt,
        status,
        execution_packet_id,
        head_sha,
        summary,
        failure_class,
        available_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (run_id)
      do update set
        status = excluded.status,
        execution_packet_id = excluded.execution_packet_id,
        head_sha = excluded.head_sha,
        summary = excluded.summary,
        failure_class = excluded.failure_class,
        available_at = excluded.available_at,
        updated_at = excluded.updated_at
    `,
    [
      run.runId,
      run.companyId,
      run.workItemId,
      run.attempt,
      run.status,
      run.executionPacketId ?? null,
      run.headSha ?? null,
      run.summary ?? null,
      run.failureClass ?? null,
      run.availableAt ?? run.createdAt,
      run.createdAt,
      run.updatedAt,
    ],
  );
}

export async function storeExecutionPacket(
  db: Queryable,
  packet: ExecutionPacket,
): Promise<void> {
  await db.query(
    `
      insert into execution_packets (
        execution_packet_id,
        company_id,
        work_item_id,
        run_id,
        packet,
        created_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6)
      on conflict (execution_packet_id)
      do update set packet = excluded.packet
    `,
    [
      packet.executionPacketId,
      packet.companyId,
      packet.workItemId,
      packet.runId,
      JSON.stringify(packet),
      packet.createdAt,
    ],
  );
}

export async function getExecutionPacketByRunId(
  db: Queryable,
  runId: string,
): Promise<ExecutionPacket | null> {
  const result = await db.query<ExecutionPacketRow>(
    `
      select execution_packet_id, company_id, work_item_id, run_id, packet, created_at
      from execution_packets
      where run_id = $1
      limit 1
    `,
    [runId],
  );

  return result.rows[0]?.packet ?? null;
}

export async function expireActiveClaimLeases(
  db: Queryable,
  input: {
    companyId: string;
    asOf: string;
    scopeRef?: string;
    holderRunId?: string;
  },
): Promise<PersistedClaimLease[]> {
  const values: string[] = [input.companyId, input.asOf];
  const clauses = ['company_id = $1', "lease_status = 'active'"];

  if (input.scopeRef) {
    values.push(input.scopeRef);
    clauses.push(`scope_ref = $${values.length}`);
  }

  if (input.holderRunId) {
    values.push(input.holderRunId);
    clauses.push(`holder_run_id = $${values.length}`);
  }

  const result = await db.query<ClaimLeaseRow>(
    `
      update claim_leases
      set
        lease_status = 'expired',
        updated_at = $2
      where ${clauses.join(' and ')} and lease_expires_at <= $2
      returning
        claim_id,
        company_id,
        work_item_id,
        scope_ref,
        holder_run_id,
        lease_expires_at,
        lease_status,
        created_at,
        updated_at
    `,
    values,
  );

  return result.rows.map(mapClaimLeaseRow);
}

export async function getActiveClaimLeaseByScope(
  db: Queryable,
  companyId: string,
  scopeRef: string,
): Promise<PersistedClaimLease | null> {
  const result = await db.query<ClaimLeaseRow>(
    `
      select
        claim_id,
        company_id,
        work_item_id,
        scope_ref,
        holder_run_id,
        lease_expires_at,
        lease_status,
        created_at,
        updated_at
      from claim_leases
      where company_id = $1
        and scope_ref = $2
        and lease_status = 'active'
      limit 1
    `,
    [companyId, scopeRef],
  );

  return result.rows[0] ? mapClaimLeaseRow(result.rows[0]) : null;
}

export async function getActiveClaimLeaseByRunId(
  db: Queryable,
  runId: string,
): Promise<PersistedClaimLease | null> {
  const result = await db.query<ClaimLeaseRow>(
    `
      select
        claim_id,
        company_id,
        work_item_id,
        scope_ref,
        holder_run_id,
        lease_expires_at,
        lease_status,
        created_at,
        updated_at
      from claim_leases
      where holder_run_id = $1
        and lease_status = 'active'
      limit 1
    `,
    [runId],
  );

  return result.rows[0] ? mapClaimLeaseRow(result.rows[0]) : null;
}

export async function acquireClaimLease(
  db: Queryable,
  lease: PersistedClaimLease,
): Promise<PersistedClaimLease | null> {
  const result = await db.query<ClaimLeaseRow>(
    `
      insert into claim_leases (
        claim_id,
        company_id,
        work_item_id,
        scope_ref,
        holder_run_id,
        lease_expires_at,
        lease_status,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict do nothing
      returning
        claim_id,
        company_id,
        work_item_id,
        scope_ref,
        holder_run_id,
        lease_expires_at,
        lease_status,
        created_at,
        updated_at
    `,
    [
      lease.claimId,
      lease.companyId,
      lease.workItemId,
      lease.scopeRef,
      lease.holderRunId,
      lease.leaseExpiresAt,
      lease.leaseStatus,
      lease.createdAt,
      lease.updatedAt,
    ],
  );

  return result.rows[0] ? mapClaimLeaseRow(result.rows[0]) : null;
}

export async function updateClaimLease(
  db: Queryable,
  lease: PersistedClaimLease,
): Promise<void> {
  await db.query(
    `
      update claim_leases
      set
        holder_run_id = $2,
        lease_expires_at = $3,
        lease_status = $4,
        updated_at = $5
      where claim_id = $1
    `,
    [
      lease.claimId,
      lease.holderRunId,
      lease.leaseExpiresAt,
      lease.leaseStatus,
      lease.updatedAt,
    ],
  );
}

export async function releaseClaimLeaseByRunId(
  db: Queryable,
  input: {
    runId: string;
    releasedAt: string;
    leaseStatus?: 'expired' | 'released';
  },
): Promise<PersistedClaimLease | null> {
  const result = await db.query<ClaimLeaseRow>(
    `
      update claim_leases
      set
        lease_status = $2,
        lease_expires_at = $3,
        updated_at = $3
      where holder_run_id = $1
        and lease_status = 'active'
      returning
        claim_id,
        company_id,
        work_item_id,
        scope_ref,
        holder_run_id,
        lease_expires_at,
        lease_status,
        created_at,
        updated_at
    `,
    [input.runId, input.leaseStatus ?? 'released', input.releasedAt],
  );

  return result.rows[0] ? mapClaimLeaseRow(result.rows[0]) : null;
}

export async function dequeueQueuedRun(
  db: Queryable,
  now: string,
): Promise<Run | null> {
  const result = await db.query<RunRow>(
    `
      with next_run as (
        select run_id
        from runs
        where status = 'queued'
          and available_at <= $1
        order by available_at asc, created_at asc, attempt asc
        limit 1
        for update skip locked
      )
      update runs
      set
        status = 'running',
        updated_at = $1
      where run_id in (select run_id from next_run)
      returning
        run_id,
        company_id,
        work_item_id,
        attempt,
        status,
        execution_packet_id,
        head_sha,
        summary,
        failure_class,
        available_at,
        created_at,
        updated_at
    `,
    [now],
  );

  return result.rows[0] ? mapRunRow(result.rows[0]) : null;
}

export async function storeRunEffect(
  db: Queryable,
  input: ExecutorResult & { companyId: string },
): Promise<void> {
  const effectId = `${input.effect.runId}:${input.toolRequest.toolCallId}`;
  await db.query(
    `
      insert into run_effects (
        effect_id,
        company_id,
        run_id,
        execution_packet_id,
        tool_call_id,
        tool_kind,
        tool_name,
        effect_status,
        started_at,
        completed_at,
        artifact_refs,
        result_payload,
        error_class,
        error_message,
        created_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15
      )
      on conflict (run_id, tool_call_id)
      do update set
        effect_status = excluded.effect_status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        artifact_refs = excluded.artifact_refs,
        result_payload = excluded.result_payload,
        error_class = excluded.error_class,
        error_message = excluded.error_message,
        created_at = excluded.created_at
    `,
    [
      effectId,
      input.companyId,
      input.effect.runId,
      input.toolRequest.executionPacketId,
      input.toolRequest.toolCallId,
      input.toolRequest.toolKind,
      input.toolRequest.toolName,
      input.effect.effectStatus,
      input.effect.startedAt,
      input.effect.completedAt,
      JSON.stringify(input.effect.artifactRefs),
      JSON.stringify(input.effect.resultPayload),
      input.effect.errorClass ?? null,
      input.effect.errorMessage ?? null,
      input.effect.completedAt,
    ],
  );
}

export async function listRunEffectsByRunId(
  db: Queryable,
  runId: string,
): Promise<PersistedRunEffect[]> {
  const result = await db.query<RunEffectRow>(
    `
      select
        effect_id,
        company_id,
        run_id,
        execution_packet_id,
        tool_call_id,
        tool_kind,
        tool_name,
        effect_status,
        started_at,
        completed_at,
        artifact_refs,
        result_payload,
        error_class,
        error_message,
        created_at
      from run_effects
      where run_id = $1
      order by created_at asc
    `,
    [runId],
  );

  return result.rows.map(mapRunEffectRow);
}

export async function getApprovalByWorkItemId(
  db: Queryable,
  workItemId: string,
): Promise<ApprovalDecision | null> {
  const result = await db.query<ApprovalRow>(
    `
      select
        approval_id,
        company_id,
        work_item_id,
        status,
        requested_action,
        decision_reason,
        created_at,
        updated_at
      from approvals
      where work_item_id = $1
      order by created_at desc
      limit 1
    `,
    [workItemId],
  );

  return result.rows[0] ? mapApprovalRow(result.rows[0]) : null;
}

export async function getApprovalById(
  db: Queryable,
  approvalId: string,
): Promise<ApprovalDecision | null> {
  const result = await db.query<ApprovalRow>(
    `
      select
        approval_id,
        company_id,
        work_item_id,
        status,
        requested_action,
        decision_reason,
        created_at,
        updated_at
      from approvals
      where approval_id = $1
      limit 1
    `,
    [approvalId],
  );

  return result.rows[0] ? mapApprovalRow(result.rows[0]) : null;
}

export async function listApprovals(
  db: Queryable,
  status?: ApprovalDecision['status'],
): Promise<ApprovalDecision[]> {
  const values: string[] = [];
  const whereClause = status
    ? (() => {
        values.push(status);
        return 'where status = $1';
      })()
    : '';

  const result = await db.query<ApprovalRow>(
    `
      select
        approval_id,
        company_id,
        work_item_id,
        status,
        requested_action,
        decision_reason,
        created_at,
        updated_at
      from approvals
      ${whereClause}
      order by created_at asc
    `,
    values,
  );

  return result.rows.map(mapApprovalRow);
}

export async function listApprovalsByCompany(
  db: Queryable,
  companyId: string,
  status?: ApprovalDecision['status'],
): Promise<ApprovalDecision[]> {
  const values: string[] = [companyId];
  const clauses = [`company_id = $${values.length}`];

  if (status) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  const result = await db.query<ApprovalRow>(
    `
      select
        approval_id,
        company_id,
        work_item_id,
        status,
        requested_action,
        decision_reason,
        created_at,
        updated_at
      from approvals
      where ${clauses.join(' and ')}
      order by created_at asc
    `,
    values,
  );

  return result.rows.map(mapApprovalRow);
}

export async function upsertApproval(
  db: Queryable,
  approval: ApprovalDecision,
): Promise<void> {
  await db.query(
    `
      insert into approvals (
        approval_id,
        company_id,
        work_item_id,
        status,
        requested_action,
        decision_reason,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (approval_id)
      do update set
        status = excluded.status,
        decision_reason = excluded.decision_reason,
        updated_at = excluded.updated_at
    `,
    [
      approval.approvalId,
      approval.companyId,
      approval.workItemId,
      approval.status,
      approval.requestedAction,
      approval.decisionReason ?? null,
      approval.createdAt,
      approval.updatedAt,
    ],
  );
}
