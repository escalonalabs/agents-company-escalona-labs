import type {
  ApprovalDecision,
  Objective,
  Run,
  WorkItem,
} from '@escalonalabs/domain';

import { createMetadataBlock } from './metadata';
import type {
  GitHubActionType,
  GitHubCheckRunProjection,
  GitHubCommentProjection,
  GitHubIssueProjection,
  GitHubProjectionBinding,
  GitHubProjectionDelivery,
  GitHubProjectionMetadata,
  GitHubProjectionPlanItem,
  GitHubRepositoryRef,
  GitHubRuntimeSnapshot,
} from './types';

const PROJECTION_VERSION = 'github.v1';

function createAggregateRef(
  aggregateType: string,
  aggregateId: string,
): string {
  return `${aggregateType}:${aggregateId}`;
}

function sanitizeProjectionIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_');
}

function createProjectionDeliveryId(parts: string[]): string {
  return parts.map(sanitizeProjectionIdPart).join('_');
}

function sanitizeLabelPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function createMetadata(input: {
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  sourceEventId: string;
  projectionDeliveryId: string;
}): GitHubProjectionMetadata {
  return {
    projectionVersion: PROJECTION_VERSION,
    companyId: input.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    sourceEventId: input.sourceEventId,
    projectionDeliveryId: input.projectionDeliveryId,
  };
}

function withMetadata(
  body: string,
  metadata: GitHubProjectionMetadata,
): string {
  return `${body.trim()}\n\n${createMetadataBlock(metadata)}`;
}

function createStatusLabel(status: string): string {
  return `status:${sanitizeLabelPart(status)}`;
}

function createObjectiveIssueBody(
  objective: Objective,
  metadata: GitHubProjectionMetadata,
): string {
  return withMetadata(
    [
      '## Objective Summary',
      '',
      objective.summary ?? 'No summary recorded yet.',
      '',
      '## Runtime State',
      '',
      `- objective_id: ${objective.objectiveId}`,
      `- status: ${objective.status}`,
      `- updated_at: ${objective.updatedAt}`,
    ].join('\n'),
    metadata,
  );
}

function createWorkItemIssueBody(
  workItem: WorkItem,
  metadata: GitHubProjectionMetadata,
): string {
  return withMetadata(
    [
      '## Work Item',
      '',
      workItem.description ?? 'No bounded description recorded yet.',
      '',
      '## Runtime State',
      '',
      `- work_item_id: ${workItem.workItemId}`,
      `- objective_id: ${workItem.objectiveId}`,
      `- status: ${workItem.status}`,
      `- attempt_budget: ${workItem.attemptBudget}`,
      `- requires_approval: ${workItem.requiresApproval}`,
      `- validation_contract: ${workItem.validationContractRef}`,
      `- scope_ref: ${workItem.scopeRef}`,
      `- blocking_reason: ${workItem.blockingReason ?? 'none'}`,
      `- latest_run_id: ${workItem.latestRunId ?? 'none'}`,
      `- updated_at: ${workItem.updatedAt}`,
    ].join('\n'),
    metadata,
  );
}

function mapRunStatusToCheck(
  input: Run,
): Pick<GitHubCheckRunProjection, 'status' | 'conclusion' | 'summary'> {
  switch (input.status) {
    case 'queued':
      return {
        status: 'queued',
        summary: input.summary ?? 'Run is queued for execution.',
      };
    case 'running':
      return {
        status: 'in_progress',
        summary: input.summary ?? 'Run is currently executing.',
      };
    case 'valid_success':
      return {
        status: 'completed',
        conclusion: 'success',
        summary: input.summary ?? 'Run completed successfully.',
      };
    case 'cancelled':
      return {
        status: 'completed',
        conclusion: 'cancelled',
        summary: input.summary ?? 'Run was cancelled.',
      };
    case 'invalid_output':
      return {
        status: 'completed',
        conclusion: 'failure',
        summary: input.summary ?? 'Run completed with invalid output.',
      };
    case 'transient_failure':
      return {
        status: 'completed',
        conclusion: 'neutral',
        summary: input.summary ?? 'Run failed transiently and may retry.',
      };
    case 'permanent_failure':
      return {
        status: 'completed',
        conclusion: 'failure',
        summary: input.summary ?? 'Run failed permanently.',
      };
  }
}

