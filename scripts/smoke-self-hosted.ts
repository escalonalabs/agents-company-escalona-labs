import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  bootstrapOperatorSession,
  createEphemeralGitHubAppCredentials,
  createSmokeOperatorCredentials,
  expectStatus,
  findAvailablePort,
  requestJson,
  waitForUrl,
} from './smoke-harness';

type CompanyCreateResponse = {
  company: {
    companyId: string;
    slug?: string;
  };
};

type CompanyOnboardingResponse = {
  status?: string;
  linkedInstallations?: Array<{
    installationId?: number;
    repository?: {
      owner?: string;
      name?: string;
    };
  }>;
};

type GitHubHealthResponse = {
  status?: string;
  readiness?: {
    appCredentialsReady?: boolean;
    webhookVerificationReady?: boolean;
    controlPlaneReady?: boolean;
  };
};

type CompanyInstallationsResponse = {
  installations?: Array<{
    installationId?: number;
    repository?: {
      owner?: string;
      name?: string;
    };
  }>;
};

type ObjectiveCreateResponse = {
  objective?: {
    objectiveId?: string;
  };
};

type SyncPlanResponse = {
  batches?: Array<{
    installation?: {
      installationId?: number;
      repository?: {
        owner?: string;
        name?: string;
      };
    };
    plan?: Array<{
      repository?: {
        owner?: string;
        name?: string;
      };
    }>;
  }>;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

async function runCommand(input: {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  allowFailure?: boolean;
}): Promise<CommandResult> {
  const child = spawn(input.cmd, input.args, {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...(input.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];

  child.stdout?.on('data', (chunk) => {
    stdout.push(String(chunk));
  });
  child.stderr?.on('data', (chunk) => {
    stderr.push(String(chunk));
  });

  const [exitCode] = (await once(child, 'exit')) as [number | null];

  const result = {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };

  if (!input.allowFailure && exitCode !== 0) {
    throw new Error(
      [
        `Command failed with exit code ${String(exitCode)}: ${input.cmd} ${input.args.join(' ')}`,
        result.stdout ? `STDOUT:\n${result.stdout}` : '',
        result.stderr ? `STDERR:\n${result.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  return result;
}

async function collectComposeDiagnostics(input: {
  cwd: string;
  envFilePath: string;
  projectName: string;
}) {
  const baseArgs = [
    'compose',
    '--env-file',
    input.envFilePath,
    '-p',
    input.projectName,
  ];
  const [ps, logs] = await Promise.all([
    runCommand({
      cmd: 'docker',
      args: [...baseArgs, 'ps'],
      cwd: input.cwd,
      allowFailure: true,
    }),
    runCommand({
      cmd: 'docker',
      args: [...baseArgs, 'logs', '--no-color', '--tail', '200'],
      cwd: input.cwd,
      allowFailure: true,
    }),
  ]);

  return {
    ps,
    logs,
  };
}

async function main() {
  const repoRoot = process.cwd();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const projectName = `agents-company-smoke-${suffix}`;
  const controlWebPort = await findAvailablePort();
  const controlPlanePort = await findAvailablePort();
  const githubAppPort = await findAvailablePort();
  const postgresPort = await findAvailablePort();
  const minioApiPort = await findAvailablePort();
  const minioConsolePort = await findAvailablePort();
  const mailpitSmtpPort = await findAvailablePort();
  const mailpitUiPort = await findAvailablePort();
  const envFilePath = join(
    tmpdir(),
    `agents-company-self-hosted-${suffix}.env`,
  );
  const controlWebBaseUrl = `http://127.0.0.1:${controlWebPort}`;
  const controlPlaneBaseUrl = `http://127.0.0.1:${controlPlanePort}`;
  const githubAppBaseUrl = `http://127.0.0.1:${githubAppPort}`;
  const minioBaseUrl = `http://127.0.0.1:${minioApiPort}`;
  const githubAppCredentials = createEphemeralGitHubAppCredentials();
  const repoName = `self-hosted-${suffix}`;
  const installationId = 9800;

  await writeFile(
    envFilePath,
    [
      'AGENTS_COMPANY_NODE_ENV=development',
      `AGENTS_COMPANY_APP_URL=${controlWebBaseUrl}`,
      `AGENTS_COMPANY_SESSION_SECRET=self-hosted-session-${suffix}`,
      `AGENTS_COMPANY_INTERNAL_API_TOKEN=self-hosted-internal-${suffix}`,
      `AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET=${githubAppCredentials.webhookSecret}`,
      `AGENTS_COMPANY_GITHUB_APP_ID=${githubAppCredentials.appId}`,
      `AGENTS_COMPANY_GITHUB_PRIVATE_KEY=${githubAppCredentials.privateKey.replace(/\n/g, '\\n')}`,
      `POSTGRES_HOST_PORT=${postgresPort}`,
      `MINIO_API_HOST_PORT=${minioApiPort}`,
      `MINIO_CONSOLE_HOST_PORT=${minioConsolePort}`,
      `MAILPIT_SMTP_HOST_PORT=${mailpitSmtpPort}`,
      `MAILPIT_UI_HOST_PORT=${mailpitUiPort}`,
      `CONTROL_PLANE_HOST_PORT=${controlPlanePort}`,
      `GITHUB_APP_HOST_PORT=${githubAppPort}`,
      `CONTROL_WEB_HOST_PORT=${controlWebPort}`,
      '',
    ].join('\n'),
    'utf8',
  );

  const composeBaseArgs = [
    'compose',
    '--env-file',
    envFilePath,
    '-p',
    projectName,
  ];

  try {
    await runCommand({
      cmd: 'docker',
      args: [
        ...composeBaseArgs,
        'up',
        '--build',
        '-d',
        'postgres',
        'minio',
        'mailpit',
        'control-plane-migrate',
        'control-plane',
        'github-app',
        'control-web',
      ],
      cwd: repoRoot,
    });

    await waitForUrl(`${controlWebBaseUrl}/web-health`, {
      timeoutMs: 180_000,
    });
    await waitForUrl(`${controlPlaneBaseUrl}/health`, {
      timeoutMs: 180_000,
    });
    await waitForUrl(`${githubAppBaseUrl}/health`, {
      timeoutMs: 180_000,
    });
    await waitForUrl(`${minioBaseUrl}/minio/health/live`, {
      timeoutMs: 180_000,
    });

    const controlPlaneHealth = await requestJson<{
      status?: string;
    }>({
      baseUrl: controlPlaneBaseUrl,
      path: '/health',
    });
    expectStatus(
      controlPlaneHealth.statusCode,
      [200],
      'control-plane health failed in self-hosted smoke',
      controlPlaneHealth.json,
    );

    const githubHealth = await requestJson<GitHubHealthResponse>({
      baseUrl: githubAppBaseUrl,
      path: '/health',
    });
    expectStatus(
      githubHealth.statusCode,
      [200],
      'github-app health failed in self-hosted smoke',
      githubHealth.json,
    );
    if (
      githubHealth.json?.readiness?.controlPlaneReady !== true ||
      githubHealth.json?.readiness?.webhookVerificationReady !== true ||
      githubHealth.json?.readiness?.appCredentialsReady !== true
    ) {
      throw new Error(
        `github-app did not report ready dependencies: ${JSON.stringify(
          githubHealth.json,
          null,
          2,
        )}`,
      );
    }

    const operatorCredentials = createSmokeOperatorCredentials(
      'self-hosted-operator',
    );
    const operatorSession = await bootstrapOperatorSession({
      baseUrl: controlWebBaseUrl,
      credentials: operatorCredentials,
    });
    const operatorHeaders = {
      cookie: operatorSession.cookie,
    };

    const createCompany = await requestJson<CompanyCreateResponse>({
      baseUrl: controlWebBaseUrl,
      path: '/companies',
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `self-hosted-company-${suffix}`,
      },
      body: {
        slug: `self-hosted-${suffix}`,
        displayName: 'Self Hosted Smoke Company',
      },
    });
    expectStatus(
      createCompany.statusCode,
      [201],
      'company creation failed in self-hosted smoke',
      createCompany.json,
    );

    const companyId = createCompany.json?.company.companyId;
    if (!companyId) {
      throw new Error(
        'Self-hosted smoke did not receive a company id after creation.',
      );
    }

    const initialOnboarding = await requestJson<CompanyOnboardingResponse>({
      baseUrl: controlWebBaseUrl,
      path: `/companies/${companyId}/onboarding`,
      headers: operatorHeaders,
    });
    expectStatus(
      initialOnboarding.statusCode,
      [200],
      'initial onboarding fetch failed in self-hosted smoke',
      initialOnboarding.json,
    );

    const linkInstallation = await requestJson({
      baseUrl: githubAppBaseUrl,
      path: '/installations/link',
      method: 'POST',
      body: {
        companyId,
        installationId,
        accountLogin: 'escalonalabs',
        repository: {
          owner: 'escalonalabs',
          name: repoName,
          id: installationId,
        },
      },
    });
    expectStatus(
      linkInstallation.statusCode,
      [200, 201],
      'github-app installation link failed in self-hosted smoke',
      linkInstallation.json,
    );

    const installations = await requestJson<CompanyInstallationsResponse>({
      baseUrl: controlWebBaseUrl,
      path: `/companies/${companyId}/github/installations`,
      headers: operatorHeaders,
    });
    expectStatus(
      installations.statusCode,
      [200],
      'company installation listing failed in self-hosted smoke',
      installations.json,
    );
    if (
      !installations.json?.installations?.some(
        (installation) =>
          installation.installationId === installationId &&
          installation.repository?.owner === 'escalonalabs' &&
          installation.repository?.name === repoName,
      )
    ) {
      throw new Error(
        `Linked installation not visible through control-web path: ${JSON.stringify(
          installations.json,
          null,
          2,
        )}`,
      );
    }

    const createObjective = await requestJson<ObjectiveCreateResponse>({
      baseUrl: controlWebBaseUrl,
      path: '/objectives',
      method: 'POST',
      headers: {
        ...operatorHeaders,
        'x-idempotency-key': `self-hosted-objective-${suffix}`,
      },
      body: {
        companyId,
        title: 'Self-hosted objective',
        summary: 'Validate compose-hosted onboarding and GitHub integration.',
        repositoryTarget: {
          owner: 'escalonalabs',
          name: repoName,
          id: installationId,
        },
        requestedWorkItems: [
          {
            title: 'Prepare self-hosted repo work item',
            scopeRef: 'scope:self-hosted-repo',
          },
        ],
      },
    });
    expectStatus(
      createObjective.statusCode,
      [201],
      'objective creation failed in self-hosted smoke',
      createObjective.json,
    );

    const syncPlan = await requestJson<SyncPlanResponse>({
      baseUrl: controlWebBaseUrl,
      path: `/companies/${companyId}/github/sync-plan`,
      method: 'POST',
      headers: operatorHeaders,
      body: {},
    });
    expectStatus(
      syncPlan.statusCode,
      [202],
      'sync-plan generation failed in self-hosted smoke',
      syncPlan.json,
    );

    const latestOnboarding = await requestJson<CompanyOnboardingResponse>({
      baseUrl: controlWebBaseUrl,
      path: `/companies/${companyId}/onboarding`,
      headers: operatorHeaders,
    });
    expectStatus(
      latestOnboarding.statusCode,
      [200],
      'latest onboarding fetch failed in self-hosted smoke',
      latestOnboarding.json,
    );

    console.log(
      JSON.stringify(
        {
          projectName,
          controlWebBaseUrl,
          controlPlaneBaseUrl,
          githubAppBaseUrl,
          minioBaseUrl,
          companyId,
          onboardingStatus: latestOnboarding.json?.status ?? null,
          linkedInstallations:
            latestOnboarding.json?.linkedInstallations?.length ?? 0,
          syncPlanBatchCount: syncPlan.json?.batches?.length ?? 0,
          verifiedPaths: [
            'compose-up',
            'control-web-bootstrap',
            'company-onboarding',
            'github-app-installation-link',
            'control-web-installation-visibility',
            'github-sync-plan',
            'minio-health',
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const diagnostics = await collectComposeDiagnostics({
      cwd: repoRoot,
      envFilePath,
      projectName,
    });
    throw new Error(
      [
        error instanceof Error ? error.message : 'Self-hosted smoke failed.',
        diagnostics.ps.stdout
          ? `docker compose ps:\n${diagnostics.ps.stdout}`
          : '',
        diagnostics.logs.stdout
          ? `docker compose logs:\n${diagnostics.logs.stdout}`
          : '',
        diagnostics.logs.stderr
          ? `docker compose logs stderr:\n${diagnostics.logs.stderr}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  } finally {
    await runCommand({
      cmd: 'docker',
      args: [...composeBaseArgs, 'down', '-v'],
      cwd: repoRoot,
      allowFailure: true,
    });
    await rm(envFilePath, {
      force: true,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
