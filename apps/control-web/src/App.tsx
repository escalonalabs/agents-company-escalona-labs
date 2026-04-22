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
  postControlPlaneJson,
  useControlPlaneEndpoint,
  useControlPlaneEventStream,
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
  betaPhase?: 'internal_alpha' | 'controlled_beta';
  betaEnrollmentStatus?: 'invited' | 'active' | 'suspended' | 'graduated';
  betaNotes?: string;
  betaUpdatedAt?: string;
  createdAt: string;
};

type CompanyBetaSnapshot = {
  phase?: 'internal_alpha' | 'controlled_beta';
  enrollmentStatus?: 'invited' | 'active' | 'suspended' | 'graduated';
  notes?: string;
  updatedAt?: string;
  eligibleForControlledBeta?: boolean;
  allowlistConfigured?: boolean;
};

type CompanyRole = 'owner' | 'admin' | 'operator' | 'reviewer' | 'viewer';

type RepositoryTarget = {
  owner: string;
  name: string;
  id?: number;
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
  repositoryTarget?: RepositoryTarget;
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

type WorkItem = {
  workItemId: string;
  objectiveId: string;
  title: string;
  description?: string;
  repositoryTarget?: RepositoryTarget;
  status: string;
  attemptBudget: number;
  requiresApproval: boolean;
  validationContractRef: string;
  scopeRef: string;
  blockingReason?: string;
  latestRunId?: string;
  updatedAt: string;
};

type Run = {
  runId: string;
  workItemId: string;
  attempt: number;
  status: string;
  executionPacketId?: string;
  headSha?: string;
  summary?: string;
  failureClass?: string;
  createdAt: string;
  updatedAt: string;
};

type ExecutionPacket = {
  executionPacketId: string;
  assignedAgentId: string;
  objectiveContext: string;
  toolAllowlist: string[];
  scopeAllowlist: string[];
  inputArtifactRefs: string[];
  expectedResultSchemaRef: string;
  policySnapshotRef: string;
  createdAt: string;
};

type ObjectiveGraph = {
  objective: Objective;
  summary?: {
    workItemCount?: number;
    completedCount?: number;
    blockedCount?: number;
    pendingApprovalCount?: number;
    objectiveStatus?: string;
  };
  workItems: WorkItem[];
  approvals: Approval[];
};

type WorkItemDetail = {
  workItem: WorkItem;
  objective?: Objective | null;
  runs: Run[];
  approval?: Approval | null;
};

type RunDetail = {
  run: Run;
  executionPacket?: ExecutionPacket | null;
  workItem?: WorkItem | null;
};

type GitHubStatus = {
  projectionHealth?: {
    status?: string;
    lastSuccessfulSyncAt?: string;
    lastAttemptAt?: string;
    openDriftCount?: number;
    lastError?: string;
  };
  metrics?: {
    queuedDeliveries?: number;
    failedDeliveries?: number;
    openDriftCount?: number;
    inboundNeedsReview?: number;
  };
};

type GitHubDelivery = {
  projectionDeliveryId: string;
  aggregateType: string;
  aggregateId: string;
  githubObjectType: string;
  actionType: string;
  status: string;
  githubObjectRef?: string;
  lastError?: string;
  updatedAt: string;
};

type GitHubDriftAlert = {
  alertId: string;
  severity: string;
  summary: string;
  driftClass?: string;
  githubObjectRef?: string;
  observedAt?: string;
};

type OperatorSession = {
  authenticated?: boolean;
  bootstrapRequired?: boolean;
  loginUrl?: string;
  logoutUrl?: string;
  expiresAt?: string;
  session?: {
    expiresAt?: string;
  };
  operator?: {
    displayName?: string;
    name?: string;
    email?: string;
    role?: string;
  };
  user?: {
    name?: string;
    email?: string;
    role?: string;
  };
};

type GitHubInstallationRef = {
  companyId?: string;
  installationId: number;
  accountLogin: string;
  repository: {
    owner: string;
    name: string;
    id?: number;
  };
  createdAt: string;
  updatedAt: string;
};

type CompanyInstallations = {
  company?: Company;
  installations?: GitHubInstallationRef[];
};

type OnboardingChecklistItem = {
  id?: string;
  label: string;
  description?: string;
  completed?: boolean;
};

type CompanyOnboarding = {
  company?: Company;
  status?: string;
  installUrl?: string;
  beta?: CompanyBetaSnapshot;
  checklist?: OnboardingChecklistItem[];
  repository?: {
    owner?: string;
    name?: string;
  };
  linkedInstallations?: GitHubInstallationRef[];
};

type CompanyMembershipEntry = {
  companyId: string;
  userId: string;
  role: CompanyRole;
  email: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
};

type CompanyInvitationEntry = {
  invitationId: string;
  companyId: string;
  email: string;
  role: CompanyRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedByUserId?: string;
  invitedByEmail?: string;
  invitedByDisplayName?: string;
  acceptedByUserId?: string;
  acceptedByEmail?: string;
  acceptedByDisplayName?: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type CompanyAccessSnapshot = {
  company?: Company;
  currentRole?: CompanyRole | null;
  canManageInvitations?: boolean;
  allowedInvitationRoles?: CompanyRole[];
  memberships?: CompanyMembershipEntry[];
  invitations?: CompanyInvitationEntry[];
};

type InvitationPreview = {
  company?: Company;
  invitation?: CompanyInvitationEntry;
  canAccept?: boolean;
  message?: string;
};

type DomainEventRecord = {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  actorRef?: string;
  summary?: string;
  severity?: string;
};

type TimelineSnapshot = {
  sentAt?: string;
  events?: DomainEventRecord[];
};

type ApiEnvelope<TData, TKey extends string> = {
  [key in TKey]: TData;
};

type ActionState = {
  phase: 'idle' | 'running' | 'success' | 'error';
  message: string | null;
};

const operatorViews = [
  {
    eyebrow: 'Company overview',
    heading: 'Metrics and health',
    body: 'Track active companies, backlog pressure, projection health, and drift without leaving the operator surface.',
  },
  {
    eyebrow: 'Objective workspace',
    heading: 'Select, inspect, intervene',
    body: 'Move from company to objective to work item to run with bounded context instead of reading raw transcripts.',
  },
  {
    eyebrow: 'Runtime timeline',
    heading: 'Recent ledger movement',
    body: 'See the latest canonical events and intervene through approved operator actions when a flow needs help.',
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

function createRepositoryKey(
  repository?: RepositoryTarget | { owner: string; name: string },
) {
  if (!repository) {
    return '';
  }

  return `${repository.owner}/${repository.name}`;
}

function statusTone(status?: string): PillTone {
  switch (status) {
    case 'ok':
    case 'active':
    case 'completed':
    case 'granted':
    case 'healthy':
    case 'success':
      return 'ok';
    case 'planned':
    case 'ready':
    case 'queued':
    case 'running':
    case 'in_progress':
    case 'pending':
    case 'lagging':
    case 'controlled_beta':
    case 'invited':
    case 'warn':
      return 'warn';
    case 'blocked':
    case 'invalid_output':
    case 'permanent_failure':
    case 'cancelled':
    case 'denied':
    case 'disabled':
    case 'suspended':
    case 'drifted':
    case 'failed':
    case 'critical':
    case 'high':
      return 'bad';
    case 'graduated':
      return 'ok';
    case 'internal_alpha':
      return 'neutral';
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

function eventLabel(value: string) {
  return value.replace(/\./g, ' ');
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => Boolean(value && value.trim().length > 0));
}

function buildControlPlaneHref(baseUrl: string, value?: string) {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

function getOperatorName(session: OperatorSession | null) {
  return (
    firstNonEmpty(
      session?.operator?.displayName,
      session?.operator?.name,
      session?.user?.name,
      session?.operator?.email,
      session?.user?.email,
    ) ?? 'Authenticated operator'
  );
}

function getOperatorRole(session: OperatorSession | null) {
  return firstNonEmpty(session?.operator?.role, session?.user?.role);
}

function getSessionExpiry(session: OperatorSession | null) {
  return firstNonEmpty(session?.session?.expiresAt, session?.expiresAt);
}

export default function App() {
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [companySlug, setCompanySlug] = useState('');
  const [companyDisplayName, setCompanyDisplayName] = useState('');
  const [objectiveTitle, setObjectiveTitle] = useState('');
  const [objectiveSummary, setObjectiveSummary] = useState('');
  const [objectiveRepositoryKey, setObjectiveRepositoryKey] = useState('');
  const [installationIdInput, setInstallationIdInput] = useState('');
  const [installationAccountLogin, setInstallationAccountLogin] = useState('');
  const [repositoryOwner, setRepositoryOwner] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [betaPhase, setBetaPhase] = useState<
    'internal_alpha' | 'controlled_beta'
  >('internal_alpha');
  const [betaEnrollmentStatus, setBetaEnrollmentStatus] = useState<
    'invited' | 'active' | 'suspended' | 'graduated'
  >('active');
  const [betaNotes, setBetaNotes] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CompanyRole>('operator');
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [invitationPassword, setInvitationPassword] = useState('SmokePass!123');
  const [invitationDisplayName, setInvitationDisplayName] = useState('');
  const [inviteToken, setInviteToken] = useState(
    () => new URLSearchParams(window.location.search).get('invite') ?? '',
  );
  const [authEmail, setAuthEmail] = useState('smoke.operator@escalonalabs.dev');
  const [authPassword, setAuthPassword] = useState('SmokePass!123');
  const [authDisplayName, setAuthDisplayName] = useState('Primary Operator');
  const [actionState, setActionState] = useState<ActionState>({
    phase: 'idle',
    message: null,
  });

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
  const session = useControlPlaneEndpoint<OperatorSession>('/auth/session', {
    refreshSeed,
    optional: true,
  });
  const sessionEndpointEnabled = session.phase !== 'unavailable';
  const sessionRequiresLogin =
    session.statusCode === 401 || session.data?.authenticated === false;
  const sessionBootstrapRequired = session.data?.bootstrapRequired === true;
  const sessionGateState = !sessionEndpointEnabled
    ? 'disabled'
    : sessionRequiresLogin
      ? 'login'
      : session.phase === 'loading' && !session.data
        ? 'checking'
        : session.phase === 'error'
          ? 'error'
          : 'ready';
  const operatorDataEnabled =
    sessionGateState === 'disabled' || sessionGateState === 'ready';
  const operatorSession = session.data ?? null;
  const operatorName = getOperatorName(operatorSession);
  const operatorRole = getOperatorRole(operatorSession);
  const sessionExpiry = getSessionExpiry(operatorSession);

  const health = useControlPlaneEndpoint<HealthResponse>('/health', {
    refreshSeed,
    enabled: operatorDataEnabled,
  });
  const companies = useControlPlaneEndpoint<Company[]>('/companies', {
    refreshSeed,
    enabled: operatorDataEnabled,
  });

  useEffect(() => {
    const nextCompanies = companies.data ?? [];

    if (nextCompanies.length === 0) {
      setSelectedCompanyId('');
      return;
    }

    if (
      !selectedCompanyId ||
      !nextCompanies.some((company) => company.companyId === selectedCompanyId)
    ) {
      setSelectedCompanyId(nextCompanies[0]?.companyId ?? '');
    }
  }, [companies.data, selectedCompanyId]);

  const deferredCompanyId = useDeferredValue(selectedCompanyId);
  const selectedCompany =
    companies.data?.find(
      (company) => company.companyId === deferredCompanyId,
    ) ?? null;

  const companyStatusPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/status`
    : '/companies/__none__/status';
  const objectivesPath = deferredCompanyId
    ? `/objectives?companyId=${encodeURIComponent(deferredCompanyId)}`
    : '/objectives';
  const approvalsPath = deferredCompanyId
    ? `/approvals?companyId=${encodeURIComponent(deferredCompanyId)}`
    : '/approvals';
  const githubStatusPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/github/status`
    : '/companies/__none__/github/status';
  const companyAccessPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/access`
    : '/companies/__none__/access';
  const githubInstallationsPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/github/installations`
    : '/companies/__none__/github/installations';
  const githubDeliveriesPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/github/deliveries`
    : '/companies/__none__/github/deliveries';
  const driftAlertsPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/github/drift-alerts`
    : '/companies/__none__/github/drift-alerts';
  const onboardingPath = deferredCompanyId
    ? `/companies/${deferredCompanyId}/onboarding`
    : '/companies/__none__/onboarding';
  const timelinePath = deferredCompanyId
    ? `/events?companyId=${encodeURIComponent(deferredCompanyId)}&limit=24&order=desc`
    : '/events?limit=24&order=desc';
  const timelineStreamPath = deferredCompanyId
    ? `/events/stream?companyId=${encodeURIComponent(deferredCompanyId)}&limit=24&intervalMs=5000&order=desc`
    : '/events/stream?limit=24&intervalMs=5000&order=desc';
  const invitationPreviewPath = inviteToken
    ? `/company-invitations/${encodeURIComponent(inviteToken)}/preview`
    : '/company-invitations/__none__/preview';

  const companyStatus = useControlPlaneEndpoint<CompanyStatus>(
    companyStatusPath,
    {
      enabled: operatorDataEnabled,
      refreshSeed,
      optional: true,
    },
  );
  const objectives = useControlPlaneEndpoint<Objective[]>(objectivesPath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });
  const approvals = useControlPlaneEndpoint<Approval[]>(approvalsPath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });
  const githubStatus = useControlPlaneEndpoint<GitHubStatus>(githubStatusPath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });
  const companyAccess = useControlPlaneEndpoint<CompanyAccessSnapshot>(
    companyAccessPath,
    {
      enabled: operatorDataEnabled,
      refreshSeed,
      optional: true,
    },
  );
  const githubInstallations = useControlPlaneEndpoint<CompanyInstallations>(
    githubInstallationsPath,
    {
      enabled: operatorDataEnabled,
      refreshSeed,
      optional: true,
    },
  );
  const onboarding = useControlPlaneEndpoint<CompanyOnboarding>(
    onboardingPath,
    {
      enabled: operatorDataEnabled,
      refreshSeed,
      optional: true,
    },
  );
  const githubDeliveries = useControlPlaneEndpoint<
    ApiEnvelope<GitHubDelivery[], 'deliveries'>
  >(githubDeliveriesPath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });
  const driftAlerts = useControlPlaneEndpoint<
    ApiEnvelope<GitHubDriftAlert[], 'driftAlerts'>
  >(driftAlertsPath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });
  const timeline = useControlPlaneEndpoint<DomainEventRecord[]>(timelinePath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });
  const timelineStream = useControlPlaneEventStream<TimelineSnapshot>(
    timelineStreamPath,
    { enabled: operatorDataEnabled },
  );
  const invitationPreview = useControlPlaneEndpoint<InvitationPreview>(
    invitationPreviewPath,
    {
      enabled: inviteToken.trim().length > 0,
      refreshSeed,
    },
  );

  useEffect(() => {
    const nextObjectives = objectives.data ?? [];

    if (nextObjectives.length === 0) {
      setSelectedObjectiveId('');
      return;
    }

    if (
      !selectedObjectiveId ||
      !nextObjectives.some(
        (objective) => objective.objectiveId === selectedObjectiveId,
      )
    ) {
      setSelectedObjectiveId(nextObjectives[0]?.objectiveId ?? '');
    }
  }, [objectives.data, selectedObjectiveId]);

  const deferredObjectiveId = useDeferredValue(selectedObjectiveId);
  const objectiveGraphPath = deferredObjectiveId
    ? `/objectives/${deferredObjectiveId}/graph`
    : '/objectives/__none__/graph';
  const objectiveGraph = useControlPlaneEndpoint<ObjectiveGraph>(
    objectiveGraphPath,
    {
      enabled: operatorDataEnabled,
      refreshSeed,
      optional: true,
    },
  );

  useEffect(() => {
    const nextWorkItems = objectiveGraph.data?.workItems ?? [];

    if (nextWorkItems.length === 0) {
      setSelectedWorkItemId('');
      setSelectedRunId('');
      return;
    }

    if (
      !selectedWorkItemId ||
      !nextWorkItems.some(
        (workItem) => workItem.workItemId === selectedWorkItemId,
      )
    ) {
      setSelectedWorkItemId(nextWorkItems[0]?.workItemId ?? '');
    }
  }, [objectiveGraph.data, selectedWorkItemId]);

  const deferredWorkItemId = useDeferredValue(selectedWorkItemId);
  const workItemPath = deferredWorkItemId
    ? `/work-items/${deferredWorkItemId}`
    : '/work-items/__none__';
  const workItemDetail = useControlPlaneEndpoint<WorkItemDetail>(workItemPath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });

  useEffect(() => {
    const nextRuns = workItemDetail.data?.runs ?? [];

    if (nextRuns.length === 0) {
      setSelectedRunId('');
      return;
    }

    if (
      !selectedRunId ||
      !nextRuns.some((run) => run.runId === selectedRunId)
    ) {
      setSelectedRunId(nextRuns[nextRuns.length - 1]?.runId ?? '');
    }
  }, [selectedRunId, workItemDetail.data]);

  const deferredRunId = useDeferredValue(selectedRunId);
  const runPath = deferredRunId ? `/runs/${deferredRunId}` : '/runs/__none__';
  const runDetail = useControlPlaneEndpoint<RunDetail>(runPath, {
    enabled: operatorDataEnabled,
    refreshSeed,
    optional: true,
  });

  const selectedObjective =
    objectives.data?.find(
      (objective) => objective.objectiveId === deferredObjectiveId,
    ) ?? null;
  const selectedWorkItem =
    objectiveGraph.data?.workItems.find(
      (workItem) => workItem.workItemId === deferredWorkItemId,
    ) ??
    workItemDetail.data?.workItem ??
    null;
  const selectedApproval = workItemDetail.data?.approval ?? null;
  const timelineItems =
    timelineStream.data?.events && timelineStream.data.events.length > 0
      ? timelineStream.data.events
      : (timeline.data ?? []);
  const timelinePhase =
    timelineStream.data?.events && timelineStream.data.events.length > 0
      ? 'success'
      : timeline.phase;
  const linkedInstallations =
    onboarding.data?.linkedInstallations ??
    githubInstallations.data?.installations ??
    [];
  const companyMembers = companyAccess.data?.memberships ?? [];
  const companyInvitations = companyAccess.data?.invitations ?? [];
  const currentCompanyRole = companyAccess.data?.currentRole ?? null;
  const allowedInvitationRoles =
    companyAccess.data?.allowedInvitationRoles ?? [];
  const canManageInvitations =
    companyAccess.data?.canManageInvitations === true;
  const invitationPreviewData = inviteToken
    ? (invitationPreview.data ?? null)
    : null;
  const invitePreviewReady = Boolean(invitationPreviewData?.invitation);
  const inviteCanAccept = invitationPreviewData?.canAccept === true;
  const installHref = buildControlPlaneHref(
    baseUrl,
    onboarding.data?.installUrl,
  );
  const onboardingChecklist =
    onboarding.data?.checklist && onboarding.data.checklist.length > 0
      ? onboarding.data.checklist
      : [
          {
            id: 'session',
            label: 'Operator session',
            description: sessionEndpointEnabled
              ? 'Authenticate with the control plane before changing runtime state.'
              : 'Auth endpoints are not available in this environment yet.',
            completed:
              sessionGateState === 'disabled' || sessionGateState === 'ready',
          },
          {
            id: 'company',
            label: 'Company selected',
            description:
              'Choose the company that will own the first GitHub-connected workflow.',
            completed: Boolean(selectedCompany),
          },
          {
            id: 'install',
            label: 'GitHub App installation',
            description:
              'Install the GitHub App on the repository or organization you want the company to control.',
            completed: Boolean(linkedInstallations.length),
          },
          {
            id: 'projection',
            label: 'Projection health',
            description:
              'Confirm GitHub projection health is green before relying on mirrored state.',
            completed:
              githubStatus.data?.projectionHealth?.status === 'healthy',
          },
        ];
  const completedChecklistCount = onboardingChecklist.filter(
    (item) => item.completed,
  ).length;
  const onboardingTone =
    linkedInstallations.length > 0 &&
    githubStatus.data?.projectionHealth?.status === 'healthy'
      ? 'ok'
      : linkedInstallations.length > 0
        ? 'warn'
        : 'neutral';
  const companyBeta = onboarding.data?.beta ?? {
    phase: selectedCompany?.betaPhase ?? 'internal_alpha',
    enrollmentStatus: selectedCompany?.betaEnrollmentStatus ?? 'active',
    notes: selectedCompany?.betaNotes,
    updatedAt: selectedCompany?.betaUpdatedAt,
    eligibleForControlledBeta: true,
    allowlistConfigured: false,
  };
  const betaPhaseLabel = companyBeta.phase ?? 'internal_alpha';
  const betaEnrollmentLabel = companyBeta.enrollmentStatus ?? 'active';
  const betaEligibilityCopy = companyBeta.allowlistConfigured
    ? companyBeta.eligibleForControlledBeta
      ? 'Allowlisted for controlled beta.'
      : 'Not currently allowlisted for controlled beta in this environment.'
    : 'No allowlist configured yet; promotion is governed by operator action.';
  const accessTone =
    companyMembers.length > 0
      ? companyInvitations.some((invitation) => invitation.status === 'pending')
        ? 'warn'
        : 'ok'
      : 'neutral';

  useEffect(() => {
    if (linkedInstallations.length === 0) {
      setObjectiveRepositoryKey('');
      return;
    }

    if (linkedInstallations.length === 1) {
      setObjectiveRepositoryKey(
        createRepositoryKey(linkedInstallations[0]?.repository),
      );
      return;
    }

    if (
      objectiveRepositoryKey &&
      linkedInstallations.some(
        (installation) =>
          createRepositoryKey(installation.repository) ===
          objectiveRepositoryKey,
      )
    ) {
      return;
    }

    setObjectiveRepositoryKey('');
  }, [linkedInstallations, objectiveRepositoryKey]);

  useEffect(() => {
    setBetaPhase(
      (companyBeta.phase ?? 'internal_alpha') as
        | 'internal_alpha'
        | 'controlled_beta',
    );
    setBetaEnrollmentStatus(
      (companyBeta.enrollmentStatus ?? 'active') as
        | 'invited'
        | 'active'
        | 'suspended'
        | 'graduated',
    );
    setBetaNotes(companyBeta.notes ?? '');
  }, [companyBeta.enrollmentStatus, companyBeta.notes, companyBeta.phase]);

  useEffect(() => {
    if (
      allowedInvitationRoles.length > 0 &&
      !allowedInvitationRoles.includes(inviteRole)
    ) {
      setInviteRole(allowedInvitationRoles[0] ?? 'viewer');
    }
  }, [allowedInvitationRoles, inviteRole]);

  async function runOperatorAction(
    label: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    setActionState({
      phase: 'running',
      message: `${label} in progress...`,
    });

    const result = await postControlPlaneJson<{ message?: string }>(path, {
      body,
    });

    if (result.ok) {
      setActionState({
        phase: 'success',
        message: `${label} completed.`,
      });
      setRefreshSeed((seed) => seed + 1);
      return;
    }

    setActionState({
      phase: 'error',
      message: `${label} failed: ${result.message}`,
    });
  }

  function clearInviteTokenFromUrl() {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('invite');
    window.history.replaceState({}, '', nextUrl.toString());
    setInviteToken('');
  }

  async function submitAuth(mode: 'login' | 'bootstrap') {
    const email = authEmail.trim();
    const password = authPassword.trim();
    const displayName = authDisplayName.trim();

    if (!email || !password) {
      setActionState({
        phase: 'error',
        message: 'Email and password are required before continuing.',
      });
      return;
    }

    setActionState({
      phase: 'running',
      message:
        mode === 'bootstrap'
          ? 'Bootstrapping operator access...'
          : 'Signing in to control plane...',
    });

    const result = await postControlPlaneJson<OperatorSession>(
      mode === 'bootstrap' ? '/auth/bootstrap' : '/auth/login',
      {
        body: {
          email,
          password,
          displayName:
            mode === 'bootstrap' ? displayName || undefined : undefined,
        },
      },
    );

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `${mode === 'bootstrap' ? 'Bootstrap' : 'Login'} failed: ${result.message}`,
      });
      return;
    }

    setActionState({
      phase: 'success',
      message:
        mode === 'bootstrap'
          ? 'Operator bootstrap completed.'
          : 'Operator session established.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function logoutFromUi() {
    setActionState({
      phase: 'running',
      message: 'Signing out of control plane...',
    });

    const result = await postControlPlaneJson<OperatorSession>('/auth/logout', {
      body: {},
    });

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `Logout failed: ${result.message}`,
      });
      return;
    }

    setActionState({
      phase: 'success',
      message: 'Operator session cleared.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function createCompanyFromUi() {
    const slug = companySlug.trim();
    const displayName = companyDisplayName.trim();

    if (!slug || !displayName) {
      setActionState({
        phase: 'error',
        message: 'Company bootstrap needs both slug and display name.',
      });
      return;
    }

    setActionState({
      phase: 'running',
      message: 'Company bootstrap in progress...',
    });

    const result = await postControlPlaneJson<{
      company?: Company;
      duplicate?: boolean;
      message?: string;
    }>('/companies', {
      body: {
        slug,
        displayName,
      },
    });

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `Company bootstrap failed: ${result.message}`,
      });
      return;
    }

    if (!result.data?.company) {
      setActionState({
        phase: 'error',
        message:
          result.data?.message ??
          'Company bootstrap returned no company record.',
      });
      return;
    }

    setSelectedCompanyId(result.data.company.companyId);
    setCompanySlug('');
    setCompanyDisplayName('');
    setActionState({
      phase: 'success',
      message: result.data.duplicate
        ? 'Company already existed and was selected.'
        : 'Company created from control web.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function updateCompanyBetaEnrollmentFromUi() {
    if (!selectedCompany) {
      setActionState({
        phase: 'error',
        message: 'Select a company before updating rollout state.',
      });
      return;
    }

    if (
      betaPhase === 'internal_alpha' &&
      betaEnrollmentStatus === 'graduated'
    ) {
      setActionState({
        phase: 'error',
        message:
          'Graduated is only valid after a company has been promoted into controlled beta.',
      });
      return;
    }

    const result = await postControlPlaneJson<{
      company?: Company;
      message?: string;
      duplicate?: boolean;
    }>(`/companies/${selectedCompany.companyId}/beta-enrollment`, {
      body: {
        phase: betaPhase,
        enrollmentStatus: betaEnrollmentStatus,
        notes: betaNotes.trim() || undefined,
      },
    });

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `Beta enrollment update failed: ${result.message}`,
      });
      return;
    }

    setActionState({
      phase: 'success',
      message: result.data?.duplicate
        ? 'Beta enrollment was already in that state.'
        : 'Beta enrollment updated.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function createInvitationFromUi() {
    if (!selectedCompany) {
      setActionState({
        phase: 'error',
        message: 'Select a company before inviting a member.',
      });
      return;
    }

    const email = inviteEmail.trim().toLowerCase();

    if (!email) {
      setActionState({
        phase: 'error',
        message: 'Invitation email is required.',
      });
      return;
    }

    setActionState({
      phase: 'running',
      message: 'Creating company invitation...',
    });

    const result = await postControlPlaneJson<{
      invitation?: CompanyInvitationEntry;
      inviteUrl?: string;
      mailDelivery?: {
        status?: 'queued' | 'sent' | 'failed' | 'skipped';
        lastError?: string;
      };
      message?: string;
    }>(`/companies/${selectedCompany.companyId}/invitations`, {
      body: {
        email,
        role: inviteRole,
      },
    });

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `Invitation failed: ${result.message}`,
      });
      return;
    }

    setInviteEmail('');
    setLatestInviteUrl(result.data?.inviteUrl ?? null);
    const deliveryStatus = result.data?.mailDelivery?.status;
    setActionState({
      phase: 'success',
      message:
        deliveryStatus === 'sent'
          ? 'Company invitation created and emailed.'
          : deliveryStatus === 'failed'
            ? `Company invitation created, but email delivery failed: ${result.data?.mailDelivery?.lastError ?? 'unknown error'}.`
            : deliveryStatus === 'skipped'
              ? 'Company invitation created with URL fallback only.'
              : 'Company invitation created.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function revokeInvitationFromUi(invitationId: string) {
    if (!selectedCompany) {
      setActionState({
        phase: 'error',
        message: 'Select a company before revoking an invitation.',
      });
      return;
    }

    setActionState({
      phase: 'running',
      message: 'Revoking company invitation...',
    });

    const result = await postControlPlaneJson<{
      invitation?: CompanyInvitationEntry;
      message?: string;
    }>(
      `/companies/${selectedCompany.companyId}/invitations/${invitationId}/revoke`,
      {
        body: {},
      },
    );

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `Invitation revoke failed: ${result.message}`,
      });
      return;
    }

    setActionState({
      phase: 'success',
      message: 'Company invitation revoked.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function acceptInvitationFromUi() {
    const trimmedToken = inviteToken.trim();

    if (!trimmedToken) {
      setActionState({
        phase: 'error',
        message: 'Invitation token is missing from the current URL.',
      });
      return;
    }

    setActionState({
      phase: 'running',
      message: 'Accepting company invitation...',
    });

    const body: Record<string, unknown> = {
      invitationToken: trimmedToken,
    };

    if (sessionGateState !== 'ready') {
      const password = invitationPassword.trim();
      if (!password) {
        setActionState({
          phase: 'error',
          message: 'Invitation acceptance needs a password.',
        });
        return;
      }

      body.password = password;

      const displayName = invitationDisplayName.trim();
      if (displayName) {
        body.displayName = displayName;
      }
    }

    const result = await postControlPlaneJson<{
      company?: Company;
      message?: string;
    }>('/company-invitations/accept', {
      body,
    });

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `Invitation acceptance failed: ${result.message}`,
      });
      return;
    }

    if (result.data?.company?.companyId) {
      setSelectedCompanyId(result.data.company.companyId);
    }

    clearInviteTokenFromUrl();
    setInvitationPassword('');
    setInvitationDisplayName('');
    setActionState({
      phase: 'success',
      message: 'Company invitation accepted.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function createObjectiveFromUi() {
    if (!selectedCompany) {
      setActionState({
        phase: 'error',
        message: 'Select a company before creating an objective.',
      });
      return;
    }

    const title = objectiveTitle.trim();
    const summary = objectiveSummary.trim();

    if (!title) {
      setActionState({
        phase: 'error',
        message: 'Objective creation needs a title.',
      });
      return;
    }

    const selectedRepository =
      linkedInstallations.find(
        (installation) =>
          createRepositoryKey(installation.repository) ===
          objectiveRepositoryKey,
      )?.repository ??
      (linkedInstallations.length === 1
        ? linkedInstallations[0]?.repository
        : undefined);

    if (linkedInstallations.length > 1 && !selectedRepository) {
      setActionState({
        phase: 'error',
        message:
          'Select the target repository before creating an objective for a multi-repo company.',
      });
      return;
    }

    setActionState({
      phase: 'running',
      message: 'Objective intake in progress...',
    });

    const result = await postControlPlaneJson<{
      objective?: Objective;
      duplicate?: boolean;
      message?: string;
    }>('/objectives', {
      body: {
        companyId: selectedCompany.companyId,
        title,
        summary: summary || undefined,
        repositoryTarget: selectedRepository,
      },
    });

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `Objective intake failed: ${result.message}`,
      });
      return;
    }

    if (!result.data?.objective) {
      setActionState({
        phase: 'error',
        message:
          result.data?.message ??
          'Objective intake returned no objective record.',
      });
      return;
    }

    setSelectedObjectiveId(result.data.objective.objectiveId);
    setObjectiveTitle('');
    setObjectiveSummary('');
    setObjectiveRepositoryKey(
      selectedRepository ? createRepositoryKey(selectedRepository) : '',
    );
    setActionState({
      phase: 'success',
      message: result.data.duplicate
        ? 'Objective already existed and was selected.'
        : 'Objective created from control web.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  async function linkGitHubInstallationFromUi() {
    if (!selectedCompany) {
      setActionState({
        phase: 'error',
        message: 'Select a company before linking a GitHub installation.',
      });
      return;
    }

    const installationId = Number(installationIdInput.trim());
    const accountLogin = installationAccountLogin.trim();
    const owner = repositoryOwner.trim();
    const name = repositoryName.trim();

    if (!Number.isFinite(installationId) || installationId <= 0) {
      setActionState({
        phase: 'error',
        message: 'GitHub installation linking needs a valid installation id.',
      });
      return;
    }

    if (!accountLogin || !owner || !name) {
      setActionState({
        phase: 'error',
        message:
          'GitHub installation linking needs account login, repository owner, and repository name.',
      });
      return;
    }

    setActionState({
      phase: 'running',
      message: 'GitHub installation link in progress...',
    });

    const result = await postControlPlaneJson<GitHubInstallationRef>(
      `/companies/${selectedCompany.companyId}/github/installations`,
      {
        body: {
          installationId,
          accountLogin,
          repository: {
            owner,
            name,
          },
        },
      },
    );

    if (!result.ok) {
      setActionState({
        phase: 'error',
        message: `GitHub installation link failed: ${result.message}`,
      });
      return;
    }

    setInstallationIdInput('');
    setInstallationAccountLogin('');
    setRepositoryOwner('');
    setRepositoryName('');
    setActionState({
      phase: 'success',
      message: 'GitHub installation linked to the selected company.',
    });
    setRefreshSeed((seed) => seed + 1);
  }

  const canCancelWorkItem = Boolean(
    selectedWorkItem &&
      !['completed', 'cancelled'].includes(selectedWorkItem.status),
  );
  const canRequeueWorkItem = Boolean(
    selectedWorkItem &&
      ['blocked', 'escalated', 'cancelled'].includes(selectedWorkItem.status),
  );
  const canGrantApproval = selectedApproval?.status === 'pending';
  const canDenyApproval = selectedApproval?.status === 'pending';

  if (sessionGateState === 'checking') {
    return (
      <main className="app-shell app-shell--gate">
        <section className="hero">
          <p className="hero__kicker">Agents Company by Escalona Labs</p>
          <h1 className="hero__title">Control the company, not the chaos.</h1>
          <p className="hero__summary">
            Validating the operator session before loading runtime state,
            approvals, and company controls.
          </p>
        </section>

        <Card eyebrow="Access gate" heading="Checking control-plane session">
          <p>
            The control web is waiting for the backend session cookie to be
            confirmed before it requests operator data.
          </p>
          <p className="muted mono">{session.url}</p>
        </Card>
      </main>
    );
  }

  if (sessionGateState === 'login') {
    return (
      <main className="app-shell app-shell--gate">
        <section className="hero">
          <p className="hero__kicker">Agents Company by Escalona Labs</p>
          <h1 className="hero__title">Operator access required.</h1>
          <p className="hero__summary">
            {sessionBootstrapRequired
              ? 'Bootstrap the first operator before the control web can load company state.'
              : 'Sign in before you can inspect approvals, execute control actions, or bootstrap a company from the control web.'}
          </p>
        </section>

        <section className="card-grid card-grid--two" aria-label="Login gate">
          <Card
            eyebrow="Access gate"
            heading={
              inviteToken && !sessionBootstrapRequired
                ? 'Accept company invitation'
                : sessionBootstrapRequired
                  ? 'Bootstrap the first operator'
                  : 'Session login'
            }
          >
            {inviteToken && !sessionBootstrapRequired ? (
              <>
                <SectionState
                  phase={invitationPreview.phase}
                  loadingCopy="Loading invitation preview..."
                  emptyCopy="Invitation preview is waiting for a valid token."
                  errorMessage={invitationPreview.errorMessage}
                  hasData={invitePreviewReady}
                />

                {invitePreviewReady ? (
                  <>
                    <div className="detail-list">
                      <span>
                        Company {invitationPreviewData?.company?.displayName}
                      </span>
                      <span>
                        Email {invitationPreviewData?.invitation?.email}
                      </span>
                      <span>
                        Role {invitationPreviewData?.invitation?.role}
                      </span>
                      <span>
                        Expires{' '}
                        {formatTimestamp(
                          invitationPreviewData?.invitation?.expiresAt,
                        )}
                      </span>
                    </div>

                    {inviteCanAccept ? (
                      <>
                        <label className="field">
                          <span className="field__label">
                            Display name for the new member
                          </span>
                          <input
                            className="field__input"
                            value={invitationDisplayName}
                            onChange={(event) =>
                              setInvitationDisplayName(event.target.value)
                            }
                            placeholder="Invited operator"
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">Password</span>
                          <input
                            className="field__input"
                            type="password"
                            value={invitationPassword}
                            onChange={(event) =>
                              setInvitationPassword(event.target.value)
                            }
                            placeholder="Create or confirm your password"
                          />
                        </label>
                        <div className="inline-actions inline-actions--top">
                          <button
                            type="button"
                            className="button"
                            onClick={() => void acceptInvitationFromUi()}
                          >
                            Accept invitation
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => clearInviteTokenFromUrl()}
                          >
                            Clear invite token
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="inline-actions inline-actions--top">
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => clearInviteTokenFromUrl()}
                        >
                          Remove invalid invite token
                        </button>
                      </div>
                    )}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p>
                  {sessionBootstrapRequired
                    ? 'The control plane reported that no operator exists yet. Create the first authenticated operator now.'
                    : 'The backend exposed an auth/session gate, so the UI is holding runtime fetches until the operator is authenticated.'}
                </p>
                <label className="field">
                  <span className="field__label">Operator email</span>
                  <input
                    className="field__input"
                    type="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder="operator@escalonalabs.dev"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Password</span>
                  <input
                    className="field__input"
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    placeholder="Enter operator password"
                  />
                </label>
              </>
            )}
            {sessionBootstrapRequired && !inviteToken ? (
              <label className="field">
                <span className="field__label">Display name</span>
                <input
                  className="field__input"
                  value={authDisplayName}
                  onChange={(event) => setAuthDisplayName(event.target.value)}
                  placeholder="Primary Operator"
                />
              </label>
            ) : null}
            {(!inviteToken || sessionBootstrapRequired) && (
              <div className="inline-actions inline-actions--top">
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    submitAuth(sessionBootstrapRequired ? 'bootstrap' : 'login')
                  }
                >
                  {sessionBootstrapRequired ? 'Bootstrap operator' : 'Sign in'}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setRefreshSeed((seed) => seed + 1)}
                >
                  Check session again
                </button>
              </div>
            )}
          </Card>

          <Card
            eyebrow="First run"
            heading={
              inviteToken && !sessionBootstrapRequired
                ? 'Invitation onboarding'
                : sessionBootstrapRequired
                  ? 'What happens after bootstrap'
                  : 'Bootstrap path after login'
            }
          >
            <div className="checklist">
              <article className="checklist-item">
                <strong>1. Authenticate the operator</strong>
                <p className="muted">
                  {inviteToken && !sessionBootstrapRequired
                    ? 'The invitation flow can create the user session and the company membership in one bounded action.'
                    : 'The shell now expects a session cookie for every fetch and operator action.'}
                </p>
              </article>
              <article className="checklist-item">
                <strong>2. Create or select the company</strong>
                <p className="muted">
                  {inviteToken && !sessionBootstrapRequired
                    ? 'Once the invitation is accepted, the invited company will become visible in the operator shell.'
                    : 'Company bootstrap remains inside the web UI once access is granted.'}
                </p>
              </article>
              <article className="checklist-item">
                <strong>3. Install and link GitHub</strong>
                <p className="muted">
                  The onboarding section will walk the operator through GitHub
                  installation linking and projection health.
                </p>
              </article>
            </div>
          </Card>
        </section>
      </main>
    );
  }

  if (sessionGateState === 'error') {
    return (
      <main className="app-shell app-shell--gate">
        <section className="hero">
          <p className="hero__kicker">Agents Company by Escalona Labs</p>
          <h1 className="hero__title">Session check failed.</h1>
          <p className="hero__summary">
            The control web could not verify the operator session, so it is not
            safe to load mutable operator state yet.
          </p>
        </section>

        <Card eyebrow="Access gate" heading="Auth endpoint error">
          <p className="error">
            {session.errorMessage ?? 'Unable to verify the operator session.'}
          </p>
          <div className="inline-actions inline-actions--top">
            <button
              type="button"
              className="button"
              onClick={() => setRefreshSeed((seed) => seed + 1)}
            >
              Retry session check
            </button>
          </div>
          <p className="muted mono">{session.url}</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="hero__kicker">Agents Company by Escalona Labs</p>
        <h1 className="hero__title">Control the company, not the chaos.</h1>
        <p className="hero__summary">
          A live operator surface for companies, objectives, approvals, runs,
          GitHub drift, and deterministic runtime activity. It favors
          trustworthy continuity over narrative noise.
        </p>
      </section>

      <section className="toolbar" aria-label="Control-plane connection">
        <div className="toolbar__meta">
          <span className="muted">Control-plane:</span>{' '}
          <span className="mono">{baseLabel}</span>
          <span className="toolbar__dot" aria-hidden="true" />
          <span className="muted">Access:</span>{' '}
          <StatusPill tone={sessionGateState === 'disabled' ? 'neutral' : 'ok'}>
            {sessionGateState === 'disabled' ? 'Direct mode' : 'Session active'}
          </StatusPill>
          <span className="toolbar__dot" aria-hidden="true" />
          <span className="muted">Operator:</span>{' '}
          <span className="mono">{operatorName}</span>
          {operatorRole ? (
            <>
              <span className="toolbar__dot" aria-hidden="true" />
              <span className="muted">Role:</span>{' '}
              <span className="mono">{operatorRole}</span>
            </>
          ) : null}
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
          {sessionExpiry ? (
            <>
              <span className="toolbar__dot" aria-hidden="true" />
              <span className="muted">Session:</span>{' '}
              <span className="mono">
                Expires {formatTimestamp(sessionExpiry)}
              </span>
            </>
          ) : null}
        </div>
        <div className="toolbar__actions">
          {actionState.message ? (
            <StatusPill
              tone={
                actionState.phase === 'error'
                  ? 'bad'
                  : actionState.phase === 'success'
                    ? 'ok'
                    : 'warn'
              }
            >
              {actionState.message}
            </StatusPill>
          ) : null}
          {sessionEndpointEnabled ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void logoutFromUi()}
            >
              Sign out
            </button>
          ) : null}
          <button
            type="button"
            className="button"
            onClick={() => setRefreshSeed((seed) => seed + 1)}
          >
            Refresh now
          </button>
        </div>
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
            {selectedCompany ? (
              <StatusPill tone={statusTone(selectedCompany.betaPhase)}>
                {selectedCompany.betaPhase ?? 'internal_alpha'}
              </StatusPill>
            ) : null}
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
                    {company.slug} · {company.betaPhase ?? 'internal_alpha'}
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

        <Card eyebrow="Beta program" heading="Controlled rollout state">
          <div className="card-row">
            <StatusPill tone={statusTone(betaPhaseLabel)}>
              {betaPhaseLabel}
            </StatusPill>
            <StatusPill tone={statusTone(betaEnrollmentLabel)}>
              {betaEnrollmentLabel}
            </StatusPill>
            <span className="muted mono">
              {selectedCompany?.slug ?? 'select-company-first'}
            </span>
          </div>

          <SectionState
            phase={selectedCompany ? onboarding.phase : 'unavailable'}
            loadingCopy="Loading rollout state..."
            emptyCopy="Select a company to manage rollout state."
            errorMessage={onboarding.errorMessage}
            hasData={Boolean(selectedCompany)}
          />

          {selectedCompany ? (
            <>
              <div className="detail-list">
                <span>{betaEligibilityCopy}</span>
                <span>Updated {formatTimestamp(companyBeta.updatedAt)}</span>
              </div>

              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void updateCompanyBetaEnrollmentFromUi();
                }}
              >
                <label className="field">
                  <span className="field__label">Rollout phase</span>
                  <select
                    value={betaPhase}
                    onChange={(event) =>
                      setBetaPhase(
                        event.target.value as
                          | 'internal_alpha'
                          | 'controlled_beta',
                      )
                    }
                  >
                    <option value="internal_alpha">internal_alpha</option>
                    <option value="controlled_beta">controlled_beta</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Enrollment status</span>
                  <select
                    value={betaEnrollmentStatus}
                    onChange={(event) =>
                      setBetaEnrollmentStatus(
                        event.target.value as
                          | 'invited'
                          | 'active'
                          | 'suspended'
                          | 'graduated',
                      )
                    }
                  >
                    <option value="invited">invited</option>
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                    <option value="graduated">graduated</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Operator notes</span>
                  <textarea
                    rows={4}
                    value={betaNotes}
                    onChange={(event) => setBetaNotes(event.target.value)}
                    placeholder="Why this company is in the current rollout cohort."
                  />
                </label>
                <div className="inline-actions">
                  <button
                    type="submit"
                    className="button"
                    disabled={
                      !selectedCompany || actionState.phase === 'running'
                    }
                  >
                    Update rollout state
                  </button>
                </div>
              </form>
            </>
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

        <Card eyebrow="GitHub mirror" heading="Projection health and drift">
          <SectionState
            phase={githubStatus.phase}
            loadingCopy="Loading GitHub projection health..."
            emptyCopy="GitHub projection status is not available for this company."
            errorMessage={githubStatus.errorMessage}
            hasData={Boolean(githubStatus.data)}
          />

          {githubStatus.data ? (
            <>
              <div className="card-row">
                <StatusPill
                  tone={statusTone(githubStatus.data.projectionHealth?.status)}
                >
                  {githubStatus.data.projectionHealth?.status ?? 'unknown'}
                </StatusPill>
                <span className="muted mono">
                  Last sync{' '}
                  {formatTimestamp(
                    githubStatus.data.projectionHealth?.lastSuccessfulSyncAt,
                  )}
                </span>
              </div>
              <div className="metric-grid">
                <MetricCard
                  label="Queued"
                  value={githubStatus.data.metrics?.queuedDeliveries ?? 0}
                  hint="Pending GitHub deliveries"
                />
                <MetricCard
                  label="Failed"
                  value={githubStatus.data.metrics?.failedDeliveries ?? 0}
                  hint="Needs operator review"
                />
                <MetricCard
                  label="Open drift"
                  value={githubStatus.data.metrics?.openDriftCount ?? 0}
                  hint="Projection mismatches"
                />
                <MetricCard
                  label="Inbound review"
                  value={githubStatus.data.metrics?.inboundNeedsReview ?? 0}
                  hint="Webhook decisions waiting"
                />
              </div>
            </>
          ) : null}
        </Card>
      </section>

      <section className="card-grid card-grid--two" aria-label="Company access">
        <Card eyebrow="Team access" heading="Members and invitations">
          <div className="card-row">
            <StatusPill tone={accessTone}>
              {companyMembers.length} members
            </StatusPill>
            <span className="muted mono">
              {currentCompanyRole
                ? `You are ${currentCompanyRole}`
                : 'Select a company first'}
            </span>
          </div>

          <SectionState
            phase={selectedCompany ? companyAccess.phase : 'unavailable'}
            loadingCopy="Loading company access..."
            emptyCopy="Select a company to inspect members and invitations."
            errorMessage={companyAccess.errorMessage}
            hasData={Boolean(selectedCompany)}
          />

          {selectedCompany ? (
            <>
              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createInvitationFromUi();
                }}
              >
                <label className="field">
                  <span className="field__label">Invite email</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="new.operator@company.dev"
                    disabled={!canManageInvitations}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Role</span>
                  <select
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(event.target.value as CompanyRole)
                    }
                    disabled={!canManageInvitations}
                  >
                    {allowedInvitationRoles.length > 0 ? (
                      allowedInvitationRoles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))
                    ) : (
                      <option value={inviteRole}>{inviteRole}</option>
                    )}
                  </select>
                </label>
                <div className="inline-actions">
                  <button
                    type="submit"
                    className="button"
                    disabled={!selectedCompany || !canManageInvitations}
                  >
                    Create invite
                  </button>
                </div>
              </form>

              {latestInviteUrl ? (
                <div className="detail-list">
                  <strong>Latest invitation link</strong>
                  <span className="mono">{latestInviteUrl}</span>
                </div>
              ) : null}

              {companyMembers.length > 0 ? (
                <div className="stack-list">
                  {companyMembers.map((member) => (
                    <article
                      key={`${member.companyId}-${member.userId}`}
                      className="stack-item"
                    >
                      <div className="stack-item__header">
                        <strong>{member.displayName ?? member.email}</strong>
                        <StatusPill tone={statusTone(member.role)}>
                          {member.role}
                        </StatusPill>
                      </div>
                      <div className="stack-item__meta mono">
                        {member.email}
                      </div>
                      <div className="stack-item__meta mono">
                        Joined {formatTimestamp(member.createdAt)}
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              {companyInvitations.length > 0 ? (
                <div className="stack-list stack-list--compact">
                  {companyInvitations.map((invitation) => (
                    <article
                      key={invitation.invitationId}
                      className="stack-item"
                    >
                      <div className="stack-item__header">
                        <strong>{invitation.email}</strong>
                        <StatusPill tone={statusTone(invitation.status)}>
                          {invitation.status}
                        </StatusPill>
                      </div>
                      <div className="stack-item__meta mono">
                        Role {invitation.role} · expires{' '}
                        {formatTimestamp(invitation.expiresAt)}
                      </div>
                      <div className="stack-item__meta mono">
                        Invited by{' '}
                        {invitation.invitedByDisplayName ??
                          invitation.invitedByEmail ??
                          invitation.invitedByUserId ??
                          'unknown'}
                      </div>
                      {invitation.status === 'accepted' ? (
                        <div className="stack-item__meta mono">
                          Accepted by{' '}
                          {invitation.acceptedByDisplayName ??
                            invitation.acceptedByEmail ??
                            invitation.acceptedByUserId ??
                            'unknown'}{' '}
                          on {formatTimestamp(invitation.acceptedAt)}
                        </div>
                      ) : null}
                      {invitation.status === 'pending' &&
                      canManageInvitations ? (
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() =>
                              void revokeInvitationFromUi(
                                invitation.invitationId,
                              )
                            }
                          >
                            Revoke invite
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </Card>

        <Card eyebrow="Invite token" heading="Accept with the current session">
          <div className="card-row">
            <StatusPill tone={inviteCanAccept ? 'warn' : 'neutral'}>
              {inviteCanAccept ? 'Ready to accept' : 'No invite loaded'}
            </StatusPill>
            <span className="muted mono">
              {inviteToken ? 'invite token detected' : 'add ?invite=...'}
            </span>
          </div>

          <SectionState
            phase={inviteToken ? invitationPreview.phase : 'unavailable'}
            loadingCopy="Loading invitation preview..."
            emptyCopy="Append ?invite=<token> to this URL to accept an invite from the current operator session."
            errorMessage={invitationPreview.errorMessage}
            hasData={Boolean(invitationPreviewData)}
          />

          {invitationPreviewData?.invitation ? (
            <>
              <div className="detail-list">
                <span>
                  Company {invitationPreviewData.company?.displayName}
                </span>
                <span>Email {invitationPreviewData.invitation.email}</span>
                <span>Role {invitationPreviewData.invitation.role}</span>
                <span>
                  Expires{' '}
                  {formatTimestamp(invitationPreviewData.invitation.expiresAt)}
                </span>
              </div>

              <div className="inline-actions inline-actions--top">
                <button
                  type="button"
                  className="button"
                  disabled={!inviteCanAccept}
                  onClick={() => void acceptInvitationFromUi()}
                >
                  Accept using current session
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => clearInviteTokenFromUrl()}
                >
                  Clear invite token
                </button>
              </div>
            </>
          ) : null}
        </Card>
      </section>

      <section
        className="card-grid card-grid--three"
        aria-label="Bootstrap controls"
      >
        <Card eyebrow="Bootstrap" heading="Create a company from control web">
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void createCompanyFromUi();
            }}
          >
            <label className="field">
              <span className="field__label">Company slug</span>
              <input
                value={companySlug}
                onChange={(event) => setCompanySlug(event.target.value)}
                placeholder="escalonalabs-demo"
              />
            </label>
            <label className="field">
              <span className="field__label">Display name</span>
              <input
                value={companyDisplayName}
                onChange={(event) => setCompanyDisplayName(event.target.value)}
                placeholder="Escalona Labs Demo"
              />
            </label>
            <div className="inline-actions">
              <button
                type="submit"
                className="button"
                disabled={actionState.phase === 'running'}
              >
                Create company
              </button>
            </div>
          </form>
        </Card>

        <Card eyebrow="GitHub onboarding" heading="Install, link, and verify">
          <div className="card-row">
            <StatusPill tone={onboardingTone}>
              {completedChecklistCount}/{onboardingChecklist.length} ready
            </StatusPill>
            <span className="muted mono">
              {selectedCompany?.slug ?? 'select-company-first'}
            </span>
          </div>

          <SectionState
            phase={selectedCompany ? onboarding.phase : 'unavailable'}
            loadingCopy="Loading onboarding state..."
            emptyCopy="Select a company to load GitHub onboarding details."
            errorMessage={
              onboarding.errorMessage ?? githubInstallations.errorMessage
            }
            hasData={Boolean(selectedCompany)}
          />

          <div className="checklist">
            {onboardingChecklist.map((item, index) => (
              <article key={item.id ?? item.label} className="checklist-item">
                <div className="stack-item__header">
                  <strong>
                    {index + 1}. {item.label}
                  </strong>
                  <StatusPill tone={item.completed ? 'ok' : 'neutral'}>
                    {item.completed ? 'Done' : 'Pending'}
                  </StatusPill>
                </div>
                {item.description ? (
                  <p className="muted">{item.description}</p>
                ) : null}
              </article>
            ))}
          </div>

          <div className="inline-actions inline-actions--top">
            {installHref ? (
              <a
                className="button button--link"
                href={installHref}
                rel="noreferrer"
                target="_blank"
              >
                Install GitHub App
              </a>
            ) : (
              <span className="muted">
                Backend install URL not provided yet.
              </span>
            )}
          </div>

          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void linkGitHubInstallationFromUi();
            }}
          >
            <label className="field">
              <span className="field__label">Installation id</span>
              <input
                inputMode="numeric"
                value={installationIdInput}
                onChange={(event) => setInstallationIdInput(event.target.value)}
                placeholder="12345678"
              />
            </label>
            <label className="field">
              <span className="field__label">GitHub account login</span>
              <input
                value={installationAccountLogin}
                onChange={(event) =>
                  setInstallationAccountLogin(event.target.value)
                }
                placeholder="escalona-labs"
              />
            </label>
            <label className="field">
              <span className="field__label">Repository owner</span>
              <input
                value={repositoryOwner}
                onChange={(event) => setRepositoryOwner(event.target.value)}
                placeholder={
                  onboarding.data?.repository?.owner ?? 'escalona-labs'
                }
              />
            </label>
            <label className="field">
              <span className="field__label">Repository name</span>
              <input
                value={repositoryName}
                onChange={(event) => setRepositoryName(event.target.value)}
                placeholder={
                  onboarding.data?.repository?.name ?? 'agents-company'
                }
              />
            </label>
            <div className="inline-actions">
              <button
                type="submit"
                className="button"
                disabled={!selectedCompany || actionState.phase === 'running'}
              >
                Link installation
              </button>
            </div>
          </form>

          {linkedInstallations.length > 0 ? (
            <div className="stack-list stack-list--compact">
              {linkedInstallations.map((installation) => (
                <article
                  key={`${installation.installationId}-${installation.repository.owner}-${installation.repository.name}`}
                  className="stack-item"
                >
                  <div className="stack-item__header">
                    <strong>
                      {installation.repository.owner}/
                      {installation.repository.name}
                    </strong>
                    <StatusPill tone="ok">Linked</StatusPill>
                  </div>
                  <div className="stack-item__meta mono">
                    Installation {installation.installationId} ·{' '}
                    {installation.accountLogin}
                  </div>
                  <div className="stack-item__meta mono">
                    Updated {formatTimestamp(installation.updatedAt)}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </Card>

        <Card eyebrow="Objective intake" heading="Create a new objective">
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void createObjectiveFromUi();
            }}
          >
            <label className="field">
              <span className="field__label">Target company</span>
              <input
                value={selectedCompany?.displayName ?? 'Select a company first'}
                readOnly
              />
            </label>
            <label className="field">
              <span className="field__label">Objective title</span>
              <input
                value={objectiveTitle}
                onChange={(event) => setObjectiveTitle(event.target.value)}
                placeholder="Ship the first operator-ready workflow"
              />
            </label>
            <label className="field">
              <span className="field__label">Objective summary</span>
              <textarea
                rows={4}
                value={objectiveSummary}
                onChange={(event) => setObjectiveSummary(event.target.value)}
                placeholder="Bound the work, expected outcome, and constraints."
              />
            </label>
            {linkedInstallations.length > 0 ? (
              <label className="field">
                <span className="field__label">Target repository</span>
                <select
                  value={objectiveRepositoryKey}
                  onChange={(event) =>
                    setObjectiveRepositoryKey(event.target.value)
                  }
                >
                  <option value="">
                    {linkedInstallations.length === 1
                      ? 'Use the linked repository'
                      : 'Select a linked repository'}
                  </option>
                  {linkedInstallations.map((installation) => {
                    const repositoryKey = createRepositoryKey(
                      installation.repository,
                    );

                    return (
                      <option
                        key={`${installation.installationId}-${repositoryKey}`}
                        value={repositoryKey}
                      >
                        {repositoryKey}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
            <div className="inline-actions">
              <button
                type="submit"
                className="button"
                disabled={!selectedCompany || actionState.phase === 'running'}
              >
                Create objective
              </button>
            </div>
          </form>
        </Card>
      </section>

      <section
        className="card-grid card-grid--two"
        aria-label="Operator workspace"
      >
        <Card
          eyebrow="Objective workspace"
          heading="Objective graph and work items"
        >
          <SectionState
            phase={objectives.phase}
            loadingCopy="Loading objectives..."
            emptyCopy="No objectives loaded for this company."
            errorMessage={objectives.errorMessage}
            hasData={Boolean(objectives.data?.length)}
          />

          {objectives.data && objectives.data.length > 0 ? (
            <>
              <div className="chip-row">
                {objectives.data.map((objective) => (
                  <button
                    key={objective.objectiveId}
                    type="button"
                    className={`stack-button ${
                      objective.objectiveId === deferredObjectiveId
                        ? 'stack-button--active'
                        : ''
                    }`}
                    onClick={() =>
                      setSelectedObjectiveId(objective.objectiveId)
                    }
                  >
                    <span>{objective.title}</span>
                    <span className="mono">{objective.status}</span>
                  </button>
                ))}
              </div>

              <SectionState
                phase={objectiveGraph.phase}
                loadingCopy="Loading objective graph..."
                emptyCopy="Select an objective to inspect its work items."
                errorMessage={objectiveGraph.errorMessage}
                hasData={Boolean(objectiveGraph.data)}
              />

              {objectiveGraph.data ? (
                <>
                  <div className="inline-actions inline-actions--top">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={
                        !selectedObjective || actionState.phase === 'running'
                      }
                      onClick={() => {
                        if (!selectedObjective) return;
                        void runOperatorAction(
                          'Objective replan',
                          `/objectives/${selectedObjective.objectiveId}/replan`,
                        );
                      }}
                    >
                      Replan objective
                    </button>
                  </div>

                  <div className="metric-grid">
                    <MetricCard
                      label="Work items"
                      value={objectiveGraph.data.summary?.workItemCount ?? 0}
                      hint="Bounded units"
                    />
                    <MetricCard
                      label="Completed"
                      value={objectiveGraph.data.summary?.completedCount ?? 0}
                      hint="Done items"
                    />
                    <MetricCard
                      label="Blocked"
                      value={objectiveGraph.data.summary?.blockedCount ?? 0}
                      hint="Needs intervention"
                    />
                    <MetricCard
                      label="Pending approval"
                      value={
                        objectiveGraph.data.summary?.pendingApprovalCount ?? 0
                      }
                      hint="Operator gates"
                    />
                  </div>

                  <div className="stack-list">
                    {objectiveGraph.data.workItems.map((workItem) => (
                      <button
                        key={workItem.workItemId}
                        type="button"
                        className={`stack-button stack-button--detail ${
                          workItem.workItemId === deferredWorkItemId
                            ? 'stack-button--active'
                            : ''
                        }`}
                        onClick={() =>
                          setSelectedWorkItemId(workItem.workItemId)
                        }
                      >
                        <div className="stack-item__header">
                          <strong>{workItem.title}</strong>
                          <StatusPill tone={statusTone(workItem.status)}>
                            {workItem.status}
                          </StatusPill>
                        </div>
                        <span className="muted">
                          {workItem.description ??
                            'No bounded description yet.'}
                        </span>
                        <span className="stack-item__meta mono">
                          Scope {workItem.scopeRef}
                          {workItem.blockingReason
                            ? ` · blocked by ${workItem.blockingReason}`
                            : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </Card>

        <Card
          eyebrow="Run detail"
          heading="Selected work item and operator actions"
        >
          <SectionState
            phase={workItemDetail.phase}
            loadingCopy="Loading work-item detail..."
            emptyCopy="Select a work item to inspect its runs and controls."
            errorMessage={workItemDetail.errorMessage}
            hasData={Boolean(workItemDetail.data)}
          />

          {workItemDetail.data ? (
            <div className="detail-grid">
              <div className="detail-grid__section">
                <div className="stack-item__header">
                  <strong>
                    {selectedWorkItem?.title ?? 'Selected work item'}
                  </strong>
                  <StatusPill tone={statusTone(selectedWorkItem?.status)}>
                    {selectedWorkItem?.status ?? 'unknown'}
                  </StatusPill>
                </div>
                <p className="muted">
                  {selectedWorkItem?.description ??
                    'No bounded description captured for this work item.'}
                </p>
                <div className="detail-list mono">
                  <span>
                    Validation {selectedWorkItem?.validationContractRef}
                  </span>
                  <span>Scope {selectedWorkItem?.scopeRef}</span>
                  <span>
                    Attempt budget {selectedWorkItem?.attemptBudget ?? 0}
                  </span>
                  <span>
                    Updated {formatTimestamp(selectedWorkItem?.updatedAt)}
                  </span>
                </div>

                <div className="inline-actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={
                      !canRequeueWorkItem || actionState.phase === 'running'
                    }
                    onClick={() => {
                      if (!selectedWorkItem) return;
                      void runOperatorAction(
                        'Work item requeue',
                        `/work-items/${selectedWorkItem.workItemId}/requeue`,
                      );
                    }}
                  >
                    Requeue
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={
                      !canCancelWorkItem || actionState.phase === 'running'
                    }
                    onClick={() => {
                      if (!selectedWorkItem) return;
                      void runOperatorAction(
                        'Work item cancel',
                        `/work-items/${selectedWorkItem.workItemId}/cancel`,
                      );
                    }}
                  >
                    Cancel
                  </button>
                </div>

                {selectedApproval ? (
                  <div className="approval-panel">
                    <div className="stack-item__header">
                      <strong>{selectedApproval.requestedAction}</strong>
                      <StatusPill tone={statusTone(selectedApproval.status)}>
                        {selectedApproval.status}
                      </StatusPill>
                    </div>
                    <p className="muted">
                      {selectedApproval.decisionReason ??
                        'No decision reason recorded yet.'}
                    </p>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={
                          !canGrantApproval || actionState.phase === 'running'
                        }
                        onClick={() => {
                          void runOperatorAction(
                            'Approval grant',
                            `/approvals/${selectedApproval.approvalId}/grant`,
                            { decisionReason: 'Granted from control web.' },
                          );
                        }}
                      >
                        Grant
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={
                          !canDenyApproval || actionState.phase === 'running'
                        }
                        onClick={() => {
                          void runOperatorAction(
                            'Approval deny',
                            `/approvals/${selectedApproval.approvalId}/deny`,
                            { decisionReason: 'Denied from control web.' },
                          );
                        }}
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="detail-grid__section">
                <strong>Run attempts</strong>
                <SectionState
                  phase={runDetail.phase}
                  loadingCopy="Loading selected run..."
                  emptyCopy="No run selected yet."
                  errorMessage={runDetail.errorMessage}
                  hasData={Boolean(runDetail.data)}
                />

                {workItemDetail.data.runs.length > 0 ? (
                  <div className="chip-row">
                    {workItemDetail.data.runs.map((run) => (
                      <button
                        key={run.runId}
                        type="button"
                        className={`stack-button ${
                          run.runId === deferredRunId
                            ? 'stack-button--active'
                            : ''
                        }`}
                        onClick={() => setSelectedRunId(run.runId)}
                      >
                        <span>Attempt {run.attempt}</span>
                        <span className="mono">{run.status}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    No runs recorded for this work item yet.
                  </p>
                )}

                {runDetail.data?.run ? (
                  <div className="stack-item">
                    <div className="stack-item__header">
                      <strong>{runDetail.data.run.runId}</strong>
                      <StatusPill tone={statusTone(runDetail.data.run.status)}>
                        {runDetail.data.run.status}
                      </StatusPill>
                    </div>
                    <div className="detail-list mono">
                      <span>Attempt {runDetail.data.run.attempt}</span>
                      <span>
                        Packet {runDetail.data.run.executionPacketId ?? 'none'}
                      </span>
                      <span>
                        Head SHA {runDetail.data.run.headSha ?? 'not attached'}
                      </span>
                      <span>
                        Failure class{' '}
                        {runDetail.data.run.failureClass ?? 'none'}
                      </span>
                    </div>
                    <p className="muted">
                      {runDetail.data.run.summary ??
                        'No operator-facing run summary captured yet.'}
                    </p>

                    {runDetail.data.executionPacket ? (
                      <div className="detail-list">
                        <span className="mono">
                          Agent {runDetail.data.executionPacket.assignedAgentId}
                        </span>
                        <span className="mono">
                          Tools{' '}
                          {runDetail.data.executionPacket.toolAllowlist.join(
                            ', ',
                          )}
                        </span>
                        <span className="mono">
                          Scope{' '}
                          {runDetail.data.executionPacket.scopeAllowlist.join(
                            ', ',
                          ) || 'none'}
                        </span>
                        <span className="muted">
                          {runDetail.data.executionPacket.objectiveContext}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      </section>

      <section
        className="card-grid card-grid--two"
        aria-label="GitHub and timeline"
      >
        <Card
          eyebrow="GitHub drift"
          heading="Recent deliveries and drift alerts"
        >
          <SectionState
            phase={driftAlerts.phase}
            loadingCopy="Loading drift and delivery state..."
            emptyCopy="No GitHub drift alerts are available yet."
            errorMessage={driftAlerts.errorMessage}
            hasData={Boolean(
              driftAlerts.data?.driftAlerts?.length ||
                githubDeliveries.data?.deliveries?.length,
            )}
          />

          {driftAlerts.data?.driftAlerts?.length ? (
            <div className="stack-list">
              {driftAlerts.data.driftAlerts.slice(0, 4).map((alert) => (
                <article key={alert.alertId} className="stack-item">
                  <div className="stack-item__header">
                    <strong>{alert.summary}</strong>
                    <StatusPill tone={statusTone(alert.severity)}>
                      {alert.severity}
                    </StatusPill>
                  </div>
                  <div className="stack-item__meta mono">
                    {alert.driftClass ?? 'drift'} ·{' '}
                    {alert.githubObjectRef ?? 'no object ref'}
                  </div>
                  <div className="stack-item__meta mono">
                    Observed {formatTimestamp(alert.observedAt)}
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {githubDeliveries.data?.deliveries?.length ? (
            <div className="stack-list stack-list--compact">
              {githubDeliveries.data.deliveries.slice(0, 4).map((delivery) => (
                <article
                  key={delivery.projectionDeliveryId}
                  className="stack-item"
                >
                  <div className="stack-item__header">
                    <strong>
                      {delivery.aggregateType} / {delivery.githubObjectType}
                    </strong>
                    <StatusPill tone={statusTone(delivery.status)}>
                      {delivery.status}
                    </StatusPill>
                  </div>
                  <div className="stack-item__meta mono">
                    {delivery.actionType} ·{' '}
                    {delivery.githubObjectRef ?? 'pending'}
                  </div>
                  <div className="stack-item__meta mono">
                    Updated {formatTimestamp(delivery.updatedAt)}
                  </div>
                  {delivery.lastError ? (
                    <p className="error">{delivery.lastError}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </Card>

        <Card eyebrow="Timeline" heading="Recent canonical events">
          <div className="card-row">
            <StatusPill
              tone={timelineStream.phase === 'success' ? 'ok' : 'neutral'}
            >
              {timelineStream.phase === 'success' ? 'Live stream' : 'Polling'}
            </StatusPill>
            <span className="muted mono">
              {timelineStream.lastEventAt
                ? `Last stream ${formatTimestamp(timelineStream.lastEventAt)}`
                : 'SSE warmup in progress'}
            </span>
          </div>

          <SectionState
            phase={timelinePhase}
            loadingCopy="Loading recent events..."
            emptyCopy="No domain events found for this company yet."
            errorMessage={
              timeline.errorMessage ?? timelineStream.errorMessage ?? null
            }
            hasData={Boolean(timelineItems.length)}
          />

          {timelineItems.length ? (
            <div className="timeline-list">
              {timelineItems.map((event) => (
                <article key={event.eventId} className="timeline-item">
                  <div className="stack-item__header">
                    <strong>
                      {event.summary ?? eventLabel(event.eventType)}
                    </strong>
                    <div className="timeline-item__badges">
                      {event.severity ? (
                        <StatusPill tone={statusTone(event.severity)}>
                          {event.severity}
                        </StatusPill>
                      ) : null}
                      <StatusPill tone={statusTone(event.aggregateType)}>
                        {event.aggregateType}
                      </StatusPill>
                    </div>
                  </div>
                  <div className="stack-item__meta mono">
                    {event.aggregateId}
                    {event.actorRef ? ` · ${event.actorRef}` : ''}
                  </div>
                  {event.summary ? (
                    <p className="muted">{eventLabel(event.eventType)}</p>
                  ) : null}
                  <div className="stack-item__meta mono">
                    {formatTimestamp(event.occurredAt)}
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          <p className="muted">
            The timeline now prefers the canonical SSE stream and falls back to
            bounded polling when live data is not available yet.
          </p>
        </Card>
      </section>

      <Card
        className="status-card"
        eyebrow="Current state"
        heading="M14 now includes team onboarding foundations"
      >
        <p>
          The control web now covers more than runtime control. Operators can
          authenticate, bootstrap companies, invite teammates, accept invite
          links from the same surface, inspect company access boundaries, and
          keep GitHub onboarding, approvals, runs, drift, and canonical timeline
          state in one place.
        </p>
      </Card>
    </main>
  );
}