function createDelivery(input: {
  companyId: string;
  aggregateType: string;
  aggregateId: string;
  sourceEventId: string;
  githubObjectType: GitHubProjectionDelivery['githubObjectType'];
  actionType: GitHubActionType;
  projectionDeliveryId: string;
  payload: Record<string, unknown>;
  now: string;
}): GitHubProjectionDelivery {
  return {
    projectionDeliveryId: input.projectionDeliveryId,
    projectionName: 'github',
    companyId: input.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    sourceEventId: input.sourceEventId,
    githubObjectType: input.githubObjectType,
    actionType: input.actionType,
    deliveryKey: [
      'github',
      input.aggregateType,
      input.aggregateId,
      input.sourceEventId,
      input.githubObjectType,
      input.actionType,
    ].join(':'),
    status: 'queued',
    attemptCount: 0,
    payload: input.payload,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function findBinding(
  bindings: GitHubProjectionBinding[],
  aggregateType: string,
  aggregateId: string,
  githubObjectType: GitHubProjectionBinding['githubObjectType'],
): GitHubProjectionBinding | undefined {
  return bindings.find(
    (binding) =>
      binding.aggregateType === aggregateType &&
      binding.aggregateId === aggregateId &&
      binding.githubObjectType === githubObjectType,
  );
}

function resolveRepository(input: {
  explicitRepository?: GitHubRepositoryRef;
  existingBinding?: GitHubProjectionBinding;
  defaultRepository?: GitHubRepositoryRef;
  aggregateLabel: string;
}): GitHubRepositoryRef {
  const repository =
    input.explicitRepository ??
    input.existingBinding?.repository ??
    input.defaultRepository;

  if (!repository) {
    throw new Error(
      `GitHub sync cannot resolve a repository target for ${input.aggregateLabel}.`,
    );
  }

  return repository;
}

function createIssuePlanItem(input: {
  aggregateType: 'objective' | 'work_item';
  aggregateId: string;
  companyId: string;
  sourceEventId: string;
  repository: GitHubRepositoryRef;
  projection: GitHubIssueProjection;
  bindings: GitHubProjectionBinding[];
  now: string;
}): GitHubProjectionPlanItem {
  const binding = findBinding(
    input.bindings,
    input.aggregateType,
    input.aggregateId,
    'issue',
  );
  const actionType: GitHubActionType = binding
    ? 'update_issue'
    : 'create_issue';
  const delivery = createDelivery({
    companyId: input.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    sourceEventId: input.sourceEventId,
    githubObjectType: 'issue',
    actionType,
    projectionDeliveryId: input.projection.metadata.projectionDeliveryId,
    payload: input.projection as unknown as Record<string, unknown>,
    now: input.now,
  });

  return {
    delivery,
    repository: input.repository,
    issueProjection: input.projection,
  };
}

function createCommentPlanItem(input: {
  aggregateType: 'approval' | 'run';
  aggregateId: string;
  companyId: string;
  sourceEventId: string;
  parentAggregateId: string;
  repository: GitHubRepositoryRef;
  projection: GitHubCommentProjection;
  bindings: GitHubProjectionBinding[];
  now: string;
}): GitHubProjectionPlanItem {
  const binding = findBinding(
    input.bindings,
    input.aggregateType,
    input.aggregateId,
    'comment',
  );
  const actionType: GitHubActionType = binding
    ? 'update_comment'
    : 'add_comment';
  const delivery = createDelivery({
    companyId: input.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    sourceEventId: input.sourceEventId,
    githubObjectType: 'comment',
    actionType,
    projectionDeliveryId: input.projection.metadata.projectionDeliveryId,
    payload: input.projection as unknown as Record<string, unknown>,
    now: input.now,
  });

  return {
    delivery,
    repository: input.repository,
    commentProjection: input.projection,
    parentAggregateId: input.parentAggregateId,
  };
}

function createCheckRunPlanItem(input: {
  run: Run;
  companyId: string;
  sourceEventId: string;
  repository: GitHubRepositoryRef;
  projection: GitHubCheckRunProjection;
  bindings: GitHubProjectionBinding[];
  now: string;
}): GitHubProjectionPlanItem {
  const binding = findBinding(
    input.bindings,
    'run',
    input.run.runId,
    'check_run',
  );
  const actionType: GitHubActionType = binding
    ? 'update_check_run'
    : 'create_check_run';
  const delivery = createDelivery({
    companyId: input.companyId,
    aggregateType: 'run',
    aggregateId: input.run.runId,
    sourceEventId: input.sourceEventId,
    githubObjectType: 'check_run',
    actionType,
    projectionDeliveryId: input.projection.metadata.projectionDeliveryId,
    payload: input.projection as unknown as Record<string, unknown>,
    now: input.now,
  });

  return {
    delivery,
    repository: input.repository,
    checkRunProjection: input.projection,
    parentAggregateId: input.run.workItemId,
  };
}

export function createObjectiveIssueProjection(input: {
  objective: Objective;
  sourceEventId: string;
  projectionDeliveryId: string;
}): GitHubIssueProjection {
  const metadata = createMetadata({
    companyId: input.objective.companyId,
    aggregateType: 'objective',
    aggregateId: input.objective.objectiveId,
    sourceEventId: input.sourceEventId,
    projectionDeliveryId: input.projectionDeliveryId,
  });

  return {
    title: input.objective.title,
    body: createObjectiveIssueBody(input.objective, metadata),
    labels: [
      'type:epic',
      'runtime:objective',
      createStatusLabel(input.objective.status),
    ],
    state: ['completed', 'cancelled'].includes(input.objective.status)
      ? 'closed'
      : 'open',
    metadata,
  };
}

export function createWorkItemIssueProjection(input: {
  workItem: WorkItem;
  sourceEventId: string;
  projectionDeliveryId: string;
}): GitHubIssueProjection {
  const metadata = createMetadata({
    companyId: input.workItem.companyId,
    aggregateType: 'work_item',
    aggregateId: input.workItem.workItemId,
    sourceEventId: input.sourceEventId,
    projectionDeliveryId: input.projectionDeliveryId,
  });
  const labels = [
    'runtime:work-item',
    createStatusLabel(input.workItem.status),
    input.workItem.requiresApproval ? 'approval:required' : 'approval:none',
  ];

  if (input.workItem.blockingReason) {
    labels.push(`blocking:${sanitizeLabelPart(input.workItem.blockingReason)}`);
  }

  return {
    title: input.workItem.title,
    body: createWorkItemIssueBody(input.workItem, metadata),
    labels,
    state: ['completed', 'cancelled'].includes(input.workItem.status)
      ? 'closed'
      : 'open',
    metadata,
  };
}

export function createApprovalCommentProjection(input: {
  approval: ApprovalDecision;
  sourceEventId: string;
  projectionDeliveryId: string;
}): GitHubCommentProjection {
  const metadata = createMetadata({
    companyId: input.approval.companyId,
    aggregateType: 'approval',
    aggregateId: input.approval.approvalId,
    sourceEventId: input.sourceEventId,
    projectionDeliveryId: input.projectionDeliveryId,
  });

  return {
    body: withMetadata(
      [
        '### Approval Status',
        '',
        `- approval_id: ${input.approval.approvalId}`,
        `- requested_action: ${input.approval.requestedAction}`,
        `- status: ${input.approval.status}`,
        `- decision_reason: ${input.approval.decisionReason ?? 'none'}`,
        `- updated_at: ${input.approval.updatedAt}`,
      ].join('\n'),
      metadata,
    ),
    metadata,
  };
}

export function createRunCommentProjection(input: {
  run: Run;
  sourceEventId: string;
  projectionDeliveryId: string;
}): GitHubCommentProjection {
  const metadata = createMetadata({
    companyId: input.run.companyId,
    aggregateType: 'run',
    aggregateId: input.run.runId,
    sourceEventId: input.sourceEventId,
    projectionDeliveryId: input.projectionDeliveryId,
  });

  return {
    body: withMetadata(
      [
        '### Run Status',
        '',
        `- run_id: ${input.run.runId}`,
        `- status: ${input.run.status}`,
        `- attempt: ${input.run.attempt}`,
        `- head_sha: ${input.run.headSha ?? 'none'}`,
        `- failure_class: ${input.run.failureClass ?? 'none'}`,
        '',
        input.run.summary ?? 'No run summary recorded yet.',
      ].join('\n'),
      metadata,
    ),
    metadata,
  };
}

export function createRunCheckRunProjection(input: {
  run: Run;
  sourceEventId: string;
  projectionDeliveryId: string;
}): GitHubCheckRunProjection {
  const metadata = createMetadata({
    companyId: input.run.companyId,
    aggregateType: 'run',
    aggregateId: input.run.runId,
    sourceEventId: input.sourceEventId,
    projectionDeliveryId: input.projectionDeliveryId,
  });
  const checkState = mapRunStatusToCheck(input.run);

  return {
    name: `run/${input.run.runId}`,
    headSha: input.run.headSha,
    status: checkState.status,
    conclusion: checkState.conclusion,
    summary: checkState.summary,
    text: input.run.summary,
    externalId: input.run.runId,
    metadata,
  };
}

export function createGitHubSyncPlan(input: {
  snapshot: GitHubRuntimeSnapshot;
  bindings: GitHubProjectionBinding[];
  defaultRepository?: GitHubRepositoryRef;
  now?: string;
}): GitHubProjectionPlanItem[] {
  const now = input.now ?? new Date().toISOString();
  const plan: GitHubProjectionPlanItem[] = [];
  const workItemById = new Map(
    input.snapshot.workItems.map((workItem) => [workItem.workItemId, workItem]),
  );

  for (const objective of input.snapshot.objectives) {
    const objectiveBinding = findBinding(
      input.bindings,
      'objective',
      objective.objectiveId,
      'issue',
    );
    const repository = resolveRepository({
      explicitRepository: objective.repositoryTarget,
      existingBinding: objectiveBinding,
      defaultRepository: input.defaultRepository,
      aggregateLabel: `objective ${objective.objectiveId}`,
    });
    const sourceEventId =
      input.snapshot.latestEventByAggregate[
        createAggregateRef('objective', objective.objectiveId)
      ] ?? 'objective:unknown';
    const projection = createObjectiveIssueProjection({
      objective,
      sourceEventId,
      projectionDeliveryId: createProjectionDeliveryId([
        'projection',
        'objective',
        objective.objectiveId,
        sourceEventId,
        'issue',
      ]),
    });

    plan.push(
      createIssuePlanItem({
        aggregateType: 'objective',
        aggregateId: objective.objectiveId,
        companyId: objective.companyId,
        sourceEventId,
        repository,
        projection,
        bindings: input.bindings,
        now,
      }),
    );
  }

  for (const workItem of input.snapshot.workItems) {
    const workItemBinding = findBinding(
      input.bindings,
      'work_item',
      workItem.workItemId,
      'issue',
    );
    const repository = resolveRepository({
      explicitRepository: workItem.repositoryTarget,
      existingBinding: workItemBinding,
      defaultRepository: input.defaultRepository,
      aggregateLabel: `work item ${workItem.workItemId}`,
    });
    const sourceEventId =
      input.snapshot.latestEventByAggregate[
        createAggregateRef('work_item', workItem.workItemId)
      ] ?? 'work-item:unknown';
    const projection = createWorkItemIssueProjection({
      workItem,
      sourceEventId,
      projectionDeliveryId: createProjectionDeliveryId([
        'projection',
        'work_item',
        workItem.workItemId,
        sourceEventId,
        'issue',
      ]),
    });

    plan.push(
      createIssuePlanItem({
        aggregateType: 'work_item',
        aggregateId: workItem.workItemId,
        companyId: workItem.companyId,
        sourceEventId,
        repository,
        projection,
        bindings: input.bindings,
        now,
      }),
    );
  }

  for (const approval of input.snapshot.approvals) {
    const parentWorkItem = workItemById.get(approval.workItemId);
    const approvalBinding = findBinding(
      input.bindings,
      'approval',
      approval.approvalId,
      'comment',
    );
    const parentBinding = findBinding(
      input.bindings,
      'work_item',
      approval.workItemId,
      'issue',
    );
    const repository = resolveRepository({
      explicitRepository: parentWorkItem?.repositoryTarget,
      existingBinding: approvalBinding ?? parentBinding,
      defaultRepository: input.defaultRepository,
      aggregateLabel: `approval ${approval.approvalId}`,
    });
    const sourceEventId =
      input.snapshot.latestEventByAggregate[
        createAggregateRef('approval', approval.approvalId)
      ] ?? 'approval:unknown';
    const projection = createApprovalCommentProjection({
      approval,
      sourceEventId,
      projectionDeliveryId: createProjectionDeliveryId([
        'projection',
        'approval',
        approval.approvalId,
        sourceEventId,
        'comment',
      ]),
    });

    plan.push(
      createCommentPlanItem({
        aggregateType: 'approval',
        aggregateId: approval.approvalId,
        companyId: approval.companyId,
        sourceEventId,
        parentAggregateId: approval.workItemId,
        repository,
        projection,
        bindings: input.bindings,
        now,
      }),
    );
  }

  for (const run of input.snapshot.runs) {
    const parentWorkItem = workItemById.get(run.workItemId);
    const runCommentBinding = findBinding(
      input.bindings,
      'run',
      run.runId,
      'comment',
    );
    const runCheckBinding = findBinding(
      input.bindings,
      'run',
      run.runId,
      'check_run',
    );
    const parentBinding = findBinding(
      input.bindings,
      'work_item',
      run.workItemId,
      'issue',
    );
    const repository = resolveRepository({
      explicitRepository: parentWorkItem?.repositoryTarget,
      existingBinding: runCommentBinding ?? runCheckBinding ?? parentBinding,
      defaultRepository: input.defaultRepository,
      aggregateLabel: `run ${run.runId}`,
    });
    const sourceEventId =
      input.snapshot.latestEventByAggregate[
        createAggregateRef('run', run.runId)
      ] ?? 'run:unknown';
    const commentProjection = createRunCommentProjection({
      run,
      sourceEventId,
      projectionDeliveryId: createProjectionDeliveryId([
        'projection',
        'run',
        run.runId,
        sourceEventId,
        'comment',
      ]),
    });

    plan.push(
      createCommentPlanItem({
        aggregateType: 'run',
        aggregateId: run.runId,
        companyId: run.companyId,
        sourceEventId,
        parentAggregateId: run.workItemId,
        repository,
        projection: commentProjection,
        bindings: input.bindings,
        now,
      }),
    );

    if (run.headSha) {
      const checkProjection = createRunCheckRunProjection({
        run,
        sourceEventId,
        projectionDeliveryId: createProjectionDeliveryId([
          'projection',
          'run',
          run.runId,
          sourceEventId,
          'check',
        ]),
      });

      plan.push(
        createCheckRunPlanItem({
          run,
          companyId: run.companyId,
          sourceEventId,
          repository,
          projection: checkProjection,
          bindings: input.bindings,
          now,
        }),
      );
    }
  }

  return plan;
}
