const DEFAULT_PORT = 3001;
const DEFAULT_WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_WEBHOOK_PATH = '/webhooks/github';
const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';

export interface GitHubAppConfig {
  nodeEnv: string;
  port: number;
  serviceName: 'github-app';
  readiness: {
    appCredentialsReady: boolean;
    webhookVerificationReady: boolean;
    controlPlaneReady: boolean;
  };
  github: {
    appId: string | null;
    privateKey: string | null;
    webhookSecret: string | null;
    apiBaseUrl: string;
    authStrategy: 'github-app';
  };
  controlPlane: {
    baseUrl: string | null;
    internalApiToken: string | null;
  };
  webhook: {
    bodyLimitBytes: number;
    path: string;
  };
}

export function loadGitHubAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig {
  const port = parsePort(env.AGENTS_COMPANY_GITHUB_APP_PORT);
  const appId = normalizeEnvValue(env.AGENTS_COMPANY_GITHUB_APP_ID);
  const privateKey = normalizeMultilineEnvValue(
    env.AGENTS_COMPANY_GITHUB_PRIVATE_KEY,
  );
  const webhookSecret = normalizeEnvValue(
    env.AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET,
  );
  const controlPlaneBaseUrl = normalizeEnvValue(
    env.AGENTS_COMPANY_CONTROL_PLANE_URL,
  );
  const internalApiToken = normalizeEnvValue(
    env.AGENTS_COMPANY_INTERNAL_API_TOKEN,
  );

  return {
    nodeEnv: normalizeEnvValue(env.AGENTS_COMPANY_NODE_ENV) ?? 'development',
    port,
    serviceName: 'github-app',
    readiness: {
      appCredentialsReady: Boolean(appId && privateKey),
      webhookVerificationReady: Boolean(webhookSecret),
      controlPlaneReady: Boolean(controlPlaneBaseUrl && internalApiToken),
    },
    github: {
      appId,
      privateKey,
      webhookSecret,
      apiBaseUrl:
        normalizeEnvValue(env.AGENTS_COMPANY_GITHUB_API_BASE_URL) ??
        DEFAULT_GITHUB_API_BASE_URL,
      authStrategy: 'github-app',
    },
    controlPlane: {
      baseUrl: controlPlaneBaseUrl,
      internalApiToken,
    },
    webhook: {
      bodyLimitBytes: DEFAULT_WEBHOOK_BODY_LIMIT_BYTES,
      path: DEFAULT_WEBHOOK_PATH,
    },
  };
}

function parsePort(rawPort: string | undefined): number {
  const value = Number(rawPort ?? String(DEFAULT_PORT));

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      'AGENTS_COMPANY_GITHUB_APP_PORT must be an integer between 1 and 65535.',
    );
  }

  return value;
}

function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeMultilineEnvValue(value: string | undefined): string | null {
  const normalized = normalizeEnvValue(value);
  return normalized ? normalized.replace(/\\n/g, '\n') : null;
}
