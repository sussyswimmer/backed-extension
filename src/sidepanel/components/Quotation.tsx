import { useMemo } from 'react';
import { quoteSegments, type QuotableMatch } from '../lib/quote';

/**
 * The verified passage as text: matching sentences highlighted, one sentence of context dimmed on
 * each side, " […] " between fragments. Everything goes through React text nodes (never HTML).
 */
export function Quotation({ match, compact = false, context = true }: { match: QuotableMatch; compact?: boolean; context?: boolean }) {
  const segs = useMemo(() => quoteSegments(match, { context }), [match, context]);
  return (
    <blockquote
      className={`border-l-[3px] border-rule-strong pl-3 font-serif text-ink ${compact ? 'text-[13.5px] leading-[1.55]' : 'text-[14.5px] leading-[1.6]'}`}
    >
      {segs.map((s, i) => {
        switch (s.kind) {
          case 'match':
            return (
              <mark key={i} className="bk-mark">
                {s.text}
              </mark>
            );
          case 'context':
            return (
              <span key={i} className="text-ink-3">
                {s.text}
              </span>
            );
          case 'gap':
            return (
              <span key={i} className="text-ink-3 font-sans text-[0.85em]">
                {s.text}
              </span>
            );
          default:
            return <span key={i}>{s.text}</span>;
        }
      })}
    </blockquote>
  );
}
