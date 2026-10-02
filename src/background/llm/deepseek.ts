// DeepSeek client (OpenAI-compatible chat completions, JSON mode).
// Every LLM call in the extension goes through here and is validated with a zod schema.
import type { z } from 'zod';
import { fetchWithTimeout, HttpError, isAbortError, retryAfter, sleep, TimeoutError, type FetchLike } from '../net';

export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

export type LlmErrorKind = 'auth' | 'balance' | 'unavailable' | 'malformed' | 'bad_request';

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  costUsd: number;
}

export interface LlmRequest<T> {
  /** Short name for logs/debug ("plan", "match#2"). */
  label: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  signal?: AbortSignal;
  temperature?: number;
  timeoutMs?: number;
}

export interface LlmResult<T> {
  data: T;
  usage: LlmUsage;
  repaired: boolean;
}

export interface LlmClient {
  json<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export interface Prices {
  inputCacheMiss: number;
  inputCacheHit: number;
  output: number;
}

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  prices: Prices;
  fetchImpl?: FetchLike;
  /** Called for every API response that reports usage (including repair attempts). */
  onUsage?: (u: LlmUsage, label: string) => void;
  /** Injected in tests to avoid real waiting. */
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Backoff before retry 1 and 2 (ms). */
  backoffMs?: [number, number];
  url?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

export function costOf(usage: ChatResponse['usage'], prices: Prices): LlmUsage {
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;
  const hit = usage?.prompt_cache_hit_tokens ?? 0;
  const miss = usage?.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit);
  const costUsd = (miss * prices.inputCacheMiss + hit * prices.inputCacheHit + completion * prices.output) / 1_000_000;
  return { promptTokens: prompt, completionTokens: completion, cacheHitTokens: hit, costUsd };
}

/** Pull a JSON object out of a reply (handles stray code fences or prose around it). */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  throw new SyntaxError('No JSON object found');
}

function describeZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export class DeepSeekClient implements LlmClient {
  private readonly cfg: DeepSeekConfig;

  constructor(cfg: DeepSeekConfig) {
    this.cfg = cfg;
  }

  async json<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const messages: ChatMessage[] = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ];
    const total: LlmUsage = { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, costUsd: 0 };
    let lastProblem = '';
    // Attempt 0 = normal call, attempt 1 = one repair retry with the error appended.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { content, usage } = await this.call(messages, req);
      total.promptTokens += usage.promptTokens;
      total.completionTokens += usage.completionTokens;
      total.cacheHitTokens += usage.cacheHitTokens;
      total.costUsd += usage.costUsd;

      let parsed: unknown;
      try {
        parsed = extractJson(content);
      } catch {
        lastProblem = 'The reply was not valid JSON.';
        messages.push({ role: 'assistant', content: content.slice(0, 4000) || '(empty)' });
        messages.push({ role: 'user', content: repairMessage(lastProblem) });
        continue;
      }
      const result = req.schema.safeParse(parsed);
      if (result.success) return { data: result.data, usage: total, repaired: attempt > 0 };
      lastProblem = `The JSON did not match the required format: ${describeZodError(result.error)}.`;
      messages.push({ role: 'assistant', content: content.slice(0, 4000) });
      messages.push({ role: 'user', content: repairMessage(lastProblem) });
    }
    throw new LlmError('malformed', `DeepSeek returned unusable JSON for ${req.label}. ${lastProblem}`);
  }

  /** One logical API call with up to 2 retries on 429/5xx/network errors. */
  private async call(messages: ChatMessage[], req: LlmRequest<unknown>): Promise<{ content: string; usage: LlmUsage }> {
    const sleepFn = this.cfg.sleepImpl ?? sleep;
    const backoff = this.cfg.backoffMs ?? [1000, 3000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) {
        const hinted = lastErr instanceof HttpError ? lastErr.retryAfterMs : undefined;
        const base = backoff[attempt - 1] ?? 3000;
        await sleepFn(Math.min(10_000, hinted ?? base + Math.round(Math.random() * 250)), req.signal);
      }
      try {
        return await this.once(messages, req);
      } catch (e) {
        if (isAbortError(e)) throw e;
        if (e instanceof LlmError) throw e; // auth/balance/bad_request: no retry
        lastErr = e;
      }
    }
    const why = lastErr instanceof HttpError ? `HTTP ${lastErr.status}` : lastErr instanceof TimeoutError ? 'timeout' : 'network error';
    throw new LlmError('unavailable', `DeepSeek is not responding (${why}). Try again in a minute.`);
  }

  private async once(messages: ChatMessage[], req: LlmRequest<unknown>): Promise<{ content: string; usage: LlmUsage }> {
    const body = {
      model: this.cfg.model,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.2,
      // Non-thinking mode: we want fast, structured answers.
      thinking: { type: 'disabled' },
      stream: false,
    };
    const res = await fetchWithTimeout(this.cfg.url ?? DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: req.signal,
      timeoutMs: req.timeoutMs ?? 45_000,
      fetchImpl: this.cfg.fetchImpl,
    });
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', 'DeepSeek rejected the API key. Check your DeepSeek key.');
    if (res.status === 402) throw new LlmError('balance', 'Your DeepSeek balance is empty. Top up your DeepSeek account.');
    if (res.status === 400 || res.status === 422) {
      // Don't echo the body: it can contain our prompt. A model-name typo is the usual cause.
      throw new LlmError('bad_request', `DeepSeek rejected the request (HTTP ${res.status}). Check the model name in options.`);
    }
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, retryAfter(res));
    let json: ChatResponse;
    try {
      json = (await res.json()) as ChatResponse;
    } catch {
      throw new HttpError(502, 'Bad JSON envelope');
    }
    const usage = costOf(json.usage, this.cfg.prices);
    this.cfg.onUsage?.(usage, req.label);
    const content = json.choices?.[0]?.message?.content ?? '';
    return { content, usage };
  }
}

function repairMessage(problem: string): string {
  return `${problem} Reply again with ONLY one valid JSON object in exactly the format described in the instructions. No prose, no code fences.`;
}

/** Rough token estimate for cost-cap checks before sending (≈4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCostUsd(inputChars: number, expectedOutputTokens: number, prices: Prices): number {
  return (Math.ceil(inputChars / 4) * prices.inputCacheMiss + expectedOutputTokens * prices.output) / 1_000_000;
}
