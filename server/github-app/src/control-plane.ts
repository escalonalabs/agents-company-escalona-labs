export interface ControlPlaneHttpClient {
  fetchFn?: typeof fetch;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export async function postControlPlaneJson(input: {
  baseUrl: string;
  path: string;
  body: Record<string, unknown>;
  internalApiToken?: string | null;
  client?: ControlPlaneHttpClient;
}): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
}> {
  const fetchFn = input.client?.fetchFn ?? fetch;
  const response = await fetchFn(`${input.baseUrl}${input.path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.internalApiToken
        ? { 'x-agents-company-internal-token': input.internalApiToken }
        : {}),
    },
    body: JSON.stringify(input.body),
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await readJsonResponse(response),
  };
}
