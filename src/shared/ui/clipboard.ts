// Copy rich text (text/html + text/plain) so pastes keep bold/underline in Google Docs and Word,
// and stay clean in plain text fields.

export interface RichText {
  text: string;
  html: string;
}

export async function copyRich(value: RichText): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip) return false;
  try {
    if (typeof ClipboardItem !== 'undefined' && typeof clip.write === 'function') {
      await clip.write([
        new ClipboardItem({
          'text/html': new Blob([value.html], { type: 'text/html' }),
          'text/plain': new Blob([value.text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // Fall back to plain text below.
  }
  try {
    await clip.writeText(value.text);
    return true;
  } catch {
    return false;
  }
}

/** Save text as a file through a Blob URL and a temporary <a download>. */
export function downloadText(filename: string, text: string, type = 'text/markdown'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
