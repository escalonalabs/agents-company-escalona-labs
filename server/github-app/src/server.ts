import Fastify from 'fastify';

import {
  applyGitHubSyncPlan,
  createGitHubRestTransport,
  requestGitHubInstallationAccessToken,
} from '@escalonalabs/github';

import { loadGitHubAppConfig } from './config';
import { postControlPlaneJson } from './control-plane';
import { renderGitHubAppPrometheusMetrics } from './metrics';
import { createGitHubWebhookTelemetry } from './telemetry';
import {
  type GitHubWebhookHeaders,
  normalizeGitHubWebhookHeaders,
  parseGitHubWebhookEnvelope,
  verifyGitHubWebhookSignature,
} from './webhook';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

interface GitHubAppServerDependencies {
  fetchFn?: typeof fetch;
}

interface SyncPlanResponseBody {
  batches: Array<{
    installation: {
      companyId: string;
      installationId: number;
      accountLogin: string;
      repository: {
        owner: string;
        name: string;
        id?: number;
      };
      createdAt: string;
      updatedAt: string;
    };
    bindings: Array<import('@escalonalabs/github').GitHubProjectionBinding>;
    plan: Array<import('@escalonalabs/github').GitHubProjectionPlanItem>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asSyncPlanResponse(value: unknown): SyncPlanResponseBody | null {
  return isRecord(value) &&
    Array.isArray(value.batches) &&
    value.batches.every(
      (batch) =>
        isRecord(batch) &&
        isRecord(batch.installation) &&
        Array.isArray(batch.plan) &&
        Array.isArray(batch.bindings),
    )
    ? (value as unknown as SyncPlanResponseBody)
    : null;
}

function deriveServiceStatus(config: ReturnType<typeof loadGitHubAppConfig>) {
  return Object.values(config.readiness).every(Boolean) ? 'ok' : 'degraded';
}

export function buildGitHubAppServer(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: GitHubAppServerDependencies = {},
) {
  const config = loadGitHubAppConfig(env);
  const telemetry = createGitHubWebhookTelemetry();
  const server = Fastify({
    logger: true,
    bodyLimit: config.webhook.bodyLimitBytes,
  });

  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      request.rawBody = Buffer.isBuffer(body)
        ? body
        : Buffer.from(body, 'utf8');

      try {
        const parsedBody = JSON.parse(
          request.rawBody.toString('utf8'),
        ) as unknown;
        done(null, parsedBody);
      } catch {
        const error = new Error('GitHub webhook body must be valid JSON.');
        Object.assign(error, { statusCode: 400 });
        done(error);
      }
    },
  );

  server.setErrorHandler(async (error, request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message =
      error instanceof Error ? error.message : 'Internal server error.';

    if (request.url === config.webhook.path && statusCode === 400) {
      telemetry.recordRejected('invalid JSON body');
      reply.code(400);
      return {
        message,
      };
    }

    request.log.error(error);
    reply.code(500);
    return {
      message: 'Internal server error.',
    };
  });

  server.get('/health', async () => {
    const snapshot = telemetry.snapshot();

    return {
      service: config.serviceName,
      status: deriveServiceStatus(config),
      authStrategy: config.github.authStrategy,
      nodeEnv: config.nodeEnv,
      readiness: config.readiness,
      webhook: config.webhook,
      controlPlane: config.controlPlane,
      metrics: {
        acceptedDeliveries: snapshot.acceptedDeliveries,
        rejectedDeliveries: snapshot.rejectedDeliveries,
        startedAt: snapshot.startedAt,
        uptimeSeconds: process.uptime(),
      },
      lastDelivery: snapshot.lastDelivery,
      lastRejection: snapshot.lastRejection,
    };
  });

  server.get('/metrics', async (_request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    reply.header('cache-control', 'no-store');

    return renderGitHubAppPrometheusMetrics({
      config,
      telemetry: telemetry.snapshot(),
    });
  });

  server.post<{
    Body: {
      companyId: string;
      installationId: number;
      accountLogin: string;
      repository: {
        owner: string;
        name: string;
        id?: number;
      };
    };
  }>('/installations/link', async (request, reply) => {
    if (!config.controlPlane.baseUrl || !config.controlPlane.internalApiToken) {
      reply.code(503);
      return {
        message:
          'Control plane internal transport is not configured for installation linking.',
      };
    }

    const response = await postControlPlaneJson({
      baseUrl: config.controlPlane.baseUrl,
      path: '/internal/github/installations/link',
      body: request.body,
      internalApiToken: config.controlPlane.internalApiToken,
      client: { fetchFn: dependencies.fetchFn },
    });

    reply.code(response.status);
    return response.body;
  });

