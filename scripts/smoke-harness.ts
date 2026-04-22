import { type ChildProcess, spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { createGitHubWebhookSignature } from '@escalonalabs/github';

import { migrate } from '../server/control-plane/src/db/migrate';
import { closePool } from '../server/control-plane/src/db/pool';

const DEFAULT_DATABASE_URL =
  'postgresql://agents_company:agents_company@localhost:55432/agents_company';
const DEFAULT_INTERNAL_TOKEN = 'smoke-internal-token';
const DEFAULT_SESSION_SECRET = 'smoke-session-secret';
const DEFAULT_NODE_ENV = 'development';
const DEFAULT_SMTP_URL = 'smtp://localhost:1025';
const DEFAULT_MAIL_FROM = 'Agents Company <no-reply@agents-company.local>';

function sanitizeIdentifier(value: string) {
  return value.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
}

function createSchemaName(prefix: string) {
  return `${sanitizeIdentifier(prefix)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function getBaseDatabaseUrl() {
  return process.env.AGENTS_COMPANY_DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

function getAdminDatabaseUrl() {
  const url = new URL(getBaseDatabaseUrl());
  url.searchParams.delete('options');
  return url.toString();
}

function buildSchemaDatabaseUrl(schemaName: string) {
  const url = new URL(getAdminDatabaseUrl());
  url.searchParams.set('options', `-c search_path=${schemaName},public`);
  return url.toString();
}

export function expectStatus(
  actual: number,
  allowed: number[],
  message: string,
  body: unknown,
) {
  if (!allowed.includes(actual)) {
    throw new Error(
      `${message}: expected ${allowed.join(' or ')}, received ${actual}\n${JSON.stringify(
        body,
        null,
        2,
      )}`,
    );
  }
}

export async function provisionSmokeSchema(prefix: string) {
  const schemaName = createSchemaName(prefix);
  const adminPool = new Pool({
    connectionString: getAdminDatabaseUrl(),
  });

  try {
    await adminPool.query(`create schema if not exists "${schemaName}"`);
  } finally {
    await adminPool.end();
  }

  return {
    schemaName,
    databaseUrl: buildSchemaDatabaseUrl(schemaName),
  };
}

export async function dropSmokeSchema(schemaName: string) {
  const adminPool = new Pool({
    connectionString: getAdminDatabaseUrl(),
  });

  try {
    await adminPool.query(`drop schema if exists "${schemaName}" cascade`);
  } finally {
    await adminPool.end();
  }
}

export async function applySmokeEnvironment(
  overrides: Record<string, string | undefined>,
) {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  await closePool();

  return async () => {
    await closePool();
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

export async function prepareSmokeRuntime(input: {
  prefix: string;
  appUrl?: string;
  additionalEnv?: Record<string, string | undefined>;
}) {
  const schema = await provisionSmokeSchema(input.prefix);
  const internalToken = `${DEFAULT_INTERNAL_TOKEN}-${schema.schemaName}`;
  const restoreEnvironment = await applySmokeEnvironment({
    AGENTS_COMPANY_NODE_ENV: DEFAULT_NODE_ENV,
    AGENTS_COMPANY_DATABASE_URL: schema.databaseUrl,
    AGENTS_COMPANY_INTERNAL_API_TOKEN: internalToken,
    AGENTS_COMPANY_SESSION_SECRET: `${DEFAULT_SESSION_SECRET}-${schema.schemaName}`,
    AGENTS_COMPANY_MAIL_SMTP_URL: DEFAULT_SMTP_URL,
    AGENTS_COMPANY_MAIL_FROM: DEFAULT_MAIL_FROM,
    ...(input.appUrl ? { AGENTS_COMPANY_APP_URL: input.appUrl } : {}),
    ...(input.additionalEnv ?? {}),
  });

  await migrate();

  return {
    schemaName: schema.schemaName,
    databaseUrl: schema.databaseUrl,
    internalToken,
    restoreEnvironment: async () => {
      await restoreEnvironment();
      await dropSmokeSchema(schema.schemaName);
    },
  };
}

export async function startFastifyServer(
  server: FastifyInstance,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const address = await server.listen({
    host: '127.0.0.1',
    port: 0,
  });
  const baseUrl = address.endsWith('/') ? address.slice(0, -1) : address;

  return {
    baseUrl,
    close: async () => {
      await server.close();
    },
  };
}

export function createInternalHeaders(internalToken: string) {
  return {
    'x-agents-company-internal-token': internalToken,
  };
}

export function createSmokeOperatorCredentials(prefix: string) {
  const suffix = randomUUID().slice(0, 8);
  return {
    email: `${sanitizeIdentifier(prefix)}-${suffix}@escalonalabs.dev`,
    password: `SmokePass!${suffix}`,
    displayName: `Smoke ${prefix} ${suffix}`,
  };
}

export async function readJsonResponse<TData>(response: Response) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!text) {
    return null as TData;
  }

  if (!isJson) {
    return JSON.parse(JSON.stringify({ message: text })) as TData;
  }

  return JSON.parse(text) as TData;
}

export async function requestJson<TData>(input: {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}) {
  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: input.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(input.body ? { 'content-type': 'application/json' } : {}),
      ...(input.headers ?? {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  return {
    response,
    statusCode: response.status,
    headers: response.headers,
    json: await readJsonResponse<TData>(response),
  };
}

export function extractSessionCookie(headers: Headers) {
  const cookie = headers.get('set-cookie');
  if (!cookie) {
    throw new Error('Expected session cookie header but none was returned.');
  }

  return cookie.split(';', 1)[0] ?? cookie;
}

export async function bootstrapOperatorSession(input: {
  baseUrl: string;
  credentials: {
    email: string;
    password: string;
    displayName: string;
  };
}) {
  let authResponse = await requestJson<{
    authenticated?: boolean;
  }>({
    baseUrl: input.baseUrl,
    path: '/auth/bootstrap',
    method: 'POST',
    body: input.credentials,
  });

  if (authResponse.statusCode === 409) {
    authResponse = await requestJson<{
      authenticated?: boolean;
    }>({
      baseUrl: input.baseUrl,
      path: '/auth/login',
      method: 'POST',
      body: {
        email: input.credentials.email,
        password: input.credentials.password,
      },
    });
  }

  expectStatus(
    authResponse.statusCode,
    [200, 201],
    'operator bootstrap failed',
    authResponse.json,
  );

  return {
    cookie: extractSessionCookie(authResponse.headers),
    payload: authResponse.json,
  };
}

export async function findAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Unable to determine an available local port.'));
        });
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

export async function waitForUrl(
  url: string,
  input?: {
    expectedStatus?: number;
    timeoutMs?: number;
    intervalMs?: number;
  },
) {
  const expectedStatus = input?.expectedStatus ?? 200;
  const timeoutMs = input?.timeoutMs ?? 30_000;
  const intervalMs = input?.intervalMs ?? 250;
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status === expectedStatus) {
        return;
      }
      lastError = new Error(
        `Expected ${expectedStatus} from ${url}, received ${response.status}.`,
      );
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for ${url}.`);
}

