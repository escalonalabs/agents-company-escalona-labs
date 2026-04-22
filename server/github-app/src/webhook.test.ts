import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  normalizeGitHubWebhookHeaders,
  parseGitHubWebhookEnvelope,
  verifyGitHubWebhookSignature,
} from './webhook';

test('verifyGitHubWebhookSignature accepts the GitHub reference vector', () => {
  const payload = Buffer.from('Hello, World!', 'utf8');

  assert.equal(
    verifyGitHubWebhookSignature({
      secret: "It's a Secret to Everybody",
      payload,
      signature: `sha256=${createHmac('sha256', "It's a Secret to Everybody")
        .update(payload)
        .digest('hex')}`,
    }),
    true,
  );
});

test('verifyGitHubWebhookSignature rejects malformed and mismatched signatures', () => {
  const payload = Buffer.from('Hello, World!', 'utf8');

  assert.equal(
    verifyGitHubWebhookSignature({
      secret: 'super-secret',
      payload,
      signature: 'sha1=abc',
    }),
    false,
  );

  assert.equal(
    verifyGitHubWebhookSignature({
      secret: 'super-secret',
      payload,
      signature: 'sha256=deadbeef',
    }),
    false,
  );
});

test('normalizeGitHubWebhookHeaders reads required GitHub headers', () => {
  const headers = normalizeGitHubWebhookHeaders({
    'x-github-delivery': 'delivery-123',
    'x-github-event': 'issues',
    'x-hub-signature-256': 'sha256=abc',
  });

  assert.deepEqual(headers, {
    deliveryId: 'delivery-123',
    eventName: 'issues',
    signature: 'sha256=abc',
  });
});

test('parseGitHubWebhookEnvelope extracts useful delivery metadata', () => {
  const envelope = parseGitHubWebhookEnvelope({
    deliveryId: 'delivery-123',
    eventName: 'issues',
    receivedAt: '2026-04-22T18:00:00.000Z',
    payload: {
      action: 'opened',
      installation: { id: 99 },
      repository: { full_name: 'octo-org/octo-repo' },
      sender: { login: 'octocat' },
    },
  });

  assert.deepEqual(envelope, {
    deliveryId: 'delivery-123',
    eventName: 'issues',
    action: 'opened',
    installationId: 99,
    receivedAt: '2026-04-22T18:00:00.000Z',
    repositoryFullName: 'octo-org/octo-repo',
    senderLogin: 'octocat',
  });
});
