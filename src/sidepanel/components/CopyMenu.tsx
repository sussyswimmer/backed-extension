import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { copyRich } from '../../shared/ui/clipboard';
import { IconChevron, IconCopy } from '../../shared/ui/Icons';
import type { CopyItem } from '../lib/format';
import { btn, useNotify } from './ui';

/** "Copy as…" disclosure: a list of formats; each copies text/html + text/plain. */
export function CopyMenu({ items, label = 'Copy as…' }: { items: CopyItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const notify = useNotify();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    rootRef.current?.querySelector<HTMLButtonElement>('[data-copy-item]')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nodes = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-copy-item]') ?? []);
      const i = nodes.findIndex((n) => n === document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % nodes.length : (i - 1 + nodes.length) % nodes.length;
      nodes[next]?.focus();
    }
  };

  const copy = async (item: CopyItem) => {
    const ok = await copyRich(item.value);
    notify(ok ? `Copied: ${item.label}` : 'Couldn’t copy. Click inside the panel and try again.');
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={btn('secondary', 'sm')}
      >
        <IconCopy className="h-3.5 w-3.5" />
        {label}
        <IconChevron className={`h-3.5 w-3.5 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <ul id={listId} className="bk-enter absolute top-full left-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-rule-strong bg-card py-1 shadow-lg">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-copy-item=""
                onClick={() => void copy(item)}
                className="block w-full px-3 py-1.5 text-left text-[13px] text-ink hover:bg-sunk focus:bg-sunk focus:outline-none"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
