import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';

import type {
  AuthSession,
  CompanyMembership,
  CompanyRole,
  User,
} from '@escalonalabs/domain';

import {
  countUsers,
  createUserSession,
  getUserByEmail,
  getUserById,
  getUserSessionByTokenHash,
  listCompanyMembershipsForUser,
  updateUserSessionLastSeen,
} from './db/auth';
import type { Queryable } from './db/events';

const SESSION_COOKIE_NAME = 'agents_company_session';

const rolePriority: Record<CompanyRole, number> = {
  viewer: 1,
  reviewer: 2,
  operator: 3,
  admin: 4,
  owner: 5,
};

export interface AuthenticatedRequestContext {
  user: User;
  session: AuthSession;
  memberships: CompanyMembership[];
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [algorithm, salt, expectedHash] = encodedHash.split('$');

  if (algorithm !== 'scrypt' || !salt || !expectedHash) {
    return false;
  }

  const actualHash = scryptSync(password, salt, 64).toString('hex');
  return actualHash === expectedHash;
}

export function hashSessionToken(
  sessionToken: string,
  sessionSecret: string,
): string {
  return hashOpaqueToken(sessionToken, sessionSecret);
}

export function hashOpaqueToken(token: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${token}`).digest('hex');
}

export function createSessionCookie(input: {
  sessionToken: string;
  expiresAt: string;
  secure: boolean;
}): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(input.sessionToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(input.expiresAt).toUTCString()}`,
  ];

  if (input.secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function clearSessionCookie(input: { secure: boolean }): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (input.secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function parseCookieValue(
  cookieHeader: string | undefined,
  key: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const chunk of cookieHeader.split(';')) {
    const [name, ...valueParts] = chunk.trim().split('=');

    if (name === key) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return null;
}

export function canAssumeRole(
  memberships: CompanyMembership[],
  companyId: string,
  minimumRole: CompanyRole,
): boolean {
  const membership = memberships.find(
    (candidate) => candidate.companyId === companyId,
  );

  if (!membership) {
    return false;
  }

  return rolePriority[membership.role] >= rolePriority[minimumRole];
}

export async function loadAuthenticatedRequestContext(
  db: Queryable,
  input: {
    cookieHeader?: string;
    sessionSecret: string;
  },
): Promise<AuthenticatedRequestContext | null> {
  const sessionToken = parseCookieValue(
    input.cookieHeader,
    SESSION_COOKIE_NAME,
  );

  if (!sessionToken) {
    return null;
  }

  const sessionTokenHash = hashSessionToken(sessionToken, input.sessionSecret);
  const record = await getUserSessionByTokenHash(db, sessionTokenHash);

  if (!record) {
    return null;
  }

  if (new Date(record.session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const [user, memberships] = await Promise.all([
    getUserById(db, record.userId),
    listCompanyMembershipsForUser(db, record.userId),
  ]);

  if (!user) {
    return null;
  }

  const lastSeenAt = new Date().toISOString();
  await updateUserSessionLastSeen(db, record.session.sessionId, lastSeenAt);

  return {
    user,
    memberships,
    session: {
      ...record.session,
      lastSeenAt,
    },
  };
}

export async function createAuthenticatedSession(
  db: Queryable,
  input: {
    userId: string;
    sessionSecret: string;
    ttlHours: number;
  },
): Promise<{ session: AuthSession; sessionToken: string }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlHours * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString('hex');
  const session: AuthSession = {
    sessionId: `session_${randomUUID()}`,
    userId: input.userId,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await createUserSession(db, {
    session,
    sessionTokenHash: hashSessionToken(sessionToken, input.sessionSecret),
  });

  return {
    session,
    sessionToken,
  };
}

export async function authenticateWithPassword(
  db: Queryable,
  input: {
    email: string;
    password: string;
  },
): Promise<User | null> {
  const userRecord = await getUserByEmail(db, input.email);

  if (!userRecord || !verifyPassword(input.password, userRecord.passwordHash)) {
    return null;
  }

  return userRecord.user;
}

export async function bootstrapRequired(db: Queryable): Promise<boolean> {
  return (await countUsers(db)) === 0;
}
