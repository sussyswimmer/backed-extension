// Shared primitives for the popup: button classes, badges, chips, external links, notify context.
import { createContext, useContext, type ReactNode, type MouseEvent } from 'react';
import type { Relation, SourceTier } from '../../shared/types';
import { openExternal, safeHttpUrl } from '../../shared/ui/safeUrl';
import { RELATION_LABELS, TIER_LABELS } from '../lib/view';

/* ------------------------------ buttons ------------------------------ */

export type ButtonKind = 'primary' | 'secondary' | 'accentOutline' | 'ghost' | 'quiet' | 'danger';
/** `icon` is a square icon button; `bare` has no horizontal padding (text-link style buttons). */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'icon' | 'bare';

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45 disabled:cursor-not-allowed';

const KINDS: Record<ButtonKind, string> = {
  primary: 'bg-accent text-accent-ink shadow-sm hover:brightness-110 active:brightness-95',
  secondary: 'border border-rule-strong bg-card text-ink hover:bg-sunk',
  accentOutline: 'border border-accent/55 bg-card text-accent hover:bg-accent-soft',
  ghost: 'text-ink-2 hover:bg-sunk hover:text-ink',
  quiet: 'text-ink-3 hover:text-ink underline-offset-2 hover:underline',
  danger: 'bg-rose-700 text-white shadow-sm hover:bg-rose-800 dark:bg-rose-400 dark:text-black dark:hover:bg-rose-300',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 rounded-md px-2 text-[11.5px]',
  sm: 'h-7 rounded-md px-2.5 text-xs',
  md: 'h-9 rounded-lg px-3.5 text-[13.5px]',
  icon: 'h-7 w-7 rounded-md text-xs',
  bare: 'h-7 rounded-sm text-xs',
};

/** `extra` must not repeat a property the kind/size sets (utility order would decide the winner). */
export function btn(kind: ButtonKind = 'secondary', size: ButtonSize = 'sm', extra = ''): string {
  return `${BASE} ${KINDS[kind]} ${SIZES[size]} ${extra}`.trim();
}

/* ------------------------------ badges ------------------------------ */

const TIER_DOT: Record<SourceTier, string> = {
  peer_reviewed: 'bg-emerald-600 dark:bg-emerald-400',
  gov_igo: 'bg-sky-600 dark:bg-sky-400',
  think_tank: 'bg-violet-600 dark:bg-violet-400',
  major_news: 'bg-slate-700 dark:bg-slate-300',
  preprint: 'bg-orange-500 dark:bg-orange-400',
  web: 'bg-stone-400 dark:bg-stone-500',
};

export function TierBadge({ tier }: { tier: SourceTier }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full border border-rule-strong bg-card px-2 text-[11px] font-medium text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[tier] ?? TIER_DOT.web}`} aria-hidden="true" />
      {TIER_LABELS[tier] ?? 'Web'}
    </span>
  );
}

const RELATION_STYLE: Record<Relation, string> = {
  direct: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/45 dark:text-emerald-200',
  paraphrase: 'bg-sky-100 text-sky-900 dark:bg-sky-900/45 dark:text-sky-200',
  partial: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  contradicts: 'bg-rose-100 text-rose-900 dark:bg-rose-900/45 dark:text-rose-200',
};

export function RelationBadge({ relation }: { relation: Relation }) {
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold ${RELATION_STYLE[relation] ?? RELATION_STYLE.partial}`}>
      {RELATION_LABELS[relation] ?? 'Match'}
    </span>
  );
}

export function NewBadge({ round }: { round: number }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-full bg-accent px-2 text-[10.5px] font-bold tracking-wider text-accent-ink uppercase"
      title={`Found in search round ${round}`}
    >
      New
    </span>
  );
}

export function Chip({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'warn' | 'accent'; title?: string }) {
  const tones = {
    plain: 'bg-sunk text-ink-2',
    warn: 'bg-warn text-warn-ink border border-warn-rule',
    accent: 'bg-accent-soft text-accent',
  } as const;
  return (
    <span title={title} className={`inline-flex min-h-5 items-center rounded-full px-2 py-px text-[11.5px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/* ------------------------------ links ------------------------------ */

/**
 * A link to an untrusted URL: rendered as a link only when it is http(s), opened in a new tab
 * through chrome.tabs.create. Anything else is plain text.
 */
export function ExternalLink({ href, children, className, title }: { href: string | undefined; children: ReactNode; className?: string; title?: string }) {
  const url = safeHttpUrl(href);
  if (!url) return <span className={className}>{children}</span>;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return; // let the browser handle modified clicks
    e.preventDefault();
    openExternal(url);
  };
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={onClick} className={className} title={title}>
      {children}
    </a>
  );
}

/* ------------------------------ notify (toast) ------------------------------ */

export const NotifyContext = createContext<(message: string) => void>(() => undefined);

export function useNotify(): (message: string) => void {
  return useContext(NotifyContext);
}

export function openOptions(): void {
  try {
    void chrome.runtime.openOptionsPage().catch(() => undefined);
  } catch {
    // not available outside the extension
  }
}
