import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CitationStyles, OutputMode, Settings, SourceId } from '../shared/types';
import { ALL_SOURCE_IDS, EXA_SOURCE_IDS } from '../shared/types';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings } from '../shared/settings';
import { BrandMark, IconCheck, IconEye, IconEyeOff, IconWarn, Spinner } from '../shared/ui/Icons';
import { testDeepSeekKey, type KeyTestResult } from './keyTest';


const SOURCE_INFO: Record<SourceId, { label: string; hint: string }> = {
  openalex: { label: 'OpenAlex', hint: 'Papers and reports across all fields.' },
  semantic_scholar: { label: 'Semantic Scholar', hint: 'Papers with abstracts and citation counts.' },
  arxiv: { label: 'arXiv', hint: 'Preprints. Only used when the claim fits (CS, econ, physics, math).' },
  exa_web: { label: 'Exa · Web', hint: 'General web pages.' },
  exa_news: { label: 'Exa · News', hint: 'Major news outlets.' },
  exa_policy: { label: 'Exa · Think tanks & gov', hint: 'Think tanks, government and IGO sites.' },
  exa_papers: { label: 'Exa · Papers', hint: 'Research papers found by meaning.' },
};

const MODE_INFO: Record<OutputMode, string> = { paper: 'Paper', essay: 'Essay', debate: 'Debate' };

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const inputClass =
  'h-9 w-full rounded-lg border border-rule-strong bg-paper px-3 text-[13.5px] text-ink placeholder:text-ink-3 ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

