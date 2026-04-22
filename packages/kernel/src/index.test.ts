import { describe, expect, it } from 'vitest';

import type {
  Company,
  DomainEvent,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';

import {
  applyEvent,
  createInitialState,
  hasNewCausalInput,
  replay,
} from './index';

const company: Company = {
  companyId: 'company_1',
  slug: 'escalona-labs',
  displayName: 'Escalona Labs',
  status: 'active',
  betaPhase: 'internal_alpha',
  betaEnrollmentStatus: 'active',
  betaUpdatedAt: '2026-04-22T00:00:00Z',
  createdAt: '2026-04-22T00:00:00Z',
};

const objective: Objective = {
  objectiveId: 'objective_1',
  companyId: company.companyId,
  title: 'Launch the runtime',
  status: 'planned',
  createdAt: '2026-04-22T00:00:01Z',
  updatedAt: '2026-04-22T00:00:01Z',
};

const workItem: WorkItem = {
  workItemId: 'work_item_1',
  companyId: company.companyId,
  objectiveId: objective.objectiveId,
  title: 'Build the kernel',
  status: 'ready',
  attemptBudget: 3,
  requiresApproval: false,
  validationContractRef: 'validation.contract.default.v1',
  scopeRef: 'scope:kernel',
  createdAt: '2026-04-22T00:00:02Z',
  updatedAt: '2026-04-22T00:00:02Z',
};

const run: Run = {
  runId: 'run_1',
  companyId: company.companyId,
  workItemId: workItem.workItemId,
  attempt: 1,
  status: 'valid_success',
  executionPacketId: 'packet_1',
  createdAt: '2026-04-22T00:00:03Z',
  updatedAt: '2026-04-22T00:00:03Z',
};

describe('kernel replay', () => {
  it('replays deterministic aggregate state from ordered events', () => {
    const events: DomainEvent[] = [
      {
        eventId: 'evt_1',
        aggregateType: 'company',
        aggregateId: company.companyId,
        companyId: company.companyId,
        eventType: 'company.created',
        occurredAt: company.createdAt,
        payload: company,
      },
      {
        eventId: 'evt_2',
        aggregateType: 'objective',
        aggregateId: objective.objectiveId,
        companyId: company.companyId,
        eventType: 'objective.created',
        occurredAt: objective.createdAt,
        payload: objective,
      },
      {
        eventId: 'evt_3',
        aggregateType: 'work_item',
        aggregateId: workItem.workItemId,
        companyId: company.companyId,
        eventType: 'work_item.created',
        occurredAt: '2026-04-22T00:00:02Z',
        payload: workItem,
      },
      {
        eventId: 'evt_4',
        aggregateType: 'run',
        aggregateId: run.runId,
        companyId: company.companyId,
        eventType: 'run.completed',
        occurredAt: '2026-04-22T00:00:03Z',
        payload: run,
      },
    ];

    const state = replay(events);

    expect(state.companies[company.companyId]).toEqual(company);
    expect(state.objectives[objective.objectiveId]).toEqual(objective);
    expect(state.workItems[workItem.workItemId]).toEqual(workItem);
    expect(state.runs[run.runId]).toEqual(run);
    expect(state.lastEventId).toBe('evt_4');
  });

  it('applies an event onto a fresh state incrementally', () => {
    const state = applyEvent(createInitialState(), {
      eventId: 'evt_company',
      aggregateType: 'company',
      aggregateId: company.companyId,
      companyId: company.companyId,
      eventType: 'company.created',
      occurredAt: company.createdAt,
      payload: company,
    });

    expect(state.companies[company.companyId]?.displayName).toBe(
      'Escalona Labs',
    );
  });

  it('replaces company snapshots when company.updated arrives', () => {
    const updatedCompany: Company = {
      ...company,
      betaPhase: 'controlled_beta',
      betaEnrollmentStatus: 'active',
      betaNotes: 'Approved for external beta.',
      betaUpdatedAt: '2026-04-22T01:00:00Z',
    };

    const state = replay([
      {
        eventId: 'evt_company_created',
        aggregateType: 'company',
        aggregateId: company.companyId,
        companyId: company.companyId,
        eventType: 'company.created',
        occurredAt: company.createdAt,
        payload: company,
      },
      {
        eventId: 'evt_company_updated',
        aggregateType: 'company',
        aggregateId: company.companyId,
        companyId: company.companyId,
        eventType: 'company.updated',
        occurredAt: updatedCompany.betaUpdatedAt ?? company.createdAt,
        payload: updatedCompany,
      },
    ]);

    expect(state.companies[company.companyId]).toEqual(updatedCompany);
    expect(state.lastEventId).toBe('evt_company_updated');
  });
});

describe('no-op loop suppression', () => {
  it('detects unchanged causal inputs and withholds redispatch', () => {
    expect(
      hasNewCausalInput(
        {
          workItemId: 'work_item_1',
          blockingReason: 'awaiting_approval',
          packetHash: 'packet_a',
          dependencyHash: 'deps_a',
          failureClass: null,
        },
        {
          workItemId: 'work_item_1',
          blockingReason: 'awaiting_approval',
          packetHash: 'packet_a',
          dependencyHash: 'deps_a',
          failureClass: null,
        },
      ),
    ).toBe(false);
  });

  it('allows redispatch when a causal input changes', () => {
    expect(
      hasNewCausalInput(
        {
          workItemId: 'work_item_1',
          blockingReason: 'awaiting_approval',
          packetHash: 'packet_a',
          dependencyHash: 'deps_a',
          failureClass: null,
        },
        {
          workItemId: 'work_item_1',
          blockingReason: null,
          packetHash: 'packet_a',
          dependencyHash: 'deps_a',
          failureClass: null,
        },
      ),
    ).toBe(true);
  });
});
