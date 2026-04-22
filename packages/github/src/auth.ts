import {
  createHmac,
  createPrivateKey,
  createSign,
  timingSafeEqual,
} from 'node:crypto';

function toBase64Url(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value) : value;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function normalizeGitHubPrivateKey(privateKey: string): string {
  return privateKey.includes('\\n')
    ? privateKey.replace(/\\n/g, '\n')
    : privateKey;
}

export function createGitHubAppJwt(input: {
  appId: string | number;
  privateKey: string;
  now?: number;
  expiresInSeconds?: number;
}): string {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const expiresInSeconds = Math.min(input.expiresInSeconds ?? 540, 540);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const payload = {
    iat: now - 60,
    exp: now + expiresInSeconds,
    iss: String(input.appId),
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
    JSON.stringify(payload),
  )}`;
  const signer = createSign('RSA-SHA256');

  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(
    createPrivateKey(normalizeGitHubPrivateKey(input.privateKey)),
  );

  return `${signingInput}.${toBase64Url(signature)}`;
}

export function createGitHubWebhookSignature(input: {
  payload: string;
  secret: string;
}): string {
  return `sha256=${createHmac('sha256', input.secret)
    .update(input.payload)
    .digest('hex')}`;
}

export function verifyGitHubWebhookSignature(input: {
  payload: string;
  secret?: string;
  signatureHeader?: string;
}): { ok: boolean; reason?: string } {
  if (!input.secret) {
    return { ok: false, reason: 'webhook secret not configured' };
  }

  if (!input.signatureHeader) {
    return { ok: false, reason: 'missing x-hub-signature-256 header' };
  }

  const expected = createGitHubWebhookSignature({
    payload: input.payload,
    secret: input.secret,
  });
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) {
    return { ok: false, reason: 'signature length mismatch' };
  }

  return timingSafeEqual(expectedBuffer, actualBuffer)
    ? { ok: true }
    : { ok: false, reason: 'signature mismatch' };
}
