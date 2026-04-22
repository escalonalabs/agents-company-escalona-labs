import type {
  AuthSession,
  Company,
  CompanyInvitation,
  CompanyMembership,
  User,
} from '@escalonalabs/domain';

import type { Queryable } from './events';

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  password_hash: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface MembershipRow {
  company_id: string;
  user_id: string;
  role: CompanyMembership['role'];
  created_at: string | Date;
  updated_at: string | Date;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  session_token_hash: string;
  expires_at: string | Date;
  created_at: string | Date;
  last_seen_at: string | Date;
}

interface CompanyInvitationRow {
  invitation_id: string;
  company_id: string;
  email: string;
  role: CompanyInvitation['role'];
  status: CompanyInvitation['status'];
  invitation_token_hash: string;
  invited_by_user_id: string | null;
  accepted_by_user_id: string | null;
  expires_at: string | Date;
  accepted_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  invited_by_email?: string | null;
  invited_by_display_name?: string | null;
  accepted_by_email?: string | null;
  accepted_by_display_name?: string | null;
}

interface CompanyAccessRow {
  company_id: string;
  slug: string;
  display_name: string;
  status: Company['status'];
  beta_phase: Company['betaPhase'] | null;
  beta_enrollment_status: Company['betaEnrollmentStatus'] | null;
  beta_notes: string | null;
  beta_updated_at: string | Date | null;
  created_at: string | Date;
}

export interface CompanyMembershipProfile extends CompanyMembership {
  email: string;
  displayName?: string;
}

export interface CompanyInvitationProfile extends CompanyInvitation {
  invitedByEmail?: string;
  invitedByDisplayName?: string;
  acceptedByEmail?: string;
  acceptedByDisplayName?: string;
}

