import { describe, expect, it } from 'vitest';

import type { Company, DomainEvent } from '@escalonalabs/domain';

import {
  createCompanyCreatedEvent,
  createCompanyEvent,
  nextStreamSequence,
  replayAggregate,
} from './ledger';

const company: Company = {
  companyId: 'company_ledger',
  slug: 'escalona-labs',
  displayName: 'Escalona Labs',
  status: 'active',
  betaPhase: 'internal_alpha',
  betaEnrollmentStatus: 'active',
  betaUpdatedAt: '2026-04-22T00:00:00Z',
  createdAt: '2026-04-22T00:00:00Z',
};

describe('kernel ledger helpers', () => {
  it('creates a canonical company.created event with deterministic metadata', () => {
    const event = createCompanyCreatedEvent({
      company,
      eventId: 'evt_company_001',
      streamSequence: 1,
      commandId: 'cmd_company_001',
      idempotencyKey: 'company:create:escalona-labs',
      actorRef: 'control-plane',
    });

    expect(event.schemaVersion).toBe(1);
    expect(event.aggregateType).toBe('company');
    expect(event.eventType).toBe('company.created');
    expect(event.streamSequence).toBe(1);
    expect(event.commandId).toBe('cmd_company_001');
    expect(event.causationKey).toBe('company:create:escalona-labs');
  });

  it('computes the next sequence inside one aggregate stream', () => {
    const events: DomainEvent[] = [
      createCompanyCreatedEvent({
        company,
        eventId: 'evt_company_001',
        streamSequence: 1,
        commandId: 'cmd_company_001',
        idempotencyKey: 'company:create:escalona-labs',
      }),
      {
        eventId: 'evt_company_002',
        aggregateType: 'company',
        aggregateId: company.companyId,
        companyId: company.companyId,
        eventType: 'company.created',
        occurredAt: '2026-04-22T00:00:01Z',
        payload: company,
        streamSequence: 2,
      },
    ];

    expect(nextStreamSequence(events, 'company', company.companyId)).toBe(3);
  });

  it('replays aggregate state from stored events', () => {
    const state = replayAggregate([
      createCompanyCreatedEvent({
        company,
        eventId: 'evt_company_001',
        streamSequence: 1,
        commandId: 'cmd_company_001',
        idempotencyKey: 'company:create:escalona-labs',
      }),
    ]);

    expect(state.companies[company.companyId]).toEqual(company);
  });

  it('creates company.updated snapshots with the latest beta timestamp', () => {
    const updatedCompany: Company = {
      ...company,
      betaPhase: 'controlled_beta',
      betaEnrollmentStatus: 'active',
      betaNotes: 'Allowlisted cohort enabled.',
      betaUpdatedAt: '2026-04-22T02:00:00Z',
    };

    const event = createCompanyEvent({
      company: updatedCompany,
      eventId: 'evt_company_003',
      eventType: 'company.updated',
      streamSequence: 2,
      commandId: 'cmd_company_003',
      idempotencyKey: 'company:update-beta:escalona-labs',
      actorRef: 'control-plane',
    });

    expect(event.eventType).toBe('company.updated');
    expect(event.occurredAt).toBe('2026-04-22T02:00:00Z');
    expect(event.payload).toEqual(updatedCompany);
  });
});
