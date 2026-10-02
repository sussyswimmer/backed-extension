// Credibility tiers by domain. Static, editable lists: add a [domain, display name] pair to the right list.
// A domain matches itself and all of its subdomains ("un.org" matches "news.un.org").

import type { SourceTier } from '../../shared/types';
import { doiFromUrl } from './url';

type DomainEntry = readonly [domain: string, name: string];

export const TIER_WEIGHT: Record<SourceTier, number> = {
  peer_reviewed: 1.0,
  gov_igo: 0.95,
  think_tank: 0.8,
  major_news: 0.75,
  preprint: 0.7,
  web: 0.4,
};

export const THINK_TANKS: readonly DomainEntry[] = [
  ['brookings.edu', 'Brookings Institution'],
  ['cfr.org', 'Council on Foreign Relations'],
  ['piie.com', 'Peterson Institute for International Economics'],
  ['rand.org', 'RAND Corporation'],
  ['cato.org', 'Cato Institute'],
  ['heritage.org', 'Heritage Foundation'],
  ['aei.org', 'American Enterprise Institute'],
  ['csis.org', 'Center for Strategic and International Studies'],
  ['chathamhouse.org', 'Chatham House'],
  ['carnegieendowment.org', 'Carnegie Endowment for International Peace'],
  ['urban.org', 'Urban Institute'],
  ['epi.org', 'Economic Policy Institute'],
  ['cgdev.org', 'Center for Global Development'],
  ['cepr.org', 'CEPR'],
  ['bruegel.org', 'Bruegel'],
  ['iiss.org', 'IISS'],
  ['lowyinstitute.org', 'Lowy Institute'],
  ['iseas.edu.sg', 'ISEAS–Yusof Ishak Institute'],
  ['eastasiaforum.org', 'East Asia Forum'],
  ['wilsoncenter.org', 'Wilson Center'],
  ['hoover.org', 'Hoover Institution'],
  ['americanprogress.org', 'Center for American Progress'],
  ['manhattan.institute', 'Manhattan Institute'],
  ['manhattan-institute.org', 'Manhattan Institute'],
  ['newamerica.org', 'New America'],
  ['pewresearch.org', 'Pew Research Center'],
  ['cbpp.org', 'Center on Budget and Policy Priorities'],
  ['taxfoundation.org', 'Tax Foundation'],
  ['taxpolicycenter.org', 'Tax Policy Center'],
  ['mercatus.org', 'Mercatus Center'],
  ['niskanencenter.org', 'Niskanen Center'],
  ['thirdway.org', 'Third Way'],
  ['atlanticcouncil.org', 'Atlantic Council'],
  ['stimson.org', 'Stimson Center'],
  ['belfercenter.org', 'Belfer Center'],
  ['crisisgroup.org', 'International Crisis Group'],
  ['sipri.org', 'SIPRI'],
  ['ifpri.org', 'IFPRI'],
  ['wri.org', 'World Resources Institute'],
  ['rff.org', 'Resources for the Future'],
  ['odi.org', 'ODI'],
  ['ifs.org.uk', 'Institute for Fiscal Studies'],
  ['resolutionfoundation.org', 'Resolution Foundation'],
  ['ecfr.eu', 'European Council on Foreign Relations'],
  ['gmfus.org', 'German Marshall Fund'],
  ['ifw-kiel.de', 'Kiel Institute'],
  ['piie.org', 'Peterson Institute for International Economics'],
  ['milkeninstitute.org', 'Milken Institute'],
  ['kff.org', 'KFF'],
  ['commonwealthfund.org', 'Commonwealth Fund'],
  ['nationalaffairs.com', 'National Affairs'],
];

