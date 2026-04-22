import { describe, expect, it } from 'vitest';

import type { DomainEvent, DriftAlert } from '@escalonalabs/domain';
import type { GitHubInboundEventRecord } from '@escalonalabs/github';

import { mergeTimelineEvents } from './timeline';

describe('operator timeline merging', () => {
  it('merges ledger, drift, and inbound GitHub events into severity-aware snapshots', () => {
    const ledgerEvent: DomainEvent = {
      eventId: 'evt_001',
      aggregateType: 'work_item',
      aggregateId: 'work_item_001',
      companyId: 'company_001',
      eventType: 'run.failed',
      occurredAt: '2026-04-22T10:10:00.000Z',
      payload: {},
    };
    const driftAlert: DriftAlert = {
      alertId: 'alert_001',
      companyId: 'company_001',
      aggregateType: 'work_item',
      aggregateId: 'work_item_001',
      severity: 'high',
      summary: 'Projection drift detected.',
      observedAt: '2026-04-22T10:11:00.000Z',
    };
    const inboundEvent: GitHubInboundEventRecord = {
      inboundEventId: 'inbound_001',
      githubDeliveryId: 'delivery_001',
      githubEventName: 'issue_comment',
      companyId: 'company_001',
      aggregateType: 'work_item',
      aggregateId: 'work_item_001',
      classification: 'accepted_intent',
      status: 'applied',
      payload: {},
      createdAt: '2026-04-22T10:12:00.000Z',
      notes: 'GitHub intent executed.',
    };

    const merged = mergeTimelineEvents({
      ledgerEvents: [ledgerEvent],
      driftAlerts: [driftAlert],
      inboundEvents: [inboundEvent],
      limit: 10,
    });

    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({
      eventId: 'inbound_001',
      source: 'github_inbound',
      summary: 'GitHub intent executed.',
    });
    expect(merged[1]).toMatchObject({
      eventId: 'alert_001',
      source: 'drift',
      severity: 'high',
    });
    expect(merged[2]).toMatchObject({
      eventId: 'evt_001',
      source: 'ledger',
      severity: 'high',
    });
  });

  it('treats company.updated as a warning-level rollout event', () => {
    const ledgerEvent: DomainEvent = {
      eventId: 'evt_company_beta',
      aggregateType: 'company',
      aggregateId: 'company_001',
      companyId: 'company_001',
      eventType: 'company.updated',
      occurredAt: '2026-04-22T12:00:00.000Z',
      payload: {},
    };

    const merged = mergeTimelineEvents({
      ledgerEvents: [ledgerEvent],
      limit: 10,
    });

    expect(merged[0]).toMatchObject({
      eventId: 'evt_company_beta',
      source: 'ledger',
      severity: 'warn',
      summary: 'Company rollout state or cohort enrollment changed.',
    });
  });
});