export function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pending = useRef<Partial<Settings>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    loadSettings().then(
      (v) => {
        if (alive) setS(v);
      },
      () => {
        if (alive) setS(structuredClone(DEFAULT_SETTINGS));
      },
    );
    const off = onSettingsChanged((next) => {
      // Changes from elsewhere (e.g. the popup's style toggle) — keep fields being edited here.
      if (Object.keys(pending.current).length === 0) setS(next);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSaveState('saving');
    try {
      await saveSettings(patch);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, []);

  /** Update locally right away; persist after `delay` ms (typing) or at once (toggles). */
  const update = useCallback(
    (patch: Partial<Settings>, delay = 0) => {
      setS((prev) => (prev ? { ...prev, ...patch } : prev));
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = setTimeout(() => setSaveState('idle'), 1800);
    return () => clearTimeout(t);
  }, [saveState]);

  if (!s) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-ink-3">
        <Spinner /> Loading…
      </div>
    );
  }

  const hasExa = !!s.exaKey.trim();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <BrandMark className="h-6 w-6" />
          <h1 className="font-serif text-[20px] font-semibold tracking-tight">Backed</h1>
          <span className="text-[13px] text-ink-3">Options</span>
          <SaveIndicator state={saveState} />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        <Section title="API keys" description="Backed has no server. Your keys stay in this browser and go only to the service they belong to.">
          <DeepSeekKeyField
            value={s.deepseekKey}
            onChange={(v) => update({ deepseekKey: v }, 500)}
            model={s.model}
            onPickModel={(m) => update({ model: m })}
          />
          <SecretField
            label="Exa key"
            badge="Optional"
            value={s.exaKey}
            onChange={(v) => update({ exaKey: v }, 500)}
            hint="Unlocks web, news, think tank and government sources. Without it, Backed searches academic sources only."
          />
          <SecretField
            label="OpenAlex API key"
            badge="Optional"
            value={s.openalexKey}
            onChange={(v) => update({ openalexKey: v }, 500)}
            hint="Higher OpenAlex limits. Search works without it."
          />
          <TextField
            label="Contact email"
            badge="Optional"
            type="email"
            value={s.contactEmail}
            onChange={(v) => update({ contactEmail: v }, 500)}
            placeholder="you@example.com"
            hint="Sent to OpenAlex so requests use its faster “polite pool”."
          />
        </Section>

        <Section title="Model">
          <TextField
            label="DeepSeek model"
            value={s.model}
            onChange={(v) => update({ model: v }, 600)}
            placeholder={DEFAULT_MODEL}
            hint={
              <>
                Default: <code className="font-mono">{DEFAULT_MODEL}</code>. Check DeepSeek’s docs for current names (“Test key” lists the models your key can use).
                {s.model.trim() !== DEFAULT_MODEL ? (
                  <>
                    {' '}
                    <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => update({ model: DEFAULT_MODEL })}>
                      Use default
                    </button>
                  </>
                ) : null}
              </>
            }
            mono
          />
        </Section>

        <Section title="Sources" description="Turn off any source you don’t want searched.">
          <div className="divide-y divide-rule">
            {ALL_SOURCE_IDS.map((id) => {
              const needsExa = EXA_SOURCE_IDS.includes(id);
              const dim = needsExa && !hasExa;
              return (
                <Toggle
                  key={id}
                  label={SOURCE_INFO[id].label}
                  hint={dim ? `${SOURCE_INFO[id].hint} Needs an Exa key.` : SOURCE_INFO[id].hint}
                  checked={s.enabledSources[id]}
                  dim={dim}
                  onChange={(v) => update({ enabledSources: { ...s.enabledSources, [id]: v } })}
                />
              );
            })}
          </div>
        </Section>

        <Section title="Cost and size" description="Limits for each search round (the first search and each “search again”).">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              label="Cost cap per search"
              prefix="$"
              value={s.costCapUsdPerSearch}
              min={0.005}
              max={5}
              step={0.01}
              onCommit={(v) => update({ costCapUsdPerSearch: v })}
              hint="Matching stops here."
            />
            <NumberField
              label="Max sources read"
              value={s.maxCandidates}
              min={3}
              max={40}
              step={1}
              integer
              onCommit={(v) => update({ maxCandidates: v })}
              hint="3–40 per round."
            />
            <NumberField
              label="Exa results per source"
              value={s.exaResultsPerAdapter}
              min={1}
              max={10}
              step={1}
              integer
              onCommit={(v) => update({ exaResultsPerAdapter: v })}
              hint="1–10."
            />
          </div>
        </Section>

        <Section title="Output" description="What “Copy as…” produces. You can switch any time in the popup.">
          <Segmented<OutputMode>
            label="Default format"
            value={s.lastMode}
            options={(['paper', 'essay', 'debate'] as const).map((m) => ({ value: m, label: MODE_INFO[m] }))}
            onChange={(v) => update({ lastMode: v })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Segmented<CitationStyles['paper']>
              label="Paper citation style"
              value={s.citationStyles.paper}
              options={[
                { value: 'apa', label: 'APA 7' },
                { value: 'chicago', label: 'Chicago' },
              ]}
              onChange={(v) => update({ citationStyles: { ...s.citationStyles, paper: v } })}
            />
            <Segmented<CitationStyles['essay']>
              label="Essay citation style"
              value={s.citationStyles.essay}
              options={[
                { value: 'mla', label: 'MLA 9' },
                { value: 'apa', label: 'APA 7' },
              ]}
              onChange={(v) => update({ citationStyles: { ...s.citationStyles, essay: v } })}
            />
          </div>
          <Toggle
            label="Honesty line"
            hint="Adds “Paraphrase match: the source supports this idea in different words.” (or Partial / Contradicts) when a source doesn’t state the claim directly. You can still remove it per source."
            checked={s.honestyLine}
            onChange={(v) => update({ honestyLine: v })}
          />
        </Section>

        <Section title="Popup" description="Backed opens as a small popup on the page, never as a sidebar.">
          <Toggle
            label="Show a “Find a source” button when I highlight text"
            hint="A small button appears next to text you select on any page. Click it to search. Turn this off to use only the keyboard shortcut."
            checked={s.selectionButton}
            onChange={(v) => update({ selectionButton: v })}
          />
          <Shortcut />
        </Section>

        <Section title="Advanced">
          <Toggle
            label="Show debug panel"
            hint="Counters, timings, cost per search and a “Re-verify on live page” button on each result."
            checked={s.showDebug}
            onChange={(v) => update({ showDebug: v })}
          />
          <div>
            <p className="text-[13px] font-medium text-ink">DeepSeek prices (USD per 1M tokens)</p>
            <p className="text-[12px] text-ink-3">Used to estimate cost against your cap. Defaults are peak rates, so estimates err high.</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <NumberField
                label="Input (cache miss)"
                prefix="$"
                value={s.prices.inputCacheMiss}
                min={0}
                max={100}
                step={0.01}
                onCommit={(v) => update({ prices: { ...s.prices, inputCacheMiss: v } })}
              />
              <NumberField
                label="Input (cache hit)"
                prefix="$"
                value={s.prices.inputCacheHit}
                min={0}
                max={100}
                step={0.001}
                onCommit={(v) => update({ prices: { ...s.prices, inputCacheHit: v } })}
              />
              <NumberField
                label="Output"
                prefix="$"
                value={s.prices.output}
                min={0}
                max={100}
                step={0.01}
                onCommit={(v) => update({ prices: { ...s.prices, output: v } })}
              />
            </div>
          </div>
        </Section>

        <Section title="Privacy">
          <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">
            <p>
              Keys and history stay in this browser (<code className="font-mono text-[12px]">chrome.storage.local</code>). There is no Backed server, no account and no
              analytics. What goes where:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="font-semibold text-ink">DeepSeek:</span> your claim and short passages of source text, to plan searches, check matches and write the
                summaries.
              </li>
              <li>
                <span className="font-semibold text-ink">OpenAlex, Semantic Scholar, arXiv:</span> search queries built from your claim (plus your contact email to
                OpenAlex, if set).
              </li>
              <li>
                <span className="font-semibold text-ink">Exa</span> (only with a key): search queries. Exa sends back page text.
              </li>
              <li>
                <span className="font-semibold text-ink">Source websites:</span> Backed downloads the pages and PDFs it found (no cookies sent) so it can check every quotation. The “Find a source” button runs on every page but sends nothing until you click it.
              </li>
            </ul>
          </div>
        </Section>
      </main>
    </div>
  );
}

