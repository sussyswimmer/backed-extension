import { describe, expect, it } from 'vitest';
import { isEnglish } from '../../src/background/sources';
import { fixtureJson } from './helpers';

interface Samples {
  english: string[];
  short_english: string[];
  non_english: Record<string, string[]>;
}

const samples = fixtureJson<Samples>('lang-samples.json');

describe('isEnglish', () => {
  it.each(samples.english.map((t) => [t.slice(0, 50), t]))('English text: %s…', (_label, text) => {
    expect(isEnglish(text)).toBe(true);
  });

  it.each(samples.short_english.map((t) => [t]))('short English title: %s', (title) => {
    expect(isEnglish(title)).toBe(true);
  });

  const foreign = Object.entries(samples.non_english).flatMap(([lang, texts]) => texts.map((t) => [lang, t.slice(0, 40), t] as const));
  it.each(foreign)('rejects %s: %s…', (_lang, _label, text) => {
    expect(isEnglish(text)).toBe(false);
  });

  it('decides short titles by function words when both sides have some', () => {
    expect(isEnglish('Minimum Wages in Los Angeles')).toBe(true);
    expect(isEnglish('Efectos del salario mínimo a largo plazo')).toBe(false);
    expect(isEnglish('La política monetaria en Vietnam')).toBe(false);
  });

  it('rejects empty / letterless input', () => {
    expect(isEnglish('')).toBe(false);
    expect(isEnglish('2024 — 1,184 € / 14')).toBe(false);
  });

  it('handles long Exa markdown text by sampling', () => {
    const en = samples.english[0]!;
    const long = `# Title\n\n${en}\n\n[link](https://example.com/a?b=c)\n\n`.repeat(40);
    expect(isEnglish(long)).toBe(true);
    const vi = samples.non_english.vi![0]!;
    expect(isEnglish(`${vi}\n\n`.repeat(40))).toBe(false);
  });

  it('accepts English text with a few non-English names', () => {
    expect(
      isEnglish(
        'Prime Minister Phạm Minh Chính said on Tuesday that the government would keep the minimum wage increase on schedule despite slower export growth in Bình Dương and Đồng Nai provinces.',
      ),
    ).toBe(true);
  });
});
