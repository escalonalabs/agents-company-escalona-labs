export interface ControlPlaneConfig {
  port: number;
  databaseUrl: string;
}

export function loadControlPlaneConfig(
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneConfig {
  return {
    port: Number(env.AGENTS_COMPANY_CONTROL_PLANE_PORT ?? '3000'),
    databaseUrl:
      env.AGENTS_COMPANY_DATABASE_URL ??
      'postgresql://agents_company:agents_company@localhost:5432/agents_company',
  };
}
