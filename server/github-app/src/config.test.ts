import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGitHubAppConfig } from './config';

test('loadGitHubAppConfig normalizes secrets and reports readiness', () => {
  const config = loadGitHubAppConfig({
    AGENTS_COMPANY_GITHUB_APP_PORT: '4321',
    AGENTS_COMPANY_GITHUB_APP_ID: '12345',
    AGENTS_COMPANY_GITHUB_PRIVATE_KEY: 'line-1\\nline-2',
    AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET: 'super-secret',
    AGENTS_COMPANY_CONTROL_PLANE_URL: 'http://localhost:3000',
    AGENTS_COMPANY_INTERNAL_API_TOKEN: 'internal-token',
  });

  assert.equal(config.port, 4321);
  assert.equal(config.github.appId, '12345');
  assert.equal(config.github.privateKey, 'line-1\nline-2');
  assert.equal(config.github.webhookSecret, 'super-secret');
  assert.equal(config.controlPlane.baseUrl, 'http://localhost:3000');
  assert.equal(config.controlPlane.internalApiToken, 'internal-token');
  assert.equal(config.github.apiBaseUrl, 'https://api.github.com');
  assert.deepEqual(config.readiness, {
    appCredentialsReady: true,
    webhookVerificationReady: true,
    controlPlaneReady: true,
  });
});

test('loadGitHubAppConfig falls back to safe defaults when env is absent', () => {
  const config = loadGitHubAppConfig({});

  assert.equal(config.port, 3001);
  assert.equal(config.github.appId, null);
  assert.equal(config.github.privateKey, null);
  assert.equal(config.github.webhookSecret, null);
  assert.equal(config.controlPlane.baseUrl, null);
  assert.deepEqual(config.readiness, {
    appCredentialsReady: false,
    webhookVerificationReady: false,
    controlPlaneReady: false,
  });
});

test('loadGitHubAppConfig rejects invalid ports', () => {
  assert.throws(
    () =>
      loadGitHubAppConfig({
        AGENTS_COMPANY_GITHUB_APP_PORT: '0',
      }),
    /AGENTS_COMPANY_GITHUB_APP_PORT/,
  );
});
