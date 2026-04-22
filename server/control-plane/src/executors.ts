import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ExecutionPacket,
  type ExecutorResult,
  type ToolRequestEnvelope,
  createEffectEnvelope,
  validateExecutorResult,
} from '@escalonalabs/execution';

const runtimeDataRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../data/runtime-artifacts',
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function ensureToolRequestAllowed(
  packet: ExecutionPacket,
  request: ToolRequestEnvelope,
): string | null {
  if (request.executionPacketId !== packet.executionPacketId) {
    return 'execution_packet_mismatch';
  }

  if (request.runId !== packet.runId) {
    return 'run_mismatch';
  }

  if (!packet.toolAllowlist.includes(request.toolName)) {
    return 'tool_not_allowlisted';
  }

  if (
    packet.scopeAllowlist.length > 0 &&
    !packet.scopeAllowlist.includes(request.scopeRef)
  ) {
    return 'scope_not_allowlisted';
  }

  return null;
}

async function writeArtifactFile(input: {
  runId: string;
  toolCallId: string;
  fileName: string;
  contents: string;
}): Promise<string> {
  const directory = resolve(runtimeDataRoot, input.runId);
  await mkdir(directory, { recursive: true });

  const artifactPath = resolve(
    directory,
    `${input.toolCallId}-${input.fileName}`,
  );
  await writeFile(artifactPath, input.contents, 'utf8');

  return `artifact://${input.runId}/${input.toolCallId}/${input.fileName}`;
}

function createFailedResult(input: {
  request: ToolRequestEnvelope;
  startedAt: string;
  effectStatus:
    | 'failed_transient'
    | 'failed_permanent'
    | 'cancelled'
    | 'timed_out';
  errorClass: string;
  errorMessage: string;
  artifactRefs?: string[];
  resultPayload?: Record<string, unknown>;
}): ExecutorResult {
  return {
    toolRequest: input.request,
    effect: createEffectEnvelope({
      toolCallId: input.request.toolCallId,
      runId: input.request.runId,
      effectStatus: input.effectStatus,
      startedAt: input.startedAt,
      completedAt: new Date().toISOString(),
      artifactRefs: input.artifactRefs,
      resultPayload: input.resultPayload,
      errorClass: input.errorClass,
      errorMessage: input.errorMessage,
    }),
  };
}

async function runInternalExecutor(
  request: ToolRequestEnvelope,
): Promise<ExecutorResult> {
  const startedAt = new Date().toISOString();
  const action = request.requestPayload.action;

  if (action === 'return_task_result') {
    return {
      toolRequest: request,
      effect: createEffectEnvelope({
        toolCallId: request.toolCallId,
        runId: request.runId,
        effectStatus: 'succeeded',
        startedAt,
        completedAt: new Date().toISOString(),
        resultPayload: {
          taskResult:
            isPlainObject(request.requestPayload.taskResult) &&
            request.requestPayload.taskResult !== null
              ? request.requestPayload.taskResult
              : {},
        },
      }),
    };
  }

  if (action === 'emit_artifact') {
    const contents =
      typeof request.requestPayload.contents === 'string'
        ? request.requestPayload.contents
        : JSON.stringify(request.requestPayload.json ?? {}, null, 2);
    const artifactRef = await writeArtifactFile({
      runId: request.runId,
      toolCallId: request.toolCallId,
      fileName: 'internal-artifact.txt',
      contents,
    });

    return {
      toolRequest: request,
      effect: createEffectEnvelope({
        toolCallId: request.toolCallId,
        runId: request.runId,
        effectStatus: 'succeeded',
        startedAt,
        completedAt: new Date().toISOString(),
        artifactRefs: [artifactRef],
        resultPayload: { artifactRef },
      }),
    };
  }

  if (action === 'simulate_transient_failure') {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_transient',
      errorClass: 'simulated_transient_failure',
      errorMessage: 'Simulated transient failure.',
      resultPayload: { action },
    });
  }

  if (action === 'simulate_permanent_failure') {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'simulated_permanent_failure',
      errorMessage: 'Simulated permanent failure.',
      resultPayload: { action },
    });
  }

  if (action === 'simulate_cancelled') {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'cancelled',
      errorClass: 'simulated_cancellation',
      errorMessage: 'Simulated cancellation.',
      resultPayload: { action },
    });
  }

  return createFailedResult({
    request,
    startedAt,
    effectStatus: 'failed_permanent',
    errorClass: 'unsupported_internal_action',
    errorMessage: 'Unsupported internal executor action.',
    resultPayload: { action },
  });
}

