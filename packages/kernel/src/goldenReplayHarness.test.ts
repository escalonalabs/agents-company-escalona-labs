import { describe, expect, it } from 'vitest';

import {
  executeGoldenFixture,
  loadGoldenFixtures,
} from './goldenReplayHarness';

describe('golden replay harness', () => {
  for (const fixture of loadGoldenFixtures()) {
    it(`replays ${fixture.trace_id} against the real kernel reducer`, () => {
      const execution = executeGoldenFixture(fixture);

      expect(execution.traceMarkers).toEqual(
        fixture.expected_events.map((event) => ({
          eventId: event.event_id,
          type: event.type,
          occurredAt: event.occurred_at,
        })),
      );
      expect(execution.replayedState).toEqual(
        execution.replayedStateFromReverseOrder,
      );

      for (const [field, expectedValue] of Object.entries(
        fixture.expected_terminal_aggregate_state,
      )) {
        expect(execution.terminalAggregateState[field]).toEqual(expectedValue);
      }

      for (const [field, expectedValue] of Object.entries(
        fixture.expected_projection_state,
      )) {
        expect(execution.projectionState[field]).toEqual(expectedValue);
      }

      for (const invariant of fixture.expected_invariants) {
        expect(execution.invariantResults[invariant]).toBe(true);
      }
    });
  }
});
