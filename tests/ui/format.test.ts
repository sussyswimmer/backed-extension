import { describe, expect, it } from 'vitest';
import { formatAll, formatForMode } from '../../src/shared/cite';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { copyAll, copyItems, debugRows, duration, markdownFilename, usd4 } from '../../src/popup/lib/format';
import { demoState } from './fixtures';

const ACCESSED = new Date(2026, 9, 2);
const styles = DEFAULT_SETTINGS.citationStyles;

describe('formatters', () => {
  it('money always has 4 decimals; durations are readable', () => {
    expect(usd4(0.01612)).toBe('$0.0161');
    expect(usd4(Number.NaN)).toBe('$0.0000');
    expect(duration(840)).toBe('840 ms');
    expect(duration(11840)).toBe('11.8 s');
  });

  it('markdown file names are short, ascii and dated', () => {
    const ts = new Date(2026, 9, 2, 12).getTime();
    expect(markdownFilename('Tăng lương tối thiểu không làm giảm việc làm!', ts)).toBe('backed-tang-luong-toi-thieu-khong-lam-giam-viec-lam-2026-10-02.md');
    expect(markdownFilename('Minimum wage hikes don’t cost jobs', ts)).toBe('backed-minimum-wage-hikes-dont-cost-jobs-2026-10-02.md');
    expect(markdownFilename('???', ts)).toBe('backed-2026-10-02.md');
  });
});

describe('copyItems', () => {
  const r = demoState().support[0]!;

  it('Paper/Essay: citation, in-text, quotation, link + summary + quote', () => {
    const items = copyItems(formatForMode(r, 'paper', { styles, accessed: ACCESSED, honestyLine: true }), 'paper');
    expect(items.map((i) => i.id)).toEqual(['citation', 'inText', 'quote', 'linkSummaryQuote']);
    const inText = items.find((i) => i.id === 'inText')!;
    expect(inText.value.text).toMatch(/^\(Rivera et al\., 2019, p\. 14\)$/);
  });

  it('Debate: debate cite and card, no in-text', () => {
    const items = copyItems(formatForMode(r, 'debate', { styles, accessed: ACCESSED, honestyLine: true }), 'debate');
    expect(items.map((i) => i.id)).toEqual(['citation', 'card', 'quote', 'linkSummaryQuote']);
    expect(items.find((i) => i.id === 'card')!.value.html).toContain('<u>');
  });

  it('in-text html is escaped', () => {
    const evil = { ...r, meta: { ...r.meta, authors: ['<b>X</b> Y'] } };
    const items = copyItems(formatForMode(evil, 'essay', { styles, accessed: ACCESSED, honestyLine: true }), 'essay');
    const inText = items.find((i) => i.id === 'inText')!;
    expect(inText.value.html).not.toContain('<b>');
  });
});

describe('copyAll', () => {
  const results = demoState().support;

  it('equals formatAll when every card has the same honesty setting', () => {
    expect(copyAll(results, () => true)).toEqual(formatAll(results, { honestyLine: true }));
    expect(copyAll(results, () => false)).toEqual(formatAll(results, { honestyLine: false }));
  });

  it('drops the honesty line only on cards where it was removed', () => {
    const out = copyAll(results, (r) => r.candidateId !== 'natarajan2021');
    expect(out.text).not.toContain('Paraphrase match:');
    expect(out.text).toContain('Partial: supports a weaker version.');
    expect(copyAll([], () => true)).toEqual({ text: '', html: '' });
  });
});

describe('debugRows', () => {
  it('lists counters, 4-decimal cost and timings', () => {
    const rows = debugRows(demoState().debug);
    expect(rows.counters).toContainEqual(['Fabricated IDs dropped', '2']);
    expect(rows.money).toEqual([
      ['LLM $', '$0.0161'],
      ['Exa $', '$0.0125'],
      ['Total $', '$0.0286'],
    ]);
    expect(rows.timings[0]).toEqual(['First result', '11.8 s']);
    expect(rows.adapters).toContainEqual(['OpenAlex', '8']);
  });
});