export const MAJOR_NEWS: readonly DomainEntry[] = [
  ['reuters.com', 'Reuters'],
  ['apnews.com', 'AP News'],
  ['bbc.com', 'BBC'],
  ['bbc.co.uk', 'BBC'],
  ['nytimes.com', 'The New York Times'],
  ['wsj.com', 'The Wall Street Journal'],
  ['ft.com', 'Financial Times'],
  ['economist.com', 'The Economist'],
  ['bloomberg.com', 'Bloomberg'],
  ['theguardian.com', 'The Guardian'],
  ['washingtonpost.com', 'The Washington Post'],
  ['asia.nikkei.com', 'Nikkei Asia'],
  ['nikkei.com', 'Nikkei'],
  ['scmp.com', 'South China Morning Post'],
  ['e.vnexpress.net', 'VnExpress International'],
  ['npr.org', 'NPR'],
  ['cnn.com', 'CNN'],
  ['cnbc.com', 'CNBC'],
  ['theatlantic.com', 'The Atlantic'],
  ['axios.com', 'Axios'],
  ['politico.com', 'Politico'],
  ['politico.eu', 'Politico Europe'],
  ['latimes.com', 'Los Angeles Times'],
  ['usatoday.com', 'USA Today'],
  ['nbcnews.com', 'NBC News'],
  ['cbsnews.com', 'CBS News'],
  ['abcnews.go.com', 'ABC News'],
  ['abc.net.au', 'ABC News (Australia)'],
  ['aljazeera.com', 'Al Jazeera'],
  ['dw.com', 'DW'],
  ['france24.com', 'France 24'],
  ['afp.com', 'AFP'],
  ['straitstimes.com', 'The Straits Times'],
  ['channelnewsasia.com', 'CNA'],
  ['japantimes.co.jp', 'The Japan Times'],
  ['thehindu.com', 'The Hindu'],
  ['smh.com.au', 'The Sydney Morning Herald'],
  ['theglobeandmail.com', 'The Globe and Mail'],
  ['cbc.ca', 'CBC News'],
  ['time.com', 'TIME'],
  ['newyorker.com', 'The New Yorker'],
  ['foreignaffairs.com', 'Foreign Affairs'],
  ['foreignpolicy.com', 'Foreign Policy'],
  ['propublica.org', 'ProPublica'],
  ['voanews.com', 'Voice of America'],
  ['thediplomat.com', 'The Diplomat'],
  ['vietnamnews.vn', 'Viet Nam News'],
  ['tuoitrenews.vn', 'Tuoi Tre News'],
  ['vir.com.vn', 'Vietnam Investment Review'],
  ['marketwatch.com', 'MarketWatch'],
  ['barrons.com', "Barron's"],
  ['forbes.com', 'Forbes'],
  ['vox.com', 'Vox'],
];

