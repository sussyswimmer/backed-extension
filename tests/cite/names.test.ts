import { describe, expect, it } from 'vitest';
import { formatCitation, formatInText, parseAuthorName } from '../../src/shared/cite';
import { meta } from './helpers';

const person = (family: string, given: string[], suffix?: string) =>
  suffix ? { kind: 'person', family, given, suffix } : { kind: 'person', family, given };
const org = (name: string) => ({ kind: 'org', name });

describe('parseAuthorName', () => {
  it.each([
    ['David Card', person('Card', ['David'])],
    ['Alan B. Krueger', person('Krueger', ['Alan', 'B.'])],
    ['Krueger, Alan B.', person('Krueger', ['Alan', 'B.'])],
    ['Card, David', person('Card', ['David'])],
    ['  David   Card  ', person('Card', ['David'])],
    ['Plato', person('Plato', [])],
  ])('parses person %j', (raw, expected) => {
    expect(parseAuthorName(raw)).toEqual(expected);
  });

  it.each([
    ['By Jane Doe', person('Doe', ['Jane'])],
    ['by: Jane Doe', person('Doe', ['Jane'])],
    ['BY JANE DOE', person('Doe', ['Jane'])],
    ['Jane Doe.', person('Doe', ['Jane'])],
    ['Jane Doe,', person('Doe', ['Jane'])],
    ['Jane Doe;', person('Doe', ['Jane'])],
    ['"Jane Doe"', person('Doe', ['Jane'])],
    ['Jane Doe (Reuters)', person('Doe', ['Jane'])],
    ['Dr. Jane Doe', person('Doe', ['Jane'])],
    ['Jane Doe, PhD', person('Doe', ['Jane'])],
    ['JOHN SMITH', person('Smith', ['John'])],
  ])('cleans junk %j', (raw, expected) => {
    expect(parseAuthorName(raw)).toEqual(expected);
  });

  it('does not strip "By" that starts a real name', () => {
    expect(parseAuthorName('Byron Smith')).toEqual(person('Smith', ['Byron']));
  });

  it.each([
    'World Bank',
    'International Monetary Fund',
    'Organisation for Economic Co-operation and Development',
    'World Health Organization',
    'Brookings Institution',
    'Pew Research Center',
    'U.S. Bureau of Labor Statistics',
    'Federal Reserve Bank of St. Louis',
    'United Nations',
    'Congressional Budget Office',
    'National Academy of Sciences Committee',
    'European Union',
    'Reuters Staff',
    'Associated Press',
    'The Economist',
    'Johnson & Johnson',
    'OECD',
    'IMF',
    'UNICEF',
  ])('detects organization %j', (raw) => {
    expect(parseAuthorName(raw)).toEqual(org(raw));
  });

  it('treats names of more than five words as organizations', () => {
    expect(parseAuthorName('Friends of the Earth Climate Action Network').kind).toBe('org');
  });

  it('keeps the period of an organization abbreviation', () => {
    expect(parseAuthorName('Acme Holdings Inc.')).toEqual(org('Acme Holdings Inc.'));
  });

  it.each([
    ['Ludwig van Beethoven', person('van Beethoven', ['Ludwig'])],
    ['Beethoven, Ludwig van', person('van Beethoven', ['Ludwig'])],
    ['Vincent Van Gogh', person('Van Gogh', ['Vincent'])],
    ['Charles de Gaulle', person('de Gaulle', ['Charles'])],
    ['Juan de la Cruz', person('de la Cruz', ['Juan'])],
    ['Leonardo da Vinci', person('da Vinci', ['Leonardo'])],
    ['Maria dos Santos', person('dos Santos', ['Maria'])],
    ['Otto von Bismarck', person('von Bismarck', ['Otto'])],
    ['Mohd Najib bin Abdul Razak', person('bin Abdul Razak', ['Mohd', 'Najib'])],
    ['Andrea del Sarto', person('del Sarto', ['Andrea'])],
    ['Carlo di Stefano', person('di Stefano', ['Carlo'])],
    ['Anne le Roux', person('le Roux', ['Anne'])],
  ])('attaches particles to the family name: %j', (raw, expected) => {
    expect(parseAuthorName(raw)).toEqual(expected);
  });

  it.each([
    ['Martin Luther King Jr.', person('King', ['Martin', 'Luther'], 'Jr.')],
    ['Martin Luther King, Jr.', person('King', ['Martin', 'Luther'], 'Jr.')],
    ['King, Martin Luther, Jr.', person('King', ['Martin', 'Luther'], 'Jr.')],
    ['Henry Ford II', person('Ford', ['Henry'], 'II')],
    ['John Smith Sr', person('Smith', ['John'], 'Sr.')],
    ['Smith, John, III', person('Smith', ['John'], 'III')],
  ])('keeps suffixes out of the family name: %j', (raw, expected) => {
    expect(parseAuthorName(raw)).toEqual(expected);
  });

  it('returns an empty organization for blank input', () => {
    expect(parseAuthorName('')).toEqual(org(''));
    expect(parseAuthorName('By ')).toEqual(org(''));
  });
});

describe('author names inside citations', () => {
  const cite = (authors: string[]) =>
    formatCitation(meta({ authors, title: 'T', published: '2001', tier: 'web' }), 'apa').text;

  it('renders APA initials, including hyphenated and run-together initials', () => {
    expect(cite(['Jean-Paul Sartre'])).toMatch(/^Sartre, J\.-P\. \(2001\)/);
    expect(cite(['Tolkien, J.R.R.'])).toMatch(/^Tolkien, J\. R\. R\. \(2001\)/);
    expect(cite(['Alan B Krueger'])).toMatch(/^Krueger, A\. B\. \(2001\)/);
  });

  it('places suffixes per style', () => {
    const m = meta({ authors: ['Martin Luther King Jr.'], title: 'Letter', published: '1963', tier: 'web' });
    expect(formatCitation(m, 'apa').text).toMatch(/^King, M\. L\., Jr\. \(1963\)\./);
    expect(formatCitation(m, 'chicago').text).toMatch(/^King, Martin Luther, Jr\. 1963\./);
    expect(formatCitation(m, 'mla').text).toMatch(/^King, Martin Luther, Jr\. "Letter\."/);
    expect(formatInText(m, 'apa')).toBe('(King, 1963)');
  });

  it('uses the particle-bearing family name in-text', () => {
    const m = meta({ authors: ['Ludwig van Beethoven'], published: '1820' });
    expect(formatInText(m, 'apa')).toBe('(van Beethoven, 1820)');
    expect(formatInText(m, 'mla')).toBe('(van Beethoven)');
  });

  it('splits entries that hold several people and drops duplicates and junk', () => {
    const m = meta({
      authors: ['Jane Doe and John Smith', 'Card, David', 'David Card', 'undefined', 'Unknown', '', 'jdoe@example.org'],
      published: '2001',
    });
    expect(formatCitation(m, 'apa').text).toMatch(/^Doe, J\., Smith, J\., & Card, D\. \(2001\)/);
  });

  it('does not split organizations that contain "and"', () => {
    const m = meta({ authors: ['Department of Health and Human Services'], published: '2001' });
    expect(formatInText(m, 'apa')).toBe('(Department of Health and Human Services, 2001)');
  });

  it('title-cases all-caps person names', () => {
    expect(cite(['JOHN SMITH'])).toMatch(/^Smith, J\. \(2001\)/);
  });
});
