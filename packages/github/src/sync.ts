import {
  createDriftAlert,
  deriveProjectionHealth,
  detectCheckRunDrift,
  detectCommentDrift,
  detectIssueDrift,
  toSyncEvent,
} from './drift';
import type {
  GitHubCheckRunProjection,
  GitHubCheckRunRecord,
  GitHubCommentProjection,
  GitHubCommentRecord,
  GitHubInstallationRef,
  GitHubIssueProjection,
  GitHubIssueRecord,
  GitHubProjectionBinding,
  GitHubProjectionDelivery,
  GitHubProjectionPlanItem,
  GitHubSyncSummary,
  GitHubTransport,
} from './types';

function createBindingKey(
  aggregateType: string,
  aggregateId: string,
  githubObjectType: GitHubProjectionBinding['githubObjectType'],
): string {
  return `${aggregateType}:${aggregateId}:${githubObjectType}`;
}

function cloneDelivery(
  delivery: GitHubProjectionDelivery,
  patch: Partial<GitHubProjectionDelivery>,
): GitHubProjectionDelivery {
  return {
    ...delivery,
    ...patch,
  };
}

function upsertBinding(
  bindings: Map<string, GitHubProjectionBinding>,
  binding: GitHubProjectionBinding,
) {
  bindings.set(
    createBindingKey(
      binding.aggregateType,
      binding.aggregateId,
      binding.githubObjectType,
    ),
    binding,
  );
}

