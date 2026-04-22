import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGitHubAppConfig } from './config';
import { renderGitHubAppPrometheusMetrics } from './metrics';

test('renderGitHubAppPrometheusMetrics emits readiness and delivery counters', () => {
  const config = loadGitHubAppConfig({
    AGENTS_COMPANY_GITHUB_APP_ID: '12345',
    AGENTS_COMPANY_GITHUB_PRIVATE_KEY: 'private-key',
    AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: 'super-secret',
    AGENTS_COMPANY_CONTROL_PLANE_URL: 'http://control-plane.internal',
    AGENTS_COMPANY_INTERNAL_API_TOKEN: 'internal-token',
  });

  const output = renderGitHubAppPrometheusMetrics({
    config,
    telemetry: {
      acceptedDeliveries: 4,
      rejectedDeliveries: 1,
      startedAt: '2026-04-22T22:00:00.000Z',
      lastDelivery: {
        deliveryId: 'delivery-123',
        eventName: 'issue_comment',
        action: 'created',
        repositoryFullName: 'escalonalabs/agents-company-escalona-labs',
        installationId: 126259795,
        senderLogin: 'escalonalabs',
        receivedAt: '2026-04-22T22:25:32.883Z',
      },
      lastRejection: {
        reason: 'signature mismatch',
        receivedAt: '2026-04-22T22:20:00.000Z',
      },
    },
  });

  assert.match(output, /agents_company_github_app_up 1/);
  assert.match(output, /agents_company_github_app_credentials_ready 1/);
  assert.match(
    output,
    /agents_company_github_app_webhook_verification_ready 1/,
  );
  assert.match(output, /agents_company_github_app_accepted_deliveries_total 4/);
  assert.match(output, /agents_company_github_app_rejected_deliveries_total 1/);
});
