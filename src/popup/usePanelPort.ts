// Long-lived port to the service worker. Sends GET_STATE on every (re)connect, reconnects with
// backoff when the worker restarts, and queues messages sent while disconnected.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BackgroundToPanel, PanelToBackground } from '../shared/messages';
import { panelPortName } from '../shared/messages';
import { frameToken, isFramed } from './embed';
import type { JobState } from '../shared/types';

type PendingClaimMsg = Extract<BackgroundToPanel, { type: 'PENDING_CLAIM' }>;
type ReverifyMsg = Extract<BackgroundToPanel, { type: 'REVERIFY_RESULT' }>;

export interface PortHandlers {
  onPendingClaim?: (msg: PendingClaimMsg) => void;
  onHint?: (message: string) => void;
  onReverify?: (msg: ReverifyMsg) => void;
}

export interface PanelPort {
  state: JobState | null;
  /** The first STATE snapshot has arrived. */
  loaded: boolean;
  connected: boolean;
  send: (msg: PanelToBackground) => void;
}

const KNOWN = new Set<BackgroundToPanel['type']>(['STATE', 'PENDING_CLAIM', 'HINT', 'REVERIFY_RESULT']);

/** Minimal shape check: the port only ever carries our own messages, but never trust blindly. */
export function isBackgroundMessage(msg: unknown): msg is BackgroundToPanel {
  if (typeof msg !== 'object' || msg === null) return false;
  const type = (msg as { type?: unknown }).type;
  if (typeof type !== 'string' || !KNOWN.has(type as BackgroundToPanel['type'])) return false;
  const m = msg as Record<string, unknown>;
  switch (type) {
    case 'STATE':
      return m.state === null || (typeof m.state === 'object' && m.state !== null && typeof (m.state as { jobId?: unknown }).jobId === 'string');
    case 'PENDING_CLAIM':
      return typeof m.claim === 'string';
    case 'HINT':
      return typeof m.message === 'string';
    case 'REVERIFY_RESULT':
      return typeof m.candidateId === 'string' && typeof m.ok === 'boolean' && typeof m.message === 'string';
    default:
      return false;
  }
}

/** Reconnect delay: 150 ms, 300 ms, … capped at 3 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(3000, 150 * 2 ** Math.max(0, attempt));
}

export function usePanelPort(handlers: PortHandlers): PanelPort {
  const [state, setState] = useState<JobState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const queueRef = useRef<PanelToBackground[]>([]);
  const handlersRef = useRef(handlers);

  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    let everAnswered = false;
    const scheduleReconnect = () => {
      if (disposed || timer !== undefined) return;
      // An in-page popup whose token the worker refused gets disconnected at once: stop retrying.
      if (isFramed() && !everAnswered && attempt >= 3) return;
      timer = setTimeout(() => {
        timer = undefined;
        connect();
      }, reconnectDelay(attempt));
      attempt++;
    };

    const onMessage = (raw: unknown) => {
      if (!isBackgroundMessage(raw)) return;
      attempt = 0;
      everAnswered = true;
      switch (raw.type) {
        case 'STATE':
          setState(raw.state);
          setLoaded(true);
          return;
        case 'PENDING_CLAIM':
          handlersRef.current.onPendingClaim?.(raw);
          return;
        case 'HINT':
          handlersRef.current.onHint?.(raw.message);
          return;
        case 'REVERIFY_RESULT':
          handlersRef.current.onReverify?.(raw);
          return;
      }
    };

    function connect() {
      if (disposed) return;
      // Inside a web page the popup must carry the token the content script was given.
      const token = frameToken();
      if (isFramed() && !token) return;
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: panelPortName(token) });
      } catch {
        setConnected(false);
        scheduleReconnect();
        return;
      }
      portRef.current = port;
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError; // read it so Chrome doesn't log "unchecked runtime.lastError"
        if (portRef.current === port) portRef.current = null;
        setConnected(false);
        scheduleReconnect();
      });
      try {
        port.postMessage({ type: 'GET_STATE' } satisfies PanelToBackground);
        const queued = queueRef.current.splice(0);
        for (const msg of queued) port.postMessage(msg);
        setConnected(true);
      } catch {
        if (portRef.current === port) portRef.current = null;
        setConnected(false);
        scheduleReconnect();
      }
    }

    connect();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      const p = portRef.current;
      portRef.current = null;
      try {
        p?.disconnect();
      } catch {
        // already gone
      }
    };
  }, []);

  const send = useCallback((msg: PanelToBackground) => {
    const port = portRef.current;
    if (port) {
      try {
        port.postMessage(msg);
        return;
      } catch {
        portRef.current = null;
      }
    }
    // Delivered right after the next successful (re)connect.
    queueRef.current.push(msg);
  }, []);

  return { state, loaded, connected, send };
}