function toIssueBinding(input: {
  existing?: GitHubProjectionBinding;
  installation: GitHubInstallationRef;
  aggregateType: string;
  aggregateId: string;
  metadataVersion: string;
  sourceEventId: string;
  record: GitHubIssueRecord;
  now: string;
}): GitHubProjectionBinding {
  return {
    bindingId:
      input.existing?.bindingId ??
      `binding_issue_${input.aggregateType}_${input.aggregateId}`,
    companyId: input.installation.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    githubObjectType: 'issue',
    githubObjectId: input.record.id,
    githubObjectNumber: input.record.number,
    repository: input.record.repository,
    metadataVersion: input.metadataVersion,
    lastSourceEventId: input.sourceEventId,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function toCommentBinding(input: {
  existing?: GitHubProjectionBinding;
  installation: GitHubInstallationRef;
  aggregateType: string;
  aggregateId: string;
  metadataVersion: string;
  sourceEventId: string;
  record: GitHubCommentRecord;
  now: string;
}): GitHubProjectionBinding {
  return {
    bindingId:
      input.existing?.bindingId ??
      `binding_comment_${input.aggregateType}_${input.aggregateId}`,
    companyId: input.installation.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    githubObjectType: 'comment',
    githubObjectId: input.record.id,
    repository: input.record.repository,
    metadataVersion: input.metadataVersion,
    lastSourceEventId: input.sourceEventId,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function toCheckRunBinding(input: {
  existing?: GitHubProjectionBinding;
  installation: GitHubInstallationRef;
  aggregateType: string;
  aggregateId: string;
  metadataVersion: string;
  sourceEventId: string;
  record: GitHubCheckRunRecord;
  now: string;
}): GitHubProjectionBinding {
  return {
    bindingId:
      input.existing?.bindingId ??
      `binding_check_${input.aggregateType}_${input.aggregateId}`,
    companyId: input.installation.companyId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    githubObjectType: 'check_run',
    githubObjectId: input.record.id,
    repository: input.record.repository,
    metadataVersion: input.metadataVersion,
    lastSourceEventId: input.sourceEventId,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function createDeliveryFailureError(reason: string): Error {
  return new Error(reason);
}

function applyIssueDrift(
  input: {
    expected: GitHubIssueProjection;
    actual: GitHubIssueRecord;
    delivery: GitHubProjectionDelivery;
    observedAt: string;
  },
  driftAlerts: GitHubSyncSummary['driftAlerts'],
): GitHubProjectionDelivery {
  const candidates = detectIssueDrift({
    expected: input.expected,
    actual: input.actual,
  });

  if (candidates.length === 0) {
    return cloneDelivery(input.delivery, {
      status: 'applied',
      githubObjectRef: `issue:${input.actual.number}`,
      appliedAt: input.observedAt,
      updatedAt: input.observedAt,
    });
  }

  for (const [index, candidate] of candidates.entries()) {
    driftAlerts.push(
      createDriftAlert({
        alertId: `${input.delivery.projectionDeliveryId}:issue:${index + 1}`,
        companyId: input.delivery.companyId,
        aggregateType: input.delivery.aggregateType,
        aggregateId: input.delivery.aggregateId,
        candidate,
        sourceEventId: input.delivery.sourceEventId,
        observedAt: input.observedAt,
      }),
    );
  }

  return cloneDelivery(input.delivery, {
    status: 'drift_detected',
    githubObjectRef: `issue:${input.actual.number}`,
    appliedAt: input.observedAt,
    updatedAt: input.observedAt,
    lastError: candidates.map((candidate) => candidate.summary).join(' | '),
  });
}

function applyCommentDrift(
  input: {
    expected: GitHubCommentProjection;
    actual: GitHubCommentRecord;
    delivery: GitHubProjectionDelivery;
    observedAt: string;
  },
  driftAlerts: GitHubSyncSummary['driftAlerts'],
): GitHubProjectionDelivery {
  const candidates = detectCommentDrift({
    expected: input.expected,
    actual: input.actual,
  });

  if (candidates.length === 0) {
    return cloneDelivery(input.delivery, {
      status: 'applied',
      githubObjectRef: `comment:${input.actual.id}`,
      appliedAt: input.observedAt,
      updatedAt: input.observedAt,
    });
  }

  for (const [index, candidate] of candidates.entries()) {
    driftAlerts.push(
      createDriftAlert({
        alertId: `${input.delivery.projectionDeliveryId}:comment:${index + 1}`,
        companyId: input.delivery.companyId,
        aggregateType: input.delivery.aggregateType,
        aggregateId: input.delivery.aggregateId,
        candidate,
        sourceEventId: input.delivery.sourceEventId,
        observedAt: input.observedAt,
      }),
    );
  }

  return cloneDelivery(input.delivery, {
    status: 'drift_detected',
    githubObjectRef: `comment:${input.actual.id}`,
    appliedAt: input.observedAt,
    updatedAt: input.observedAt,
    lastError: candidates.map((candidate) => candidate.summary).join(' | '),
  });
}

function applyCheckRunDrift(
  input: {
    expected: GitHubCheckRunProjection;
    actual: GitHubCheckRunRecord;
    delivery: GitHubProjectionDelivery;
    observedAt: string;
  },
  driftAlerts: GitHubSyncSummary['driftAlerts'],
): GitHubProjectionDelivery {
  const candidates = detectCheckRunDrift({
    expected: input.expected,
    actual: input.actual,
  });

  if (candidates.length === 0) {
    return cloneDelivery(input.delivery, {
      status: 'applied',
      githubObjectRef: `check_run:${input.actual.id}`,
      appliedAt: input.observedAt,
      updatedAt: input.observedAt,
    });
  }

  for (const [index, candidate] of candidates.entries()) {
    driftAlerts.push(
      createDriftAlert({
        alertId: `${input.delivery.projectionDeliveryId}:check:${index + 1}`,
        companyId: input.delivery.companyId,
        aggregateType: input.delivery.aggregateType,
        aggregateId: input.delivery.aggregateId,
        candidate,
        sourceEventId: input.delivery.sourceEventId,
        observedAt: input.observedAt,
      }),
    );
  }

  return cloneDelivery(input.delivery, {
    status: 'drift_detected',
    githubObjectRef: `check_run:${input.actual.id}`,
    appliedAt: input.observedAt,
    updatedAt: input.observedAt,
    lastError: candidates.map((candidate) => candidate.summary).join(' | '),
  });
}

export async function applyGitHubSyncPlan(input: {
  installation: GitHubInstallationRef;
  plan: GitHubProjectionPlanItem[];
  bindings: GitHubProjectionBinding[];
  transport: GitHubTransport;
  now?: string;
}): Promise<
  GitHubSyncSummary & {
    bindings: GitHubProjectionBinding[];
    deliveries: GitHubProjectionDelivery[];
  }
> {
  const observedAt = input.now ?? new Date().toISOString();
  const bindings = new Map<string, GitHubProjectionBinding>();

  for (const binding of input.bindings) {
    upsertBinding(bindings, binding);
  }

  const deliveries: GitHubProjectionDelivery[] = [];
  const driftAlerts: GitHubSyncSummary['driftAlerts'] = [];

  for (const planItem of input.plan) {
    const delivery = cloneDelivery(planItem.delivery, {
      attemptCount: planItem.delivery.attemptCount + 1,
      updatedAt: observedAt,
      lastError: undefined,
    });

    try {
      if (planItem.issueProjection) {
        const existingBinding = bindings.get(
          createBindingKey(
            delivery.aggregateType,
            delivery.aggregateId,
            'issue',
          ),
        );
        const issueRecord =
          delivery.actionType === 'create_issue'
            ? await input.transport.createIssue({
                repository: planItem.repository,
                projection: planItem.issueProjection,
              })
            : await input.transport.updateIssue({
                repository: planItem.repository,
                issueNumber:
                  existingBinding?.githubObjectNumber ??
                  (() => {
                    throw createDeliveryFailureError(
                      'Cannot update GitHub issue without an existing issue binding.',
                    );
                  })(),
                projection: planItem.issueProjection,
              });
        const nextBinding = toIssueBinding({
          existing: existingBinding,
          installation: input.installation,
          aggregateType: delivery.aggregateType,
          aggregateId: delivery.aggregateId,
          metadataVersion: planItem.issueProjection.metadata.projectionVersion,
          sourceEventId: delivery.sourceEventId,
          record: issueRecord,
          now: observedAt,
        });

        upsertBinding(bindings, nextBinding);
        deliveries.push(
          applyIssueDrift(
            {
              expected: planItem.issueProjection,
              actual: issueRecord,
              delivery,
              observedAt,
            },
            driftAlerts,
          ),
        );
        continue;
      }

      if (planItem.commentProjection) {
        const existingBinding = bindings.get(
          createBindingKey(
            delivery.aggregateType,
            delivery.aggregateId,
            'comment',
          ),
        );
        const parentIssueBinding = bindings.get(
          createBindingKey(
            'work_item',
            planItem.parentAggregateId ?? '',
            'issue',
          ),
        );

        const commentRecord =
          delivery.actionType === 'add_comment'
            ? await input.transport.createComment({
                repository: planItem.repository,
                issueNumber:
                  parentIssueBinding?.githubObjectNumber ??
                  (() => {
                    throw createDeliveryFailureError(
                      'Cannot create GitHub comment without a bound parent work-item issue.',
                    );
                  })(),
                projection: planItem.commentProjection,
              })
            : await input.transport.updateComment({
                repository: planItem.repository,
                commentId:
                  existingBinding?.githubObjectId ??
                  (() => {
                    throw createDeliveryFailureError(
                      'Cannot update GitHub comment without an existing comment binding.',
                    );
                  })(),
                projection: planItem.commentProjection,
              });
        const nextBinding = toCommentBinding({
          existing: existingBinding,
          installation: input.installation,
          aggregateType: delivery.aggregateType,
          aggregateId: delivery.aggregateId,
          metadataVersion:
            planItem.commentProjection.metadata.projectionVersion,
          sourceEventId: delivery.sourceEventId,
          record: commentRecord,
          now: observedAt,
        });

        upsertBinding(bindings, nextBinding);
        deliveries.push(
          applyCommentDrift(
            {
              expected: planItem.commentProjection,
              actual: commentRecord,
              delivery,
              observedAt,
            },
            driftAlerts,
          ),
        );
        continue;
      }

      if (planItem.checkRunProjection) {
        const existingBinding = bindings.get(
          createBindingKey(
            delivery.aggregateType,
            delivery.aggregateId,
            'check_run',
          ),
        );
        const checkRunRecord =
          delivery.actionType === 'create_check_run'
            ? await input.transport.createCheckRun({
                repository: planItem.repository,
                projection: planItem.checkRunProjection,
              })
            : await input.transport.updateCheckRun({
                repository: planItem.repository,
                checkRunId:
                  existingBinding?.githubObjectId ??
                  (() => {
                    throw createDeliveryFailureError(
                      'Cannot update GitHub check run without an existing check-run binding.',
                    );
                  })(),
                projection: planItem.checkRunProjection,
              });
        const nextBinding = toCheckRunBinding({
          existing: existingBinding,
          installation: input.installation,
          aggregateType: delivery.aggregateType,
          aggregateId: delivery.aggregateId,
          metadataVersion:
            planItem.checkRunProjection.metadata.projectionVersion,
          sourceEventId: delivery.sourceEventId,
          record: checkRunRecord,
          now: observedAt,
        });

        upsertBinding(bindings, nextBinding);
        deliveries.push(
          applyCheckRunDrift(
            {
              expected: planItem.checkRunProjection,
              actual: checkRunRecord,
              delivery,
              observedAt,
            },
            driftAlerts,
          ),
        );
        continue;
      }

      throw createDeliveryFailureError(
        'GitHub sync plan item must include an issue, comment, or check-run projection.',
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown GitHub sync failure.';

      driftAlerts.push(
        createDriftAlert({
          alertId: `${delivery.projectionDeliveryId}:delivery_failure`,
          companyId: delivery.companyId,
          aggregateType: delivery.aggregateType,
          aggregateId: delivery.aggregateId,
          candidate: {
            driftClass: 'delivery_failure',
            severity: 'high',
            summary: message,
          },
          sourceEventId: delivery.sourceEventId,
          observedAt,
        }),
      );
      deliveries.push(
        cloneDelivery(delivery, {
          status: 'failed',
          updatedAt: observedAt,
          lastError: message,
        }),
      );
    }
  }

  return {
    bindings: [...bindings.values()],
    deliveries,
    driftAlerts,
    syncEvents: deliveries.map(toSyncEvent),
    projectionHealth: deriveProjectionHealth({
      companyId: input.installation.companyId,
      deliveries,
      driftAlerts,
    }),
  };
}
