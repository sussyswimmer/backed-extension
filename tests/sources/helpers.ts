import { readFileSync } from 'node:fs';
import type { Candidate, Plan } from '../../src/shared/types';
import type { FetchLike } from '../../src/background/net';

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url), 'utf8');
}

export function fixtureJson<T = unknown>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

export interface FetchCall {
  url: string;
  init?: RequestInit;
}

export type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Mock fetch that records every call. */
export function mockFetch(handler: Handler): { fetch: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(body: string, status = 200, contentType = 'application/atom+xml'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

/** A fetch that never resolves until its signal aborts (to exercise timeouts). */
export function hangingFetch(): FetchLike {
  return (_url, init) =>
    new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const onAbort = () => {
        const e = new Error('Aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
}

export function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers;
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  const rec = h as Record<string, string>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? rec[key] : undefined;
}

export function bodyOf<T = Record<string, unknown>>(init: RequestInit | undefined): T {
  return JSON.parse(String(init?.body ?? '{}')) as T;
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  const base: Plan = {
    normalizedClaim: 'Minimum wage increases do not cause large job losses.',
    claimType: 'causal',
    coreProposition: 'Raising the minimum wage has little effect on employment.',
    paraphrases: [
      'Minimum wage increases had no significant effect on employment',
      'The disemployment effects of minimum wages are small',
      'Higher minimum wages did not reduce the number of low-wage jobs',
    ],
    keyTerms: ['minimum wage', 'employment', 'disemployment effect', 'low-wage jobs', 'labor demand'],
    excludeTerms: [],
    constraints: { side: 'support', strength: 'any' },
    queries: {
      academic: ['minimum wage employment effects', 'minimum wage disemployment low-wage jobs'],
      semantic: ['Our estimates show minimum wage increases had no significant effect on employment.'],
      news: ['minimum wage increase job losses study'],
      policy: ['minimum wage employment evidence review'],
    },
    counterQuery: 'minimum wage increases cause job losses for low-skilled workers',
    domains: ['economics'],
  };
  return {
    ...base,
    ...overrides,
    constraints: { ...base.constraints, ...(overrides.constraints ?? {}) },
    queries: { ...base.queries, ...(overrides.queries ?? {}) },
  };
}

export function cand(overrides: Partial<Candidate> & { url: string }): Candidate {
  return {
    id: overrides.id ?? `c_${overrides.url}`,
    sourceId: 'exa_web',
    tier: 'web',
    title: 'Untitled',
    authors: [],
    ...overrides,
  };
}

export const signal = (): AbortSignal => new AbortController().signal;
