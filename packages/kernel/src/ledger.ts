import type {
  AggregateType,
  Company,
  DomainEvent,
  DomainEventType,
} from '@escalonalabs/domain';

import { replay } from './core';

export interface CreateDomainEventInput<TPayload> {
  eventId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  companyId: string;
  eventType: DomainEventType;
  occurredAt: string;
  payload: TPayload;
  streamSequence: number;
  schemaVersion?: number;
  actorRef?: string;
  commandId?: string;
  correlationId?: string;
  causationId?: string;
  causationKey?: string;
}

export function createDomainEvent<TPayload>(
  input: CreateDomainEventInput<TPayload>,
): DomainEvent<TPayload> {
  return {
    eventId: input.eventId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    companyId: input.companyId,
    eventType: input.eventType,
    schemaVersion: input.schemaVersion ?? 1,
    streamSequence: input.streamSequence,
    occurredAt: input.occurredAt,
    payload: input.payload,
    actorRef: input.actorRef,
    commandId: input.commandId,
    correlationId: input.correlationId,
    causationId: input.causationId,
    causationKey: input.causationKey,
  };
}

export function nextStreamSequence(
  events: DomainEvent[],
  aggregateType: AggregateType,
  aggregateId: string,
): number {
  const lastSequence = events
    .filter(
      (event) =>
        event.aggregateType === aggregateType &&
        event.aggregateId === aggregateId &&
        typeof event.streamSequence === 'number',
    )
    .reduce(
      (maxSequence, event) => Math.max(maxSequence, event.streamSequence ?? 0),
      0,
    );

  return lastSequence + 1;
}

export function orderEventsForReplay(events: DomainEvent[]): DomainEvent[] {
  return [...events].sort((left, right) => {
    const leftSequence = left.streamSequence ?? 0;
    const rightSequence = right.streamSequence ?? 0;

    if (left.aggregateType === right.aggregateType) {
      if (left.aggregateId === right.aggregateId) {
        return leftSequence - rightSequence;
      }
    }

    return left.occurredAt.localeCompare(right.occurredAt);
  });
}

export function replayAggregate(
  events: DomainEvent[],
): ReturnType<typeof replay> {
  return replay(orderEventsForReplay(events));
}

export function createCompanyCreatedEvent(input: {
  company: Company;
  eventId: string;
  streamSequence: number;
  commandId: string;
  idempotencyKey: string;
  actorRef?: string;
  correlationId?: string;
}): DomainEvent<Company> {
  return createDomainEvent({
    eventId: input.eventId,
    aggregateType: 'company',
    aggregateId: input.company.companyId,
    companyId: input.company.companyId,
    eventType: 'company.created',
    occurredAt: input.company.createdAt,
    payload: input.company,
    streamSequence: input.streamSequence,
    commandId: input.commandId,
    actorRef: input.actorRef,
    correlationId: input.correlationId,
    causationKey: input.idempotencyKey,
    causationId: input.commandId,
  });
}
