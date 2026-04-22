import type {
  ApprovalDecision,
  Company,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';
import type { ExecutionPacket } from '@escalonalabs/execution';

import type { Queryable } from './events';

export interface CompanyRow {
  company_id: string;
  slug: string;
  display_name: string;
  status: Company['status'];
  created_at: string | Date;
}

export interface ObjectiveRow {
  objective_id: string;
  company_id: string;
  title: string;
  summary: string | null;
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
  summary: string | null;
  failure_class: string | null;
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

function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function mapCompanyRow(row: CompanyRow): Company {
  return {
    companyId: row.company_id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function mapObjectiveRow(row: ObjectiveRow): Objective {
  return {
    objectiveId: row.objective_id,
    companyId: row.company_id,
    title: row.title,
    summary: row.summary ?? undefined,
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
    summary: row.summary ?? undefined,
    failureClass: row.failure_class ?? undefined,
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

export async function getCompanyById(
  db: Queryable,
  companyId: string,
): Promise<Company | null> {
  const result = await db.query<CompanyRow>(
    `
      select company_id, slug, display_name, status, created_at
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
      select company_id, slug, display_name, status, created_at
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
      select company_id, slug, display_name, status, created_at
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
      insert into companies (company_id, slug, display_name, status, created_at)
      values ($1, $2, $3, $4, $5)
    `,
    [
      company.companyId,
      company.slug,
      company.displayName,
      company.status,
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
      select objective_id, company_id, title, summary, status, created_at, updated_at
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
      select objective_id, company_id, title, summary, status, created_at, updated_at
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
      select objective_id, company_id, title, summary, status, created_at, updated_at
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
        status,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (objective_id)
      do update set
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
    [
      objective.objectiveId,
      objective.companyId,
      objective.title,
      objective.summary ?? null,
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
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      on conflict (work_item_id)
      do update set
        title = excluded.title,
        description = excluded.description,
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
        summary,
        failure_class,
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
        summary,
        failure_class,
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
        summary,
        failure_class,
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
        summary,
        failure_class,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (run_id)
      do update set
        status = excluded.status,
        execution_packet_id = excluded.execution_packet_id,
        summary = excluded.summary,
        failure_class = excluded.failure_class,
        updated_at = excluded.updated_at
    `,
    [
      run.runId,
      run.companyId,
      run.workItemId,
      run.attempt,
      run.status,
      run.executionPacketId ?? null,
      run.summary ?? null,
      run.failureClass ?? null,
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
