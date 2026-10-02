import type { DebugInfo } from '../../shared/types';
import { debugRows } from '../lib/format';

/** Counters for the current job. Only rendered when settings.showDebug is on. */
export function DebugPanel({ debug }: { debug: DebugInfo }) {
  const { counters, money, timings, adapters } = debugRows(debug);
  return (
    <details className="mx-3 mt-4 rounded-xl border border-dashed border-rule-strong bg-card/60 px-3 py-2 text-[12px]">
      <summary className="cursor-pointer select-none font-semibold text-ink-2">Debug</summary>
      <div className="mt-2 space-y-3 font-mono text-[11.5px] text-ink-2">
        <Grid title="Counters" rows={counters} />
        <Grid title="Cost" rows={money} />
        {adapters.length ? <Grid title="Candidates per source" rows={adapters} /> : null}
        {timings.length ? <Grid title="Timings" rows={timings} /> : null}
      </div>
    </details>
  );
}

function Grid({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div>
      <p className="bk-label mb-1">{title}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-ink-3">{k}</dt>
            <dd className="text-right text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
