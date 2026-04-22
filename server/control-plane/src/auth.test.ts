import { describe, expect, it } from 'vitest';

import {
  canAssumeRole,
  clearSessionCookie,
  createSessionCookie,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from './auth';

describe('control-plane auth helpers', () => {
  it('hashes and verifies passwords with scrypt', () => {
    const passwordHash = hashPassword('EscalonaLabs!123');

    expect(passwordHash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('EscalonaLabs!123', passwordHash)).toBe(true);
    expect(verifyPassword('wrong-password', passwordHash)).toBe(false);
  });

  it('enforces role hierarchy by company membership', () => {
    const memberships = [
      {
        companyId: 'company_001',
        userId: 'user_001',
        role: 'reviewer' as const,
        createdAt: '2026-04-22T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z',
      },
    ];

    expect(canAssumeRole(memberships, 'company_001', 'viewer')).toBe(true);
    expect(canAssumeRole(memberships, 'company_001', 'reviewer')).toBe(true);
    expect(canAssumeRole(memberships, 'company_001', 'operator')).toBe(false);
    expect(canAssumeRole(memberships, 'company_999', 'viewer')).toBe(false);
  });

  it('serializes and clears the session cookie consistently', () => {
    const cookie = createSessionCookie({
      sessionToken: 'session-token',
      expiresAt: '2026-04-29T00:00:00.000Z',
      secure: true,
    });

    expect(cookie).toContain('agents_company_session=session-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');

    const cleared = clearSessionCookie({ secure: true });
    expect(cleared).toContain('agents_company_session=');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('hashes opaque invitation/session tokens deterministically per secret', () => {
    const first = hashOpaqueToken('invite-token', 'secret-a');
    const second = hashOpaqueToken('invite-token', 'secret-a');
    const third = hashOpaqueToken('invite-token', 'secret-b');

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(first).toHaveLength(64);
  });
});
