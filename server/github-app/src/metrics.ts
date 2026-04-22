import type { GitHubAppConfig } from './config';
import type { GitHubWebhookTelemetrySnapshot } from './telemetry';

function asMetricFlag(value: boolean): number {
  return value ? 1 : 0;
}

function createMetricLines(input: {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  value: number;
}) {
  return [
    `# HELP ${input.name} ${input.help}`,
    `# TYPE ${input.name} ${input.type}`,
    `${input.name} ${input.value}`,
  ];
}

function asUnixSeconds(value: string | undefined | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp / 1000 : 0;
}

export function renderGitHubAppPrometheusMetrics(input: {
  config: GitHubAppConfig;
  telemetry: GitHubWebhookTelemetrySnapshot;
}): string {
  const lines = [
    ...createMetricLines({
      name: 'agents_company_github_app_up',
      help: 'GitHub app process health indicator.',
      type: 'gauge',
      value: 1,
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_credentials_ready',
      help: 'GitHub app credentials readiness flag.',
      type: 'gauge',
      value: asMetricFlag(input.config.readiness.appCredentialsReady),
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_webhook_verification_ready',
      help: 'GitHub webhook verification readiness flag.',
      type: 'gauge',
      value: asMetricFlag(input.config.readiness.webhookVerificationReady),
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_control_plane_ready',
      help: 'GitHub app control-plane connectivity readiness flag.',
      type: 'gauge',
      value: asMetricFlag(input.config.readiness.controlPlaneReady),
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_accepted_deliveries_total',
      help: 'Accepted GitHub webhook deliveries since process start.',
      type: 'counter',
      value: input.telemetry.acceptedDeliveries,
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_rejected_deliveries_total',
      help: 'Rejected GitHub webhook deliveries since process start.',
      type: 'counter',
      value: input.telemetry.rejectedDeliveries,
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_uptime_seconds',
      help: 'GitHub app process uptime in seconds.',
      type: 'gauge',
      value: process.uptime(),
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_started_at_seconds',
      help: 'GitHub app process start time as Unix seconds.',
      type: 'gauge',
      value: asUnixSeconds(input.telemetry.startedAt),
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_last_delivery_timestamp_seconds',
      help: 'Last accepted GitHub webhook delivery timestamp as Unix seconds.',
      type: 'gauge',
      value: asUnixSeconds(input.telemetry.lastDelivery?.receivedAt),
    }),
    ...createMetricLines({
      name: 'agents_company_github_app_last_rejection_timestamp_seconds',
      help: 'Last rejected GitHub webhook timestamp as Unix seconds.',
      type: 'gauge',
      value: asUnixSeconds(input.telemetry.lastRejection?.receivedAt),
    }),
  ];

  return `${lines.join('\n')}\n`;
}