  server.post<{ Params: { companyId: string } }>(
    '/companies/:companyId/sync',
    async (request, reply) => {
      if (
        !config.controlPlane.baseUrl ||
        !config.controlPlane.internalApiToken
      ) {
        reply.code(503);
        return {
          message:
            'Control plane internal transport is not configured for GitHub sync.',
        };
      }

      if (!config.github.appId || !config.github.privateKey) {
        reply.code(503);
        return {
          message: 'GitHub App credentials are not configured for GitHub sync.',
        };
      }

      const syncPlanResponse = await postControlPlaneJson({
        baseUrl: config.controlPlane.baseUrl,
        path: `/internal/github/companies/${request.params.companyId}/sync-plan`,
        body: {},
        internalApiToken: config.controlPlane.internalApiToken,
        client: { fetchFn: dependencies.fetchFn },
      });

      if (!syncPlanResponse.ok) {
        reply.code(syncPlanResponse.status);
        return syncPlanResponse.body;
      }

      const syncPlan = asSyncPlanResponse(syncPlanResponse.body);
      if (!syncPlan) {
        reply.code(502);
        return {
          message:
            'Control plane returned an invalid GitHub sync plan payload.',
        };
      }

      const batchResults = [];
      const combinedBindings: Array<
        import('@escalonalabs/github').GitHubProjectionBinding
      > = [];
      const combinedDeliveries: Array<
        import('@escalonalabs/github').GitHubProjectionDelivery
      > = [];
      const combinedDriftAlerts: unknown[] = [];

      for (const batch of syncPlan.batches) {
        const tokenResponse = await requestGitHubInstallationAccessToken({
          appId: config.github.appId,
          privateKey: config.github.privateKey,
          installationId: batch.installation.installationId,
          apiBaseUrl: config.github.apiBaseUrl,
          fetchFn: dependencies.fetchFn,
        });
        const transport = createGitHubRestTransport({
          apiBaseUrl: config.github.apiBaseUrl,
          fetchFn: dependencies.fetchFn,
          getToken: async () => tokenResponse.token,
        });
        const syncResult = await applyGitHubSyncPlan({
          installation: batch.installation,
          bindings: batch.bindings,
          plan: batch.plan,
          transport,
        });

        batchResults.push({
          installation: batch.installation,
          tokenExpiresAt: tokenResponse.expiresAt ?? null,
          sync: syncResult,
        });
        combinedBindings.push(...syncResult.bindings);
        combinedDeliveries.push(...syncResult.deliveries);
        combinedDriftAlerts.push(...syncResult.driftAlerts);
      }

      const persistResponse = await postControlPlaneJson({
        baseUrl: config.controlPlane.baseUrl,
        path: `/internal/github/companies/${request.params.companyId}/sync-results`,
        body: {
          bindings: combinedBindings,
          deliveries: combinedDeliveries,
          driftAlerts: combinedDriftAlerts,
        },
        internalApiToken: config.controlPlane.internalApiToken,
        client: { fetchFn: dependencies.fetchFn },
      });

      if (!persistResponse.ok) {
        reply.code(persistResponse.status);
        return persistResponse.body;
      }

      return {
        batches: batchResults,
        persisted: persistResponse.body,
      };
    },
  );

  server.post(config.webhook.path, async (request, reply) => {
    if (!config.github.webhookSecret) {
      telemetry.recordRejected('webhook secret not configured');
      reply.code(503);
      return {
        message:
          'GitHub webhook secret is not configured. Refusing unsigned ingestion.',
      };
    }

    let headers: GitHubWebhookHeaders;
    try {
      headers = normalizeGitHubWebhookHeaders(
        request.headers as Record<string, string | string[] | undefined>,
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'missing required headers';
      telemetry.recordRejected(reason);
      reply.code(400);
      return { message: reason };
    }

    if (!request.rawBody) {
      telemetry.recordRejected('raw body unavailable');
      reply.code(500);
      return {
        message:
          'GitHub webhook body was unavailable for signature validation.',
      };
    }

    if (
      !verifyGitHubWebhookSignature({
        secret: config.github.webhookSecret,
        payload: request.rawBody,
        signature: headers.signature,
      })
    ) {
      telemetry.recordRejected('signature verification failed');
      reply.code(401);
      return {
        message: 'GitHub webhook signature verification failed.',
      };
    }

    if (typeof request.body !== 'object' || request.body === null) {
      telemetry.recordRejected('payload must be a JSON object');
      reply.code(400);
      return {
        message: 'GitHub webhook payload must be a JSON object.',
      };
    }

    const delivery = parseGitHubWebhookEnvelope({
      deliveryId: headers.deliveryId,
      eventName: headers.eventName,
      receivedAt: new Date().toISOString(),
      payload: request.body,
    });

    if (config.controlPlane.baseUrl && !config.controlPlane.internalApiToken) {
      telemetry.recordRejected('control plane internal token missing');
      reply.code(503);
      return {
        message:
          'Control plane internal token is required before webhook forwarding can be enabled.',
      };
    }

    if (config.controlPlane.baseUrl && config.controlPlane.internalApiToken) {
      const forwardResponse = await postControlPlaneJson({
        baseUrl: config.controlPlane.baseUrl,
        path: '/internal/github/webhooks/ingest',
        body: {
          deliveryId: delivery.deliveryId,
          eventName: delivery.eventName,
          action: delivery.action,
          receivedAt: delivery.receivedAt,
          payload: request.body as Record<string, unknown>,
        },
        internalApiToken: config.controlPlane.internalApiToken,
        client: { fetchFn: dependencies.fetchFn },
      });

      if (!forwardResponse.ok) {
        telemetry.recordRejected('control plane ingestion failed');
        reply.code(502);
        return {
          message: 'Control plane rejected the GitHub webhook delivery.',
          details: forwardResponse.body,
        };
      }
    }

    telemetry.recordAccepted(delivery);
    request.log.info(
      {
        deliveryId: delivery.deliveryId,
        eventName: delivery.eventName,
        action: delivery.action,
        installationId: delivery.installationId,
        repositoryFullName: delivery.repositoryFullName,
      },
      'GitHub webhook ingested',
    );

    reply.code(202);
    return {
      accepted: true,
      deliveryId: delivery.deliveryId,
      eventName: delivery.eventName,
      action: delivery.action,
      repositoryFullName: delivery.repositoryFullName,
      installationId: delivery.installationId,
    };
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadGitHubAppConfig();
  const server = buildGitHubAppServer();

  server.listen({ port: config.port, host: '0.0.0.0' }).catch((error) => {
    server.log.error(error);
    process.exitCode = 1;
  });
}