async function runHttpExecutor(
  request: ToolRequestEnvelope,
): Promise<ExecutorResult> {
  const startedAt = new Date().toISOString();
  const url =
    typeof request.requestPayload.url === 'string'
      ? request.requestPayload.url
      : null;
  if (!url) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'missing_url',
      errorMessage: 'HTTP executor requires requestPayload.url.',
    });
  }

  const parsed = new URL(url);
  const allowedHosts = Array.isArray(request.requestPayload.allowedHosts)
    ? request.requestPayload.allowedHosts.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.host)) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'host_not_allowlisted',
      errorMessage: 'HTTP target host is not allowlisted.',
      resultPayload: { host: parsed.host },
    });
  }

  try {
    const response = await fetch(url, {
      method:
        typeof request.requestPayload.method === 'string'
          ? request.requestPayload.method
          : 'GET',
      headers: asStringMap(request.requestPayload.headers),
      body:
        typeof request.requestPayload.body === 'string'
          ? request.requestPayload.body
          : request.requestPayload.body !== undefined
            ? JSON.stringify(request.requestPayload.body)
            : undefined,
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const bodyText = await response.text();
    const artifactRef = await writeArtifactFile({
      runId: request.runId,
      toolCallId: request.toolCallId,
      fileName: 'http-response.txt',
      contents: bodyText,
    });

    if (!response.ok) {
      return createFailedResult({
        request,
        startedAt,
        effectStatus:
          response.status >= 500 ? 'failed_transient' : 'failed_permanent',
        errorClass: `http_${response.status}`,
        errorMessage: `HTTP request failed with status ${response.status}.`,
        artifactRefs: [artifactRef],
        resultPayload: { status: response.status, url },
      });
    }

    return {
      toolRequest: request,
      effect: createEffectEnvelope({
        toolCallId: request.toolCallId,
        runId: request.runId,
        effectStatus: 'succeeded',
        startedAt,
        completedAt: new Date().toISOString(),
        artifactRefs: [artifactRef],
        resultPayload: {
          status: response.status,
          url,
          bodyText,
        },
      }),
    };
  } catch (error) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timed_out'
          : 'failed_transient',
      errorClass: error instanceof Error ? error.name : 'http_executor_error',
      errorMessage:
        error instanceof Error ? error.message : 'HTTP executor failed.',
    });
  }
}

