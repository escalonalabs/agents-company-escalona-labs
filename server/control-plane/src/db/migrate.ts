import { fileURLToPath } from 'node:url';

import { closePool, getPool } from './pool';

export async function migrate() {
  const pool = getPool();

  await pool.query(`
    create table if not exists companies (
      company_id text primary key,
      slug text not null unique,
      display_name text not null,
      status text not null,
      beta_phase text,
      beta_enrollment_status text,
      beta_notes text,
      beta_updated_at timestamptz,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    alter table companies
      add column if not exists beta_phase text,
      add column if not exists beta_enrollment_status text,
      add column if not exists beta_notes text,
      add column if not exists beta_updated_at timestamptz;
  `);

  await pool.query(`
    create table if not exists objectives (
      objective_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      title text not null,
      summary text,
      target_repository_owner text,
      target_repository_name text,
      target_repository_id bigint,
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
      target_repository_owner text,
      target_repository_name text,
      target_repository_id bigint,
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
      add column if not exists target_repository_owner text,
      add column if not exists target_repository_name text,
      add column if not exists target_repository_id bigint,
      add column if not exists updated_at timestamptz not null default now();
  `);

  await pool.query(`
    alter table work_items
      add column if not exists description text,
      add column if not exists target_repository_owner text,
      add column if not exists target_repository_name text,
      add column if not exists target_repository_id bigint,
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
      head_sha text,
      summary text,
      failure_class text,
      available_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    alter table runs
      add column if not exists head_sha text,
      add column if not exists available_at timestamptz not null default now();
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
    create table if not exists claim_leases (
      claim_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      work_item_id text not null references work_items(work_item_id) on delete cascade,
      scope_ref text not null,
      holder_run_id text not null references runs(run_id) on delete cascade,
      lease_expires_at timestamptz not null,
      lease_status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create unique index if not exists claim_leases_active_scope_key
      on claim_leases (company_id, scope_ref)
      where lease_status = 'active';
  `);

  await pool.query(`
    create index if not exists claim_leases_holder_run_idx
      on claim_leases (holder_run_id, updated_at desc);
  `);

  await pool.query(`
    create table if not exists run_effects (
      effect_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      run_id text not null references runs(run_id) on delete cascade,
      execution_packet_id text not null references execution_packets(execution_packet_id) on delete cascade,
      tool_call_id text not null,
      tool_kind text not null,
      tool_name text not null,
      effect_status text not null,
      started_at timestamptz not null,
      completed_at timestamptz not null,
      artifact_refs jsonb not null default '[]'::jsonb,
      result_payload jsonb not null default '{}'::jsonb,
      error_class text,
      error_message text,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create unique index if not exists run_effects_run_tool_call_key
      on run_effects (run_id, tool_call_id);
  `);

  await pool.query(`
    create index if not exists run_effects_run_created_idx
      on run_effects (run_id, created_at asc);
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

  await pool.query(`
    create table if not exists users (
      user_id text primary key,
      email text not null unique,
      display_name text,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists company_memberships (
      company_id text not null references companies(company_id) on delete cascade,
      user_id text not null references users(user_id) on delete cascade,
      role text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (company_id, user_id)
    );
  `);

  await pool.query(`
    create index if not exists company_memberships_user_idx
      on company_memberships (user_id, created_at desc);
  `);

  await pool.query(`
    create table if not exists user_sessions (
      session_id text primary key,
      user_id text not null references users(user_id) on delete cascade,
      session_token_hash text not null unique,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists user_sessions_user_idx
      on user_sessions (user_id, expires_at desc);
  `);

  await pool.query(`
    create table if not exists company_invitations (
      invitation_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      email text not null,
      role text not null,
      status text not null,
      invitation_token_hash text not null unique,
      invited_by_user_id text references users(user_id) on delete set null,
      accepted_by_user_id text references users(user_id) on delete set null,
      expires_at timestamptz not null,
      accepted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists company_invitations_company_idx
      on company_invitations (company_id, created_at desc);
  `);

  await pool.query(`
    create index if not exists company_invitations_email_idx
      on company_invitations (lower(email), status, expires_at desc);
  `);

  await pool.query(`
    create table if not exists outbound_mail (
      mail_id text primary key,
      company_id text references companies(company_id) on delete cascade,
      message_kind text not null,
      recipient text not null,
      subject text not null,
      provider text not null,
      status text not null,
      message_id text,
      last_error text,
      metadata jsonb not null default '{}'::jsonb,
      sent_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists outbound_mail_company_created_idx
      on outbound_mail (company_id, created_at desc);
  `);

  await pool.query(`
    create table if not exists github_installations (
      company_id text not null references companies(company_id) on delete cascade,
      installation_id bigint not null,
      account_login text not null,
      repository_owner text not null,
      repository_name text not null,
      repository_id bigint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (company_id, installation_id, repository_owner, repository_name)
    );
  `);

  await pool.query(`
    create unique index if not exists github_installations_company_repository_key
      on github_installations (company_id, repository_owner, repository_name);
  `);

  await pool.query(`
    create table if not exists github_projection_bindings (
      binding_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      aggregate_type text not null,
      aggregate_id text not null,
      github_object_type text not null,
      github_object_id text not null,
      github_object_number integer,
      repository_owner text not null,
      repository_name text not null,
      repository_id bigint,
      metadata_version text not null,
      last_source_event_id text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create unique index if not exists github_projection_bindings_aggregate_key
      on github_projection_bindings (
        company_id,
        aggregate_type,
        aggregate_id,
        github_object_type
      );
  `);

  await pool.query(`
    create table if not exists github_projection_deliveries (
      projection_delivery_id text primary key,
      projection_name text not null,
      company_id text not null references companies(company_id) on delete cascade,
      aggregate_type text not null,
      aggregate_id text not null,
      source_event_id text not null,
      github_object_type text not null,
      action_type text not null,
      delivery_key text not null unique,
      status text not null,
      attempt_count integer not null default 0,
      github_object_ref text,
      last_error text,
      payload jsonb not null,
      applied_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists github_projection_deliveries_company_status_idx
      on github_projection_deliveries (company_id, status, created_at desc);
  `);

  await pool.query(`
    create table if not exists github_inbound_events (
      inbound_event_id text primary key,
      github_delivery_id text not null unique,
      github_event_name text not null,
      action text,
      company_id text references companies(company_id) on delete cascade,
      aggregate_type text,
      aggregate_id text,
      classification text not null,
      status text not null,
      proposed_command jsonb,
      notes text,
      payload jsonb not null,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists github_inbound_events_company_status_idx
      on github_inbound_events (company_id, status, created_at desc);
  `);

  await pool.query(`
    create table if not exists drift_alerts (
      alert_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      aggregate_type text not null,
      aggregate_id text not null,
      severity text not null,
      summary text not null,
      github_object_ref text,
      drift_class text,
      source_event_id text,
      observed_at timestamptz,
      repair_status text not null default 'open',
      notes text
    );
  `);

  await pool.query(`
    create index if not exists drift_alerts_company_severity_idx
      on drift_alerts (company_id, severity, observed_at desc);
  `);

  await pool.query(`
    create table if not exists memory_candidates (
      candidate_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      source_kind text not null,
      source_ref text not null,
      aggregate_type text,
      aggregate_id text,
      objective_id text references objectives(objective_id) on delete set null,
      scope_ref text,
      candidate_class text not null,
      retention_class text not null,
      summary text not null,
      detail text,
      confidence double precision not null,
      freshness_expires_at timestamptz,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists memory_candidates_company_status_idx
      on memory_candidates (company_id, status, updated_at desc);
  `);

  await pool.query(`
    create index if not exists memory_candidates_company_scope_idx
      on memory_candidates (company_id, scope_ref, updated_at desc);
  `);

  await pool.query(`
    create table if not exists knowledge_memories (
      memory_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      candidate_id text not null references memory_candidates(candidate_id) on delete restrict,
      aggregate_type text,
      aggregate_id text,
      objective_id text references objectives(objective_id) on delete set null,
      scope_ref text,
      candidate_class text not null,
      retention_class text not null,
      summary text not null,
      detail text,
      confidence double precision not null,
      freshness_expires_at timestamptz,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      invalidated_at timestamptz,
      invalidation_reason text
    );
  `);

  await pool.query(`
    create unique index if not exists knowledge_memories_candidate_key
      on knowledge_memories (candidate_id);
  `);

  await pool.query(`
    create index if not exists knowledge_memories_company_status_idx
      on knowledge_memories (company_id, status, updated_at desc);
  `);

  await pool.query(`
    create index if not exists knowledge_memories_company_scope_idx
      on knowledge_memories (company_id, scope_ref, updated_at desc);
  `);

  await pool.query(`
    create table if not exists memory_provenance_edges (
      edge_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      source_node_type text not null,
      source_node_id text not null,
      target_node_type text not null,
      target_node_id text not null,
      edge_type text not null,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists memory_provenance_edges_target_idx
      on memory_provenance_edges (company_id, target_node_id, created_at desc);
  `);

  await pool.query(`
    create index if not exists memory_provenance_edges_source_idx
      on memory_provenance_edges (company_id, source_node_id, created_at desc);
  `);

  await pool.query(`
    create table if not exists memory_retrieval_audits (
      retrieval_id text primary key,
      company_id text not null references companies(company_id) on delete cascade,
      memory_id text references knowledge_memories(memory_id) on delete set null,
      scope_ref text,
      objective_id text references objectives(objective_id) on delete set null,
      query_text text,
      freshness text not null,
      outcome text not null,
      reason text,
      relevance_score double precision not null,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists memory_retrieval_audits_company_created_idx
      on memory_retrieval_audits (company_id, created_at desc);
  `);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  migrate()
    .then(() => {
      console.log('control-plane migration complete');
    })
    .finally(async () => {
      await closePool();
    });
}
