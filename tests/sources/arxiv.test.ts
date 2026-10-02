import { describe, expect, it } from 'vitest';
import { decodeXmlEntities, parseAtomFeed } from '../../src/background/sources/atom';
import { arxivIdOf, createArxivAdapter, parseArxivFeed } from '../../src/background/sources/arxiv';
import { AdapterError } from '../../src/background/sources';
import { fixtureText, makePlan, mockFetch, signal, textResponse } from './helpers';

const feed = fixtureText('arxiv-feed.xml');

describe('Atom parser', () => {
  it('parses multiple entries with authors, links, categories and arxiv extensions', () => {
    const entries = parseAtomFeed(feed);
    expect(entries).toHaveLength(5);
    const [kaplan, , data] = entries;
    expect(kaplan!.id).toBe('http://arxiv.org/abs/2001.08361v1');
    expect(kaplan!.title).toBe('Scaling Laws for Neural Language Models');
    expect(kaplan!.summary.startsWith('We study empirical scaling laws')).toBe(true);
    expect(kaplan!.summary).not.toMatch(/\n/);
    expect(kaplan!.authors).toEqual(['Jared Kaplan', 'Sam McCandlish', 'Tom Henighan']);
    expect(kaplan!.published).toBe('2020-01-23T03:59:54Z');
    expect(kaplan!.links).toContainEqual({ href: 'http://arxiv.org/pdf/2001.08361v1', rel: 'related', type: 'application/pdf', title: 'pdf' });
    expect(kaplan!.categories).toEqual(['cs.LG', 'stat.ML']);
    expect(kaplan!.primaryCategory).toBe('cs.LG');
    expect(kaplan!.doi).toBeUndefined();

    // Entities in title/summary/author names, multi-line title collapsed.
    expect(data!.title).toBe('Data & Compute Trade-offs: When Do Larger Models Stop Paying Off?');
    expect(data!.summary).toContain('loss < 2.0 nats');
    expect(data!.summary).toContain('"data wall" for language models & vision models');
    expect(data!.authors).toEqual(['Renée Dupont', 'Wei Zhang']);
    expect(data!.doi).toBe('10.1234/example.2024.0042');
    expect(data!.journalRef).toBe('Example Journal of ML 12 (2024) 1-20');
  });

  it('decodes entities in one pass and handles CDATA', () => {
    expect(decodeXmlEntities('A &amp; B &lt;x&gt; &quot;q&quot; &apos;s&apos; &#233; &#xE9; &amp;lt;')).toBe(`A & B <x> "q" 's' é é &lt;`);
    const xml = '<feed><entry><id>x</id><title><![CDATA[Raw <b>&amp;</b> text]]> &amp; more</title></entry></feed>';
    expect(parseAtomFeed(xml)[0]!.title).toBe('Raw <b>&amp;</b> text & more');
  });

  it('returns no entries for an empty feed', () => {
    expect(parseAtomFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>')).toEqual([]);
  });
});

describe('arXiv mapping', () => {
  it('extracts ids including old-style ones', () => {
    expect(arxivIdOf('http://arxiv.org/abs/2001.08361v1')).toEqual({ base: '2001.08361', versioned: '2001.08361v1' });
    expect(arxivIdOf('http://arxiv.org/abs/math/0211159v1')).toEqual({ base: 'math/0211159', versioned: 'math/0211159v1' });
    expect(arxivIdOf('http://arxiv.org/api/errors#bad')).toBeUndefined();
  });

  it('maps entries and drops the non-English one', () => {
    const out = parseArxivFeed(feed);
    expect(out.map((c) => c.title)).toEqual([
      'Scaling Laws for Neural Language Models',
      'Training Compute-Optimal Large Language Models',
      'Data & Compute Trade-offs: When Do Larger Models Stop Paying Off?',
      'The entropy formula for the Ricci flow and its geometric applications',
    ]);
    expect(out[0]).toMatchObject({
      sourceId: 'arxiv',
      tier: 'preprint',
      url: 'https://arxiv.org/abs/2001.08361',
      pdfUrl: 'https://arxiv.org/pdf/2001.08361v1',
      doi: '10.48550/arxiv.2001.08361',
      publisher: 'arXiv',
      published: '2020-01-23',
      authors: ['Jared Kaplan', 'Sam McCandlish', 'Tom Henighan'],
    });
    expect(out[2]!.doi).toBe('10.1234/example.2024.0042'); // journal DOI wins over the arXiv DOI
    expect(out[3]!.url).toBe('https://arxiv.org/abs/math/0211159');
  });

  it('filters by published year client-side', () => {
    const out = parseArxivFeed(feed, { from: 2019, to: 2022 });
    expect(out.map((c) => c.published?.slice(0, 4))).toEqual(['2020', '2022']);
  });

  it('skips arXiv error entries', () => {
    expect(parseArxivFeed(fixtureText('arxiv-error.xml'))).toEqual([]);
  });
});

describe('arXiv adapter', () => {
  it('builds the query URL and over-fetches when filtering by year', async () => {
    const { fetch, calls } = mockFetch(() => textResponse(feed));
    const adapter = createArxivAdapter({ fetchImpl: fetch });
    const plan = makePlan({
      queries: { academic: ['neural language model scaling laws', 'other'], semantic: [], news: [], policy: [] },
      constraints: { side: 'support', strength: 'any', yearFrom: 2019, yearTo: 2022 },
    });
    const out = await adapter.search(plan, { limit: 4, signal: signal() });
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://export.arxiv.org/api/query');
    expect(u.searchParams.get('search_query')).toBe('all:neural AND all:language AND all:model AND all:scaling AND all:laws');
    expect(u.searchParams.get('max_results')).toBe('12');
    expect(out).toHaveLength(2);
  });

  it('maps the real "Rate exceeded." 429 to rate_limited, and HTML to bad_response', async () => {
    const { fetch } = mockFetch(() => textResponse(fixtureText('arxiv-429.real.txt'), 429, 'text/plain'));
    const err = await createArxivAdapter({ fetchImpl: fetch })
      .search(makePlan(), { limit: 3, signal: signal() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('rate_limited');

    const { fetch: f2 } = mockFetch(() => textResponse('<html><body>Maintenance</body></html>', 200, 'text/html'));
    const err2 = await createArxivAdapter({ fetchImpl: f2 })
      .search(makePlan(), { limit: 3, signal: signal() })
      .catch((e: unknown) => e);
    expect((err2 as AdapterError).kind).toBe('bad_response');
  });
});

describe('arxivQuery', () => {
  it('prefixes every term and joins with explicit boolean operators', async () => {
    const { arxivQuery } = await import('../../src/background/sources/arxiv');
    expect(arxivQuery('large language models versus FinBERT for sentiment')).toBe('all:large AND all:language AND all:models AND all:FinBERT AND all:sentiment');
    expect(arxivQuery('large language models FinBERT', 'OR')).toBe('all:large OR all:language OR all:models OR all:FinBERT');
  });
});
