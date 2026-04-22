import type { DriftAlert } from '@escalonalabs/domain';
import type {
  GitHubInboundEventRecord,
  GitHubInstallationRef,
  GitHubProjectionBinding,
  GitHubProjectionDelivery,
} from '@escalonalabs/github';

import type { Queryable } from './events';

interface GitHubInstallationRow {
  company_id: string;
  installation_id: string | number;
  account_login: string;
  repository_owner: string;
  repository_name: string;
  repository_id: string | number | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface GitHubProjectionBindingRow {
  binding_id: string;
  company_id: string;
  aggregate_type: string;
  aggregate_id: string;
  github_object_type: GitHubProjectionBinding['githubObjectType'];
  github_object_id: string;
  github_object_number: number | null;
  repository_owner: string;
  repository_name: string;
  repository_id: string | number | null;
  metadata_version: string;
  last_source_event_id: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface GitHubProjectionDeliveryRow {
  projection_delivery_id: string;
  projection_name: 'github';
  company_id: string;
  aggregate_type: string;
  aggregate_id: string;
  source_event_id: string;
  github_object_type: GitHubProjectionDelivery['githubObjectType'];
  action_type: GitHubProjectionDelivery['actionType'];
  delivery_key: string;
  status: GitHubProjectionDelivery['status'];
  attempt_count: number;
  github_object_ref: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
  applied_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface GitHubInboundEventRow {
  inbound_event_id: string;
  github_delivery_id: string;
  github_event_name: string;
  action: string | null;
  company_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  classification: GitHubInboundEventRecord['classification'];
  status: GitHubInboundEventRecord['status'];
  proposed_command: GitHubInboundEventRecord['proposedCommand'] | null;
  notes: string | null;
  payload: Record<string, unknown>;
  created_at: string | Date;
}

interface DriftAlertRow {
  alert_id: string;
  company_id: string;
  aggregate_type: string;
  aggregate_id: string;
  severity: DriftAlert['severity'];
  summary: string;
  github_object_ref: string | null;
  drift_class: string | null;
  source_event_id: string | null;
  observed_at: string | Date | null;
  repair_status: DriftAlert['repairStatus'] | null;
  notes: string | null;
}

function normalizeTimestamp(
  value: string | Date | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

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

function mapInstallationRow(row: GitHubInstallationRow): GitHubInstallationRef {
  return {
    companyId: row.company_id,
    installationId: normalizeOptionalNumber(row.installation_id) ?? 0,
    accountLogin: row.account_login,
    repository: {
      owner: row.repository_owner,
      name: row.repository_name,
      id: normalizeOptionalNumber(row.repository_id),
    },
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapBindingRow(
  row: GitHubProjectionBindingRow,
): GitHubProjectionBinding {
  return {
    bindingId: row.binding_id,
    companyId: row.company_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    githubObjectType: row.github_object_type,
    githubObjectId: row.github_object_id,
    githubObjectNumber: row.github_object_number ?? undefined,
    repository: {
      owner: row.repository_owner,
      name: row.repository_name,
      id: normalizeOptionalNumber(row.repository_id),
    },
    metadataVersion: row.metadata_version,
    lastSourceEventId: row.last_source_event_id,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapDeliveryRow(
  row: GitHubProjectionDeliveryRow,
): GitHubProjectionDelivery {
  return {
    projectionDeliveryId: row.projection_delivery_id,
    projectionName: row.projection_name,
    companyId: row.company_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    sourceEventId: row.source_event_id,
    githubObjectType: row.github_object_type,
    actionType: row.action_type,
    deliveryKey: row.delivery_key,
    status: row.status,
    attemptCount: row.attempt_count,
    githubObjectRef: row.github_object_ref ?? undefined,
    lastError: row.last_error ?? undefined,
    payload: row.payload,
    appliedAt: normalizeTimestamp(row.applied_at),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapInboundEventRow(
  row: GitHubInboundEventRow,
): GitHubInboundEventRecord {
  return {
    inboundEventId: row.inbound_event_id,
    githubDeliveryId: row.github_delivery_id,
    githubEventName: row.github_event_name,
    action: row.action ?? undefined,
    companyId: row.company_id ?? undefined,
    aggregateType: row.aggregate_type ?? undefined,
    aggregateId: row.aggregate_id ?? undefined,
    classification: row.classification,
    status: row.status,
    proposedCommand: row.proposed_command ?? undefined,
    notes: row.notes ?? undefined,
    payload: row.payload,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
  };
}

function mapDriftAlertRow(row: DriftAlertRow): DriftAlert {
  return {
    alertId: row.alert_id,
    companyId: row.company_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    severity: row.severity,
    summary: row.summary,
    githubObjectRef: row.github_object_ref ?? undefined,
    driftClass: row.drift_class ?? undefined,
    sourceEventId: row.source_event_id ?? undefined,
    observedAt: normalizeTimestamp(row.observed_at),
    repairStatus: row.repair_status ?? undefined,
    notes: row.notes ?? undefined,
  };
}

export async function listGitHubInstallations(
  db: Queryable,
  companyId: string,
): Promise<GitHubInstallationRef[]> {
  const result = await db.query<GitHubInstallationRow>(
    `
      select
        company_id,
        installation_id,
        account_login,
        repository_owner,
        repository_name,
        repository_id,
        created_at,
        updated_at
      from github_installations
      where company_id = $1
      order by updated_at desc, repository_owner asc, repository_name asc
    `,
    [companyId],
  );

  return result.rows.map(mapInstallationRow);
}

export async function getGitHubInstallationForCompany(
  db: Queryable,
  companyId: string,
): Promise<GitHubInstallationRef | null> {
  const installations = await listGitHubInstallations(db, companyId);
  return installations[0] ?? null;
}

export async function upsertGitHubInstallation(
  db: Queryable,
  installation: GitHubInstallationRef,
): Promise<void> {
  await db.query(
    `
      insert into github_installations (
        company_id,
        installation_id,
        account_login,
        repository_owner,
        repository_name,
        repository_id,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (company_id, installation_id, repository_owner, repository_name)
      do update set
        account_login = excluded.account_login,
        repository_id = excluded.repository_id,
        updated_at = excluded.updated_at
    `,
    [
      installation.companyId,
      installation.installationId,
      installation.accountLogin,
      installation.repository.owner,
      installation.repository.name,
      installation.repository.id ?? null,
      installation.createdAt,
      installation.updatedAt,
    ],
  );
}

export async function listGitHubProjectionBindings(
  db: Queryable,
  filters: {
    companyId: string;
    aggregateType?: string;
    aggregateId?: string;
    githubObjectType?: GitHubProjectionBinding['githubObjectType'];
  },
): Promise<GitHubProjectionBinding[]> {
  const values: Array<string> = [filters.companyId];
  const clauses = ['company_id = $1'];

  if (filters.aggregateType) {
    values.push(filters.aggregateType);
    clauses.push(`aggregate_type = $${values.length}`);
  }

  if (filters.aggregateId) {
    values.push(filters.aggregateId);
    clauses.push(`aggregate_id = $${values.length}`);
  }

  if (filters.githubObjectType) {
    values.push(filters.githubObjectType);
    clauses.push(`github_object_type = $${values.length}`);
  }

  const result = await db.query<GitHubProjectionBindingRow>(
    `
      select
        binding_id,
        company_id,
        aggregate_type,
        aggregate_id,
        github_object_type,
        github_object_id,
        github_object_number,
        repository_owner,
        repository_name,
        repository_id,
        metadata_version,
        last_source_event_id,
        created_at,
        updated_at
      from github_projection_bindings
      where ${clauses.join(' and ')}
      order by updated_at desc
    `,
    values,
  );

  return result.rows.map(mapBindingRow);
}

export async function upsertGitHubProjectionBinding(
  db: Queryable,
  binding: GitHubProjectionBinding,
): Promise<void> {
  await db.query(
    `
      insert into github_projection_bindings (
        binding_id,
        company_id,
        aggregate_type,
        aggregate_id,
        github_object_type,
        github_object_id,
        github_object_number,
        repository_owner,
        repository_name,
        repository_id,
        metadata_version,
        last_source_event_id,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      on conflict (company_id, aggregate_type, aggregate_id, github_object_type)
      do update set
        binding_id = excluded.binding_id,
        github_object_id = excluded.github_object_id,
        github_object_number = excluded.github_object_number,
        repository_owner = excluded.repository_owner,
        repository_name = excluded.repository_name,
        repository_id = excluded.repository_id,
        metadata_version = excluded.metadata_version,
        last_source_event_id = excluded.last_source_event_id,
        updated_at = excluded.updated_at
    `,
    [
      binding.bindingId,
      binding.companyId,
      binding.aggregateType,
      binding.aggregateId,
      binding.githubObjectType,
      binding.githubObjectId,
      binding.githubObjectNumber ?? null,
      binding.repository.owner,
      binding.repository.name,
      binding.repository.id ?? null,
      binding.metadataVersion,
      binding.lastSourceEventId,
      binding.createdAt,
      binding.updatedAt,
    ],
  );
}

export async function listGitHubProjectionDeliveries(
  db: Queryable,
  filters: {
    companyId: string;
    status?: GitHubProjectionDelivery['status'];
    limit?: number;
  },
): Promise<GitHubProjectionDelivery[]> {
  const values: Array<string | number> = [filters.companyId];
  const clauses = ['company_id = $1'];

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  values.push(filters.limit ?? 200);

  const result = await db.query<GitHubProjectionDeliveryRow>(
    `
      select
        projection_delivery_id,
        projection_name,
        company_id,
        aggregate_type,
        aggregate_id,
        source_event_id,
        github_object_type,
        action_type,
        delivery_key,
        status,
        attempt_count,
        github_object_ref,
        last_error,
        payload,
        applied_at,
        created_at,
        updated_at
      from github_projection_deliveries
      where ${clauses.join(' and ')}
      order by created_at desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(mapDeliveryRow);
}

export async function upsertGitHubProjectionDelivery(
  db: Queryable,
  delivery: GitHubProjectionDelivery,
): Promise<void> {
  await db.query(
    `
      insert into github_projection_deliveries (
        projection_delivery_id,
        projection_name,
        company_id,
        aggregate_type,
        aggregate_id,
        source_event_id,
        github_object_type,
        action_type,
        delivery_key,
        status,
        attempt_count,
        github_object_ref,
        last_error,
        payload,
        applied_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
      on conflict (delivery_key)
      do update set
        projection_delivery_id = excluded.projection_delivery_id,
        status = excluded.status,
        attempt_count = excluded.attempt_count,
        github_object_ref = excluded.github_object_ref,
        last_error = excluded.last_error,
        payload = excluded.payload,
        applied_at = excluded.applied_at,
        updated_at = excluded.updated_at
    `,
    [
      delivery.projectionDeliveryId,
      delivery.projectionName,
      delivery.companyId,
      delivery.aggregateType,
      delivery.aggregateId,
      delivery.sourceEventId,
      delivery.githubObjectType,
      delivery.actionType,
      delivery.deliveryKey,
      delivery.status,
      delivery.attemptCount,
      delivery.githubObjectRef ?? null,
      delivery.lastError ?? null,
      JSON.stringify(delivery.payload),
      delivery.appliedAt ?? null,
      delivery.createdAt,
      delivery.updatedAt,
    ],
  );
}

export async function listGitHubInboundEvents(
  db: Queryable,
  filters: {
    companyId?: string;
    status?: GitHubInboundEventRecord['status'];
    limit?: number;
  } = {},
): Promise<GitHubInboundEventRecord[]> {
  const values: Array<string | number> = [];
  const clauses: string[] = [];

  if (filters.companyId) {
    values.push(filters.companyId);
    clauses.push(`company_id = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  values.push(filters.limit ?? 200);
  const whereClause =
    clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';

  const result = await db.query<GitHubInboundEventRow>(
    `
      select
        inbound_event_id,
        github_delivery_id,
        github_event_name,
        action,
        company_id,
        aggregate_type,
        aggregate_id,
        classification,
        status,
        proposed_command,
        notes,
        payload,
        created_at
      from github_inbound_events
      ${whereClause}
      order by created_at desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(mapInboundEventRow);
}

export async function getGitHubInboundEventByDeliveryId(
  db: Queryable,
  githubDeliveryId: string,
): Promise<GitHubInboundEventRecord | null> {
  const result = await db.query<GitHubInboundEventRow>(
    `
      select
        inbound_event_id,
        github_delivery_id,
        github_event_name,
        action,
        company_id,
        aggregate_type,
        aggregate_id,
        classification,
        status,
        proposed_command,
        notes,
        payload,
        created_at
      from github_inbound_events
      where github_delivery_id = $1
      limit 1
    `,
    [githubDeliveryId],
  );

  return result.rows[0] ? mapInboundEventRow(result.rows[0]) : null;
}

export async function getGitHubInboundEventById(
  db: Queryable,
  inboundEventId: string,
): Promise<GitHubInboundEventRecord | null> {
  const result = await db.query<GitHubInboundEventRow>(
    `
      select
        inbound_event_id,
        github_delivery_id,
        github_event_name,
        action,
        company_id,
        aggregate_type,
        aggregate_id,
        classification,
        status,
        proposed_command,
        notes,
        payload,
        created_at
      from github_inbound_events
      where inbound_event_id = $1
      limit 1
    `,
    [inboundEventId],
  );

  return result.rows[0] ? mapInboundEventRow(result.rows[0]) : null;
}

export async function upsertGitHubInboundEvent(
  db: Queryable,
  event: GitHubInboundEventRecord,
): Promise<void> {
  await db.query(
    `
      insert into github_inbound_events (
        inbound_event_id,
        github_delivery_id,
        github_event_name,
        action,
        company_id,
        aggregate_type,
        aggregate_id,
        classification,
        status,
        proposed_command,
        notes,
        payload,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13)
      on conflict (github_delivery_id)
      do update set
        action = excluded.action,
        company_id = excluded.company_id,
        aggregate_type = excluded.aggregate_type,
        aggregate_id = excluded.aggregate_id,
        classification = excluded.classification,
        status = excluded.status,
        proposed_command = excluded.proposed_command,
        notes = excluded.notes,
        payload = excluded.payload
    `,
    [
      event.inboundEventId,
      event.githubDeliveryId,
      event.githubEventName,
      event.action ?? null,
      event.companyId ?? null,
      event.aggregateType ?? null,
      event.aggregateId ?? null,
      event.classification,
      event.status,
      JSON.stringify(event.proposedCommand ?? null),
      event.notes ?? null,
      JSON.stringify(event.payload),
      event.createdAt,
    ],
  );
}

export async function listDriftAlerts(
  db: Queryable,
  filters: {
    companyId: string;
    severity?: DriftAlert['severity'];
    limit?: number;
  },
): Promise<DriftAlert[]> {
  const values: Array<string | number> = [filters.companyId];
  const clauses = ['company_id = $1'];

  if (filters.severity) {
    values.push(filters.severity);
    clauses.push(`severity = $${values.length}`);
  }

  values.push(filters.limit ?? 200);

  const result = await db.query<DriftAlertRow>(
    `
      select
        alert_id,
        company_id,
        aggregate_type,
        aggregate_id,
        severity,
        summary,
        github_object_ref,
        drift_class,
        source_event_id,
        observed_at,
        repair_status,
        notes
      from drift_alerts
      where ${clauses.join(' and ')}
      order by coalesce(observed_at, now()) desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(mapDriftAlertRow);
}

export async function upsertDriftAlert(
  db: Queryable,
  alert: DriftAlert,
): Promise<void> {
  await db.query(
    `
      insert into drift_alerts (
        alert_id,
        company_id,
        aggregate_type,
        aggregate_id,
        severity,
        summary,
        github_object_ref,
        drift_class,
        source_event_id,
        observed_at,
        repair_status,
        notes
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (alert_id)
      do update set
        severity = excluded.severity,
        summary = excluded.summary,
        github_object_ref = excluded.github_object_ref,
        drift_class = excluded.drift_class,
        source_event_id = excluded.source_event_id,
        observed_at = excluded.observed_at,
        repair_status = excluded.repair_status,
        notes = excluded.notes
    `,
    [
      alert.alertId,
      alert.companyId,
      alert.aggregateType,
      alert.aggregateId,
      alert.severity,
      alert.summary,
      alert.githubObjectRef ?? null,
      alert.driftClass ?? null,
      alert.sourceEventId ?? null,
      alert.observedAt ?? null,
      alert.repairStatus ?? 'open',
      alert.notes ?? null,
    ],
  );
}
