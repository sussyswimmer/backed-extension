// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEditableTarget } from '../../src/popup/lib/keyboard';
import { ResultCard } from '../../src/popup/components/ResultCard';
import { RefinePanel } from '../../src/popup/components/RefinePanel';
import { Results } from '../../src/popup/components/Results';
import { displayLists } from '../../src/popup/lib/view';
import type { RefineAnswer, SourceResult } from '../../src/shared/types';
import { KEEP_AS_IS } from '../../src/shared/types';
import { demoState, emptyState, fragment, result, verified, WIKI_META } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const noop = () => undefined;

function renderCard(r: SourceResult, handlers: Partial<{ onTogglePick: (id: string) => void; onNotRelevant: (id: string) => void }> = {}) {
  act(() => {
    root.render(
      <ResultCard
        result={r}
        keyIndex={0}
        picked={false}
        summaryPending={false}
        showDebug={false}
        onTogglePick={handlers.onTogglePick ?? noop}
        onNotRelevant={handlers.onNotRelevant ?? noop}
        onReverify={noop}
      />,
    );
  });
}

describe('ResultCard', () => {
  it('renders untrusted source text as text, and never links non-http URLs', () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const r = result({
      meta: { ...WIKI_META, title: `Title ${evil}`, url: 'javascript:alert(1)', authors: [`<script>bad()</script>`] },
      best: verified({
        candidateId: WIKI_META.id,
        relation: 'paraphrase',
        reason: `Reason ${evil}`,
        fragments: [fragment([{ text: `Passage ${evil}`, match: true }])],
      }),
      finalUrl: 'javascript:alert(2)',
      summary: { howItRelates: `How ${evil}`, summary: 's', droppedSentences: 0, abstractOnly: false },
    });
    renderCard(r);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.querySelector('a')).toBeNull(); // the only link would be the (unsafe) title
    expect(container.textContent).toContain(`Title ${evil}`);
    expect(container.textContent).toContain(`Passage ${evil}`);
    // "Open at passage" is hidden when the URL is not http(s).
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Open at passage'))).toBe(false);
  });

  it('shows badges, highlights matches, and wires Use this / Not relevant', () => {
    const r = demoState().support[0]!;
    const onTogglePick = vi.fn();
    const onNotRelevant = vi.fn();
    renderCard(r, { onTogglePick, onNotRelevant });
    expect(container.textContent).toContain('Peer-reviewed');
    expect(container.textContent).toContain('Direct');
    const marks = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toEqual([expect.stringContaining('we find no statistically significant decline in teen employment')]);
    const title = container.querySelector('h3 a');
    expect(title?.getAttribute('href')).toBe(r.meta.url);
    expect(title?.getAttribute('rel')).toContain('noopener');

    const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
    act(() => button('Use this')?.click());
    expect(onTogglePick).toHaveBeenCalledWith('rivera2019');
    act(() => button('Not relevant')?.click());
    expect(onNotRelevant).toHaveBeenCalledWith('rivera2019');

    // Summary collapsed to the howItRelates line; tap to expand.
    expect(container.textContent).not.toContain('The study compares neighboring counties');
    act(() => (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('The study compares neighboring counties');

    // More passages expands result.more.
    act(() => button('More passages (1)')?.click());
    expect(container.textContent).toContain('Restaurant employment');
  });

  it('shows the Wikipedia tag, the New badge and amber rows', () => {
    const base = demoState().support[2]!;
    renderCard({ ...base, meta: { ...base.meta, isWikipedia: true }, round: 2 });
    expect(container.textContent).toContain('Use to find the real source');
    expect(container.textContent).toContain('New');
    expect(container.textContent).toContain('Abstract only — we couldn’t read the full text');
    expect(container.textContent).toContain('Published in 2014, before your timeframe.');
  });
});

describe('RefinePanel', () => {
  it('collects chip and text answers and sends them with Search again', () => {
    const state = demoState();
    const onAnswer = vi.fn<(a: RefineAnswer[]) => void>();
    act(() => {
      root.render(
        <RefinePanel
          state={state}
          running={false}
          pickedCount={2}
          hasResults
          focusRef={{ current: null }}
          onAnswer={onAnswer}
          onDismiss={noop}
          onSearchAgain={noop}
          onMakeOutput={noop}
        />,
      );
    });
    const searchAgain = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Search again with these')!;
    expect(searchAgain.disabled).toBe(true); // nothing changed yet
    const radio = Array.from(container.querySelectorAll<HTMLInputElement>('input[type=radio]')).find((i) => i.value === 'Southeast Asia')!;
    act(() => radio.click());
    expect(searchAgain.disabled).toBe(false);
    act(() => searchAgain.click());
    expect(onAnswer).toHaveBeenCalledWith([
      { questionId: 'q-region', answer: 'Southeast Asia' },
      { questionId: 'q-strength', answer: KEEP_AS_IS },
      { questionId: 'q-years', answer: KEEP_AS_IS },
    ]);
    expect(container.textContent).toContain('2 picked → Make output');
    expect(container.textContent).toContain('Which of these fits your argument best?');
  });

  it('hides the questions but keeps the pick prompt at the round limit', () => {
    const state = demoState({ round: 3, maxRounds: 3 });
    act(() => {
      root.render(
        <RefinePanel state={state} running={false} pickedCount={0} hasResults focusRef={{ current: null }} onAnswer={noop} onDismiss={noop} onSearchAgain={noop} onMakeOutput={noop} />,
      );
    });
    expect(container.textContent).not.toContain('Search again with these');
    expect(container.textContent).toContain('Which of these fits your argument best?');
    expect(container.textContent).not.toContain('None of these fit');
  });
});

describe('Results empty state', () => {
  it('offers the one-tap chips that send SEARCH_AGAIN text', () => {
    const state = emptyState();
    const onSearchAgain = vi.fn();
    const lists = displayLists(state, { mode: 'essay', debateTab: 'support', pushbackOpen: false, hidden: new Set() });
    act(() => {
      root.render(
        <Results
          state={state}
          mode="essay"
          lists={lists}
          running={false}
          empty
          debateTab="support"
          onDebateTab={noop}
          pushbackOpen={false}
          onPushbackOpen={noop}
          showDebug={false}
          reverify={{}}
          onTogglePick={noop}
          onNotRelevant={noop}
          onReverify={noop}
          onSearchAgain={onSearchAgain}
        />,
      );
    });
    expect(container.textContent).toContain('Nothing solid found');
    const chip = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Drop the region limit')!;
    act(() => chip.click());
    expect(onSearchAgain).toHaveBeenCalledWith('Drop the region limit.');
  });
});

describe('isEditableTarget', () => {
  it('detects text fields but not buttons or radios', () => {
    const make = (tag: string, type?: string) => {
      const el = document.createElement(tag);
      if (type) el.setAttribute('type', type);
      document.body.appendChild(el);
      return el;
    };
    expect(isEditableTarget(make('textarea'))).toBe(true);
    expect(isEditableTarget(make('input', 'text'))).toBe(true);
    expect(isEditableTarget(make('input', 'search'))).toBe(true);
    expect(isEditableTarget(make('select'))).toBe(true);
    expect(isEditableTarget(make('input', 'radio'))).toBe(false);
    expect(isEditableTarget(make('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
