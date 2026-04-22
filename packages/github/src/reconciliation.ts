import { parseMetadataBlock } from './metadata';
import type {
  GitHubCommandIntent,
  GitHubInboundEventRecord,
  GitHubProjectionMetadata,
} from './types';

interface GitHubInboundPayloadContext {
  metadata: GitHubProjectionMetadata | null;
  body: string | null;
}

interface GitHubActorIdentity {
  login: string | null;
  type: string | null;
  htmlUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractActorIdentity(value: unknown): GitHubActorIdentity | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    login: asString(value.login),
    type: asString(value.type),
    htmlUrl: asString(value.html_url),
  };
}

function extractBodyMetadata(
  payload: Record<string, unknown>,
): GitHubInboundPayloadContext {
  const issue = isRecord(payload.issue) ? payload.issue : null;
  const comment = isRecord(payload.comment) ? payload.comment : null;
  const review = isRecord(payload.review) ? payload.review : null;
  const pullRequest = isRecord(payload.pull_request)
    ? payload.pull_request
    : null;
  const issueBody = asString(issue?.body);
  const commentBody = asString(comment?.body);
  const reviewBody = asString(review?.body);
  const pullRequestBody = asString(pullRequest?.body);

  return {
    metadata:
      parseMetadataBlock(issueBody) ??
      parseMetadataBlock(commentBody) ??
      parseMetadataBlock(reviewBody) ??
      parseMetadataBlock(pullRequestBody),
    body: commentBody ?? reviewBody ?? issueBody ?? pullRequestBody,
  };
}

function parseSlashCommand(
  body: string | null,
  metadata: GitHubProjectionMetadata | null,
): GitHubCommandIntent | null {
  if (!body || !metadata) {
    return null;
  }

  const command = body.trim().split(/\s+/u)[0]?.toLowerCase();

  if (!command?.startsWith('/')) {
    return null;
  }

  const commandType =
    command === '/approve'
      ? 'approval.grant'
      : command === '/deny'
        ? 'approval.deny'
        : command === '/cancel'
          ? 'work_item.cancel'
          : command === '/requeue'
            ? 'work_item.requeue'
            : null;

  if (!commandType) {
    return null;
  }

  if (
    commandType.startsWith('approval.') &&
    metadata.aggregateType !== 'approval'
  ) {
    return null;
  }

  if (
    commandType.startsWith('work_item.') &&
    metadata.aggregateType !== 'work_item'
  ) {
    return null;
  }

  return {
    commandType,
    aggregateType: metadata.aggregateType,
    aggregateId: metadata.aggregateId,
  };
}

function parseLabelIntent(
  payload: Record<string, unknown>,
  action: string | null | undefined,
  metadata: GitHubProjectionMetadata | null,
): GitHubCommandIntent | null {
  if (
    action !== 'labeled' ||
    !metadata ||
    metadata.aggregateType !== 'work_item'
  ) {
    return null;
  }

  const label = isRecord(payload.label) ? payload.label : null;
  const name = asString(label?.name)?.toLowerCase();

  if (name === 'operator:cancel') {
    return {
      commandType: 'work_item.cancel',
      aggregateType: 'work_item',
      aggregateId: metadata.aggregateId,
    };
  }

  if (name === 'operator:requeue') {
    return {
      commandType: 'work_item.requeue',
      aggregateType: 'work_item',
      aggregateId: metadata.aggregateId,
    };
  }

  return null;
}

function extractProtectedObjectActor(input: {
  payload: Record<string, unknown>;
  githubEventName: string;
}): GitHubActorIdentity | null {
  if (input.githubEventName === 'issues') {
    const issue = isRecord(input.payload.issue) ? input.payload.issue : null;
    return extractActorIdentity(issue?.user);
  }

  if (input.githubEventName === 'issue_comment') {
    const comment = isRecord(input.payload.comment)
      ? input.payload.comment
      : null;
    return extractActorIdentity(comment?.user);
  }

  if (input.githubEventName === 'pull_request') {
    const pullRequest = isRecord(input.payload.pull_request)
      ? input.payload.pull_request
      : null;
    return extractActorIdentity(pullRequest?.user);
  }

  return null;
}

function isGitHubAppBotIdentity(actor: GitHubActorIdentity | null): boolean {
  if (!actor) {
    return false;
  }

  return (
    actor.type === 'Bot' &&
    actor.login !== null &&
    actor.htmlUrl !== null &&
    actor.htmlUrl.includes('/apps/')
  );
}

