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
  options?: { optional?: boolean },
): Promise<FetchJsonResult<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
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

export function useControlPlaneEndpoint<TData extends JsonValue>(
  path: string,
  options: { refreshSeed: number; optional?: boolean },
): EndpointState<TData> {
  const { optional, refreshSeed } = options;
  const baseUrl = useMemo(() => getControlPlaneBaseUrl(), []);
  const url = useMemo(() => `${baseUrl}${path}`, [baseUrl, path]);
  const [state, setState] = useState<EndpointState<TData>>({
    phase: 'loading',
    url,
    data: null,
    statusCode: null,
    errorMessage: null,
    lastSuccessAt: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    void refreshSeed;

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
  }, [optional, refreshSeed, url]);

  return state;
}
