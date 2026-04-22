import { describe, expect, it } from 'vitest';

import type { Company, DomainEvent } from '@escalonalabs/domain';

import {
  createCompanyCreatedEvent,
  nextStreamSequence,
  replayAggregate,
} from './ledger';

const company: Company = {
  companyId: 'company_ledger',
  slug: 'escalona-labs',
  displayName: 'Escalona Labs',
  status: 'active',
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
});