function matchesActorIdentity(
  left: GitHubActorIdentity | null,
  right: GitHubActorIdentity | null,
): boolean {
  if (!left || !right) {
    return false;
  }

  if (
    left.login?.toLowerCase() !== right.login?.toLowerCase() ||
    left.type !== right.type
  ) {
    return false;
  }

  if (left.htmlUrl && right.htmlUrl) {
    return left.htmlUrl === right.htmlUrl;
  }

  return true;
}

export function classifyGitHubInboundEvent(input: {
  inboundEventId: string;
  githubDeliveryId: string;
  githubEventName: string;
  action?: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
}): GitHubInboundEventRecord {
  const context = extractBodyMetadata(input.payload);
  const metadata = context.metadata;
  const action = input.action ?? undefined;
  const payloadJson = input.payload as Record<string, unknown>;
  const sender = extractActorIdentity(payloadJson.sender);
  const protectedObjectActor = extractProtectedObjectActor({
    payload: payloadJson,
    githubEventName: input.githubEventName,
  });
  const issueState = asString(
    isRecord(payloadJson.issue) ? payloadJson.issue.state : undefined,
  );
  const reviewState = asString(
    isRecord(payloadJson.review) ? payloadJson.review.state : undefined,
  )?.toLowerCase();

  const baseRecord: GitHubInboundEventRecord = {
    inboundEventId: input.inboundEventId,
    githubDeliveryId: input.githubDeliveryId,
    githubEventName: input.githubEventName,
    action,
    companyId: metadata?.companyId,
    aggregateType: metadata?.aggregateType,
    aggregateId: metadata?.aggregateId,
    classification: 'ignored',
    status: 'recorded',
    payload: {
      ...payloadJson,
      receivedAt: input.receivedAt,
    },
    createdAt: input.receivedAt,
  };

  const slashIntent = parseSlashCommand(context.body, metadata);
  if (slashIntent) {
    return {
      ...baseRecord,
      classification: 'accepted_intent',
      proposedCommand: slashIntent,
      notes: 'Accepted structured slash-command intent from GitHub.',
    };
  }

  const labelIntent = parseLabelIntent(payloadJson, action, metadata);
  if (labelIntent && input.githubEventName === 'issues') {
    return {
      ...baseRecord,
      classification: 'accepted_intent',
      proposedCommand: labelIntent,
      notes: 'Accepted GitHub label intent from the allowlist.',
    };
  }

  if (
    input.githubEventName === 'pull_request_review' &&
    metadata?.aggregateType === 'approval' &&
    (reviewState === 'approved' || reviewState === 'changes_requested')
  ) {
    return {
      ...baseRecord,
      classification: 'accepted_intent',
      proposedCommand: {
        commandType:
          reviewState === 'approved' ? 'approval.grant' : 'approval.deny',
        aggregateType: 'approval',
        aggregateId: metadata.aggregateId,
      },
      notes: 'Accepted structured review intent from GitHub review state.',
    };
  }

  const protectedMutation =
    (input.githubEventName === 'issues' &&
      ['edited', 'closed', 'reopened'].includes(action ?? '')) ||
    (input.githubEventName === 'issue_comment' &&
      ['deleted'].includes(action ?? '')) ||
    (input.githubEventName === 'pull_request' &&
      ['edited', 'closed', 'reopened'].includes(action ?? ''));

  if (!metadata && protectedMutation) {
    return {
      ...baseRecord,
      classification: 'missing_linkage',
      status: 'requires_review',
      notes:
        'Protected GitHub activity arrived without canonical linkage metadata.',
    };
  }

  if (metadata && protectedMutation) {
    if (
      isGitHubAppBotIdentity(sender) &&
      isGitHubAppBotIdentity(protectedObjectActor) &&
      matchesActorIdentity(sender, protectedObjectActor)
    ) {
      return {
        ...baseRecord,
        classification: 'benign_divergence',
        notes:
          'Self-authored GitHub App projection update recorded for audit without opening drift.',
      };
    }

    const notes =
      issueState && ['closed', 'open'].includes(issueState)
        ? `Protected GitHub surface mutated issue state to ${issueState}.`
        : 'Protected GitHub surface changed outside the allowed command paths.';

    return {
      ...baseRecord,
      classification: 'authoritative_conflict',
      status: 'reproject_required',
      notes,
    };
  }

  if (metadata) {
    return {
      ...baseRecord,
      classification: 'benign_divergence',
      notes:
        'GitHub activity recorded for audit without changing kernel truth.',
    };
  }

  return {
    ...baseRecord,
    classification: 'ignored',
    notes:
      'GitHub activity did not map to a safe inbound command or linked aggregate.',
  };
}
