import type { Pool, PoolClient } from 'pg';

import type { CommandLogEntry, DomainEvent } from '@escalonalabs/domain';

export type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface LedgerEventRow {
  event_id: string;
  aggregate_type: DomainEvent['aggregateType'];
  aggregate_id: string;
  company_id: string;
  stream_sequence: number;
  event_type: DomainEvent['eventType'];
  schema_version: number;
  occurred_at: string | Date;
  actor_ref: string | null;
  command_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  causation_key: string | null;
  payload: unknown;
}

interface CommandLogRow {
  command_id: string;
  company_id: string;
  aggregate_id: string;
  command_type: string;
  idempotency_key: string;
  received_at: string | Date;
  resolution_status: CommandLogEntry['resolutionStatus'];
  result_event_ids: string[];
}

function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDomainEvent(row: LedgerEventRow): DomainEvent {
  return {
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    companyId: row.company_id,
    streamSequence: row.stream_sequence,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    occurredAt: normalizeTimestamp(row.occurred_at),
    actorRef: row.actor_ref ?? undefined,
    commandId: row.command_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    causationKey: row.causation_key ?? undefined,
    payload: row.payload,
  };
}

export async function appendDomainEvent(
  db: Queryable,
  event: DomainEvent,
): Promise<boolean> {
  const result = await db.query(
    `
      insert into ledger_events (
        event_id,
        aggregate_type,
        aggregate_id,
        company_id,
        stream_sequence,
        event_type,
        schema_version,
        occurred_at,
        actor_ref,
        command_id,
        correlation_id,
        causation_id,
        causation_key,
        payload
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      on conflict (event_id) do nothing
    `,
    [
      event.eventId,
      event.aggregateType,
      event.aggregateId,
      event.companyId,
      event.streamSequence ?? 1,
      event.eventType,
      event.schemaVersion ?? 1,
      event.occurredAt,
      event.actorRef ?? null,
      event.commandId ?? null,
      event.correlationId ?? null,
      event.causationId ?? null,
      event.causationKey ?? null,
      JSON.stringify(event.payload),
    ],
  );

  return result.rowCount === 1;
}

export async function getCommandLogEntry(
  db: Queryable,
  companyId: string,
  idempotencyKey: string,
): Promise<CommandLogEntry | null> {
  const result = await db.query<CommandLogRow>(
    `
      select
        command_id,
        company_id,
        aggregate_id,
        command_type,
        idempotency_key,
        received_at,
        resolution_status,
        result_event_ids
      from command_log
      where company_id = $1 and idempotency_key = $2
      limit 1
    `,
    [companyId, idempotencyKey],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    commandId: row.command_id,
    companyId: row.company_id,
    aggregateId: row.aggregate_id,
    commandType: row.command_type,
    idempotencyKey: row.idempotency_key,
    receivedAt: normalizeTimestamp(row.received_at),
    resolutionStatus: row.resolution_status,
    resultEventIds: row.result_event_ids,
  };
}

export async function recordCommandLogEntry(
  db: Queryable,
  entry: CommandLogEntry,
): Promise<void> {
  await db.query(
    `
      insert into command_log (
        command_id,
        company_id,
        aggregate_id,
        command_type,
        idempotency_key,
        received_at,
        resolution_status,
        result_event_ids
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      on conflict (company_id, idempotency_key)
      do update set
        resolution_status = excluded.resolution_status,
        result_event_ids = excluded.result_event_ids
    `,
    [
      entry.commandId,
      entry.companyId,
      entry.aggregateId,
      entry.commandType,
      entry.idempotencyKey,
      entry.receivedAt,
      entry.resolutionStatus,
      JSON.stringify(entry.resultEventIds),
    ],
  );
}

export async function listDomainEvents(
  db: Queryable,
  filters: {
    companyId?: string;
    aggregateType?: DomainEvent['aggregateType'];
    aggregateId?: string;
    limit?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<DomainEvent[]> {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (filters.companyId) {
    values.push(filters.companyId);
    clauses.push(`company_id = $${values.length}`);
  }

  if (filters.aggregateType) {
    values.push(filters.aggregateType);
    clauses.push(`aggregate_type = $${values.length}`);
  }

  if (filters.aggregateId) {
    values.push(filters.aggregateId);
    clauses.push(`aggregate_id = $${values.length}`);
  }

  values.push(filters.limit ?? 100);
  const whereClause =
    clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
  const orderDirection = filters.order === 'desc' ? 'desc' : 'asc';

  const result = await db.query<LedgerEventRow>(
    `
      select
        event_id,
        aggregate_type,
        aggregate_id,
        company_id,
        stream_sequence,
        event_type,
        schema_version,
        occurred_at,
        actor_ref,
        command_id,
        correlation_id,
        causation_id,
        causation_key,
        payload
      from ledger_events
      ${whereClause}
      order by occurred_at ${orderDirection}, stream_sequence ${orderDirection}
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(toDomainEvent);
}
