// Real pdf.js (legacy Node build) on a real PDF file: the same code path the offscreen document uses.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExtractor } from '../../scripts/nodeExtractor';
import { cleanPdfPages } from '../../src/background/extract/pdfClean';
import { buildDoc, makeChunks } from '../../src/background/extract/chunk';
import { verify } from '../../src/background/match/verify';
import { FIXTURES } from '../helpers';

describe('pdf.js extraction → clean → verify', () => {
  it('extracts pages, strips the running header and page numbers, heals hyphenation, keeps page numbers for citations', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'pages/mini-paper.pdf')));
    const pdf = await nodeExtractor().pdf(bytes, { keyTerms: ['minimum wage'], firstPages: 60, maxScanPages: 300 });
    expect(pdf.pageCount).toBe(3);
    expect(pdf.title).toBe('Test Paper');
    const { text, pageStarts } = cleanPdfPages(pdf.pages);
    expect(text).not.toContain('JOURNAL OF TESTING');
    expect(text).toContain('New Jersey and Pennsylvania before');
    const doc = buildDoc({ docId: 'd1', candidateId: 'c1', text, pageStarts, textSource: 'pdf', finalUrl: 'https://x.org/p.pdf', fetchedAt: 't' });
    const idx = doc.sentences.findIndex((s) => s.text.startsWith('Contrary to the textbook model'));
    expect(doc.sentences[idx]?.page).toBe(2);
    const chunk = makeChunks(doc).find((c) => c.sentenceStart <= idx && idx <= c.sentenceEnd)!;
    const out = verify({ chunkId: chunk.id, relation: 'direct', sentenceIds: [`d1.s${idx}`], confidence: 0.9, reason: 'r' }, doc, chunk, 'c1');
    expect(out.ok && out.match.verification.page).toBe(2);
  });
});