export const GOV_IGO: readonly DomainEntry[] = [
  ['imf.org', 'International Monetary Fund'],
  ['worldbank.org', 'World Bank'],
  ['oecd.org', 'OECD'],
  ['oecd-ilibrary.org', 'OECD iLibrary'],
  ['un.org', 'United Nations'],
  ['adb.org', 'Asian Development Bank'],
  ['bis.org', 'Bank for International Settlements'],
  ['who.int', 'World Health Organization'],
  ['europa.eu', 'European Union'],
  ['ecb.europa.eu', 'European Central Bank'],
  ['wto.org', 'World Trade Organization'],
  ['ilo.org', 'International Labour Organization'],
  ['unesco.org', 'UNESCO'],
  ['unicef.org', 'UNICEF'],
  ['undp.org', 'UNDP'],
  ['unctad.org', 'UNCTAD'],
  ['unep.org', 'UNEP'],
  ['unhcr.org', 'UNHCR'],
  ['unodc.org', 'UNODC'],
  ['fao.org', 'FAO'],
  ['wfp.org', 'World Food Programme'],
  ['iea.org', 'International Energy Agency'],
  ['irena.org', 'IRENA'],
  ['iadb.org', 'Inter-American Development Bank'],
  ['afdb.org', 'African Development Bank'],
  ['aiib.org', 'Asian Infrastructure Investment Bank'],
  ['ebrd.com', 'EBRD'],
  ['eib.org', 'European Investment Bank'],
  ['ifc.org', 'International Finance Corporation'],
  ['ipcc.ch', 'IPCC'],
  ['asean.org', 'ASEAN'],
  ['apec.org', 'APEC'],
  ['amro-asia.org', 'ASEAN+3 Macroeconomic Research Office'],
  ['osce.org', 'OSCE'],
  ['federalreserve.gov', 'Federal Reserve'],
  ['newyorkfed.org', 'Federal Reserve Bank of New York'],
  ['stlouisfed.org', 'Federal Reserve Bank of St. Louis'],
  ['frbsf.org', 'Federal Reserve Bank of San Francisco'],
  ['chicagofed.org', 'Federal Reserve Bank of Chicago'],
  ['kansascityfed.org', 'Federal Reserve Bank of Kansas City'],
  ['dallasfed.org', 'Federal Reserve Bank of Dallas'],
  ['atlantafed.org', 'Federal Reserve Bank of Atlanta'],
  ['bostonfed.org', 'Federal Reserve Bank of Boston'],
  ['clevelandfed.org', 'Federal Reserve Bank of Cleveland'],
  ['minneapolisfed.org', 'Federal Reserve Bank of Minneapolis'],
  ['richmondfed.org', 'Federal Reserve Bank of Richmond'],
  ['philadelphiafed.org', 'Federal Reserve Bank of Philadelphia'],
  ['bankofengland.co.uk', 'Bank of England'],
  ['bankofcanada.ca', 'Bank of Canada'],
  ['boj.or.jp', 'Bank of Japan'],
  ['bundesbank.de', 'Deutsche Bundesbank'],
  ['rbi.org.in', 'Reserve Bank of India'],
  ['parliament.uk', 'UK Parliament'],
  ['nhs.uk', 'NHS'],
  ['obr.uk', 'Office for Budget Responsibility'],
  ['nao.org.uk', 'National Audit Office'],
  ['canada.ca', 'Government of Canada'],
  ['chinhphu.vn', 'Government of Viet Nam'],
  ['sbv.gov.vn', 'State Bank of Vietnam'],
  ['gso.gov.vn', 'General Statistics Office of Vietnam'],
  ['gov.vn', 'Government of Viet Nam'],
  ['gov.uk', 'UK Government'],
  ['ons.gov.uk', 'Office for National Statistics'],
  ['mas.gov.sg', 'Monetary Authority of Singapore'],
  ['bls.gov', 'U.S. Bureau of Labor Statistics'],
  ['bea.gov', 'U.S. Bureau of Economic Analysis'],
  ['census.gov', 'U.S. Census Bureau'],
  ['cbo.gov', 'Congressional Budget Office'],
  ['gao.gov', 'U.S. Government Accountability Office'],
  ['congress.gov', 'U.S. Congress'],
  ['whitehouse.gov', 'The White House'],
  ['treasury.gov', 'U.S. Department of the Treasury'],
  ['state.gov', 'U.S. Department of State'],
  ['dol.gov', 'U.S. Department of Labor'],
  ['ed.gov', 'U.S. Department of Education'],
  ['usda.gov', 'U.S. Department of Agriculture'],
  ['epa.gov', 'U.S. Environmental Protection Agency'],
  ['energy.gov', 'U.S. Department of Energy'],
  ['eia.gov', 'U.S. Energy Information Administration'],
  ['cdc.gov', 'CDC'],
  ['nih.gov', 'National Institutes of Health'],
  ['hhs.gov', 'U.S. Department of Health and Human Services'],
  ['fda.gov', 'FDA'],
  ['ftc.gov', 'Federal Trade Commission'],
  ['sec.gov', 'SEC'],
  ['ssa.gov', 'Social Security Administration'],
  ['usaid.gov', 'USAID'],
  ['nasa.gov', 'NASA'],
  ['noaa.gov', 'NOAA'],
  ['ustr.gov', 'Office of the U.S. Trade Representative'],
  ['abs.gov.au', 'Australian Bureau of Statistics'],
  ['rba.gov.au', 'Reserve Bank of Australia'],
  ['statcan.gc.ca', 'Statistics Canada'],
];

/** Government / IGO hostname patterns (.gov, .gov.uk, .gob.mx, .gouv.fr, .go.jp, .gc.ca, .int, .mil …). */
const GOV_PATTERNS: readonly RegExp[] = [
  /(^|\.)(gov|mil|int)$/,
  /(^|\.)(gov|gob|gouv|govt|go|gv|gub)\.[a-z]{2}$/,
  /(^|\.)gc\.ca$/,
  /(^|\.)nic\.in$/,
];