function ensurePathInsideRoot(rootDir: string, targetPath: string): boolean {
  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(targetPath);
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}/`)
  );
}

async function runFileArtifactExecutor(
  request: ToolRequestEnvelope,
): Promise<ExecutorResult> {
  const startedAt = new Date().toISOString();
  const action = request.requestPayload.action;

  if (action === 'write_artifact') {
    const contents =
      typeof request.requestPayload.contents === 'string'
        ? request.requestPayload.contents
        : JSON.stringify(request.requestPayload.json ?? {}, null, 2);
    const artifactRef = await writeArtifactFile({
      runId: request.runId,
      toolCallId: request.toolCallId,
      fileName: 'artifact.txt',
      contents,
    });

    return {
      toolRequest: request,
      effect: createEffectEnvelope({
        toolCallId: request.toolCallId,
        runId: request.runId,
        effectStatus: 'succeeded',
        startedAt,
        completedAt: new Date().toISOString(),
        artifactRefs: [artifactRef],
        resultPayload: { artifactRef },
      }),
    };
  }

  const rootDir =
    typeof request.requestPayload.rootDir === 'string'
      ? request.requestPayload.rootDir
      : null;
  const targetPath =
    typeof request.requestPayload.path === 'string'
      ? request.requestPayload.path
      : null;
  if (!rootDir || !targetPath) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'missing_file_path',
      errorMessage: 'File/artifact executor requires rootDir and path.',
    });
  }

  if (!ensurePathInsideRoot(rootDir, targetPath)) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'path_out_of_scope',
      errorMessage: 'Requested file path escapes the declared root directory.',
    });
  }

  try {
    if (action === 'write_file') {
      await mkdir(dirname(targetPath), { recursive: true });
      const contents =
        typeof request.requestPayload.contents === 'string'
          ? request.requestPayload.contents
          : JSON.stringify(request.requestPayload.json ?? {}, null, 2);
      await writeFile(targetPath, contents, 'utf8');

      return {
        toolRequest: request,
        effect: createEffectEnvelope({
          toolCallId: request.toolCallId,
          runId: request.runId,
          effectStatus: 'succeeded',
          startedAt,
          completedAt: new Date().toISOString(),
          resultPayload: { path: targetPath, bytesWritten: contents.length },
        }),
      };
    }

    if (action === 'read_file') {
      const contents = await readFile(targetPath, 'utf8');
      const extension = extname(targetPath).replace('.', '') || 'txt';
      const artifactRef = await writeArtifactFile({
        runId: request.runId,
        toolCallId: request.toolCallId,
        fileName: `file-read.${extension}`,
        contents,
      });

      return {
        toolRequest: request,
        effect: createEffectEnvelope({
          toolCallId: request.toolCallId,
          runId: request.runId,
          effectStatus: 'succeeded',
          startedAt,
          completedAt: new Date().toISOString(),
          artifactRefs: [artifactRef],
          resultPayload: { path: targetPath, artifactRef },
        }),
      };
    }

    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'unsupported_file_action',
      errorMessage: 'Unsupported file/artifact executor action.',
      resultPayload: { action },
    });
  } catch (error) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: error instanceof Error ? error.name : 'file_executor_error',
      errorMessage:
        error instanceof Error
          ? error.message
          : 'File/artifact executor failed.',
    });
  }
}

async function runShellExecutor(
  request: ToolRequestEnvelope,
): Promise<ExecutorResult> {
  const startedAt = new Date().toISOString();
  const command =
    typeof request.requestPayload.command === 'string'
      ? request.requestPayload.command
      : null;
  const cwd =
    typeof request.requestPayload.cwd === 'string'
      ? request.requestPayload.cwd
      : null;
  const args = Array.isArray(request.requestPayload.args)
    ? request.requestPayload.args.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];

  if (!command || !cwd) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'missing_shell_command',
      errorMessage: 'Shell executor requires command and cwd.',
    });
  }

  const env = {
    ...process.env,
    ...asStringMap(request.requestPayload.env),
  };

  const result = await new Promise<ExecutorResult>((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill('SIGKILL');
      resolveResult(
        createFailedResult({
          request,
          startedAt,
          effectStatus: 'timed_out',
          errorClass: 'shell_timeout',
          errorMessage: 'Shell executor timed out.',
          resultPayload: { command, args, cwd },
        }),
      );
    }, request.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolveResult(
        createFailedResult({
          request,
          startedAt,
          effectStatus: 'failed_permanent',
          errorClass: error.name,
          errorMessage: error.message,
          resultPayload: { command, args, cwd },
        }),
      );
    });
    child.on('close', async (code, signal) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);

      const artifactRef = await writeArtifactFile({
        runId: request.runId,
        toolCallId: request.toolCallId,
        fileName: 'shell-output.txt',
        contents: [stdout, stderr].filter(Boolean).join('\n'),
      });

      if (code !== 0 || signal) {
        resolveResult(
          createFailedResult({
            request,
            startedAt,
            effectStatus: 'failed_permanent',
            errorClass: signal ? `signal_${signal}` : `exit_${code ?? 1}`,
            errorMessage: 'Shell executor exited unsuccessfully.',
            artifactRefs: [artifactRef],
            resultPayload: { command, args, cwd, code, signal, stdout, stderr },
          }),
        );
        return;
      }

      resolveResult({
        toolRequest: request,
        effect: createEffectEnvelope({
          toolCallId: request.toolCallId,
          runId: request.runId,
          effectStatus: 'succeeded',
          startedAt,
          completedAt: new Date().toISOString(),
          artifactRefs: [artifactRef],
          resultPayload: { command, args, cwd, code, stdout, stderr },
        }),
      });
    });
  });

  return result;
}

async function runBrowserExecutor(
  request: ToolRequestEnvelope,
): Promise<ExecutorResult> {
  const startedAt = new Date().toISOString();
  const url =
    typeof request.requestPayload.url === 'string'
      ? request.requestPayload.url
      : null;
  if (!url) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'missing_browser_url',
      errorMessage: 'Browser executor requires requestPayload.url.',
    });
  }

  const parsed = new URL(url);
  const allowedHosts = Array.isArray(request.requestPayload.allowedHosts)
    ? request.requestPayload.allowedHosts.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.host)) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus: 'failed_permanent',
      errorClass: 'browser_host_not_allowlisted',
      errorMessage: 'Browser target host is not allowlisted.',
      resultPayload: { host: parsed.host },
    });
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const html = await response.text();
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const artifactRef = await writeArtifactFile({
      runId: request.runId,
      toolCallId: request.toolCallId,
      fileName: 'browser-evidence.html',
      contents: html,
    });

    if (!response.ok) {
      return createFailedResult({
        request,
        startedAt,
        effectStatus:
          response.status >= 500 ? 'failed_transient' : 'failed_permanent',
        errorClass: `browser_http_${response.status}`,
        errorMessage: `Browser fetch failed with status ${response.status}.`,
        artifactRefs: [artifactRef],
        resultPayload: { status: response.status, url },
      });
    }

    return {
      toolRequest: request,
      effect: createEffectEnvelope({
        toolCallId: request.toolCallId,
        runId: request.runId,
        effectStatus: 'succeeded',
        startedAt,
        completedAt: new Date().toISOString(),
        artifactRefs: [artifactRef],
        resultPayload: {
          url,
          title: titleMatch?.[1] ?? null,
          artifactRef,
        },
      }),
    };
  } catch (error) {
    return createFailedResult({
      request,
      startedAt,
      effectStatus:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timed_out'
          : 'failed_transient',
      errorClass:
        error instanceof Error ? error.name : 'browser_executor_error',
      errorMessage:
        error instanceof Error ? error.message : 'Browser executor failed.',
    });
  }
}

export async function executeAuthorizedToolRequest(input: {
  packet: ExecutionPacket;
  request: ToolRequestEnvelope;
}): Promise<ExecutorResult> {
  const requestFailure = ensureToolRequestAllowed(input.packet, input.request);
  if (requestFailure) {
    return createFailedResult({
      request: input.request,
      startedAt: new Date().toISOString(),
      effectStatus: 'failed_permanent',
      errorClass: requestFailure,
      errorMessage: 'Tool request failed packet policy validation.',
      resultPayload: { requestFailure },
    });
  }

  const result =
    input.request.toolKind === 'internal'
      ? await runInternalExecutor(input.request)
      : input.request.toolKind === 'http'
        ? await runHttpExecutor(input.request)
        : input.request.toolKind === 'file/artifact'
          ? await runFileArtifactExecutor(input.request)
          : input.request.toolKind === 'shell'
            ? await runShellExecutor(input.request)
            : await runBrowserExecutor(input.request);

  const validation = validateExecutorResult(result);
  if (!validation.ok) {
    return createFailedResult({
      request: input.request,
      startedAt: new Date().toISOString(),
      effectStatus: 'failed_permanent',
      errorClass: 'invalid_executor_result',
      errorMessage: validation.issues.join('; '),
      resultPayload: { issues: validation.issues },
    });
  }

  return result;
}
