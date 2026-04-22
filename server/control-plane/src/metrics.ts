type CountQueryable = {
  query<T extends { count: string }>(statement: string): Promise<{ rows: T[] }>;
};

export interface ControlPlaneMetricsSnapshot {
  auth: {
    sessionReady: boolean;
    internalApiReady: boolean;
  };
  counts: {
    companies: number;
    internalAlphaCompanies: number;
    controlledBetaCompanies: number;
    betaActiveCompanies: number;
    objectives: number;
    workItems: number;
    runs: number;
    approvals: number;
  };
  appOrigin: string | null;
  uptimeSeconds: number;
}

function asMetricFlag(value: boolean): number {
  return value ? 1 : 0;
}

function createMetricLines(input: {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  value: number;
}) {
  return [
    `# HELP ${input.name} ${input.help}`,
    `# TYPE ${input.name} ${input.type}`,
    `${input.name} ${input.value}`,
  ];
}

async function countRows(pool: CountQueryable, tableName: string) {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from ${tableName}`,
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function countCompaniesByCondition(
  pool: CountQueryable,
  condition: string,
) {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from companies where ${condition}`,
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function loadControlPlaneMetricsSnapshot(input: {
  pool: CountQueryable;
  sessionReady: boolean;
  internalApiReady: boolean;
  appOrigin: string | null;
}): Promise<ControlPlaneMetricsSnapshot> {
  const [
    companies,
    internalAlphaCompanies,
    controlledBetaCompanies,
    betaActiveCompanies,
    objectives,
    workItems,
    runs,
    approvals,
  ] = await Promise.all([
    countRows(input.pool, 'companies'),
    countCompaniesByCondition(
      input.pool,
      "coalesce(beta_phase, 'internal_alpha') = 'internal_alpha'",
    ),
    countCompaniesByCondition(
      input.pool,
      "coalesce(beta_phase, 'internal_alpha') = 'controlled_beta'",
    ),
    countCompaniesByCondition(
      input.pool,
      "coalesce(beta_enrollment_status, 'active') = 'active'",
    ),
    countRows(input.pool, 'objectives'),
    countRows(input.pool, 'work_items'),
    countRows(input.pool, 'runs'),
    countRows(input.pool, 'approvals'),
  ]);

  return {
    auth: {
      sessionReady: input.sessionReady,
      internalApiReady: input.internalApiReady,
    },
    counts: {
      companies,
      internalAlphaCompanies,
      controlledBetaCompanies,
      betaActiveCompanies,
      objectives,
      workItems,
      runs,
      approvals,
    },
    appOrigin: input.appOrigin,
    uptimeSeconds: process.uptime(),
  };
}

export function renderControlPlanePrometheusMetrics(
  snapshot: ControlPlaneMetricsSnapshot,
): string {
  const lines = [
    ...createMetricLines({
      name: 'agents_company_control_plane_up',
      help: 'Control plane process health indicator.',
      type: 'gauge',
      value: 1,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_auth_session_ready',
      help: 'Session auth readiness flag.',
      type: 'gauge',
      value: asMetricFlag(snapshot.auth.sessionReady),
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_auth_internal_api_ready',
      help: 'Internal API auth readiness flag.',
      type: 'gauge',
      value: asMetricFlag(snapshot.auth.internalApiReady),
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_companies',
      help: 'Companies currently loaded in the control plane ledger.',
      type: 'gauge',
      value: snapshot.counts.companies,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_companies_internal_alpha',
      help: 'Companies currently tracked in the internal alpha cohort.',
      type: 'gauge',
      value: snapshot.counts.internalAlphaCompanies,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_companies_controlled_beta',
      help: 'Companies currently tracked in the controlled beta cohort.',
      type: 'gauge',
      value: snapshot.counts.controlledBetaCompanies,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_companies_beta_active',
      help: 'Companies currently marked active in their rollout cohort.',
      type: 'gauge',
      value: snapshot.counts.betaActiveCompanies,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_objectives',
      help: 'Objectives currently stored in the control plane ledger.',
      type: 'gauge',
      value: snapshot.counts.objectives,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_work_items',
      help: 'Work items currently stored in the control plane ledger.',
      type: 'gauge',
      value: snapshot.counts.workItems,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_runs',
      help: 'Runs currently stored in the control plane ledger.',
      type: 'gauge',
      value: snapshot.counts.runs,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_approvals',
      help: 'Approvals currently stored in the control plane ledger.',
      type: 'gauge',
      value: snapshot.counts.approvals,
    }),
    ...createMetricLines({
      name: 'agents_company_control_plane_uptime_seconds',
      help: 'Control plane process uptime in seconds.',
      type: 'gauge',
      value: snapshot.uptimeSeconds,
    }),
  ];

  return `${lines.join('\n')}\n`;
}
