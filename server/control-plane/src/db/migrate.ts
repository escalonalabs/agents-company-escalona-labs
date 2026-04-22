import { closePool, getPool } from './pool';

async function migrate() {
  const pool = getPool();

  await pool.query(`
    create table if not exists companies (
      company_id text primary key,
      slug text not null unique,
      display_name text not null,
      status text not null,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists objectives (
      objective_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      title text not null,
      summary text,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists work_items (
      work_item_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      objective_id text not null references objectives(objective_id) on delete cascade,
      title text not null,
      description text,
      status text not null,
      attempt_budget integer not null,
      requires_approval boolean not null default false,
      validation_contract_ref text not null default 'validation.contract.default.v1',
      scope_ref text not null default 'scope:default',
      blocking_reason text,
      latest_run_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    alter table objectives
      add column if not exists summary text,
      add column if not exists updated_at timestamptz not null default now();
  `);

  await pool.query(`
    alter table work_items
      add column if not exists description text,
      add column if not exists requires_approval boolean not null default false,
      add column if not exists validation_contract_ref text not null default 'validation.contract.default.v1',
      add column if not exists scope_ref text not null default 'scope:default',
      add column if not exists blocking_reason text,
      add column if not exists latest_run_id text,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now();
  `);

  await pool.query(`
    create table if not exists runs (
      run_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      work_item_id text not null references work_items(work_item_id) on delete cascade,
      attempt integer not null,
      status text not null,
      execution_packet_id text,
      summary text,
      failure_class text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists approvals (
      approval_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      work_item_id text not null references work_items(work_item_id) on delete cascade,
      status text not null,
      requested_action text not null,
      decision_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists execution_packets (
      execution_packet_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      work_item_id text not null references work_items(work_item_id) on delete cascade,
      run_id text not null references runs(run_id) on delete cascade,
      packet jsonb not null,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists ledger_events (
      event_id text primary key,
      aggregate_type text not null,
      aggregate_id text not null,
      company_id text not null,
      stream_sequence integer not null default 1,
      event_type text not null,
      schema_version integer not null default 1,
      occurred_at timestamptz not null,
      actor_ref text,
      command_id text,
      correlation_id text,
      causation_id text,
      causation_key text,
      payload jsonb not null
    );
  `);

  await pool.query(`
    create unique index if not exists ledger_events_stream_key
      on ledger_events (aggregate_type, aggregate_id, stream_sequence);
  `);

  await pool.query(`
    create unique index if not exists ledger_events_company_causation_key
      on ledger_events (company_id, causation_key)
      where causation_key is not null;
  `);

  await pool.query(`
    create table if not exists command_log (
      command_id text primary key,
      company_id text not null,
      aggregate_id text not null,
      command_type text not null,
      idempotency_key text not null,
      received_at timestamptz not null,
      resolution_status text not null,
      result_event_ids jsonb not null default '[]'::jsonb
    );
  `);

  await pool.query(`
    create unique index if not exists command_log_company_idempotency_key
      on command_log (company_id, idempotency_key);
  `);
}

migrate()
  .then(() => {
    console.log('control-plane migration complete');
  })
  .finally(async () => {
    await closePool();
  });
