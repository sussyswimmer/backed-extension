import { describe, expect, it } from 'vitest';
import { cleanPdfPages } from '../../src/background/extract/pdfClean';
import { buildDoc } from '../../src/background/extract/chunk';
import { extractPdfPages, itemsToText } from '../../src/offscreen/pdfText';
import { fakePdfDoc } from '../helpers';

function page(n: number, body: string): { page: number; text: string } {
  return {
    page: n,
    text: [`Journal of Labor Economics Vol. 12`, `Card and Krueger`, body, ``, `Page ${n} of 5`].join('\n'),
  };
}

describe('cleanPdfPages', () => {
  const pages = [
    page(1, 'We study fast-food restaurants in New Jersey and Pennsyl-\nvania before and after the increase.'),
    page(2, 'Employment did not fall in New Jersey relative to\nPennsylvania after the minimum wage rose.'),
    page(3, 'Prices rose by about 4 percent.\n\nA new paragraph starts here.'),
    page(4, 'The results are robust to alternative specifications.'),
    page(5, 'We conclude that the effects on employment were small.'),
  ];

  it('drops running headers/footers repeated on >50% of pages and page numbers', () => {
    const { text } = cleanPdfPages(pages);
    expect(text).not.toContain('Journal of Labor Economics');
    expect(text).not.toContain('Card and Krueger');
    expect(text).not.toMatch(/Page \d of 5/);
  });

  it('de-hyphenates words broken across lines and joins wrapped lines', () => {
    const { text } = cleanPdfPages(pages);
    expect(text).toContain('New Jersey and Pennsylvania before');
    expect(text).toContain('relative to Pennsylvania after');
  });

  it('keeps paragraph breaks and exact page offsets', () => {
    const { text, pageStarts } = cleanPdfPages(pages);
    expect(text).toContain('4 percent.\n\nA new paragraph');
    expect(pageStarts.map((p) => p.page)).toEqual([1, 2, 3, 4, 5]);
    for (const p of pageStarts) {
      const body = pages[p.page - 1]?.text.split('\n')[2]?.slice(0, 12) ?? '';
      expect(text.slice(p.start, p.start + 12)).toBe(body);
    }
    const doc = buildDoc({ docId: 'd1', candidateId: 'c', text, pageStarts, textSource: 'pdf', finalUrl: 'u', fetchedAt: 't' });
    const s = doc.sentences.find((x) => x.text.startsWith('Prices rose'));
    expect(s?.page).toBe(3);
    for (const x of doc.sentences) expect(doc.text.slice(x.start, x.end)).toBe(x.text);
  });

  it('does not strip anything from very short documents', () => {
    const { text } = cleanPdfPages([{ page: 1, text: 'Title line\nBody text here.' }]);
    expect(text).toContain('Title line');
  });
});

describe('extractPdfPages (huge PDFs)', () => {
  it('keeps the first N pages plus later pages that mention a key term', async () => {
    const pages = Array.from({ length: 120 }, (_, i) => (i + 1 === 95 ? 'Here we discuss the minimum wage elasticity.' : `Filler page ${i + 1}.`));
    const out = await extractPdfPages(fakePdfDoc(pages, { Title: 'Big Report' }), { keyTerms: ['Minimum wage'], firstPages: 60, maxScanPages: 300 });
    expect(out.pageCount).toBe(120);
    expect(out.pages.map((p) => p.page)).toEqual([...Array.from({ length: 60 }, (_, i) => i + 1), 95]);
    expect(out.title).toBe('Big Report');
  });

  it('stops scanning at maxScanPages', async () => {
    const pages = Array.from({ length: 50 }, () => 'minimum wage');
    const out = await extractPdfPages(fakePdfDoc(pages), { keyTerms: ['minimum wage'], firstPages: 5, maxScanPages: 10 });
    expect(out.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('itemsToText builds lines and paragraph gaps from pdf.js items', () => {
    const t = itemsToText([
      { str: 'First line', transform: [1, 0, 0, 1, 0, 700], height: 10, hasEOL: true },
      { str: 'second line', transform: [1, 0, 0, 1, 0, 688], height: 10, hasEOL: false },
      { str: 'Far below', transform: [1, 0, 0, 1, 0, 600], height: 10, hasEOL: true },
    ]);
    expect(t).toBe('First line\nsecond line\n\nFar below\n');
  });
});
