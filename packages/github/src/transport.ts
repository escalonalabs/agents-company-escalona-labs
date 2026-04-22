import { createGitHubAppJwt } from './auth';
import type {
  GitHubCheckRunProjection,
  GitHubCheckRunRecord,
  GitHubCommentProjection,
  GitHubCommentRecord,
  GitHubIssueProjection,
  GitHubIssueRecord,
  GitHubRepositoryRef,
  GitHubTransport,
} from './types';

interface GitHubApiRequestInit {
  method?: string;
  body?: Record<string, unknown>;
}

function createRepositoryPath(
  repository: GitHubRepositoryRef,
  suffix: string,
): string {
  return `/repos/${repository.owner}/${repository.name}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toIssueRecord(
  repository: GitHubRepositoryRef,
  payload: Record<string, unknown>,
): GitHubIssueRecord {
  const labels = Array.isArray(payload.labels)
    ? payload.labels
        .map((label) =>
          isRecord(label)
            ? typeof label.name === 'string'
              ? label.name
              : null
            : typeof label === 'string'
              ? label
              : null,
        )
        .filter((label): label is string => Boolean(label))
    : [];

  return {
    id: String(payload.id),
    number: Number(payload.number),
    repository,
    title: String(payload.title ?? ''),
    body: String(payload.body ?? ''),
    labels,
    state: payload.state === 'closed' ? 'closed' : 'open',
  };
}

function toCommentRecord(
  repository: GitHubRepositoryRef,
  payload: Record<string, unknown>,
): GitHubCommentRecord {
  const issueUrl =
    typeof payload.issue_url === 'string' ? payload.issue_url : '';
  const issueNumber = Number(issueUrl.split('/').at(-1) ?? 0);

  return {
    id: String(payload.id),
    repository,
    issueNumber,
    body: String(payload.body ?? ''),
  };
}

function toCheckRunRecord(
  repository: GitHubRepositoryRef,
  payload: Record<string, unknown>,
): GitHubCheckRunRecord {
  const output = isRecord(payload.output) ? payload.output : {};

  return {
    id: String(payload.id),
    repository,
    name: String(payload.name ?? ''),
    headSha:
      typeof payload.head_sha === 'string' && payload.head_sha.length > 0
        ? payload.head_sha
        : undefined,
    status:
      payload.status === 'completed' ||
      payload.status === 'in_progress' ||
      payload.status === 'queued'
        ? payload.status
        : 'queued',
    conclusion:
      typeof payload.conclusion === 'string'
        ? (payload.conclusion as GitHubCheckRunProjection['conclusion'])
        : undefined,
    summary: String(output.summary ?? ''),
    text:
      typeof output.text === 'string' && output.text.length > 0
        ? output.text
        : undefined,
    externalId: String(payload.external_id ?? ''),
  };
}

export async function requestGitHubInstallationAccessToken(input: {
  appId: string | number;
  privateKey: string;
  installationId: number;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
}): Promise<{ token: string; expiresAt?: string }> {
  const fetchFn = input.fetchFn ?? fetch;
  const baseUrl = input.apiBaseUrl ?? 'https://api.github.com';
  const appJwt = createGitHubAppJwt({
    appId: input.appId,
    privateKey: input.privateKey,
  });
  const response = await fetchFn(
    `${baseUrl}/app/installations/${input.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${appJwt}`,
        'User-Agent': 'agents-company-github-app',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub installation token request failed with ${response.status}.`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    token: String(payload.token ?? ''),
    expiresAt:
      typeof payload.expires_at === 'string' ? payload.expires_at : undefined,
  };
}

