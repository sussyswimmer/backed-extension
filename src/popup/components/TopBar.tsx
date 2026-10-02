import { BrandMark, IconGear } from '../../shared/ui/Icons';
import { closePopup } from '../embed';
import { btn, openOptions } from './ui';

export type PanelTab = 'search' | 'history';

export function TopBar({ tab, onTab, connected }: { tab: PanelTab; onTab: (t: PanelTab) => void; connected: boolean }) {
  const tabClass = (active: boolean) =>
    'relative h-11 px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ' +
    (active
      ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-accent'
      : 'text-ink-3 hover:text-ink');
  return (
    <header className="sticky top-0 z-30 flex h-11 items-center gap-1 border-b border-rule bg-paper/90 px-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-1.5">
        <BrandMark className="h-5 w-5 shrink-0" />
        <span className="font-serif text-[17px] font-semibold tracking-tight">Backed</span>
        {!connected ? (
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-500 bk-pulse" title="Reconnecting to the extension…" aria-label="Reconnecting" />
        ) : null}
      </div>
      <div role="tablist" aria-label="Sections" className="ml-auto flex items-stretch">
        <button type="button" role="tab" aria-selected={tab === 'search'} className={tabClass(tab === 'search')} onClick={() => onTab('search')}>
          Search
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tabClass(tab === 'history')} onClick={() => onTab('history')}>
          History
        </button>
      </div>
      <button type="button" className={btn('ghost', 'icon')} onClick={openOptions} aria-label="Open options" title="Options">
        <IconGear className="h-[18px] w-[18px]" />
      </button>
      <button type="button" className={btn('ghost', 'icon')} onClick={closePopup} aria-label="Close" title="Close (Esc). A running search keeps going.">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>
  );
}
