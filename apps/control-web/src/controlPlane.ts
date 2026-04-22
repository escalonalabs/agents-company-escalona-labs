import { useEffect, useMemo, useState } from 'react';

type JsonValue = unknown;

export type EndpointPhase = 'loading' | 'success' | 'error' | 'unavailable';

export type EndpointState<TData> = {
  phase: EndpointPhase;
  url: string;
  data: TData | null;
  statusCode: number | null;
  errorMessage: string | null;
  lastSuccessAt: string | null;
};

export type EventStreamState<TData> = {
  phase: EndpointPhase;
  url: string;
  data: TData | null;
  errorMessage: string | null;
  lastEventAt: string | null;
  lastHeartbeatAt: string | null;
};

function normalizeBaseUrl(value: string | undefined): string {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getControlPlaneBaseUrl(): string {
  // Default to same-origin. In local dev you can set VITE_CONTROL_PLANE_URL
  // (for example http://localhost:3000) to avoid CORS/proxy mismatches.
  return normalizeBaseUrl(import.meta.env.VITE_CONTROL_PLANE_URL);
}

type FetchJsonResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string; unavailable?: boolean };

async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
  options?: {
    optional?: boolean;
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
  },
): Promise<FetchJsonResult<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: options?.method ?? 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(options?.body ? { 'content-type': 'application/json' } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Network request failed.';
    return { ok: false, status: 0, message };
  }

  if (options?.optional && response.status === 404) {
    return {
      ok: false,
      status: 404,
      message: 'Endpoint not available yet.',
      unavailable: true,
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payloadText = isJson ? null : await response.text().catch(() => null);

  if (!response.ok) {
    const message = payloadText
      ? payloadText.slice(0, 400)
      : `Request failed with ${response.status}.`;
    return { ok: false, status: response.status, message };
  }

  if (!isJson) {
    return {
      ok: false,
      status: response.status,
      message: 'Expected JSON response.',
    };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, status: response.status, data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to parse JSON response.';
    return { ok: false, status: response.status, message };
  }
}

export async function postControlPlaneJson<TData extends JsonValue>(
  path: string,
  options?: {
    body?: Record<string, unknown>;
    optional?: boolean;
  },
): Promise<FetchJsonResult<TData>> {
  const controller = new AbortController();
  const baseUrl = getControlPlaneBaseUrl();
  const url = `${baseUrl}${path}`;

  try {
    return await fetchJson<TData>(url, controller.signal, {
      body: options?.body,
      method: 'POST',
      optional: options?.optional,
    });
  } finally {
    controller.abort();
  }
}

export function useControlPlaneEndpoint<TData extends JsonValue>(
  path: string,
  options: { refreshSeed: number; optional?: boolean; enabled?: boolean },
): EndpointState<TData> {
  const { enabled = true, optional, refreshSeed } = options;
  const baseUrl = useMemo(() => getControlPlaneBaseUrl(), []);
  const url = useMemo(() => `${baseUrl}${path}`, [baseUrl, path]);
  const [state, setState] = useState<EndpointState<TData>>({
    phase: enabled ? 'loading' : 'unavailable',
    url,
    data: null,
    statusCode: null,
    errorMessage: null,
    lastSuccessAt: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    void refreshSeed;

    if (!enabled) {
      setState((previous) => ({
        ...previous,
        url,
        phase: 'unavailable',
        statusCode: null,
        errorMessage: 'Request disabled.',
      }));
      return () => controller.abort();
    }

    setState((previous) => ({
      ...previous,
      url,
      phase: 'loading',
      statusCode: null,
      errorMessage: null,
    }));

    void (async () => {
      const result = await fetchJson<TData>(url, controller.signal, {
        optional,
      });

      if (controller.signal.aborted) return;

      if (result.ok) {
        setState({
          phase: 'success',
          url,
          data: result.data,
          statusCode: result.status,
          errorMessage: null,
          lastSuccessAt: new Date().toISOString(),
        });
        return;
      }

      if (result.unavailable) {
        setState((previous) => ({
          phase: 'unavailable',
          url,
          data: previous.data,
          statusCode: result.status,
          errorMessage: result.message,
          lastSuccessAt: previous.lastSuccessAt,
        }));
        return;
      }

      setState((previous) => ({
        phase: 'error',
        url,
        data: previous.data,
        statusCode: result.status,
        errorMessage: result.message,
        lastSuccessAt: previous.lastSuccessAt,
      }));
    })();

    return () => controller.abort();
  }, [enabled, optional, refreshSeed, url]);

  return state;
}

export function useControlPlaneEventStream<TData extends JsonValue>(
  path: string,
  options: { enabled?: boolean },
): EventStreamState<TData> {
  const { enabled = true } = options;
  const baseUrl = useMemo(() => getControlPlaneBaseUrl(), []);
  const url = useMemo(
    () => (enabled ? `${baseUrl}${path}` : ''),
    [baseUrl, enabled, path],
  );
  const [state, setState] = useState<EventStreamState<TData>>({
    phase: enabled ? 'loading' : 'unavailable',
    url,
    data: null,
    errorMessage: null,
    lastEventAt: null,
    lastHeartbeatAt: null,
  });

  useEffect(() => {
    if (!enabled || !url) {
      setState({
        phase: 'unavailable',
        url,
        data: null,
        errorMessage: 'Event stream disabled.',
        lastEventAt: null,
        lastHeartbeatAt: null,
      });
      return;
    }

    const source = new EventSource(url, { withCredentials: true });

    setState((previous) => ({
      ...previous,
      phase: 'loading',
      url,
      errorMessage: null,
    }));

    const handleSnapshot = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as TData & {
          sentAt?: string;
        };

        setState({
          phase: 'success',
          url,
          data: payload,
          errorMessage: null,
          lastEventAt: payload.sentAt ?? new Date().toISOString(),
          lastHeartbeatAt: null,
        });
      } catch (error) {
        setState((previous) => ({
          ...previous,
          phase: 'error',
          url,
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Failed to parse event stream snapshot.',
        }));
      }
    };

    const handleHeartbeat = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          sentAt?: string;
        };

        setState((previous) => ({
          ...previous,
          phase: previous.data ? 'success' : previous.phase,
          url,
          errorMessage: null,
          lastHeartbeatAt: payload.sentAt ?? new Date().toISOString(),
        }));
      } catch {
        setState((previous) => ({
          ...previous,
          lastHeartbeatAt: new Date().toISOString(),
        }));
      }
    };

    const handleError = () => {
      setState((previous) => ({
        ...previous,
        phase: previous.data ? 'success' : 'error',
        url,
        errorMessage:
          previous.data !== null
            ? previous.errorMessage
            : 'Event stream connection failed.',
      }));
    };

    source.addEventListener('snapshot', handleSnapshot as EventListener);
    source.addEventListener('heartbeat', handleHeartbeat as EventListener);
    source.addEventListener('error', handleError as EventListener);

    return () => {
      source.removeEventListener('snapshot', handleSnapshot as EventListener);
      source.removeEventListener('heartbeat', handleHeartbeat as EventListener);
      source.removeEventListener('error', handleError as EventListener);
      source.close();
    };
  }, [enabled, url]);

  return state;
}
