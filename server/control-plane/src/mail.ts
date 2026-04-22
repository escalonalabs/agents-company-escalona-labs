import { randomUUID } from 'node:crypto';

import nodemailer from 'nodemailer';

import type { Company, CompanyInvitation } from '@escalonalabs/domain';

import type { ControlPlaneConfig } from './config';
import type { Queryable } from './db/events';
import { type OutboundMailRecord, upsertOutboundMail } from './db/mail';

function buildInvitationSubject(company: Company) {
  return `Invitation to join ${company.displayName} on Agents Company`;
}

function buildInvitationText(input: {
  company: Company;
  invitation: CompanyInvitation;
  inviteUrl: string;
}) {
  return [
    `You have been invited to join ${input.company.displayName} on Agents Company by Escalona Labs.`,
    '',
    `Role: ${input.invitation.role}`,
    `Invitation ID: ${input.invitation.invitationId}`,
    `Expires At: ${input.invitation.expiresAt}`,
    '',
    'Accept the invitation using this link:',
    input.inviteUrl,
  ].join('\n');
}

export async function sendInvitationEmail(input: {
  db: Queryable;
  config: ControlPlaneConfig;
  company: Company;
  invitation: CompanyInvitation;
  inviteUrl: string;
}): Promise<OutboundMailRecord> {
  const provider = input.config.mail.smtpUrl ? 'smtp' : 'disabled';
  const now = new Date().toISOString();
  const subject = buildInvitationSubject(input.company);
  const baseRecord: OutboundMailRecord = {
    mailId: `mail_${randomUUID()}`,
    companyId: input.company.companyId,
    messageKind: 'company_invitation',
    recipient: input.invitation.email,
    subject,
    provider,
    status: input.config.mail.smtpUrl ? 'queued' : 'skipped',
    metadata: {
      invitationId: input.invitation.invitationId,
      companyId: input.company.companyId,
      companySlug: input.company.slug,
      inviteUrl: input.inviteUrl,
      role: input.invitation.role,
      expiresAt: input.invitation.expiresAt,
    },
    createdAt: now,
    updatedAt: now,
  };

  if (!input.config.mail.smtpUrl || !input.config.mail.from) {
    const skippedRecord: OutboundMailRecord = {
      ...baseRecord,
      status: 'skipped',
      lastError:
        'SMTP delivery is not configured. Invitation created with URL fallback only.',
    };
    await upsertOutboundMail(input.db, skippedRecord);
    return skippedRecord;
  }

  await upsertOutboundMail(input.db, baseRecord);

  const transporter = nodemailer.createTransport(input.config.mail.smtpUrl);

  try {
    const result = await transporter.sendMail({
      from: input.config.mail.from,
      to: input.invitation.email,
      subject,
      text: buildInvitationText(input),
    });

    const sentRecord: OutboundMailRecord = {
      ...baseRecord,
      status: 'sent',
      messageId: result.messageId,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await upsertOutboundMail(input.db, sentRecord);
    return sentRecord;
  } catch (error) {
    const failedRecord: OutboundMailRecord = {
      ...baseRecord,
      status: 'failed',
      lastError:
        error instanceof Error ? error.message : 'Unknown SMTP delivery error.',
      updatedAt: new Date().toISOString(),
    };
    await upsertOutboundMail(input.db, failedRecord);
    return failedRecord;
  }
}
