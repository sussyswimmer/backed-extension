// Display names for adapters ("OpenAlex: 6 results").

import type { SourceId } from '../../shared/types';

export const ADAPTER_LABELS: Record<SourceId, string> = {
  openalex: 'OpenAlex',
  semantic_scholar: 'Semantic Scholar',
  arxiv: 'arXiv',
  exa_web: 'Exa web',
  exa_news: 'Exa news',
  exa_policy: 'Exa think tanks & gov',
  exa_papers: 'Exa papers',
};

export function adapterLabel(id: SourceId): string {
  return ADAPTER_LABELS[id] ?? id;
}
