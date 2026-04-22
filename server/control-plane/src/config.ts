export interface ControlPlaneConfig {
  port: number;
  databaseUrl: string;
  appUrl: string | null;
  sessionSecret: string | null;
  sessionTtlHours: number;
  invitationTtlHours: number;
  internalApiToken: string | null;
  controlledBetaCompanySlugs: string[];
  mail: {
    smtpUrl: string | null;
    from: string | null;
    uiUrl: string | null;
  };
}

export function loadControlPlaneConfig(
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneConfig {
  return {
    port: Number(env.AGENTS_COMPANY_CONTROL_PLANE_PORT ?? '3000'),
    databaseUrl:
      env.AGENTS_COMPANY_DATABASE_URL ??
      'postgresql://agents_company:agents_company@localhost:55432/agents_company',
    appUrl: normalizeEnvValue(env.AGENTS_COMPANY_APP_URL),
    sessionSecret: normalizeEnvValue(env.AGENTS_COMPANY_SESSION_SECRET),
    sessionTtlHours: Number(env.AGENTS_COMPANY_SESSION_TTL_HOURS ?? '168'),
    invitationTtlHours: Number(
      env.AGENTS_COMPANY_INVITATION_TTL_HOURS ?? '168',
    ),
    internalApiToken: normalizeEnvValue(env.AGENTS_COMPANY_INTERNAL_API_TOKEN),
    controlledBetaCompanySlugs: parseCsvList(
      env.AGENTS_COMPANY_CONTROLLED_BETA_COMPANY_SLUGS,
    ),
    mail: {
      smtpUrl: normalizeEnvValue(env.AGENTS_COMPANY_MAIL_SMTP_URL),
      from:
        normalizeEnvValue(env.AGENTS_COMPANY_MAIL_FROM) ??
        'Agents Company <no-reply@agents-company.local>',
      uiUrl: normalizeEnvValue(env.AGENTS_COMPANY_MAIL_UI_URL),
    },
  };
}

function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseCsvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
