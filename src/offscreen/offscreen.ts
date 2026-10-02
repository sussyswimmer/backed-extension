// Offscreen document: the only place with a DOM. Handles HTML extraction (Readability),
// PDF text extraction (pdf.js) and clipboard reads for the Google Docs fallback.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { isOffscreenRequest, type OffscreenRequest, type OffscreenResponse } from '../shared/messages';
import { extractReadable } from './htmlText';
import { extractPdfPages } from './pdfText';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function handle(req: OffscreenRequest): Promise<unknown> {
  switch (req.type) {
    case 'EXTRACT_HTML':
      return extractReadable(req.html, req.url, new DOMParser());
    case 'EXTRACT_PDF': {
      const task = pdfjs.getDocument({ data: fromBase64(req.dataBase64), disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 });
      const pdf = await task.promise;
      try {
        return await extractPdfPages(pdf, { keyTerms: req.keyTerms, firstPages: req.firstPages, maxScanPages: req.maxScanPages, deadlineMs: 25_000 });
      } finally {
        void task.destroy();
      }
    }
    case 'READ_CLIPBOARD': {
      const ta = document.createElement('textarea');
      document.body.appendChild(ta);
      ta.focus();
      document.execCommand('paste');
      const text = ta.value;
      ta.remove();
      return text;
    }
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (r: OffscreenResponse<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id || !isOffscreenRequest(msg)) return false;
  handle(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true; // async response
});
