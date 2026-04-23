import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ReleaseCheckObservation,
  evaluateReleaseReadiness,
  summarizeRequiredChecks,
} from '../packages/github/src/releaseReadiness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_REPO = 'escalonalabs/agents-company-escalona-labs';
const MAIN_RULESET_NAME = 'Main Branch Protection';
const RELEASE_RULESET_NAME = 'Release Candidate Protection';
const REQUIRED_CHECKS = summarizeRequiredChecks([
  'quality',
  'ops-validation',
  'bootstrap-smoke',
  'integration-smokes',
  'self-hosted-smoke',
  'repo-guardrails',
  'dependency-review',
  'secret-scan',
  'replay-regression',
]);
const MILESTONE_TITLES = [
  'M15 Production Infrastructure and Reliability',
  'M16 Internal Alpha and Controlled Beta',
  'M17 General Availability',
  'M18 Launch Evidence and Activation',
];

interface CliOptions {
  repo: string;
  semanticVersion: string;
  tagName: string;
  releaseBranch: string;
  outputDir: string;
  milestoneTitles: string[];
}

interface VersionAlignment {
  expectedVersion: string;
  packageVersions: Array<{ path: string; version: string }>;
  chartVersion: string | null;
  chartAppVersion: string | null;
  stagingImageTags: string[];
  productionImageTags: string[];
  immutableEcrConfigured: boolean;
  mismatches: string[];
}

interface ReleaseEvidenceFile {
  generatedAt: string;
  repo: string;
  version: {
    semanticVersion: string;
    tagName: string;
    releaseBranch: string;
    commitSha?: string;
  };
  milestones: Array<{
    title: string;
    number?: number;
    issues: Array<{ number: number; title: string; url: string }>;
    missing: boolean;
  }>;
  readiness: ReturnType<typeof evaluateReleaseReadiness>;
  versionAlignment: VersionAlignment;
  release: {
    published: boolean;
    url?: string;
    isDraft?: boolean;
    isPrerelease?: boolean;
  };
}

function parseCliArgs(argv: string[]): CliOptions {
  const provided = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const inlineValueIndex = arg.indexOf('=');
    if (inlineValueIndex > -1) {
      provided.set(
        arg.slice(2, inlineValueIndex),
        arg.slice(inlineValueIndex + 1),
      );
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      provided.set(arg.slice(2), 'true');
      continue;
    }

    provided.set(arg.slice(2), next);
    index += 1;
  }

  const rawVersion = provided.get('version');
  if (!rawVersion) {
    throw new Error('--version is required. Example: --version v0.1.0');
  }

  const semanticVersion = rawVersion.startsWith('v')
    ? rawVersion.slice(1)
    : rawVersion;
  const tagName = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
  const releaseBranch = provided.get('release-branch') ?? `release/${tagName}`;
  const outputDir =
    provided.get('output-dir') ??
    join(REPO_ROOT, 'artifacts', 'releases', tagName);
  const milestoneTitles = (
    provided
      .get('milestones')
      ?.split(',')
      .map((value) => value.trim()) ?? MILESTONE_TITLES
  ).filter(Boolean);

  return {
    repo: provided.get('repo') ?? DEFAULT_REPO,
    semanticVersion,
    tagName,
    releaseBranch,
    outputDir,
    milestoneTitles,
  };
}

function runCommand(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_PAGER: 'cat',
    },
  }).trim();
}

function tryRunJson(command: string, args: string[]) {
  try {
    const output = runCommand(command, args);
    return output ? JSON.parse(output) : null;
  } catch {
    return null;
  }
}

function fileExists(path: string) {
  return existsSync(join(REPO_ROOT, path));
}

async function readJson(path: string) {
  const raw = await readFile(join(REPO_ROOT, path), 'utf8');
  return JSON.parse(raw) as { version?: string };
}

