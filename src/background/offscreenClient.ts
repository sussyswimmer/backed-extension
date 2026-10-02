// Service-worker side of the offscreen document (DOM work: Readability, pdf.js, clipboard).
import { OFFSCREEN_TARGET, type ExtractedHtml, type ExtractedPdf, type OffscreenRequest, type OffscreenResponse } from '../shared/messages';
import type { Extractor } from './extract/getText';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
let creating: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.CLIPBOARD],
        justification: 'Extract article text from fetched pages and PDFs, and read the clipboard as a fallback for Google Docs selections.',
      })
      .catch((e: unknown) => {
        // Another caller may have created it in the meantime.
        if (!String(e).includes('Only a single offscreen')) throw e;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

async function send<T>(req: Omit<OffscreenRequest, 'target'> & { type: OffscreenRequest['type'] }, timeoutMs: number): Promise<T> {
  await ensureOffscreen();
  const msg = { ...req, target: OFFSCREEN_TARGET } as OffscreenRequest;
  const res = await Promise.race([
    chrome.runtime.sendMessage(msg) as Promise<OffscreenResponse<T> | undefined>,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Offscreen extraction timed out')), timeoutMs)),
  ]);
  if (!res) throw new Error('No response from offscreen document');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

export const offscreenExtractor: Extractor = {
  html(html: string, url: string): Promise<ExtractedHtml> {
    return send<ExtractedHtml>({ type: 'EXTRACT_HTML', html, url } as OffscreenRequest, 15_000);
  },
  pdf(bytes: Uint8Array, opts): Promise<ExtractedPdf> {
    return send<ExtractedPdf>(
      { type: 'EXTRACT_PDF', dataBase64: toBase64(bytes), keyTerms: opts.keyTerms, firstPages: opts.firstPages, maxScanPages: opts.maxScanPages } as OffscreenRequest,
      30_000,
    );
  },
};

export async function readClipboardViaOffscreen(): Promise<string> {
  try {
    return await send<string>({ type: 'READ_CLIPBOARD' } as OffscreenRequest, 3_000);
  } catch {
    return '';
  }
}