export function createGitHubRestTransport(input: {
  getToken: () => Promise<string>;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  userAgent?: string;
}): GitHubTransport {
  const baseUrl = input.apiBaseUrl ?? 'https://api.github.com';
  const fetchFn = input.fetchFn ?? fetch;

  async function request<TRecord>(
    repository: GitHubRepositoryRef,
    path: string,
    init: GitHubApiRequestInit,
    mapper: (payload: Record<string, unknown>) => TRecord,
  ): Promise<TRecord> {
    const token = await input.getToken();
    const response = await fetchFn(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': input.userAgent ?? 'agents-company-github-app',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API request failed with ${response.status} for ${path}.`,
      );
    }

    return mapper((await response.json()) as Record<string, unknown>);
  }

  return {
    async getIssue(inputArgs) {
      try {
        return await request(
          inputArgs.repository,
          createRepositoryPath(
            inputArgs.repository,
            `/issues/${inputArgs.issueNumber}`,
          ),
          {},
          (payload) => toIssueRecord(inputArgs.repository, payload),
        );
      } catch {
        return null;
      }
    },
    async createIssue(inputArgs) {
      const createdIssue = await request(
        inputArgs.repository,
        createRepositoryPath(inputArgs.repository, '/issues'),
        {
          method: 'POST',
          body: {
            title: inputArgs.projection.title,
            body: inputArgs.projection.body,
            labels: inputArgs.projection.labels,
          },
        },
        (payload) => toIssueRecord(inputArgs.repository, payload),
      );

      if (inputArgs.projection.state === 'closed') {
        return this.updateIssue({
          repository: inputArgs.repository,
          issueNumber: createdIssue.number,
          projection: inputArgs.projection,
        });
      }

      return createdIssue;
    },
    async updateIssue(inputArgs) {
      return request(
        inputArgs.repository,
        createRepositoryPath(
          inputArgs.repository,
          `/issues/${inputArgs.issueNumber}`,
        ),
        {
          method: 'PATCH',
          body: {
            title: inputArgs.projection.title,
            body: inputArgs.projection.body,
            labels: inputArgs.projection.labels,
            state: inputArgs.projection.state,
          },
        },
        (payload) => toIssueRecord(inputArgs.repository, payload),
      );
    },
    async getComment(inputArgs) {
      try {
        return await request(
          inputArgs.repository,
          createRepositoryPath(
            inputArgs.repository,
            `/issues/comments/${inputArgs.commentId}`,
          ),
          {},
          (payload) => toCommentRecord(inputArgs.repository, payload),
        );
      } catch {
        return null;
      }
    },
    async createComment(inputArgs) {
      return request(
        inputArgs.repository,
        createRepositoryPath(
          inputArgs.repository,
          `/issues/${inputArgs.issueNumber}/comments`,
        ),
        {
          method: 'POST',
          body: {
            body: inputArgs.projection.body,
          },
        },
        (payload) => toCommentRecord(inputArgs.repository, payload),
      );
    },
    async updateComment(inputArgs) {
      return request(
        inputArgs.repository,
        createRepositoryPath(
          inputArgs.repository,
          `/issues/comments/${inputArgs.commentId}`,
        ),
        {
          method: 'PATCH',
          body: {
            body: inputArgs.projection.body,
          },
        },
        (payload) => toCommentRecord(inputArgs.repository, payload),
      );
    },
    async getCheckRun(inputArgs) {
      try {
        return await request(
          inputArgs.repository,
          createRepositoryPath(
            inputArgs.repository,
            `/check-runs/${inputArgs.checkRunId}`,
          ),
          {},
          (payload) => toCheckRunRecord(inputArgs.repository, payload),
        );
      } catch {
        return null;
      }
    },
    async createCheckRun(inputArgs) {
      if (!inputArgs.projection.headSha) {
        throw new Error('GitHub check runs require headSha.');
      }

      return request(
        inputArgs.repository,
        createRepositoryPath(inputArgs.repository, '/check-runs'),
        {
          method: 'POST',
          body: {
            name: inputArgs.projection.name,
            head_sha: inputArgs.projection.headSha,
            status: inputArgs.projection.status,
            conclusion: inputArgs.projection.conclusion,
            external_id: inputArgs.projection.externalId,
            output: {
              title: inputArgs.projection.name,
              summary: inputArgs.projection.summary,
              text: inputArgs.projection.text,
            },
          },
        },
        (payload) => toCheckRunRecord(inputArgs.repository, payload),
      );
    },
    async updateCheckRun(inputArgs) {
      return request(
        inputArgs.repository,
        createRepositoryPath(
          inputArgs.repository,
          `/check-runs/${inputArgs.checkRunId}`,
        ),
        {
          method: 'PATCH',
          body: {
            name: inputArgs.projection.name,
            head_sha: inputArgs.projection.headSha,
            status: inputArgs.projection.status,
            conclusion: inputArgs.projection.conclusion,
            external_id: inputArgs.projection.externalId,
            output: {
              title: inputArgs.projection.name,
              summary: inputArgs.projection.summary,
              text: inputArgs.projection.text,
            },
          },
        },
        (payload) => toCheckRunRecord(inputArgs.repository, payload),
      );
    },
  };
}
