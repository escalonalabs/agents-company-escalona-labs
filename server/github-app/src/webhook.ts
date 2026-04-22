import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GitHubWebhookHeaders {
  deliveryId: string;
  eventName: string;
  signature: string;
}

export interface GitHubWebhookEnvelope {
  deliveryId: string;
  eventName: string;
  action: string | null;
  installationId: number | null;
  receivedAt: string;
  repositoryFullName: string | null;
  senderLogin: string | null;
}

export function normalizeGitHubWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): GitHubWebhookHeaders {
  return {
    deliveryId: readRequiredHeader(headers, 'x-github-delivery'),
    eventName: readRequiredHeader(headers, 'x-github-event'),
    signature: readRequiredHeader(headers, 'x-hub-signature-256'),
  };
}

export function verifyGitHubWebhookSignature(input: {
  secret: string;
  payload: Buffer;
  signature: string;
}): boolean {
  if (!input.signature.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = `sha256=${createHmac('sha256', input.secret)
    .update(input.payload)
    .digest('hex')}`;
  const receivedSignature = Buffer.from(input.signature, 'utf8');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

  if (receivedSignature.length !== expectedSignatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedSignature, expectedSignatureBuffer);
}

export function parseGitHubWebhookEnvelope(input: {
  deliveryId: string;
  eventName: string;
  receivedAt: string;
  payload: unknown;
}): GitHubWebhookEnvelope {
  const payload = isRecord(input.payload)
    ? input.payload
    : ({} as Record<string, unknown>);
  const installation = isRecord(payload.installation)
    ? payload.installation
    : null;
  const repository = isRecord(payload.repository) ? payload.repository : null;
  const sender = isRecord(payload.sender) ? payload.sender : null;

  return {
    deliveryId: input.deliveryId,
    eventName: input.eventName,
    action: asOptionalString(payload.action),
    installationId: asOptionalNumber(installation?.id),
    receivedAt: input.receivedAt,
    repositoryFullName: asOptionalString(repository?.full_name),
    senderLogin: asOptionalString(sender?.login),
  };
}

function readRequiredHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = headers[name];
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new Error(`Missing required GitHub webhook header: ${name}.`);
  }

  return normalized;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
