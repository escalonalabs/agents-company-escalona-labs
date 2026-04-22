import type { Queryable } from './events';

export type OutboundMailStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export interface OutboundMailRecord {
  mailId: string;
  companyId?: string;
  messageKind: string;
  recipient: string;
  subject: string;
  provider: string;
  status: OutboundMailStatus;
  messageId?: string;
  lastError?: string;
  metadata: Record<string, unknown>;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface OutboundMailRow {
  mail_id: string;
  company_id: string | null;
  message_kind: string;
  recipient: string;
  subject: string;
  provider: string;
  status: OutboundMailStatus;
  message_id: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  sent_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTimestamp(
  value: string | Date | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapOutboundMailRow(row: OutboundMailRow): OutboundMailRecord {
  return {
    mailId: row.mail_id,
    companyId: row.company_id ?? undefined,
    messageKind: row.message_kind,
    recipient: row.recipient,
    subject: row.subject,
    provider: row.provider,
    status: row.status,
    messageId: row.message_id ?? undefined,
    lastError: row.last_error ?? undefined,
    metadata: row.metadata,
    sentAt: normalizeTimestamp(row.sent_at),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

export async function upsertOutboundMail(
  db: Queryable,
  record: OutboundMailRecord,
): Promise<void> {
  await db.query(
    `
      insert into outbound_mail (
        mail_id,
        company_id,
        message_kind,
        recipient,
        subject,
        provider,
        status,
        message_id,
        last_error,
        metadata,
        sent_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
      on conflict (mail_id)
      do update set
        status = excluded.status,
        message_id = excluded.message_id,
        last_error = excluded.last_error,
        metadata = excluded.metadata,
        sent_at = excluded.sent_at,
        updated_at = excluded.updated_at
    `,
    [
      record.mailId,
      record.companyId ?? null,
      record.messageKind,
      record.recipient,
      record.subject,
      record.provider,
      record.status,
      record.messageId ?? null,
      record.lastError ?? null,
      JSON.stringify(record.metadata),
      record.sentAt ?? null,
      record.createdAt,
      record.updatedAt,
    ],
  );
}

export async function listOutboundMail(
  db: Queryable,
  filters: {
    companyId?: string;
    status?: OutboundMailStatus;
    limit?: number;
  } = {},
): Promise<OutboundMailRecord[]> {
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

  values.push(filters.limit ?? 100);
  const whereClause =
    clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';

  const result = await db.query<OutboundMailRow>(
    `
      select
        mail_id,
        company_id,
        message_kind,
        recipient,
        subject,
        provider,
        status,
        message_id,
        last_error,
        metadata,
        sent_at,
        created_at,
        updated_at
      from outbound_mail
      ${whereClause}
      order by created_at desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows.map(mapOutboundMailRow);
}
