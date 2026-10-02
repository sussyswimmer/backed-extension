import { describe, expect, it } from 'vitest';
import { acquireText, looksBlocked } from '../../src/background/extract/getText';
import type { Candidate } from '../../src/shared/types';
import { fixture, testExtractor } from '../helpers';

function cand(url: string, extra: Partial<Candidate> = {}): Candidate {
  return { id: 'c1', sourceId: 'exa_web', tier: 'think_tank', title: 'T', url, authors: [], snippet: 'A short abstract about minimum wage increases and their effects on employment in many states.', ...extra };
}

const ctxFor = (pages: Record<string, { status: number; body: string; type?: string }>) => ({
  extractor: testExtractor(),
  signal: new AbortController().signal,
  keyTerms: ['minimum wage'],
  canFetchPages: true,
  fetchImpl: async (url: string) => {
    const p = pages[url];
    return p ? new Response(p.body, { status: p.status, headers: { 'content-type': p.type ?? 'text/html' } }) : new Response('nope', { status: 404 });
  },
});

describe('acquireText fallbacks', () => {
  it('bot-protection pages are never treated as the article → abstract only', async () => {
    expect(looksBlocked('Sorry, you have been blocked. Cloudflare Ray ID: 123')).toBe(true);
    const doc = await acquireText(cand('https://tt.org/a'), 'd1', ctxFor({ 'https://tt.org/a': { status: 200, body: fixture('pages/cloudflare-block.html') } }));
    expect(doc?.textSource).toBe('abstract_only');
    expect(doc?.fallbackReason).toContain('blocked');
    expect(doc?.text).not.toMatch(/blocked/i);
  });

  it('403 / paywall → abstract only, never pretending to have the full text', async () => {
    const d403 = await acquireText(cand('https://tt.org/b'), 'd2', ctxFor({ 'https://tt.org/b': { status: 403, body: 'Forbidden' } }));
    expect(d403).toMatchObject({ textSource: 'abstract_only', fallbackReason: '403' });
    const pay = await acquireText(cand('https://tt.org/c'), 'd3', ctxFor({ 'https://tt.org/c': { status: 200, body: fixture('pages/paywall.html') } }));
    expect(pay?.textSource).toBe('abstract_only');
  });

  it('prefers Exa text over fetching when it is long enough, and fetches when there is none', async () => {
    const exa = await acquireText(cand('https://x.org/a', { text: fixture('pages/minwage-news.exa.md') }), 'd4', ctxFor({}));
    expect(exa?.textSource).toBe('exa');
    const html = await acquireText(cand('https://x.org/n'), 'd5', ctxFor({ 'https://x.org/n': { status: 200, body: fixture('pages/minwage-news.html') } }));
    expect(html?.textSource).toBe('html');
    expect(html?.title).toBe('Study finds minimum wage rises did not cut jobs');
  });

  it('no page access → Exa text or abstract only; nothing at all → null', async () => {
    const ctx = { ...ctxFor({}), canFetchPages: false };
    expect((await acquireText(cand('https://x.org/z'), 'd6', ctx))?.fallbackReason).toBe('no page access');
    expect(await acquireText(cand('https://x.org/z', { snippet: '' }), 'd7', ctx)).toBeNull();
  });
});
