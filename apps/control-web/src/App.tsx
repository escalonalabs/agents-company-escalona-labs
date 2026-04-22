import { Card } from '@escalonalabs/ui';
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  getControlPlaneBaseUrl,
  useControlPlaneEndpoint,
} from './controlPlane';

type HealthResponse = {
  service?: string;
  status?: string;
  companiesLoaded?: number;
  counts?: {
    companies?: number;
    objectives?: number;
    workItems?: number;
    runs?: number;
    approvals?: number;
  };
};

type Company = {
  companyId: string;
  slug: string;
  displayName: string;
  status: string;
  createdAt: string;
};

type CompanyStatus = {
  company: Company;
  metrics?: {
    objectives?: number;
    workItems?: number;
    runs?: number;
    approvalsPending?: number;
    runningWorkItems?: number;
    blockedWorkItems?: number;
  };
};

type Objective = {
  objectiveId: string;
  title: string;
  summary?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type Approval = {
  approvalId: string;
  workItemId: string;
  status: string;
  requestedAction: string;
  decisionReason?: string;
  updatedAt: string;
};

const operatorViews = [
  {
    eyebrow: 'Company overview',
    heading: 'Objectives and drift',
    body: 'Track live metrics, pending approvals, and the health of the current company without leaving the control plane.',
  },
  {
    eyebrow: 'Objective workspace',
    heading: 'Focused operational state',
    body: 'Keep objective status, blockers, and execution posture close to the operator instead of buried in chat transcripts.',
  },
  {
    eyebrow: 'Run detail',
    heading: 'Fail-closed evidence',
    body: 'Expose only trustworthy status changes, with invalid outputs blocked before they can create noisy continuity.',
  },
] as const;

type PillTone = 'ok' | 'warn' | 'bad' | 'neutral';

function StatusPill({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

function formatTimestamp(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusTone(status?: string): PillTone {
  switch (status) {
    case 'ok':
    case 'active':
    case 'completed':
    case 'granted':
      return 'ok';
    case 'planned':
    case 'ready':
    case 'queued':
    case 'running':
    case 'in_progress':
    case 'pending':
      return 'warn';
    case 'blocked':
    case 'invalid_output':
    case 'permanent_failure':
    case 'cancelled':
    case 'denied':
    case 'disabled':
      return 'bad';
    default:
      return 'neutral';
  }
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="metric-card">
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      <span className="metric-card__hint">{hint}</span>
    </div>
  );
}

function SectionState({
  phase,
  loadingCopy,
  emptyCopy,
  errorMessage,
  hasData,
}: {
  phase: 'loading' | 'success' | 'error' | 'unavailable';
  loadingCopy: string;
  emptyCopy: string;
  errorMessage: string | null;
  hasData: boolean;
}) {
  if (phase === 'loading' && !hasData) {
    return <p className="muted">{loadingCopy}</p>;
  }

  if (phase === 'error') {
    return <p className="error">{errorMessage ?? 'Request failed.'}</p>;
  }

  if (phase === 'unavailable' || !hasData) {
    return <p className="muted">{emptyCopy}</p>;
  }

  return null;
}

export default function App() {
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  useEffect(() => {
    const id = window.setInterval(
      () => setRefreshSeed((seed) => seed + 1),
      15000,
    );

    return () => window.clearInterval(id);
  }, []);

  const baseUrl = useMemo(() => getControlPlaneBaseUrl(), []);
  const baseLabel =
    baseUrl.length > 0 ? baseUrl : `${window.location.origin} (same-origin)`;

  const health = useControlPlaneEndpoint<HealthResponse>('/health', {
    refreshSeed,
  });
  const companies = useControlPlaneEndpoint<Company[]>('/companies', {
    refreshSeed,
  });

  useEffect(() => {
    if (!companies.data || companies.data.length === 0) return;

    const selectedStillExists = companies.data.some(
      (company) => company.companyId === selectedCompanyId,
    );

    if (!selectedStillExists) {
      setSelectedCompanyId(companies.data[0]?.companyId ?? '');
    }
  }, [companies.data, selectedCompanyId]);

  const deferredCompanyId = useDeferredValue(selectedCompanyId);
  const companyStatusPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/status`
    : '/companies/__none__/status';
  const objectivesPath = deferredCompanyId
    ? `/objectives?companyId=${encodeURIComponent(deferredCompanyId)}`
    : '/objectives';
  const approvalsPath = deferredCompanyId
    ? `/approvals?companyId=${encodeURIComponent(deferredCompanyId)}`
    : '/approvals';

  const companyStatus = useControlPlaneEndpoint<CompanyStatus>(
    companyStatusPath,
    {
      refreshSeed,
      optional: true,
    },
  );
  const objectives = useControlPlaneEndpoint<Objective[]>(objectivesPath, {
    refreshSeed,
    optional: true,
  });
  const approvals = useControlPlaneEndpoint<Approval[]>(approvalsPath, {
    refreshSeed,
    optional: true,
  });

  const selectedCompany =
    companies.data?.find(
      (company) => company.companyId === deferredCompanyId,
    ) ?? null;

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="hero__kicker">Agents Company by Escalona Labs</p>
        <h1 className="hero__title">Control the company, not the chaos.</h1>
        <p className="hero__summary">
          A live operator surface for companies, objectives, approvals, and
          fail-closed execution status. It favors trustworthy continuity over
          narrative noise.
        </p>
      </section>

      <section className="toolbar" aria-label="Control-plane connection">
        <div className="toolbar__meta">
          <span className="muted">Control-plane:</span>{' '}
          <span className="mono">{baseLabel}</span>
          <span className="toolbar__dot" aria-hidden="true" />
          <span className="muted">Auto-refresh:</span> 15s
          {health.lastSuccessAt ? (
            <>
              <span className="toolbar__dot" aria-hidden="true" />
              <span className="muted">Last ok:</span>{' '}
              <span className="mono">
                {formatTimestamp(health.lastSuccessAt)}
              </span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="button"
          onClick={() => setRefreshSeed((seed) => seed + 1)}
        >
          Refresh now
        </button>
      </section>

      <section className="card-grid" aria-label="Operator starting points">
        {operatorViews.map((view) => (
          <Card
            key={view.heading}
            eyebrow={view.eyebrow}
            heading={view.heading}
          >
            <p>{view.body}</p>
          </Card>
        ))}
      </section>

      <section className="card-grid card-grid--two" aria-label="Live status">
        <Card eyebrow="Heartbeat" heading="Control-plane status">
          <div className="card-row">
            <StatusPill tone={statusTone(health.data?.status)}>
              {health.phase === 'loading'
                ? 'Checking'
                : health.phase === 'success'
                  ? (health.data?.status ?? 'Unknown')
                  : health.phase === 'unavailable'
                    ? 'Unavailable'
                    : 'Error'}
            </StatusPill>
            <span className="muted mono">{health.url}</span>
          </div>

          <SectionState
            phase={health.phase}
            loadingCopy="Checking /health..."
            emptyCopy="Health endpoint is not available."
            errorMessage={health.errorMessage}
            hasData={Boolean(health.data)}
          />

          {health.data?.counts ? (
            <div className="metric-grid">
              <MetricCard
                label="Companies"
                value={health.data.counts.companies ?? 0}
                hint="Registered companies"
              />
              <MetricCard
                label="Objectives"
                value={health.data.counts.objectives ?? 0}
                hint="Tracked objectives"
              />
              <MetricCard
                label="Runs"
                value={health.data.counts.runs ?? 0}
                hint="Execution records"
              />
            </div>
          ) : null}
        </Card>

        <Card eyebrow="Company focus" heading="Active company selection">
          <div className="card-row">
            <StatusPill tone={statusTone(selectedCompany?.status)}>
              {selectedCompany?.status ?? 'No company'}
            </StatusPill>
            <span className="muted mono">
              {selectedCompany?.slug ?? 'no-company-selected'}
            </span>
          </div>

          <SectionState
            phase={companies.phase}
            loadingCopy="Loading company inventory..."
            emptyCopy="No companies yet. Create one via POST /companies."
            errorMessage={companies.errorMessage}
            hasData={Boolean(companies.data?.length)}
          />

          {companies.data && companies.data.length > 0 ? (
            <div className="chip-row">
              {companies.data.map((company) => (
                <button
                  key={company.companyId}
                  type="button"
                  className={`company-chip ${
                    company.companyId === selectedCompany?.companyId
                      ? 'company-chip--active'
                      : ''
                  }`}
                  onClick={() => setSelectedCompanyId(company.companyId)}
                >
                  <span className="company-chip__name">
                    {company.displayName}
                  </span>
                  <span className="company-chip__meta mono">
                    {company.slug}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </Card>
      </section>

      <section
        className="card-grid card-grid--three"
        aria-label="Selected company metrics"
      >
        <Card eyebrow="Company metrics" heading="Operational counts">
          <SectionState
            phase={companyStatus.phase}
            loadingCopy="Loading company metrics..."
            emptyCopy="Select a company to load metrics."
            errorMessage={companyStatus.errorMessage}
            hasData={Boolean(companyStatus.data)}
          />

          {companyStatus.data?.metrics ? (
            <div className="metric-grid">
              <MetricCard
                label="Objectives"
                value={companyStatus.data.metrics.objectives ?? 0}
                hint="Within selected company"
              />
              <MetricCard
                label="Work items"
                value={companyStatus.data.metrics.workItems ?? 0}
                hint="Tracked execution units"
              />
              <MetricCard
                label="Pending approvals"
                value={companyStatus.data.metrics.approvalsPending ?? 0}
                hint="Waiting on operator action"
              />
              <MetricCard
                label="Running"
                value={companyStatus.data.metrics.runningWorkItems ?? 0}
                hint="Currently executing"
              />
              <MetricCard
                label="Blocked"
                value={companyStatus.data.metrics.blockedWorkItems ?? 0}
                hint="Needs intervention"
              />
              <MetricCard
                label="Runs"
                value={companyStatus.data.metrics.runs ?? 0}
                hint="Historical attempts"
              />
            </div>
          ) : null}
        </Card>

        <Card eyebrow="Objectives" heading="Selected company objectives">
          <SectionState
            phase={objectives.phase}
            loadingCopy="Loading objectives..."
            emptyCopy="No objectives loaded for this company."
            errorMessage={objectives.errorMessage}
            hasData={Boolean(objectives.data?.length)}
          />

          {objectives.data && objectives.data.length > 0 ? (
            <div className="stack-list">
              {objectives.data.map((objective) => (
                <article key={objective.objectiveId} className="stack-item">
                  <div className="stack-item__header">
                    <strong>{objective.title}</strong>
                    <StatusPill tone={statusTone(objective.status)}>
                      {objective.status}
                    </StatusPill>
                  </div>
                  <p className="muted">
                    {objective.summary ?? 'No summary captured yet.'}
                  </p>
                  <div className="stack-item__meta mono">
                    Updated {formatTimestamp(objective.updatedAt)}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </Card>

        <Card eyebrow="Approvals" heading="Operator approval inbox">
          <SectionState
            phase={approvals.phase}
            loadingCopy="Loading approvals..."
            emptyCopy="No approvals waiting for this company."
            errorMessage={approvals.errorMessage}
            hasData={Boolean(approvals.data?.length)}
          />

          {approvals.data && approvals.data.length > 0 ? (
            <div className="stack-list">
              {approvals.data.map((approval) => (
                <article key={approval.approvalId} className="stack-item">
                  <div className="stack-item__header">
                    <strong>{approval.requestedAction}</strong>
                    <StatusPill tone={statusTone(approval.status)}>
                      {approval.status}
                    </StatusPill>
                  </div>
                  <div className="stack-item__meta mono">
                    Work item {approval.workItemId}
                  </div>
                  <p className="muted">
                    {approval.decisionReason ??
                      'No decision reason recorded yet.'}
                  </p>
                  <div className="stack-item__meta mono">
                    Updated {formatTimestamp(approval.updatedAt)}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </Card>
      </section>

      <Card
        className="status-card"
        eyebrow="Current state"
        heading="Control plane reading live deterministic runtime state"
      >
        <p>
          The operator UI is now backed by real company metrics, objective
          listings, approval state, and health data coming from the control
          plane. It stays useful even when optional surfaces are unavailable.
        </p>
      </Card>
    </main>
  );
}