export async function startChildProcess(input: {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  readyUrl: string;
  readyStatus?: number;
}) {
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

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      stderr.push(`Process exited with code ${code}.`);
    }
  });

  try {
    await waitForUrl(input.readyUrl, {
      expectedStatus: input.readyStatus,
    });
  } catch (error) {
    await stopChildProcess(child);
    throw new Error(
      [
        error instanceof Error ? error.message : 'Unknown startup error.',
        stdout.length > 0 ? `STDOUT:\n${stdout.join('')}` : '',
        stderr.length > 0 ? `STDERR:\n${stderr.join('')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  return {
    child,
    stdout,
    stderr,
    stop: async () => {
      await stopChildProcess(child);
    },
  };
}

export async function stopChildProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

export function createEphemeralGitHubAppCredentials() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  return {
    appId: '12345',
    privateKey: privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string,
    webhookSecret: `webhook-${randomUUID()}`,
  };
}

type GitHubStubState = {
  issueCounter: number;
  commentCounter: number;
  checkRunCounter: number;
  issues: Map<string, Record<string, unknown>>;
  comments: Map<string, Record<string, unknown>>;
  checkRuns: Map<string, Record<string, unknown>>;
};

function createStubState(): GitHubStubState {
  return {
    issueCounter: 100,
    commentCounter: 500,
    checkRunCounter: 900,
    issues: new Map(),
    comments: new Map(),
    checkRuns: new Map(),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function createRepositoryKey(owner: string, name: string) {
  return `${owner}/${name}`;
}

export function createGitHubFetchStub(input: {
  controlPlaneBaseUrl: string;
  apiBaseUrl?: string;
}) {
  const state = createStubState();
  const apiBaseUrl = input.apiBaseUrl ?? 'https://api.github.com';

  const fetchFn: typeof fetch = async (url, init) => {
    const urlString = typeof url === 'string' ? url : url.toString();

    if (urlString.startsWith(input.controlPlaneBaseUrl)) {
      return fetch(urlString, init);
    }

    if (urlString.startsWith(apiBaseUrl)) {
      const parsedUrl = new URL(urlString);
      const method = (init?.method ?? 'GET').toUpperCase();
      const bodyText =
        typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof Uint8Array
            ? Buffer.from(init.body).toString('utf8')
            : '';
      const body = bodyText
        ? (JSON.parse(bodyText) as Record<string, unknown>)
        : {};

      if (
        method === 'POST' &&
        /^\/app\/installations\/\d+\/access_tokens$/.test(parsedUrl.pathname)
      ) {
        return jsonResponse({
          token: 'stub-installation-token',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
      }

      const repoMatch = parsedUrl.pathname.match(
        /^\/repos\/([^/]+)\/([^/]+)\/(.*)$/,
      );
      if (!repoMatch) {
        return jsonResponse(
          { message: `Unhandled GitHub stub path ${parsedUrl.pathname}` },
          404,
        );
      }

      const [, owner, name, suffix] = repoMatch;
      const repositoryKey = createRepositoryKey(owner, name);

      if (suffix === 'issues' && method === 'POST') {
        state.issueCounter += 1;
        const issue = {
          id: String(state.issueCounter),
          number: state.issueCounter,
          title: String(body.title ?? ''),
          body: String(body.body ?? ''),
          labels: Array.isArray(body.labels)
            ? body.labels.map((label) => ({ name: String(label) }))
            : [],
          state: body.state === 'closed' ? 'closed' : 'open',
          repositoryKey,
        };
        state.issues.set(`${repositoryKey}:${issue.number}`, issue);
        return jsonResponse(issue, 201);
      }

      const issueMatch = suffix.match(/^issues\/(\d+)$/);
      if (issueMatch) {
        const issueKey = `${repositoryKey}:${issueMatch[1]}`;
        const existing = state.issues.get(issueKey);

        if (method === 'GET') {
          return existing
            ? jsonResponse(existing)
            : jsonResponse({ message: 'Not Found' }, 404);
        }

        if (method === 'PATCH') {
          const nextIssue = {
            ...(existing ?? {
              id: issueMatch[1],
              number: Number(issueMatch[1]),
              repositoryKey,
            }),
            title: String(body.title ?? existing?.title ?? ''),
            body: String(body.body ?? existing?.body ?? ''),
            labels: Array.isArray(body.labels)
              ? body.labels.map((label) => ({ name: String(label) }))
              : (existing?.labels ?? []),
            state:
              body.state === 'closed' || body.state === 'open'
                ? body.state
                : (existing?.state ?? 'open'),
          };
          state.issues.set(issueKey, nextIssue);
          return jsonResponse(nextIssue);
        }
      }

      const createCommentMatch = suffix.match(/^issues\/(\d+)\/comments$/);
      if (createCommentMatch && method === 'POST') {
        state.commentCounter += 1;
        const comment = {
          id: String(state.commentCounter),
          body: String(body.body ?? ''),
          issue_url: `${apiBaseUrl}/repos/${owner}/${name}/issues/${createCommentMatch[1]}`,
          repositoryKey,
        };
        state.comments.set(`${repositoryKey}:${comment.id}`, comment);
        return jsonResponse(comment, 201);
      }

      const commentMatch = suffix.match(/^issues\/comments\/(.+)$/);
      if (commentMatch) {
        const commentKey = `${repositoryKey}:${commentMatch[1]}`;
        const existing = state.comments.get(commentKey);

        if (method === 'GET') {
          return existing
            ? jsonResponse(existing)
            : jsonResponse({ message: 'Not Found' }, 404);
        }

        if (method === 'PATCH') {
          const nextComment = {
            ...(existing ?? {
              id: commentMatch[1],
              issue_url: `${apiBaseUrl}/repos/${owner}/${name}/issues/0`,
              repositoryKey,
            }),
            body: String(body.body ?? existing?.body ?? ''),
          };
          state.comments.set(commentKey, nextComment);
          return jsonResponse(nextComment);
        }
      }

      if (suffix === 'check-runs' && method === 'POST') {
        state.checkRunCounter += 1;
        const checkRun = {
          id: String(state.checkRunCounter),
          name: String(body.name ?? ''),
          head_sha: String(body.head_sha ?? ''),
          status: String(body.status ?? 'queued'),
          conclusion:
            typeof body.conclusion === 'string' ? body.conclusion : null,
          output:
            typeof body.output === 'object' && body.output !== null
              ? body.output
              : {},
          external_id: String(body.external_id ?? ''),
          repositoryKey,
        };
        state.checkRuns.set(`${repositoryKey}:${checkRun.id}`, checkRun);
        return jsonResponse(checkRun, 201);
      }

      const checkRunMatch = suffix.match(/^check-runs\/(.+)$/);
      if (checkRunMatch && method === 'PATCH') {
        const checkRunKey = `${repositoryKey}:${checkRunMatch[1]}`;
        const existing = state.checkRuns.get(checkRunKey);
        const nextCheckRun = {
          ...(existing ?? {
            id: checkRunMatch[1],
            repositoryKey,
          }),
          name: String(body.name ?? existing?.name ?? ''),
          head_sha: String(body.head_sha ?? existing?.head_sha ?? ''),
          status: String(body.status ?? existing?.status ?? 'queued'),
          conclusion:
            typeof body.conclusion === 'string'
              ? body.conclusion
              : (existing?.conclusion ?? null),
          output:
            typeof body.output === 'object' && body.output !== null
              ? body.output
              : (existing?.output ?? {}),
          external_id: String(body.external_id ?? existing?.external_id ?? ''),
        };
        state.checkRuns.set(checkRunKey, nextCheckRun);
        return jsonResponse(nextCheckRun);
      }

      return jsonResponse(
        {
          message: `Unhandled GitHub stub request ${method} ${parsedUrl.pathname}`,
        },
        404,
      );
    }

    return fetch(urlString, init);
  };

  return {
    fetchFn,
    state,
  };
}

export async function postSignedGitHubWebhook(input: {
  githubAppBaseUrl: string;
  webhookSecret: string;
  deliveryId: string;
  eventName: string;
  payload: Record<string, unknown>;
}) {
  const payloadText = JSON.stringify(input.payload);
  const signature = createGitHubWebhookSignature({
    payload: payloadText,
    secret: input.webhookSecret,
  });

  return fetch(`${input.githubAppBaseUrl}/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': input.deliveryId,
      'x-github-event': input.eventName,
      'x-hub-signature-256': signature,
    },
    body: payloadText,
  });
}
