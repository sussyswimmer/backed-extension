// Shared test helpers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import type { ExtractedHtml, ExtractedPdf } from '../src/shared/messages';
import type { Extractor } from '../src/background/extract/getText';
import { extractReadable } from '../src/offscreen/htmlText';
import { extractPdfPages, type PdfDocLike } from '../src/offscreen/pdfText';

export const FIXTURES = join(__dirname, 'fixtures');

export function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), 'utf8');
}

export function jsdomParser(): DOMParser {
  const { window } = new JSDOM('');
  return new window.DOMParser();
}

export function extractHtml(html: string, url = 'https://example.org/article'): ExtractedHtml {
  return extractReadable(html, url, jsdomParser());
}

/** A fake PDF made of page texts; bytes are "%PDF-<id>". */
export function fakePdfBytes(id: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-${id}`);
}

export function fakePdfDoc(pages: string[], meta?: { Title?: string; Author?: string }): PdfDocLike {
  return {
    numPages: pages.length,
    async getPage(n: number) {
      const text = pages[n - 1] ?? '';
      return {
        async getTextContent() {
          return { items: text.split('\n').map((line) => ({ str: line, hasEOL: true })) };
        },
      };
    },
    async getMetadata() {
      return { info: meta ?? {} };
    },
  };
}

/** Extractor that uses Readability+jsdom for HTML and a registry of fake PDFs. */
export function testExtractor(pdfs: Record<string, string[]> = {}): Extractor {
  return {
    async html(html: string, url: string) {
      return extractHtml(html, url);
    },
    async pdf(bytes, opts): Promise<ExtractedPdf> {
      const id = new TextDecoder().decode(bytes).replace(/^%PDF-/, '');
      const pages = pdfs[id];
      if (!pages) throw new Error(`unknown fake pdf ${id}`);
      return extractPdfPages(fakePdfDoc(pages), opts);
    },
  };
}
