import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { costOf, DeepSeekClient, extractJson, LlmError } from '../../src/background/llm/deepseek';

const prices = { inputCacheMiss: 0.3, inputCacheHit: 0.006, output: 1.2 };
const Schema = z.object({ answer: z.string() });

function reply(content: string, status = 200, usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 200, prompt_cache_miss_tokens: 800 }) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status, headers: { 'content-type': 'application/json' } });
}

function client(responses: Array<Response | Error>, onUsage = vi.fn()) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const c = new DeepSeekClient({ apiKey: 'sk-test-secret-123456', model: 'deepseek-flash', prices, fetchImpl, onUsage, sleepImpl: async () => undefined });
  return { c, calls, fetchImpl, onUsage };
}

const req = { label: 't', system: 'Reply in JSON.', user: 'hi', schema: Schema, maxTokens: 100 };

describe('DeepSeekClient', () => {
  it('sends JSON mode, non-thinking, bearer auth; parses and reports cost', async () => {
    const { c, calls, onUsage } = client([reply('{"answer":"ok"}')]);
    const out = await c.json(req);
    expect(out.data).toEqual({ answer: 'ok' });
    expect(calls[0]?.url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0]?.body).toMatchObject({ model: 'deepseek-flash', response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 100 });
    expect(calls[0]?.headers.authorization).toBe('Bearer sk-test-secret-123456');
    expect(calls[0]?.url).not.toContain('sk-test');
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(out.usage.costUsd).toBeCloseTo((800 * 0.3 + 200 * 0.006 + 100 * 1.2) / 1e6, 10);
  });

  it('401 → auth error, no retry, key never in the message', async () => {
    const { c, fetchImpl } = client([new Response('{"error":{"message":"Authentication Fails, key sk-test-secret-123456"}}', { status: 401 })]);
    const err = await c.json(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('auth');
    expect((err as LlmError).message).toMatch(/Check your DeepSeek key/);
    expect((err as LlmError).message).not.toContain('sk-test');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('402 → balance error', async () => {
    const { c } = client([new Response('{}', { status: 402 })]);
    await expect(c.json(req)).rejects.toMatchObject({ kind: 'balance' });
  });

  it('429/5xx → backs off and retries twice, then succeeds', async () => {
    const { c, fetchImpl } = client([new Response('', { status: 429 }), new Response('', { status: 503 }), reply('{"answer":"third time"}')]);
    await expect(c.json(req)).resolves.toMatchObject({ data: { answer: 'third time' } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('429/5xx ×3 → unavailable error', async () => {
    const { c, fetchImpl } = client([new Response('', { status: 500 }), new Response('', { status: 502 }), new TypeError('network down')]);
    await expect(c.json(req)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('malformed JSON → one repair retry with the error appended', async () => {
    const { c, calls } = client([reply('Sure! here you go: {answer: oops'), reply('{"answer":"fixed"}')]);
    const out = await c.json(req);
    expect(out).toMatchObject({ data: { answer: 'fixed' }, repaired: true });
    const msgs = calls[1]?.body.messages as Array<{ role: string; content: string }>;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[3]?.content).toMatch(/not valid JSON/);
  });

  it('schema mismatch twice → malformed error (caller skips the batch)', async () => {
    const { c } = client([reply('{"nope":1}'), reply('{"still":"wrong"}')]);
    await expect(c.json(req)).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('empty content counts as malformed', async () => {
    const { c } = client([reply(''), reply('{"answer":"ok"}')]);
    await expect(c.json(req)).resolves.toMatchObject({ repaired: true });
  });

  it('aborts immediately when the signal fires', async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    );
    const c = new DeepSeekClient({ apiKey: 'k', model: 'm', prices, fetchImpl });
    const p = c.json({ ...req, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    const t0 = Date.now();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('extractJson / costOf', () => {
  it('handles fences and surrounding prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a":2} thanks')).toEqual({ a: 2 });
    expect(() => extractJson('no json')).toThrow();
  });
  it('falls back to prompt_tokens when cache split is missing', () => {
    expect(costOf({ prompt_tokens: 1_000_000, completion_tokens: 0 }, prices).costUsd).toBeCloseTo(0.3);
  });
});
