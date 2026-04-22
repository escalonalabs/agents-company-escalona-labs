import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { buildGitHubAppServer } from './server';

test('GET /health reports config readiness and delivery counters', async () => {
  const server = buildGitHubAppServer({
    AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: 'super-secret',
  });

  try {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.equal(body.service, 'github-app');
    assert.equal(body.status, 'degraded');
    assert.equal(body.readiness.appCredentialsReady, false);
    assert.equal(body.readiness.webhookVerificationReady, true);
    assert.equal(body.readiness.controlPlaneReady, false);
    assert.equal(body.metrics.acceptedDeliveries, 0);
    assert.equal(body.metrics.rejectedDeliveries, 0);
  } finally {
    await server.close();
  }
});

test('GET /metrics exposes Prometheus-ready delivery counters', async () => {
  const server = buildGitHubAppServer({
    AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: 'super-secret',
  });

  try {
    const response = await server.inject({
      method: 'GET',
      url: '/metrics',
    });

    assert.equal(response.statusCode, 200);
    assert.match(
      String(response.headers['content-type']),
      /text\/plain; version=0\.0\.4/,
    );
    assert.match(response.body, /agents_company_github_app_up 1/);
    assert.match(
      response.body,
      /agents_company_github_app_rejected_deliveries_total 0/,
    );
  } finally {
    await server.close();
  }
});

test('POST /webhooks/github rejects deliveries when the signature is missing', async () => {
  const server = buildGitHubAppServer({
    AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: 'super-secret',
  });

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': 'delivery-123',
        'x-github-event': 'issues',
      },
      payload: JSON.stringify({ action: 'opened' }),
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /x-hub-signature-256/i);
  } finally {
    await server.close();
  }
});

test('POST /webhooks/github verifies HMAC, ingests metadata, and updates health', async () => {
  const secret = 'super-secret';
  const payload = JSON.stringify({
    action: 'opened',
    installation: { id: 42 },
    repository: { full_name: 'escalona-labs/m11' },
    sender: { login: 'octocat' },
  });
  const signature = `sha256=${createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex')}`;

  const server = buildGitHubAppServer(
    {
      AGENTS_COMPANY_GITHUB_APP_ID: '12345',
      AGENTS_COMPANY_GITHUB_PRIVATE_KEY: 'private-key',
      AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: secret,
      AGENTS_COMPANY_CONTROL_PLANE_URL: 'http://control-plane.internal',
      AGENTS_COMPANY_INTERNAL_API_TOKEN: 'internal-token',
    },
    {
      fetchFn: async () =>
        new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
    },
  );

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': 'delivery-123',
        'x-github-event': 'issues',
        'x-hub-signature-256': signature,
      },
      payload,
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), {
      accepted: true,
      deliveryId: 'delivery-123',
      eventName: 'issues',
      action: 'opened',
      repositoryFullName: 'escalona-labs/m11',
      installationId: 42,
    });

    const health = await server.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(health.statusCode, 200);

    const healthBody = health.json();
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.metrics.acceptedDeliveries, 1);
    assert.equal(healthBody.metrics.rejectedDeliveries, 0);
    assert.deepEqual(healthBody.lastDelivery, {
      deliveryId: 'delivery-123',
      eventName: 'issues',
      action: 'opened',
      repositoryFullName: 'escalona-labs/m11',
      installationId: 42,
      senderLogin: 'octocat',
      receivedAt: healthBody.lastDelivery.receivedAt,
    });
  } finally {
    await server.close();
  }
});

test('POST /webhooks/github fails closed when control plane forwarding lacks the internal token', async () => {
  const secret = 'super-secret';
  const payload = JSON.stringify({
    action: 'opened',
    installation: { id: 42 },
    repository: { full_name: 'escalona-labs/m11' },
  });
  const signature = `sha256=${createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex')}`;

  const server = buildGitHubAppServer({
    AGENTS_COMPANY_CONTROL_PLANE_URL: 'http://control-plane.internal',
    AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: secret,
  });

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': 'delivery-123',
        'x-github-event': 'issues',
        'x-hub-signature-256': signature,
      },
      payload,
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /internal token/i);
  } finally {
    await server.close();
  }
});

test('POST /webhooks/github fails closed when webhook verification is not configured', async () => {
  const server = buildGitHubAppServer({});

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': 'delivery-123',
        'x-github-event': 'issues',
        'x-hub-signature-256': 'sha256=abc',
      },
      payload: JSON.stringify({ action: 'opened' }),
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /webhook secret/i);
  } finally {
    await server.close();
  }
});

test('POST /installations/link forwards installation linkage to the control plane', async () => {
  const server = buildGitHubAppServer(
    {
      AGENTS_COMPANY_CONTROL_PLANE_URL: 'http://control-plane.internal',
      AGENTS_COMPANY_INTERNAL_API_TOKEN: 'internal-token',
    },
    {
      fetchFn: async (_url, init) =>
        new Response(
          JSON.stringify({
            linked: true,
            requestBody: JSON.parse(String(init?.body ?? '{}')),
          }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        ),
    },
  );

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/installations/link',
      payload: {
        companyId: 'company_001',
        installationId: 42,
        accountLogin: 'escalonalabs',
        repository: {
          owner: 'escalonalabs',
          name: 'agents-company-escalona-labs',
        },
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().linked, true);
    assert.equal(response.json().requestBody.installationId, 42);
  } finally {
    await server.close();
  }
});
