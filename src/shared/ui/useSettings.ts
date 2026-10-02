import { useEffect, useState } from 'react';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged } from '../settings';

/** Current settings from chrome.storage.local, kept live. `null` until the first load finishes. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    loadSettings().then(
      (s) => {
        if (alive) setSettings(s);
      },
      () => {
        if (alive) setSettings(structuredClone(DEFAULT_SETTINGS));
      },
    );
    let off: () => void = () => undefined;
    try {
      off = onSettingsChanged((s) => {
        if (alive) setSettings(s);
      });
    } catch {
      // storage events unavailable (tests); settings stay as loaded
    }
    return () => {
      alive = false;
      off();
    };
  }, []);
  return settings;
}