async function readChartVersions() {
  const raw = await readFile(
    join(REPO_ROOT, 'charts/agents-company/Chart.yaml'),
    'utf8',
  );

  const chartVersion = raw.match(/^version:\s*([^\s]+)\s*$/m)?.[1] ?? null;
  const chartAppVersion =
    raw.match(/^appVersion:\s*"?(.*?)"?\s*$/m)?.[1] ?? null;

  return {
    chartVersion,
    chartAppVersion,
  };
}

async function readYamlImageTags(relativePath: string) {
  const raw = await readFile(join(REPO_ROOT, relativePath), 'utf8');
  return [...raw.matchAll(/^\s*tag:\s*([^\s]+)\s*$/gm)].map((match) =>
    match[1]?.replace(/^"|"$/g, ''),
  );
}

async function evaluateVersionAlignment(
  semanticVersion: string,
  tagName: string,
): Promise<VersionAlignment> {
  const packageJsonPaths = [
    'package.json',
    'apps/control-web/package.json',
    'packages/domain/package.json',
    'packages/execution/package.json',
    'packages/github/package.json',
    'packages/kernel/package.json',
    'packages/memory/package.json',
    'packages/orchestration/package.json',
    'packages/sdk/package.json',
    'packages/ui/package.json',
    'server/control-plane/package.json',
    'server/github-app/package.json',
  ];

  const packageVersions = await Promise.all(
    packageJsonPaths.map(async (path) => ({
      path,
      version: (await readJson(path)).version ?? 'missing',
    })),
  );
  const chartVersions = await readChartVersions();
  const stagingImageTags = await readYamlImageTags(
    'charts/agents-company/values-staging.yaml',
  );
  const productionImageTags = await readYamlImageTags(
    'charts/agents-company/values-production.yaml',
  );
  const infraRaw = await readFile(join(REPO_ROOT, 'infra/aws/main.tf'), 'utf8');
  const immutableMatches = infraRaw.match(
    /image_tag_mutability\s*=\s*"IMMUTABLE"/g,
  );
  const mismatches: string[] = [];

  for (const entry of packageVersions) {
    if (entry.version !== semanticVersion) {
      mismatches.push(
        `${entry.path} version is ${entry.version}, expected ${semanticVersion}.`,
      );
    }
  }

  if (chartVersions.chartVersion !== semanticVersion) {
    mismatches.push(
      `charts/agents-company/Chart.yaml version is ${chartVersions.chartVersion}, expected ${semanticVersion}.`,
    );
  }

  if (chartVersions.chartAppVersion !== semanticVersion) {
    mismatches.push(
      `charts/agents-company/Chart.yaml appVersion is ${chartVersions.chartAppVersion}, expected ${semanticVersion}.`,
    );
  }

  if (stagingImageTags.some((value) => value !== tagName)) {
    mismatches.push(
      `charts/agents-company/values-staging.yaml must use immutable image tag ${tagName}.`,
    );
  }

  if (productionImageTags.some((value) => value !== tagName)) {
    mismatches.push(
      `charts/agents-company/values-production.yaml must use immutable image tag ${tagName}.`,
    );
  }

  if ((immutableMatches?.length ?? 0) < 3) {
    mismatches.push(
      'infra/aws/main.tf must configure every ECR repository with IMMUTABLE tags.',
    );
  }

  return {
    expectedVersion: semanticVersion,
    packageVersions,
    chartVersion: chartVersions.chartVersion,
    chartAppVersion: chartVersions.chartAppVersion,
    stagingImageTags,
    productionImageTags,
    immutableEcrConfigured: (immutableMatches?.length ?? 0) >= 3,
    mismatches,
  };
}

function readRulesets(repo: string) {
  return (
    (tryRunJson('gh', ['api', `repos/${repo}/rulesets`]) as Array<{
      name?: string;
      enforcement?: string;
    }> | null) ?? []
  );
}

function ruleActive(
  rulesets: Array<{ name?: string; enforcement?: string }>,
  targetName: string,
) {
  return rulesets.some(
    (rule) => rule.name === targetName && rule.enforcement === 'active',
  );
}