/* ------------------------------ pieces ------------------------------ */

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span role="status" aria-live="polite" className="ml-auto text-[12.5px]">
      {state === 'saving' ? (
        <span className="inline-flex items-center gap-1.5 text-ink-3">
          <Spinner className="h-3.5 w-3.5" /> Saving…
        </span>
      ) : state === 'saved' ? (
        <span className="bk-enter inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 font-medium text-accent">
          <IconCheck className="h-3.5 w-3.5" /> Saved
        </span>
      ) : state === 'error' ? (
        <span className="inline-flex items-center gap-1 text-err-ink">
          <IconWarn className="h-3.5 w-3.5" /> Couldn’t save
        </span>
      ) : null}
    </span>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-rule bg-card p-4 shadow-sm sm:p-5">
      <h2 id={id} className="font-serif text-[17px] font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {description ? <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function FieldLabel({ htmlFor, label, badge }: { htmlFor: string; label: string; badge?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex items-center gap-2 text-[13px] font-medium text-ink">
      {label}
      {badge ? (
        <span
          className={`rounded-full px-1.5 py-px text-[10.5px] font-semibold tracking-wide uppercase ${
            badge === 'Required' ? 'bg-accent-soft text-accent' : 'bg-sunk text-ink-3'
          }`}
        >
          {badge}
        </span>
      ) : null}
    </label>
  );
}

