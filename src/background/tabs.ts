// Which tabs Backed can run in.

/**
 * Pages where extensions can't run any script. Checked synchronously so the sidebar can still be
 * opened inside the user gesture (chrome.sidePanel.open must be called during the gesture).
 */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    !/^(https?|file):/i.test(url) ||
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//i.test(url)
  );
}

