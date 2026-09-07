export class AirbyteApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000) {
    return cachedToken.value;
  }

  const baseUrl = process.env.AIRBYTE_BASE_URL;
  const clientId = process.env.AIRBYTE_CLIENT_ID;
  const clientSecret = process.env.AIRBYTE_CLIENT_SECRET;

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('AIRBYTE_BASE_URL, AIRBYTE_CLIENT_ID e AIRBYTE_CLIENT_SECRET precisam estar configurados.');
  }

  const res = await fetch(`${baseUrl}/api/public/v1/applications/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });

  if (!res.ok) {
    throw new AirbyteApiError('Falha ao autenticar no Airbyte.', res.status, await res.text());
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 55 * 60 * 1000),
  };
  return cachedToken.value;
}

export async function airbyteFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.AIRBYTE_BASE_URL;
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl}/api/public/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = extractAirbyteErrorMessage(json) || res.statusText;
    throw new AirbyteApiError(message, res.status, json);
  }

  return json as T;
}

function extractAirbyteErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as Record<string, unknown>;
  const data = body.data as Record<string, unknown> | undefined;

  return (
    (data?.message as string) ||
    (body.detail as string) ||
    (body.message as string) ||
    (body.title as string) ||
    null
  );
}
