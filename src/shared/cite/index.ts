// Citation and "Copy as…" formatters. Pure functions: CandidateMeta / SourceResult in, text + HTML out.

export type { Formatted } from './rich';
export type { ParsedName } from './names';
export type { PageRef } from './pages';
export type { CiteStyle, CitationOptions } from './styles';
export type { ModeOutputs } from './output';

export { parseAuthorName } from './names';
export { pagesOf } from './pages';
export { formatCitation, formatInText, styleForMode } from './styles';
export { formatQuote, honestyLine, relationLabel } from './quote';
export { formatDebateCite, formatDebateCard } from './debate';
export { formatLinkSummaryQuote, formatForMode, formatAll, exportMarkdown } from './output';
export { textFragmentUrl, pdfPageUrl, openAtPassageUrl } from './urls';
export { escapeHtml } from './rich';
