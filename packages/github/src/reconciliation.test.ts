import { describe, expect, it } from 'vitest';

import { createMetadataBlock } from './metadata';
import { classifyGitHubInboundEvent } from './reconciliation';

const metadata = createMetadataBlock({
  projectionVersion: 'github.v1',
  companyId: 'company_001',
  aggregateType: 'work_item',
  aggregateId: 'work_item_001',
  sourceEventId: 'evt_001',
  projectionDeliveryId: 'projection_001',
});

describe('GitHub inbound reconciliation', () => {
  it('accepts slash commands on linked work-item issues', () => {
    const event = classifyGitHubInboundEvent({
      inboundEventId: 'inbound_001',
      githubDeliveryId: 'delivery_001',
      githubEventName: 'issue_comment',
      action: 'created',
      receivedAt: '2026-04-22T00:00:00.000Z',
      payload: {
        issue: {
          body: `## Work Item\n\n${metadata}`,
        },
        comment: {
          body: '/cancel',
        },
      },
    });

    expect(event.classification).toBe('accepted_intent');
    expect(event.proposedCommand).toMatchObject({
      commandType: 'work_item.cancel',
      aggregateType: 'work_item',
      aggregateId: 'work_item_001',
    });
  });

  it('flags protected issue mutations without linkage metadata', () => {
    const event = classifyGitHubInboundEvent({
      inboundEventId: 'inbound_002',
      githubDeliveryId: 'delivery_002',
      githubEventName: 'issues',
      action: 'closed',
      receivedAt: '2026-04-22T00:00:00.000Z',
      payload: {
        issue: {
          state: 'closed',
        },
      },
    });

    expect(event.classification).toBe('missing_linkage');
    expect(event.status).toBe('requires_review');
  });

  it('treats non-command linked activity as benign divergence', () => {
    const event = classifyGitHubInboundEvent({
      inboundEventId: 'inbound_003',
      githubDeliveryId: 'delivery_003',
      githubEventName: 'issue_comment',
      action: 'created',
      receivedAt: '2026-04-22T00:00:00.000Z',
      payload: {
        issue: {
          body: `## Work Item\n\n${metadata}`,
        },
        comment: {
          body: 'Please keep going.',
        },
      },
    });

    expect(event.classification).toBe('benign_divergence');
    expect(event.status).toBe('recorded');
  });

  it('does not accept operator label removal as a runtime command', () => {
    const event = classifyGitHubInboundEvent({
      inboundEventId: 'inbound_004',
      githubDeliveryId: 'delivery_004',
      githubEventName: 'issues',
      action: 'unlabeled',
      receivedAt: '2026-04-22T00:00:00.000Z',
      payload: {
        issue: {
          body: `## Work Item\n\n${metadata}`,
        },
        label: {
          name: 'operator:cancel',
        },
      },
    });

    expect(event.classification).not.toBe('accepted_intent');
  });

  it('does not map approval slash commands from work-item metadata', () => {
    const event = classifyGitHubInboundEvent({
      inboundEventId: 'inbound_005',
      githubDeliveryId: 'delivery_005',
      githubEventName: 'issue_comment',
      action: 'created',
      receivedAt: '2026-04-22T00:00:00.000Z',
      payload: {
        issue: {
          body: `## Work Item\n\n${metadata}`,
        },
        comment: {
          body: '/approve',
        },
      },
    });

    expect(event.classification).toBe('benign_divergence');
  });

  it('treats self-authored GitHub App issue mutations as benign audit events', () => {
    const appBot = {
      login: 'agents-company-by-escalona-labs[bot]',
      type: 'Bot',
      html_url: 'https://github.com/apps/agents-company-by-escalona-labs',
    };

    const event = classifyGitHubInboundEvent({
      inboundEventId: 'inbound_006',
      githubDeliveryId: 'delivery_006',
      githubEventName: 'issues',
      action: 'edited',
      receivedAt: '2026-04-22T00:00:00.000Z',
      payload: {
        issue: {
          state: 'closed',
          body: `## Work Item\n\n${metadata}`,
          user: appBot,
        },
        sender: appBot,
      },
    });

    expect(event.classification).toBe('benign_divergence');
    expect(event.status).toBe('recorded');
    expect(event.notes).toMatch(/Self-authored GitHub App projection update/i);
  });

  it('keeps human protected issue mutations fail-closed', () => {
    const event = classifyGitHubInboundEvent({
      inboundEventId: 'inbound_007',
      githubDeliveryId: 'delivery_007',
      githubEventName: 'issues',
      action: 'closed',
      receivedAt: '2026-04-22T00:00:00.000Z',
      payload: {
        issue: {
          state: 'closed',
          body: `## Work Item\n\n${metadata}`,
          user: {
            login: 'agents-company-by-escalona-labs[bot]',
            type: 'Bot',
            html_url: 'https://github.com/apps/agents-company-by-escalona-labs',
          },
        },
        sender: {
          login: 'escalona',
          type: 'User',
          html_url: 'https://github.com/escalona',
        },
      },
    });

    expect(event.classification).toBe('authoritative_conflict');
    expect(event.status).toBe('reproject_required');
  });
});