function TextField({
  label,
  badge,
  value,
  onChange,
  placeholder,
  hint,
  type = 'text',
  mono = false,
}: {
  label: string;
  badge?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  type?: 'text' | 'email';
  mono?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} badge={badge} />
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`mt-1 ${inputClass} ${mono ? 'font-mono text-[13px]' : ''}`}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[12px] leading-snug text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SecretInput({ id, value, onChange, describedBy, placeholder }: { id: string; value: string; onChange: (v: string) => void; describedBy?: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-1">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={placeholder ?? 'Paste your key'}
        aria-describedby={describedBy}
        className={`${inputClass} pr-10 font-mono text-[13px] placeholder:font-sans`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide key' : 'Show key'}
        aria-pressed={show}
        className="absolute top-1/2 right-1.5 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-sunk hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        {show ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SecretField({ label, badge, value, onChange, hint }: { label: string; badge?: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} badge={badge} />
      <SecretInput id={id} value={value} onChange={onChange} describedBy={hint ? `${id}-hint` : undefined} />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[12px] leading-snug text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function DeepSeekKeyField({
  value,
  onChange,
  model,
  onPickModel,
}: {
  value: string;
  onChange: (v: string) => void;
  model: string;
  onPickModel: (m: string) => void;
}) {
  const id = useId();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<KeyTestResult | null>(null);
  const run = async () => {
    setTesting(true);
    setResult(null);
    const r = await testDeepSeekKey(value);
    setTesting(false);
    setResult(r);
  };
  const models = result?.kind === 'ok' ? result.models : [];
  const modelMissing = models.length > 0 && !models.includes(model.trim());
  return (
    <div>
      <FieldLabel htmlFor={id} label="DeepSeek key" badge="Required" />
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <SecretInput
            id={id}
            value={value}
            onChange={(v) => {
              onChange(v);
              setResult(null);
            }}
            describedBy={`${id}-hint`}
            placeholder="sk-…"
          />
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!value.trim() || testing}
          className="mt-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rule-strong bg-card px-3 text-[13px] font-medium text-ink hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-45"
        >
          {testing ? <Spinner className="h-3.5 w-3.5" /> : null}
          Test key
        </button>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-[12px] leading-snug text-ink-3">
        Plans searches, checks matches and writes summaries. Get one at platform.deepseek.com.
      </p>
      <div role="status" aria-live="polite" className="mt-1.5 text-[12.5px]">
        {result?.kind === 'ok' ? (
          <div className="space-y-1.5">
            <p className="inline-flex items-center gap-1 font-medium text-ok-ink">
              <IconCheck className="h-3.5 w-3.5" /> Key works.
            </p>
            {models.length ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[12px] text-ink-3">Models on your key:</span>
                {models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onPickModel(m)}
                    aria-pressed={m === model.trim()}
                    className={`rounded-full border px-2 py-px font-mono text-[11.5px] ${
                      m === model.trim() ? 'border-accent bg-accent-soft text-accent' : 'border-rule-strong text-ink-2 hover:border-accent'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : null}
            {modelMissing ? <p className="text-[12px] text-warn-ink">Your model setting (“{model}”) isn’t in this list. Pick one above.</p> : null}
          </div>
        ) : result?.kind === 'invalid' ? (
          <p className="inline-flex items-center gap-1 font-medium text-err-ink">
            <IconWarn className="h-3.5 w-3.5" /> DeepSeek rejected this key.
          </p>
        ) : result?.kind === 'rate_limited' ? (
          <p className="text-warn-ink">DeepSeek is rate-limiting right now. Try again in a minute.</p>
        ) : result?.kind === 'error' ? (
          <p className="text-err-ink">{result.message}</p>
        ) : null}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, dim = false }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; dim?: boolean }) {
  const id = useId();
  return (
    <div className={`flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 ${dim ? 'opacity-55' : ''}`}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-[12px] leading-snug text-ink-3">
            {hint}
          </p>
        ) : null}
      </div>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className={
            'block h-5 w-9 rounded-full bg-rule-strong transition-colors peer-checked:bg-accent ' +
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ' +
            "after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] " +
            'peer-checked:after:translate-x-4'
          }
        />
      </span>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div>
      <p id={id} className="text-[13px] font-medium text-ink">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="mt-1 inline-flex rounded-lg border border-rule bg-sunk p-0.5">
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input
              type="radio"
              name={id}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className="pointer-events-none block rounded-md px-3 py-1 text-[13px] font-medium text-ink-2 peer-checked:bg-card peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step,
  integer = false,
  prefix,
  hint,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  prefix?: string;
  hint?: string;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const change = (raw: string) => {
    setText(raw);
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      setError(integer ? `Enter a whole number from ${min} to ${max}.` : `Enter a number from ${min} to ${max}.`);
      return;
    }
    setError('');
    onCommit(n);
  };

  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      <div className="relative mt-1">
        {prefix ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-ink-3">{prefix}</span> : null}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (error) {
              setText(String(value));
              setError('');
            }
          }}
          onChange={(e) => change(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={`${id}-hint`}
          className={`${inputClass} tabular-nums ${prefix ? 'pl-6' : ''} ${error ? 'border-err-ink focus:border-err-ink focus:ring-err-ink/20' : ''}`}
        />
      </div>
      <p id={`${id}-hint`} className={`mt-1 text-[12px] leading-snug ${error ? 'text-err-ink' : 'text-ink-3'}`}>
        {error || hint}
      </p>
    </div>
  );
}

function Shortcut() {
  const [keys, setKeys] = useState<string | null>(null);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.commands?.getAll) return;
    chrome.commands.getAll().then(
      (all) => setKeys(all.find((c) => c.name === 'find-source')?.shortcut ?? ''),
      () => setKeys(''),
    );
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <p className="text-[13px] font-medium text-ink">Keyboard shortcut</p>
        <p className="text-[12px] text-ink-3">
          Searches the highlighted text, or opens and closes Backed when nothing is selected. In Google Docs, highlight a sentence and use the shortcut.
        </p>
      </div>
      <kbd className="rounded-md border border-rule bg-sunk px-2 py-1 font-mono text-[12.5px] text-ink">{keys === null ? '…' : keys || 'Not set'}</kbd>
      <button
        type="button"
        onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        className="text-[13px] font-medium text-accent underline underline-offset-2 hover:brightness-110"
      >
        Change shortcut
      </button>
    </div>
  );
}