function readBranchHeadSha(repo: string, releaseBranch: string) {
  const result = tryRunJson('gh', [
    'api',
    `repos/${repo}/branches/${releaseBranch}`,
  ]) as { commit?: { sha?: string } } | null;

  return result?.commit?.sha;
}

function readCheckRuns(
  repo: string,
  commitSha?: string,
): ReleaseCheckObservation[] {
  if (!commitSha) {
    return [];
  }

  const result = tryRunJson('gh', [
    'api',
    `repos/${repo}/commits/${commitSha}/check-runs`,
    '-H',
    'Accept: application/vnd.github+json',
  ]) as {
    check_runs?: Array<{
      name?: string;
      status?: ReleaseCheckObservation['status'];
      conclusion?: ReleaseCheckObservation['conclusion'];
    }>;
  } | null;

  return (result?.check_runs ?? [])
    .filter((item) => item.name)
    .map((item) => ({
      name: String(item.name),
      status: item.status ?? 'queued',
      conclusion: item.conclusion ?? null,
    }));
}

function readMilestones(repo: string) {
  return (
    (tryRunJson('gh', [
      'api',
      `repos/${repo}/milestones?state=all&per_page=100`,
    ]) as Array<{
      title?: string;
      number?: number;
      state?: string;
    }> | null) ?? []
  );
}

function readOpenIssuesForMilestone(repo: string, milestoneNumber: number) {
  return (
    (tryRunJson('gh', [
      'api',
      `repos/${repo}/issues?state=open&milestone=${String(
        milestoneNumber,
      )}&per_page=100`,
    ]) as Array<{
      number?: number;
      title?: string;
      html_url?: string;
      pull_request?: unknown;
    }> | null) ?? []
  );
}

function readRelease(repo: string, tagName: string) {
  return tryRunJson('gh', [
    'release',
    'view',
    tagName,
    '--repo',
    repo,
    '--json',
    'tagName,url,isDraft,isPrerelease',
  ]) as {
    tagName?: string;
    url?: string;
    isDraft?: boolean;
    isPrerelease?: boolean;
  } | null;
}

function readRemoteTag(repo: string, tagName: string) {
  return tryRunJson('gh', ['api', `repos/${repo}/git/ref/tags/${tagName}`]);
}

