import type { GitHubWebhookEnvelope } from './webhook';

export interface GitHubWebhookTelemetrySnapshot {
  acceptedDeliveries: number;
  rejectedDeliveries: number;
  startedAt: string;
  lastDelivery: GitHubWebhookEnvelope | null;
  lastRejection: {
    reason: string;
    receivedAt: string;
  } | null;
}

export function createGitHubWebhookTelemetry() {
  const startedAt = new Date().toISOString();
  let acceptedDeliveries = 0;
  let rejectedDeliveries = 0;
  let lastDelivery: GitHubWebhookEnvelope | null = null;
  let lastRejection: GitHubWebhookTelemetrySnapshot['lastRejection'] = null;

  return {
    recordAccepted(delivery: GitHubWebhookEnvelope) {
      acceptedDeliveries += 1;
      lastDelivery = delivery;
    },
    recordRejected(reason: string, receivedAt = new Date().toISOString()) {
      rejectedDeliveries += 1;
      lastRejection = {
        reason,
        receivedAt,
      };
    },
    snapshot(): GitHubWebhookTelemetrySnapshot {
      return {
        acceptedDeliveries,
        rejectedDeliveries,
        startedAt,
        lastDelivery,
        lastRejection,
      };
    },
  };
}
