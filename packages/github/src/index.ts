import type { GitHubSyncEvent } from '@escalonalabs/domain';

export interface IssueProjection {
  title: string;
  body: string;
  labels: string[];
}

export function createIssueProjection(input: {
  objectiveTitle: string;
  summary: string;
  labels?: string[];
}): IssueProjection {
  return {
    title: input.objectiveTitle,
    body: input.summary,
    labels: input.labels ?? [],
  };
}

export function toSyncEvent(input: GitHubSyncEvent): GitHubSyncEvent {
  return input;
}