function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapUserRow(row: UserRow): User {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function mapMembershipRow(row: MembershipRow): CompanyMembership {
  return {
    companyId: row.company_id,
    userId: row.user_id,
    role: row.role,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function mapSessionRow(row: SessionRow): AuthSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    expiresAt: normalizeTimestamp(row.expires_at),
    createdAt: normalizeTimestamp(row.created_at),
    lastSeenAt: normalizeTimestamp(row.last_seen_at),
  };
}

function mapCompanyAccessRow(row: CompanyAccessRow): Company {
  return {
    companyId: row.company_id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    betaPhase: row.beta_phase ?? 'internal_alpha',
    betaEnrollmentStatus: row.beta_enrollment_status ?? 'active',
    betaNotes: row.beta_notes ?? undefined,
    betaUpdatedAt: row.beta_updated_at
      ? normalizeTimestamp(row.beta_updated_at)
      : normalizeTimestamp(row.created_at),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function mapCompanyInvitationRow(
  row: CompanyInvitationRow,
): CompanyInvitationProfile {
  return {
    invitationId: row.invitation_id,
    companyId: row.company_id,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedByUserId: row.invited_by_user_id ?? undefined,
    acceptedByUserId: row.accepted_by_user_id ?? undefined,
    expiresAt: normalizeTimestamp(row.expires_at),
    acceptedAt: row.accepted_at
      ? normalizeTimestamp(row.accepted_at)
      : undefined,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    invitedByEmail: row.invited_by_email ?? undefined,
    invitedByDisplayName: row.invited_by_display_name ?? undefined,
    acceptedByEmail: row.accepted_by_email ?? undefined,
    acceptedByDisplayName: row.accepted_by_display_name ?? undefined,
  };
}

export async function countUsers(db: Queryable): Promise<number> {
  const result = await db.query<{ count: string }>(
    'select count(*)::text as count from users',
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function createUser(
  db: Queryable,
  input: {
    user: User;
    passwordHash: string;
  },
): Promise<void> {
  await db.query(
    `
      insert into users (
        user_id,
        email,
        display_name,
        password_hash,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [
      input.user.userId,
      input.user.email,
      input.user.displayName ?? null,
      input.passwordHash,
      input.user.createdAt,
      input.user.updatedAt,
    ],
  );
}

export async function getUserByEmail(
  db: Queryable,
  email: string,
): Promise<{ user: User; passwordHash: string } | null> {
  const result = await db.query<UserRow>(
    `
      select
        user_id,
        email,
        display_name,
        password_hash,
        created_at,
        updated_at
      from users
      where lower(email) = lower($1)
      limit 1
    `,
    [email],
  );

  const row = result.rows[0];

  return row
    ? {
        user: mapUserRow(row),
        passwordHash: row.password_hash,
      }
    : null;
}

export async function getUserById(
  db: Queryable,
  userId: string,
): Promise<User | null> {
  const result = await db.query<UserRow>(
    `
      select
        user_id,
        email,
        display_name,
        password_hash,
        created_at,
        updated_at
      from users
      where user_id = $1
      limit 1
    `,
    [userId],
  );

  return result.rows[0] ? mapUserRow(result.rows[0]) : null;
}

export async function addCompanyMembership(
  db: Queryable,
  membership: CompanyMembership,
): Promise<void> {
  await db.query(
    `
      insert into company_memberships (
        company_id,
        user_id,
        role,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5)
      on conflict (company_id, user_id)
      do update set
        role = excluded.role,
        updated_at = excluded.updated_at
    `,
    [
      membership.companyId,
      membership.userId,
      membership.role,
      membership.createdAt,
      membership.updatedAt,
    ],
  );
}

export async function listCompanyMembershipsForUser(
  db: Queryable,
  userId: string,
): Promise<CompanyMembership[]> {
  const result = await db.query<MembershipRow>(
    `
      select company_id, user_id, role, created_at, updated_at
      from company_memberships
      where user_id = $1
      order by created_at asc
    `,
    [userId],
  );

  return result.rows.map(mapMembershipRow);
}

export async function listCompanyMembershipsForCompany(
  db: Queryable,
  companyId: string,
): Promise<CompanyMembershipProfile[]> {
  const result = await db.query<
    MembershipRow & {
      email: string;
      display_name: string | null;
    }
  >(
    `
      select
        company_memberships.company_id,
        company_memberships.user_id,
        company_memberships.role,
        company_memberships.created_at,
        company_memberships.updated_at,
        users.email,
        users.display_name
      from company_memberships
      inner join users on users.user_id = company_memberships.user_id
      where company_memberships.company_id = $1
      order by company_memberships.created_at asc
    `,
    [companyId],
  );

  return result.rows.map((row) => ({
    ...mapMembershipRow(row),
    email: row.email,
    displayName: row.display_name ?? undefined,
  }));
}

export async function getCompanyMembership(
  db: Queryable,
  companyId: string,
  userId: string,
): Promise<CompanyMembership | null> {
  const result = await db.query<MembershipRow>(
    `
      select company_id, user_id, role, created_at, updated_at
      from company_memberships
      where company_id = $1 and user_id = $2
      limit 1
    `,
    [companyId, userId],
  );

  return result.rows[0] ? mapMembershipRow(result.rows[0]) : null;
}

export async function listCompaniesForUser(
  db: Queryable,
  userId: string,
): Promise<Company[]> {
  const result = await db.query<CompanyAccessRow>(
    `
      select
        companies.company_id,
        companies.slug,
        companies.display_name,
        companies.status,
        companies.beta_phase,
        companies.beta_enrollment_status,
        companies.beta_notes,
        companies.beta_updated_at,
        companies.created_at
      from companies
      inner join company_memberships
        on company_memberships.company_id = companies.company_id
      where company_memberships.user_id = $1
      order by companies.created_at asc
    `,
    [userId],
  );

  return result.rows.map(mapCompanyAccessRow);
}

export async function createUserSession(
  db: Queryable,
  input: {
    session: AuthSession;
    sessionTokenHash: string;
  },
): Promise<void> {
  await db.query(
    `
      insert into user_sessions (
        session_id,
        user_id,
        session_token_hash,
        expires_at,
        created_at,
        last_seen_at
      )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [
      input.session.sessionId,
      input.session.userId,
      input.sessionTokenHash,
      input.session.expiresAt,
      input.session.createdAt,
      input.session.lastSeenAt,
    ],
  );
}

export async function getUserSessionByTokenHash(
  db: Queryable,
  sessionTokenHash: string,
): Promise<{ session: AuthSession; userId: string } | null> {
  const result = await db.query<SessionRow>(
    `
      select
        session_id,
        user_id,
        session_token_hash,
        expires_at,
        created_at,
        last_seen_at
      from user_sessions
      where session_token_hash = $1
      limit 1
    `,
    [sessionTokenHash],
  );

  const row = result.rows[0];
  return row
    ? {
        session: mapSessionRow(row),
        userId: row.user_id,
      }
    : null;
}

export async function updateUserSessionLastSeen(
  db: Queryable,
  sessionId: string,
  lastSeenAt: string,
): Promise<void> {
  await db.query(
    `
      update user_sessions
      set last_seen_at = $2
      where session_id = $1
    `,
    [sessionId, lastSeenAt],
  );
}

export async function deleteUserSession(
  db: Queryable,
  sessionId: string,
): Promise<void> {
  await db.query('delete from user_sessions where session_id = $1', [
    sessionId,
  ]);
}

export async function createCompanyInvitation(
  db: Queryable,
  input: {
    invitation: CompanyInvitation;
    invitationTokenHash: string;
  },
): Promise<void> {
  await db.query(
    `
      insert into company_invitations (
        invitation_id,
        company_id,
        email,
        role,
        status,
        invitation_token_hash,
        invited_by_user_id,
        accepted_by_user_id,
        expires_at,
        accepted_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      input.invitation.invitationId,
      input.invitation.companyId,
      input.invitation.email,
      input.invitation.role,
      input.invitation.status,
      input.invitationTokenHash,
      input.invitation.invitedByUserId ?? null,
      input.invitation.acceptedByUserId ?? null,
      input.invitation.expiresAt,
      input.invitation.acceptedAt ?? null,
      input.invitation.createdAt,
      input.invitation.updatedAt,
    ],
  );
}

export async function findActiveCompanyInvitationByEmail(
  db: Queryable,
  input: {
    companyId: string;
    email: string;
  },
): Promise<CompanyInvitationProfile | null> {
  const result = await db.query<CompanyInvitationRow>(
    `
      select
        company_invitations.invitation_id,
        company_invitations.company_id,
        company_invitations.email,
        company_invitations.role,
        case
          when company_invitations.status = 'pending'
           and company_invitations.expires_at <= now()
            then 'expired'
          else company_invitations.status
        end as status,
        company_invitations.invitation_token_hash,
        company_invitations.invited_by_user_id,
        company_invitations.accepted_by_user_id,
        company_invitations.expires_at,
        company_invitations.accepted_at,
        company_invitations.created_at,
        company_invitations.updated_at,
        inviter.email as invited_by_email,
        inviter.display_name as invited_by_display_name,
        accepted.email as accepted_by_email,
        accepted.display_name as accepted_by_display_name
      from company_invitations
      left join users as inviter
        on inviter.user_id = company_invitations.invited_by_user_id
      left join users as accepted
        on accepted.user_id = company_invitations.accepted_by_user_id
      where company_invitations.company_id = $1
        and lower(company_invitations.email) = lower($2)
        and company_invitations.status = 'pending'
        and company_invitations.expires_at > now()
      order by company_invitations.created_at desc
      limit 1
    `,
    [input.companyId, input.email],
  );

  return result.rows[0] ? mapCompanyInvitationRow(result.rows[0]) : null;
}

export async function getCompanyInvitationById(
  db: Queryable,
  input: {
    companyId: string;
    invitationId: string;
  },
): Promise<CompanyInvitationProfile | null> {
  const result = await db.query<CompanyInvitationRow>(
    `
      select
        company_invitations.invitation_id,
        company_invitations.company_id,
        company_invitations.email,
        company_invitations.role,
        case
          when company_invitations.status = 'pending'
           and company_invitations.expires_at <= now()
            then 'expired'
          else company_invitations.status
        end as status,
        company_invitations.invitation_token_hash,
        company_invitations.invited_by_user_id,
        company_invitations.accepted_by_user_id,
        company_invitations.expires_at,
        company_invitations.accepted_at,
        company_invitations.created_at,
        company_invitations.updated_at,
        inviter.email as invited_by_email,
        inviter.display_name as invited_by_display_name,
        accepted.email as accepted_by_email,
        accepted.display_name as accepted_by_display_name
      from company_invitations
      left join users as inviter
        on inviter.user_id = company_invitations.invited_by_user_id
      left join users as accepted
        on accepted.user_id = company_invitations.accepted_by_user_id
      where company_invitations.company_id = $1
        and company_invitations.invitation_id = $2
      limit 1
    `,
    [input.companyId, input.invitationId],
  );

  return result.rows[0] ? mapCompanyInvitationRow(result.rows[0]) : null;
}

export async function getCompanyInvitationByTokenHash(
  db: Queryable,
  invitationTokenHash: string,
): Promise<CompanyInvitationProfile | null> {
  const result = await db.query<CompanyInvitationRow>(
    `
      select
        company_invitations.invitation_id,
        company_invitations.company_id,
        company_invitations.email,
        company_invitations.role,
        case
          when company_invitations.status = 'pending'
           and company_invitations.expires_at <= now()
            then 'expired'
          else company_invitations.status
        end as status,
        company_invitations.invitation_token_hash,
        company_invitations.invited_by_user_id,
        company_invitations.accepted_by_user_id,
        company_invitations.expires_at,
        company_invitations.accepted_at,
        company_invitations.created_at,
        company_invitations.updated_at,
        inviter.email as invited_by_email,
        inviter.display_name as invited_by_display_name,
        accepted.email as accepted_by_email,
        accepted.display_name as accepted_by_display_name
      from company_invitations
      left join users as inviter
        on inviter.user_id = company_invitations.invited_by_user_id
      left join users as accepted
        on accepted.user_id = company_invitations.accepted_by_user_id
      where company_invitations.invitation_token_hash = $1
      limit 1
    `,
    [invitationTokenHash],
  );

  return result.rows[0] ? mapCompanyInvitationRow(result.rows[0]) : null;
}

export async function listCompanyInvitationsForCompany(
  db: Queryable,
  companyId: string,
): Promise<CompanyInvitationProfile[]> {
  const result = await db.query<CompanyInvitationRow>(
    `
      select
        company_invitations.invitation_id,
        company_invitations.company_id,
        company_invitations.email,
        company_invitations.role,
        case
          when company_invitations.status = 'pending'
           and company_invitations.expires_at <= now()
            then 'expired'
          else company_invitations.status
        end as status,
        company_invitations.invitation_token_hash,
        company_invitations.invited_by_user_id,
        company_invitations.accepted_by_user_id,
        company_invitations.expires_at,
        company_invitations.accepted_at,
        company_invitations.created_at,
        company_invitations.updated_at,
        inviter.email as invited_by_email,
        inviter.display_name as invited_by_display_name,
        accepted.email as accepted_by_email,
        accepted.display_name as accepted_by_display_name
      from company_invitations
      left join users as inviter
        on inviter.user_id = company_invitations.invited_by_user_id
      left join users as accepted
        on accepted.user_id = company_invitations.accepted_by_user_id
      where company_invitations.company_id = $1
      order by company_invitations.created_at desc
    `,
    [companyId],
  );

  return result.rows.map(mapCompanyInvitationRow);
}

export async function acceptCompanyInvitation(
  db: Queryable,
  input: {
    invitationId: string;
    acceptedByUserId: string;
    acceptedAt: string;
  },
): Promise<void> {
  await db.query(
    `
      update company_invitations
      set
        status = 'accepted',
        accepted_by_user_id = $2,
        accepted_at = $3,
        updated_at = $3
      where invitation_id = $1
    `,
    [input.invitationId, input.acceptedByUserId, input.acceptedAt],
  );
}

export async function revokeCompanyInvitation(
  db: Queryable,
  input: {
    invitationId: string;
    updatedAt: string;
  },
): Promise<void> {
  await db.query(
    `
      update company_invitations
      set
        status = 'revoked',
        updated_at = $2
      where invitation_id = $1
    `,
    [input.invitationId, input.updatedAt],
  );
}
