// Node stand-in for the offscreen document: Readability via jsdom, pdf.js legacy build for PDFs.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import type { Extractor } from '../src/background/extract/getText';
import { extractReadable } from '../src/offscreen/htmlText';
import { extractPdfPages } from '../src/offscreen/pdfText';

const require = createRequire(import.meta.url);

export function nodeExtractor(): Extractor {
  const parser = new new JSDOM('').window.DOMParser();
  return {
    async html(html, url) {
      return extractReadable(html, url, parser);
    },
    async pdf(bytes, opts) {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
      const pdf = await task.promise;
      try {
        return await extractPdfPages(pdf, { ...opts, deadlineMs: 25_000 });
      } finally {
        void task.destroy();
      }
    },
  };
}
