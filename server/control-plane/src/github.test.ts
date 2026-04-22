import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '@escalonalabs/domain';

import { mapLatestEventIds } from './github';

describe('mapLatestEventIds', () => {
  it('selects the newest event per aggregate even when input order is descending', () => {
    const events: DomainEvent[] = [
      {
        eventId: 'evt_new',
        aggregateType: 'work_item',
        aggregateId: 'work_item_001',
        companyId: 'company_001',
        streamSequence: 3,
        eventType: 'work_item.updated',
        schemaVersion: 1,
        occurredAt: '2026-04-22T10:05:00.000Z',
        payload: {},
      },
      {
        eventId: 'evt_old',
        aggregateType: 'work_item',
        aggregateId: 'work_item_001',
        companyId: 'company_001',
        streamSequence: 1,
        eventType: 'work_item.created',
        schemaVersion: 1,
        occurredAt: '2026-04-22T10:00:00.000Z',
        payload: {},
      },
    ];

    expect(mapLatestEventIds(events)).toEqual({
      'work_item:work_item_001': 'evt_new',
    });
  });
});
