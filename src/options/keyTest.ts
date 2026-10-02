// "Test key" for DeepSeek: GET /models with the bearer key. The key is never logged or shown.

export const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';

export type KeyTestResult =
  | { kind: 'ok'; models: string[] }
  | { kind: 'invalid' }
  | { kind: 'rate_limited' }
  | { kind: 'error'; message: string };

/** Model ids from an OpenAI-style list response: { data: [{ id }] }. */
export function parseModelIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((m) => (typeof m === 'object' && m !== null ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '' && id.length < 100)
    .map((id) => id.trim());
  return Array.from(new Set(ids)).sort();
}

export function classifyKeyResponse(status: number, body: unknown): KeyTestResult {
  if (status >= 200 && status < 300) return { kind: 'ok', models: parseModelIds(body) };
  if (status === 401 || status === 403) return { kind: 'invalid' };
  if (status === 429) return { kind: 'rate_limited' };
  if (status >= 500) return { kind: 'error', message: `DeepSeek is having trouble (HTTP ${status}). Try again in a minute.` };
  return { kind: 'error', message: `Couldn’t check the key (HTTP ${status}).` };
}

export async function testDeepSeekKey(key: string, fetchImpl: typeof fetch = fetch, timeoutMs = 12_000): Promise<KeyTestResult> {
  const k = key.trim();
  if (!k) return { kind: 'invalid' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(DEEPSEEK_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${k}`, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return classifyKeyResponse(res.status, body);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    // Never echo the error text: it is not ours and could, in theory, contain request details.
    return { kind: 'error', message: aborted ? 'DeepSeek didn’t answer in time.' : 'Couldn’t reach DeepSeek. Check your connection.' };
  } finally {
    clearTimeout(timer);
  }
}
