export type ReleaseCheckStatus = 'queued' | 'in_progress' | 'completed';

export type ReleaseCheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | null;

export interface ReleaseCheckObservation {
  name: string;
  status: ReleaseCheckStatus;
  conclusion: ReleaseCheckConclusion;
}

export interface ReleaseEvidenceInput {
  mainProtected: boolean;
  releaseProtected: boolean;
  requiredChecks: string[];
  observedChecks: ReleaseCheckObservation[];
  requiredDocs: string[];
  publishedDocs: string[];
  releaseBranch?: string;
  tagName?: string;
  releasePublished: boolean;
  blockingIssues: string[];
}

export interface ReleaseReadinessReport {
  ready: boolean;
  blockingFindings: string[];
  checks: {
    required: string[];
    observed: string[];
    missing: string[];
    failing: string[];
  };
  docs: {
    required: string[];
    published: string[];
    missing: string[];
  };
  release: {
    branch?: string;
    tagName?: string;
    published: boolean;
  };
  blockingIssues: string[];
}

function normalize(value: string): string {
  return value.trim();
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = normalize(rawValue);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

export function summarizeRequiredChecks(checks: string[]): string[] {
  return [...uniqueOrdered(checks)].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function evaluateReleaseReadiness(
  input: ReleaseEvidenceInput,
): ReleaseReadinessReport {
  const requiredChecks = uniqueOrdered(input.requiredChecks);
  const requiredDocs = uniqueOrdered(input.requiredDocs);
  const publishedDocs = uniqueOrdered(input.publishedDocs);

  const observedByName = new Map<string, ReleaseCheckObservation>();
  for (const check of input.observedChecks) {
    const name = normalize(check.name);
    if (!name || observedByName.has(name)) {
      continue;
    }
    observedByName.set(name, {
      ...check,
      name,
    });
  }

  const failingChecks = requiredChecks.filter((name) => {
    const observed = observedByName.get(name);
    if (!observed) {
      return false;
    }
    return (
      observed.status === 'completed' &&
      observed.conclusion !== 'success' &&
      observed.conclusion !== null
    );
  });

  const missingChecks = requiredChecks.filter((name) => {
    const observed = observedByName.get(name);
    if (!observed) {
      return true;
    }
    if (
      observed.status === 'completed' &&
      observed.conclusion !== null &&
      observed.conclusion !== 'success'
    ) {
      return false;
    }
    return !(
      observed.status === 'completed' && observed.conclusion === 'success'
    );
  });

  const missingDocs = requiredDocs.filter(
    (docPath) => !publishedDocs.includes(docPath),
  );

  const blockingFindings: string[] = [];

  if (!input.mainProtected) {
    blockingFindings.push('Main branch protection is not active.');
  }

  if (!input.releaseProtected || missingChecks.length > 0) {
    blockingFindings.push(
      'Release branch protection is missing one or more required passing checks.',
    );
  }

  if (missingDocs.length > 0) {
    blockingFindings.push('Required operational documentation is incomplete.');
  }

  if (!input.releaseBranch) {
    blockingFindings.push('No release branch is recorded for this candidate.');
  }

  if (!input.tagName) {
    blockingFindings.push('No release tag is published for this candidate.');
  }

  if (!input.releasePublished) {
    blockingFindings.push('No GitHub release is published for this candidate.');
  }

  if (input.blockingIssues.length > 0) {
    blockingFindings.push('Blocking GitHub issues remain open.');
  }

  return {
    ready: blockingFindings.length === 0,
    blockingFindings,
    checks: {
      required: requiredChecks,
      observed: [...observedByName.keys()].sort((left, right) =>
        left.localeCompare(right),
      ),
      missing: missingChecks,
      failing: failingChecks,
    },
    docs: {
      required: requiredDocs,
      published: publishedDocs,
      missing: missingDocs,
    },
    release: {
      branch: input.releaseBranch,
      tagName: input.tagName,
      published: input.releasePublished,
    },
    blockingIssues: [...input.blockingIssues],
  };
}