function renderSummary(input: ReleaseEvidenceFile) {
  const milestoneLines = input.milestones.map((milestone) => {
    if (milestone.missing) {
      return `- ${milestone.title}: missing milestone`;
    }

    if (milestone.issues.length === 0) {
      return `- ${milestone.title}: clear`;
    }

    return `- ${milestone.title}: ${milestone.issues
      .map((issue) => `#${issue.number} ${issue.title}`)
      .join(', ')}`;
  });

  const mismatchLines =
    input.versionAlignment.mismatches.length > 0
      ? input.versionAlignment.mismatches.map((item) => `- ${item}`)
      : ['- none'];

  const findingLines =
    input.readiness.blockingFindings.length > 0
      ? input.readiness.blockingFindings.map((item) => `- ${item}`)
      : ['- none'];

  return [
    `# Release Evidence ${input.version.tagName}`,
    '',
    `- Generated at: ${input.generatedAt}`,
    `- Repo: \`${input.repo}\``,
    `- Release branch: \`${input.version.releaseBranch}\``,
    `- Commit: \`${input.version.commitSha ?? 'missing'}\``,
    `- Ready: \`${String(
      input.readiness.ready && input.versionAlignment.mismatches.length === 0,
    )}\``,
    '',
    '## Blocking findings',
    ...findingLines,
    '',
    '## Version alignment',
    ...mismatchLines,
    '',
    '## Required checks',
    `- Required: ${input.readiness.checks.required.join(', ')}`,
    `- Missing: ${input.readiness.checks.missing.join(', ') || 'none'}`,
    `- Failing: ${input.readiness.checks.failing.join(', ') || 'none'}`,
    '',
    '## Required docs',
    `- Missing: ${input.readiness.docs.missing.join(', ') || 'none'}`,
    '',
    '## Milestones',
    ...milestoneLines,
    '',
    '## Release state',
    `- Remote tag present: \`${String(Boolean(input.readiness.release.tagName))}\``,
    `- GitHub release published: \`${String(input.release.published)}\``,
    `- Release URL: ${input.release.url ?? 'not published'}`,
    `- Draft release: \`${String(input.release.isDraft ?? false)}\``,
    `- Prerelease: \`${String(input.release.isPrerelease ?? false)}\``,
    '',
  ].join('\n');
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const releaseNotesPath = `docs/releases/${options.tagName}.md`;
  const requiredDocs = [
    'docs/operations/ga-runbook.md',
    'docs/operations/release-train.md',
    'docs/operations/support-and-oncall.md',
    'docs/operations/hosted-aws.md',
    'docs/operations/self-hosted.md',
    'docs/operations/hosted-rotation-and-drills.md',
    'docs/operations/monitoring-dashboards.md',
    'ops/monitoring/grafana/agents-company-overview.json',
    releaseNotesPath,
  ];
  const publishedDocs = requiredDocs.filter((path) => fileExists(path));
  const rulesets = readRulesets(options.repo);
  const mainProtected = ruleActive(rulesets, MAIN_RULESET_NAME);
  const releaseProtected = ruleActive(rulesets, RELEASE_RULESET_NAME);
  const commitSha = readBranchHeadSha(options.repo, options.releaseBranch);
  const observedChecks = readCheckRuns(options.repo, commitSha);
  const releaseInfo = readRelease(options.repo, options.tagName);
  const tagExists = Boolean(readRemoteTag(options.repo, options.tagName));
  const allMilestones = readMilestones(options.repo);

  const milestoneReports = options.milestoneTitles.map((title) => {
    const milestone = allMilestones.find((item) => item.title === title);
    if (!milestone?.number) {
      return {
        title,
        missing: true,
        issues: [],
      };
    }

    const issues = readOpenIssuesForMilestone(options.repo, milestone.number)
      .filter((item) => !item.pull_request)
      .map((item) => ({
        number: item.number ?? 0,
        title: item.title ?? 'Untitled issue',
        url: item.html_url ?? '',
      }));

    return {
      title,
      number: milestone.number,
      missing: false,
      issues,
    };
  });

  const blockingIssues = milestoneReports.flatMap((milestone) => {
    if (milestone.missing) {
      return [`Missing GitHub milestone: ${milestone.title}`];
    }

    return milestone.issues.map((issue) => `#${issue.number} ${issue.title}`);
  });

  const readiness = evaluateReleaseReadiness({
    mainProtected,
    releaseProtected,
    requiredChecks: REQUIRED_CHECKS,
    observedChecks,
    requiredDocs,
    publishedDocs,
    releaseBranch: commitSha ? options.releaseBranch : undefined,
    tagName: tagExists ? options.tagName : undefined,
    releasePublished: Boolean(releaseInfo && !releaseInfo.isDraft),
    blockingIssues,
  });
  const versionAlignment = await evaluateVersionAlignment(
    options.semanticVersion,
    options.tagName,
  );
  const evidence: ReleaseEvidenceFile = {
    generatedAt: new Date().toISOString(),
    repo: options.repo,
    version: {
      semanticVersion: options.semanticVersion,
      tagName: options.tagName,
      releaseBranch: options.releaseBranch,
      commitSha,
    },
    milestones: milestoneReports,
    readiness,
    versionAlignment,
    release: {
      published: Boolean(releaseInfo && !releaseInfo.isDraft),
      url: releaseInfo?.url,
      isDraft: releaseInfo?.isDraft,
      isPrerelease: releaseInfo?.isPrerelease,
    },
  };
  const summary = renderSummary(evidence);

  await mkdir(options.outputDir, { recursive: true });
  await writeFile(
    join(options.outputDir, 'readiness.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(options.outputDir, 'SUMMARY.md'),
    `${summary}\n`,
    'utf8',
  );

  process.stdout.write(`${summary}\n`);

  if (!readiness.ready || versionAlignment.mismatches.length > 0) {
    process.exitCode = 1;
  }
}

await main();
