import { describe, expect, it } from 'vitest';
import { classifyKeyResponse, DEEPSEEK_MODELS_URL, parseModelIds, testDeepSeekKey } from '../../src/options/keyTest';
import { safeHttpUrl } from '../../src/shared/ui/safeUrl';
import { isBackgroundMessage, reconnectDelay } from '../../src/popup/usePanelPort';

describe('isBackgroundMessage', () => {
  it('accepts our messages and rejects anything else', () => {
    expect(isBackgroundMessage({ type: 'STATE', state: null })).toBe(true);
    expect(isBackgroundMessage({ type: 'STATE', state: { jobId: 'j' } })).toBe(true);
    expect(isBackgroundMessage({ type: 'HINT', message: 'Copy the sentence first' })).toBe(true);
    expect(isBackgroundMessage({ type: 'PENDING_CLAIM', claim: 'x', origin: 'hotkey', autoStart: false })).toBe(true);
    expect(isBackgroundMessage({ type: 'REVERIFY_RESULT', candidateId: 'c', ok: true, message: 'ok' })).toBe(true);
    expect(isBackgroundMessage({ type: 'STATE' })).toBe(false);
    expect(isBackgroundMessage({ type: 'HINT', message: 3 })).toBe(false);
    expect(isBackgroundMessage({ type: 'EVAL', code: '1' })).toBe(false);
    expect(isBackgroundMessage('STATE')).toBe(false);
    expect(isBackgroundMessage(null)).toBe(false);
  });

  it('reconnects with capped backoff', () => {
    expect([0, 1, 2, 3, 10].map(reconnectDelay)).toEqual([150, 300, 600, 1200, 3000]);
  });
});

describe('safeHttpUrl', () => {
  it('only lets http(s) URLs through', () => {
    expect(safeHttpUrl('https://example.org/a#:~:text=no%20job%20losses')).toBe('https://example.org/a#:~:text=no%20job%20losses');
    expect(safeHttpUrl(' http://example.org ')).toBe('http://example.org');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,<script>1</script>')).toBeUndefined();
    expect(safeHttpUrl('chrome://settings')).toBeUndefined();
    expect(safeHttpUrl('https://exa mple.org')).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});

describe('DeepSeek key test', () => {
  it('classifies responses', () => {
    expect(classifyKeyResponse(200, { data: [{ id: 'deepseek-pro' }, { id: 'deepseek-flash' }, { id: 'deepseek-flash' }] })).toEqual({
      kind: 'ok',
      models: ['deepseek-flash', 'deepseek-pro'],
    });
    expect(classifyKeyResponse(401, {})).toEqual({ kind: 'invalid' });
    expect(classifyKeyResponse(429, {})).toEqual({ kind: 'rate_limited' });
    expect(classifyKeyResponse(503, {}).kind).toBe('error');
    expect(parseModelIds({ data: 'nope' })).toEqual([]);
  });

  it('sends the key only in the Authorization header and never echoes it', async () => {
    const key = 'sk-secret-1234567890';
    const calls: Array<{ url: string; auth: string | null }> = [];
    const okFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') });
      return new Response(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }), { status: 200 });
    }) as typeof fetch;
    expect(await testDeepSeekKey(key, okFetch)).toEqual({ kind: 'ok', models: ['deepseek-flash'] });
    expect(calls).toEqual([{ url: DEEPSEEK_MODELS_URL, auth: `Bearer ${key}` }]);

    const failing = (async () => {
      throw new Error(`network down for ${key}`);
    }) as typeof fetch;
    const res = await testDeepSeekKey(key, failing);
    expect(res.kind).toBe('error');
    expect(JSON.stringify(res)).not.toContain(key);
  });
});
