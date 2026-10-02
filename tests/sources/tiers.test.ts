import { describe, expect, it } from 'vitest';
import type { SourceTier } from '../../src/shared/types';
import { EXA_EXCLUDE_DOMAINS, POLICY_INCLUDE_DOMAINS, tierForUrl } from '../../src/background/sources';

describe('tierForUrl', () => {
  it.each<[string, SourceTier, string?]>([
    ['https://www.brookings.edu/articles/x/', 'think_tank', 'Brookings Institution'],
    ['https://www.cfr.org/backgrounder/x', 'think_tank', 'Council on Foreign Relations'],
    ['https://www.piie.com/blogs/x', 'think_tank'],
    ['https://www.rand.org/pubs/x.html', 'think_tank'],
    ['https://www.cato.org/x', 'think_tank'],
    ['https://www.epi.org/publication/x/', 'think_tank'],
    ['https://www.nber.org/papers/w12663', 'preprint', 'NBER'],
    ['https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1', 'preprint', 'SSRN'],
    ['https://arxiv.org/abs/2001.08361', 'preprint', 'arXiv'],
    ['https://www.researchgate.net/publication/1', 'preprint'],
    ['https://osf.io/abc12', 'preprint'],
    ['https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1', 'preprint'],
    ['https://www.medrxiv.org/content/x', 'preprint'],
    ['https://www.reuters.com/world/x', 'major_news', 'Reuters'],
    ['https://apnews.com/article/x', 'major_news'],
    ['https://www.bbc.co.uk/news/x', 'major_news', 'BBC'],
    ['https://www.bbc.com/news/x', 'major_news'],
    ['https://www.ft.com/content/x', 'major_news'],
    ['https://asia.nikkei.com/Economy/x', 'major_news', 'Nikkei Asia'],
    ['https://www.scmp.com/news/x', 'major_news'],
    ['https://e.vnexpress.net/news/x', 'major_news', 'VnExpress International'],
    ['https://vnexpress.net/x.html', 'web'],
    ['https://www.npr.org/x', 'major_news'],
    ['https://www.imf.org/en/Publications/WP/x', 'gov_igo', 'International Monetary Fund'],
    ['https://www.worldbank.org/en/x', 'gov_igo'],
    ['https://openknowledge.worldbank.org/x', 'gov_igo'],
    ['https://www.oecd.org/x', 'gov_igo'],
    ['https://news.un.org/en/story/x', 'gov_igo'],
    ['https://www.adb.org/x', 'gov_igo'],
    ['https://www.bis.org/x', 'gov_igo'],
    ['https://www.who.int/news/x', 'gov_igo'],
    ['https://ec.europa.eu/eurostat/x', 'gov_igo'],
    ['https://www.ecb.europa.eu/pub/x', 'gov_igo', 'European Central Bank'],
    ['https://www.federalreserve.gov/econres/x', 'gov_igo', 'Federal Reserve'],
    ['https://www.bls.gov/x', 'gov_igo'],
    ['https://www.some-agency.gov/report', 'gov_igo'],
    ['https://www.gov.uk/government/x', 'gov_igo'],
    ['https://www.ons.gov.uk/x', 'gov_igo', 'Office for National Statistics'],
    ['https://www.sbv.gov.vn/x', 'gov_igo', 'State Bank of Vietnam'],
    ['https://www.gso.gov.vn/en/x', 'gov_igo'],
    ['https://www.army.mil/article/x', 'gov_igo'],
    ['https://www.wipo.int/x', 'gov_igo'],
    ['https://www.statcan.gc.ca/x', 'gov_igo'],
    ['https://www.nature.com/articles/s41586-020-1234-5', 'peer_reviewed', 'Nature'],
    ['https://www.science.org/doi/10.1126/science.abc', 'peer_reviewed'],
    ['https://www.sciencedirect.com/science/article/pii/S0', 'peer_reviewed'],
    ['https://link.springer.com/article/10.1007/x', 'peer_reviewed', 'Springer'],
    ['https://onlinelibrary.wiley.com/doi/10.1111/x', 'peer_reviewed'],
    ['https://www.tandfonline.com/doi/full/x', 'peer_reviewed'],
    ['https://www.jstor.org/stable/123', 'peer_reviewed'],
    ['https://academic.oup.com/qje/article/x', 'peer_reviewed'],
    ['https://www.cambridge.org/core/x', 'peer_reviewed'],
    ['https://journals.sagepub.com/doi/x', 'peer_reviewed'],
    ['https://journals.plos.org/plosone/x', 'peer_reviewed'],
    ['https://www.pnas.org/doi/x', 'peer_reviewed'],
    ['https://www.thelancet.com/journals/x', 'peer_reviewed'],
    ['https://www.nejm.org/doi/x', 'peer_reviewed'],
    ['https://www.bmj.com/content/x', 'peer_reviewed'],
    ['https://jamanetwork.com/journals/x', 'peer_reviewed'],
    ['https://www.aeaweb.org/articles?id=10.1257/aer.1', 'peer_reviewed'],
    ['https://www.frontiersin.org/articles/x', 'peer_reviewed'],
    ['https://www.mdpi.com/2071-1050/1/1/1', 'peer_reviewed'],
    ['https://www.cell.com/cell/x', 'peer_reviewed'],
    ['https://ieeexplore.ieee.org/document/1', 'peer_reviewed'],
    ['https://dl.acm.org/doi/10.1145/1', 'peer_reviewed'],
    ['https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/', 'peer_reviewed'],
    ['https://pubmed.ncbi.nlm.nih.gov/123456/', 'peer_reviewed', 'PubMed'],
    ['https://www.nimh.nih.gov/health/x', 'gov_igo'],
    ['https://doi.org/10.1093/qje/qjz014', 'peer_reviewed'],
    ['https://doi.org/10.48550/arXiv.2001.08361', 'preprint'],
    ['https://doi.org/10.2139/ssrn.123', 'preprint'],
    ['https://abcnews.go.com/x', 'major_news'],
    ['https://www.example-blog.com/x', 'web'],
    ['not a url', 'web'],
  ])('%s → %s', (url, tier, publisher) => {
    const t = tierForUrl(url);
    expect(t.tier).toBe(tier);
    expect(t.lowQuality).toBeUndefined();
    if (publisher) expect(t.publisherName).toBe(publisher);
  });

  it.each([
    'https://www.ukessays.com/essays/economics/x.php',
    'https://ivypanda.com/essays/x/',
    'https://studymoose.com/x',
    'https://gradesfixer.com/free-essay-examples/x/',
    'https://www.bartleby.com/essay/x',
    'https://papersowl.com/examples/x/',
    'https://www.quora.com/Do-minimum-wage-hikes',
    'https://www.reddit.com/r/economics/x',
    'https://old.reddit.com/r/economics/x',
    'https://www.answers.com/x',
    'https://brainly.com/question/1',
    'https://brainly.ph/question/1',
    'https://www.chegg.com/x',
    'https://www.coursehero.com/file/1',
    'https://www.studocu.com/x',
    'https://www.scribd.com/document/1',
    'https://www.pinterest.com/pin/1',
    'https://www.facebook.com/x',
    'https://x.com/user/status/1',
    'https://twitter.com/user/status/1',
    'https://www.tiktok.com/@x',
    'https://www.youtube.com/watch?v=1',
    'https://economics.fandom.com/wiki/x',
    'https://www.essayshark.com/x',
  ])('low quality: %s', (url) => {
    expect(tierForUrl(url)).toMatchObject({ tier: 'web', lowQuality: true });
  });

  it('flags Wikipedia', () => {
    expect(tierForUrl('https://en.wikipedia.org/wiki/Minimum_wage')).toEqual({ tier: 'web', isWikipedia: true, publisherName: 'Wikipedia' });
    expect(tierForUrl('https://en.m.wikipedia.org/wiki/Minimum_wage').isWikipedia).toBe(true);
  });

  it('exports exclusion and policy domain lists', () => {
    expect(EXA_EXCLUDE_DOMAINS).toEqual(expect.arrayContaining(['ukessays.com', 'quora.com', 'reddit.com', 'youtube.com']));
    expect(POLICY_INCLUDE_DOMAINS).toEqual(expect.arrayContaining(['brookings.edu', 'cfr.org', 'imf.org', 'worldbank.org', 'gov.uk', 'sbv.gov.vn']));
    expect(POLICY_INCLUDE_DOMAINS).not.toContain('reuters.com');
    expect(new Set(POLICY_INCLUDE_DOMAINS).size).toBe(POLICY_INCLUDE_DOMAINS.length);
  });
});
