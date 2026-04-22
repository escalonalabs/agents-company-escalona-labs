import { describe, expect, it } from 'vitest';

import {
  loadControlPlaneMetricsSnapshot,
  renderControlPlanePrometheusMetrics,
} from './metrics';

describe('control-plane metrics', () => {
  it('loads snapshot counts and renders Prometheus output', async () => {
    const fakePool = {
      async query<T extends { count: string }>(statement: string) {
        const counts: Record<string, string> = {
          companies: '3',
          objectives: '5',
          work_items: '8',
          runs: '13',
          approvals: '2',
        };
        if (
          statement.includes(
            "coalesce(beta_phase, 'internal_alpha') = 'internal_alpha'",
          )
        ) {
          return {
            rows: [{ count: '2' } as T],
          };
        }
        if (
          statement.includes(
            "coalesce(beta_phase, 'internal_alpha') = 'controlled_beta'",
          )
        ) {
          return {
            rows: [{ count: '1' } as T],
          };
        }
        if (
          statement.includes(
            "coalesce(beta_enrollment_status, 'active') = 'active'",
          )
        ) {
          return {
            rows: [{ count: '3' } as T],
          };
        }
        const tableName = statement.split(' from ')[1]?.trim();

        return {
          rows: [{ count: counts[tableName ?? ''] ?? '0' } as T],
        };
      },
    };

    const snapshot = await loadControlPlaneMetricsSnapshot({
      pool: fakePool,
      sessionReady: true,
      internalApiReady: false,
      appOrigin: 'http://localhost:38080',
    });

    expect(snapshot).toMatchObject({
      auth: {
        sessionReady: true,
        internalApiReady: false,
      },
      counts: {
        companies: 3,
        internalAlphaCompanies: 2,
        controlledBetaCompanies: 1,
        betaActiveCompanies: 3,
        objectives: 5,
        workItems: 8,
        runs: 13,
        approvals: 2,
      },
      appOrigin: 'http://localhost:38080',
    });

    const rendered = renderControlPlanePrometheusMetrics(snapshot);
    expect(rendered).toContain('agents_company_control_plane_up 1');
    expect(rendered).toContain(
      'agents_company_control_plane_auth_session_ready 1',
    );
    expect(rendered).toContain(
      'agents_company_control_plane_auth_internal_api_ready 0',
    );
    expect(rendered).toContain('agents_company_control_plane_companies 3');
    expect(rendered).toContain(
      'agents_company_control_plane_companies_internal_alpha 2',
    );
    expect(rendered).toContain(
      'agents_company_control_plane_companies_controlled_beta 1',
    );
    expect(rendered).toContain(
      'agents_company_control_plane_companies_beta_active 3',
    );
    expect(rendered).toContain('agents_company_control_plane_work_items 8');
    expect(rendered).toContain('agents_company_control_plane_runs 13');
  });
});
