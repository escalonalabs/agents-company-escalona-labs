import { describe, expect, it } from 'vitest';

import { loadControlPlaneConfig } from './config';

describe('control-plane config', () => {
  it('parses controlled beta company slug allowlists from env', () => {
    const config = loadControlPlaneConfig({
      AGENTS_COMPANY_CONTROLLED_BETA_COMPANY_SLUGS:
        'external-beta-a, external-beta-b , ,external-beta-c',
    });

    expect(config.controlledBetaCompanySlugs).toEqual([
      'external-beta-a',
      'external-beta-b',
      'external-beta-c',
    ]);
  });
});
