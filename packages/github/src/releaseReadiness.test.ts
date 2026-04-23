import { describe, expect, it } from 'vitest';

import {
  type ReleaseEvidenceInput,
  evaluateReleaseReadiness,
  summarizeRequiredChecks,
} from './releaseReadiness';

function createBaseInput(): ReleaseEvidenceInput {
  return {
    mainProtected: true,
    releaseProtected: true,
    requiredChecks: ['quality', 'replay-regression', 'self-hosted-smoke'],
    observedChecks: [
      { name: 'quality', status: 'completed', conclusion: 'success' },
      {
        name: 'replay-regression',
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'self-hosted-smoke',
        status: 'completed',
        conclusion: 'success',
      },
    ],
    requiredDocs: [
      'docs/operations/ga-runbook.md',
      'docs/operations/release-train.md',
      'docs/operations/support-and-oncall.md',
      'docs/operations/hosted-aws.md',
      'docs/operations/self-hosted.md',
    ],
    publishedDocs: [
      'docs/operations/ga-runbook.md',
      'docs/operations/release-train.md',
      'docs/operations/support-and-oncall.md',
      'docs/operations/hosted-aws.md',
      'docs/operations/self-hosted.md',
    ],
    releaseBranch: 'release/v0.1.0',
    tagName: 'v0.1.0',
    releasePublished: true,
    blockingIssues: [],
  };
}

describe('release readiness helpers', () => {
  it('marks the release ready when protections, checks, docs, and artifacts exist', () => {
    const result = evaluateReleaseReadiness(createBaseInput());

    expect(result.ready).toBe(true);
    expect(result.blockingFindings).toEqual([]);
    expect(result.checks.missing).toEqual([]);
    expect(result.checks.failing).toEqual([]);
  });

  it('fails closed when protections, checks, docs, or release artifacts are missing', () => {
    const result = evaluateReleaseReadiness({
      ...createBaseInput(),
      mainProtected: false,
      observedChecks: [
        { name: 'quality', status: 'completed', conclusion: 'failure' },
        { name: 'replay-regression', status: 'in_progress', conclusion: null },
      ],
      publishedDocs: ['docs/operations/ga-runbook.md'],
      releaseBranch: undefined,
      tagName: undefined,
      releasePublished: false,
      blockingIssues: [
        'AC-1501 Deliver M15 Production Infrastructure and Reliability',
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.blockingFindings).toContain(
      'Main branch protection is not active.',
    );
    expect(result.blockingFindings).toContain(
      'Release branch protection is missing one or more required passing checks.',
    );
    expect(result.blockingFindings).toContain(
      'Required operational documentation is incomplete.',
    );
    expect(result.blockingFindings).toContain(
      'No release branch is recorded for this candidate.',
    );
    expect(result.blockingFindings).toContain(
      'No release tag is published for this candidate.',
    );
    expect(result.blockingFindings).toContain(
      'No GitHub release is published for this candidate.',
    );
    expect(result.blockingFindings).toContain(
      'Blocking GitHub issues remain open.',
    );
    expect(result.checks.failing).toEqual(['quality']);
    expect(result.checks.missing).toEqual([
      'replay-regression',
      'self-hosted-smoke',
    ]);
    expect(result.docs.missing).toEqual([
      'docs/operations/release-train.md',
      'docs/operations/support-and-oncall.md',
      'docs/operations/hosted-aws.md',
      'docs/operations/self-hosted.md',
    ]);
  });

  it('summarizes required checks deterministically', () => {
    expect(
      summarizeRequiredChecks([
        'replay-regression',
        'quality',
        'quality',
        'bootstrap-smoke',
      ]),
    ).toEqual(['bootstrap-smoke', 'quality', 'replay-regression']);
  });
});
