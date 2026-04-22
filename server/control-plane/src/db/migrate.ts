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
      status text not null,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists work_items (
      work_item_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      objective_id text not null references objectives(objective_id) on delete cascade,
      title text not null,
      status text not null,
      attempt_budget integer not null
    );
  `);

  await pool.query(`
    create table if not exists ledger_events (
      event_id text primary key,
      aggregate_type text not null,
      aggregate_id text not null,
      company_id text not null,
      event_type text not null,
      occurred_at timestamptz not null,
      payload jsonb not null
    );
  `);
}

migrate()
  .then(() => {
    console.log('control-plane migration complete');
  })
  .finally(async () => {
    await closePool();
  });