export const JOURNALS: readonly DomainEntry[] = [
  ['nature.com', 'Nature'],
  ['science.org', 'Science'],
  ['sciencemag.org', 'Science'],
  ['sciencedirect.com', 'ScienceDirect'],
  ['cell.com', 'Cell Press'],
  ['thelancet.com', 'The Lancet'],
  ['springer.com', 'Springer'],
  ['link.springer.com', 'Springer'],
  ['springeropen.com', 'SpringerOpen'],
  ['biomedcentral.com', 'BMC'],
  ['wiley.com', 'Wiley'],
  ['tandfonline.com', 'Taylor & Francis'],
  ['jstor.org', 'JSTOR'],
  ['academic.oup.com', 'Oxford Academic'],
  ['cambridge.org', 'Cambridge University Press'],
  ['sagepub.com', 'SAGE'],
  ['plos.org', 'PLOS'],
  ['pnas.org', 'PNAS'],
  ['nejm.org', 'NEJM'],
  ['bmj.com', 'The BMJ'],
  ['jamanetwork.com', 'JAMA Network'],
  ['aeaweb.org', 'American Economic Association'],
  ['frontiersin.org', 'Frontiers'],
  ['mdpi.com', 'MDPI'],
  ['ieeexplore.ieee.org', 'IEEE Xplore'],
  ['dl.acm.org', 'ACM Digital Library'],
  ['annualreviews.org', 'Annual Reviews'],
  ['emerald.com', 'Emerald'],
  ['degruyter.com', 'De Gruyter'],
  ['journals.uchicago.edu', 'University of Chicago Press'],
  ['muse.jhu.edu', 'Project MUSE'],
  ['journals.aps.org', 'American Physical Society'],
  ['iopscience.iop.org', 'IOP Publishing'],
  ['pubs.acs.org', 'ACS Publications'],
  ['pubs.rsc.org', 'Royal Society of Chemistry'],
  ['pubs.aip.org', 'AIP Publishing'],
  ['royalsocietypublishing.org', 'Royal Society Publishing'],
  ['elifesciences.org', 'eLife'],
  ['peerj.com', 'PeerJ'],
  ['hindawi.com', 'Hindawi'],
  ['karger.com', 'Karger'],
  ['journals.lww.com', 'Wolters Kluwer'],
  ['ahajournals.org', 'AHA Journals'],
  ['psycnet.apa.org', 'APA PsycNet'],
  ['pubsonline.informs.org', 'INFORMS'],
  ['journals.aom.org', 'Academy of Management'],
  ['econometricsociety.org', 'Econometric Society'],
  ['bioone.org', 'BioOne'],
  ['acpjournals.org', 'ACP Journals'],
  ['europepmc.org', 'Europe PMC'],
  ['ncbi.nlm.nih.gov', 'PubMed Central'],
  ['pubmed.ncbi.nlm.nih.gov', 'PubMed'],
  ['pmc.ncbi.nlm.nih.gov', 'PubMed Central'],
];

export const PREPRINT_SERVERS: readonly DomainEntry[] = [
  ['arxiv.org', 'arXiv'],
  ['ssrn.com', 'SSRN'],
  ['researchgate.net', 'ResearchGate'],
  ['osf.io', 'OSF'],
  ['biorxiv.org', 'bioRxiv'],
  ['medrxiv.org', 'medRxiv'],
  ['nber.org', 'NBER'],
  ['iza.org', 'IZA Institute of Labor Economics'],
  ['econstor.eu', 'EconStor'],
  ['ideas.repec.org', 'RePEc'],
  ['repec.org', 'RePEc'],
  ['preprints.org', 'Preprints.org'],
  ['zenodo.org', 'Zenodo'],
  ['hal.science', 'HAL'],
  ['hal.archives-ouvertes.fr', 'HAL'],
  ['psyarxiv.com', 'PsyArXiv'],
  ['philarchive.org', 'PhilArchive'],
  ['core.ac.uk', 'CORE'],
  ['eprints.lse.ac.uk', 'LSE Research Online'],
];

/** DOI prefixes registered by preprint servers / working-paper series. */
const PREPRINT_DOI_PREFIXES: readonly string[] = [
  '10.48550', // arXiv
  '10.2139', // SSRN
  '10.1101', // bioRxiv / medRxiv
  '10.31219', // OSF
  '10.31234', // PsyArXiv
  '10.31235',
  '10.20944', // Preprints.org
  '10.5281', // Zenodo
  '10.3386', // NBER working papers
  '10.21203', // Research Square
];

/** Content farms, essay mills, Q&A/social sites, fan wikis: kept but ranked last and excluded from Exa web search. */
export const LOW_QUALITY_DOMAINS: readonly string[] = [
  'ukessays.com',
  'ivypanda.com',
  'studymoose.com',
  'gradesfixer.com',
  'bartleby.com',
  'papersowl.com',
  'edubirdie.com',
  'essaypro.com',
  'studycorgi.com',
  'kibin.com',
  'phdessay.com',
  'cram.com',
  'enotes.com',
  'quizlet.com',
  'chegg.com',
  'coursehero.com',
  'studocu.com',
  'scribd.com',
  'brainly.com',
  'brainly.in',
  'answers.com',
  'quora.com',
  'reddit.com',
  'pinterest.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'youtube.com',
  'linkedin.com',
  'fandom.com',
  'wikihow.com',
  'ehow.com',
  'hubpages.com',
  'ezinearticles.com',
  'wattpad.com',
  'slideshare.net',
  'prezi.com',
];

const LOW_QUALITY_PATTERNS: readonly RegExp[] = [/(^|\.)brainly\.[a-z.]+$/, /(^|\.)pinterest\.[a-z.]+$/, /essay/];

/** Domains excluded from the general Exa web search. */
export const EXA_EXCLUDE_DOMAINS: readonly string[] = [...LOW_QUALITY_DOMAINS];

/** Wildcard entries so subdomains are included whatever Exa's default subdomain handling is. */
const POLICY_WILDCARDS: readonly string[] = ['*.un.org', '*.europa.eu', '*.gov.uk', '*.gov.vn', '*.worldbank.org', '*.imf.org', '*.oecd.org'];

/** includeDomains for the Exa think-tank + gov/IGO adapter. */
export const POLICY_INCLUDE_DOMAINS: readonly string[] = Array.from(
  new Set([...THINK_TANKS.map(([d]) => d), ...GOV_IGO.map(([d]) => d), ...POLICY_WILDCARDS]),
);

export interface TierInfo {
  tier: SourceTier;
  lowQuality?: boolean;
  isWikipedia?: boolean;
  publisherName?: string;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

/** Most specific (longest) matching entry, so "ecb.europa.eu" beats "europa.eu". */
function findEntry(host: string, list: readonly DomainEntry[]): DomainEntry | undefined {
  let best: DomainEntry | undefined;
  for (const e of list) if (hostMatches(host, e[0]) && (!best || e[0].length > best[0].length)) best = e;
  return best;
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\d?\./, '');
  } catch {
    return '';
  }
}

export function isLowQualityHost(host: string): boolean {
  return LOW_QUALITY_DOMAINS.some((d) => hostMatches(host, d)) || LOW_QUALITY_PATTERNS.some((re) => re.test(host));
}

export function isGovHost(host: string): boolean {
  return GOV_PATTERNS.some((re) => re.test(host)) || !!findEntry(host, GOV_IGO);
}

/** Tier for a URL by its domain. Unknown or unparsable URLs are `web`. */
export function tierForUrl(url: string): TierInfo {
  const host = hostOfUrl(url);
  if (!host) return { tier: 'web' };
  if (/(^|\.)wikipedia\.org$/.test(host)) return { tier: 'web', isWikipedia: true, publisherName: 'Wikipedia' };
  if (isLowQualityHost(host)) return { tier: 'web', lowQuality: true };

  if (host === 'doi.org' || host === 'dx.doi.org') {
    const doi = doiFromUrl(url);
    if (doi && PREPRINT_DOI_PREFIXES.some((p) => doi.startsWith(p + '/'))) return { tier: 'preprint' };
    return { tier: doi ? 'peer_reviewed' : 'web' };
  }

  // Papers first: PubMed/PMC live on .gov but are journal articles; NBER is a think tank but posts working papers.
  const journal = findEntry(host, JOURNALS);
  if (journal) return { tier: 'peer_reviewed', publisherName: journal[1] };
  const preprint = findEntry(host, PREPRINT_SERVERS);
  if (preprint) return { tier: 'preprint', publisherName: preprint[1] };

  const gov = findEntry(host, GOV_IGO);
  if (gov) return { tier: 'gov_igo', publisherName: gov[1] };
  if (GOV_PATTERNS.some((re) => re.test(host))) return { tier: 'gov_igo' };

  const tank = findEntry(host, THINK_TANKS);
  if (tank) return { tier: 'think_tank', publisherName: tank[1] };
  const news = findEntry(host, MAJOR_NEWS);
  if (news) return { tier: 'major_news', publisherName: news[1] };
  return { tier: 'web' };
}

/** True when the DOI belongs to a preprint server / working-paper series. */
export function isPreprintDoi(doi: string): boolean {
  const d = doi.toLowerCase();
  return PREPRINT_DOI_PREFIXES.some((p) => d.startsWith(p + '/'));
}

/** Display name for a known domain, else undefined. */
export function publisherForHost(host: string): string | undefined {
  const h = host.toLowerCase().replace(/^www\d?\./, '');
  for (const list of [JOURNALS, PREPRINT_SERVERS, GOV_IGO, THINK_TANKS, MAJOR_NEWS]) {
    const e = findEntry(h, list);
    if (e) return e[1];
  }
  return undefined;
}

/** Compare tiers by weight (higher is better). */
export function betterTier(a: SourceTier, b: SourceTier): SourceTier {
  return TIER_WEIGHT[b] > TIER_WEIGHT[a] ? b : a;
}
