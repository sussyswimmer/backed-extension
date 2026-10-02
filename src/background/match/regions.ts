// Cheap region detection for the refine prompt's compact result summary ("regions=United States").

const REGIONS: Array<[string, RegExp]> = [
  ['United States', /\b(united states|u\.s\.(?!\w)|usa\b|american (?:workers|states|economy|teens|adolescents|counties|cities)|us states|state minimum wage)/i],
  ['United Kingdom', /\b(united kingdom|u\.k\.(?!\w)|britain|british|england|scotland|wales)\b/i],
  ['Canada', /\bcanad(a|ian)\b/i],
  ['Mexico', /\bmexic(o|an)\b/i],
  ['Brazil', /\bbrazil(ian)?\b/i],
  ['Argentina', /\bargentin(a|e|ian)\b/i],
  ['Chile', /\bchile(an)?\b/i],
  ['Colombia', /\bcolombia(n)?\b/i],
  ['Peru', /\bperu(vian)?\b/i],
  ['Germany', /\bgerman(y)?\b/i],
  ['France', /\b(france|french)\b/i],
  ['Italy', /\b(italy|italian)\b/i],
  ['Spain', /\b(spain|spanish)\b/i],
  ['Portugal', /\bportug(al|uese)\b/i],
  ['Netherlands', /\b(netherlands|dutch)\b/i],
  ['Sweden', /\bswed(en|ish)\b/i],
  ['Norway', /\bnorw(ay|egian)\b/i],
  ['Denmark', /\b(denmark|danish)\b/i],
  ['Finland', /\bfin(land|nish)\b/i],
  ['Poland', /\bpol(and|ish)\b/i],
  ['Greece', /\b(greece|greek)\b/i],
  ['Russia', /\bruss(ia|ian)\b/i],
  ['Ukraine', /\bukrain(e|ian)\b/i],
  ['Turkey', /\b(turkey|turkish|türkiye)\b/i],
  ['Europe', /\b(europe|european union|eurozone|euro area|\beu\b)/i],
  ['China', /\b(china|chinese|prc)\b/i],
  ['Japan', /\bjapan(ese)?\b/i],
  ['South Korea', /\b(south korea|korean)\b/i],
  ['Taiwan', /\btaiwan(ese)?\b/i],
  ['Hong Kong', /\bhong kong\b/i],
  ['India', /\bindia(n)?\b/i],
  ['Pakistan', /\bpakistan(i)?\b/i],
  ['Bangladesh', /\bbangladesh(i)?\b/i],
  ['Indonesia', /\bindonesia(n)?\b/i],
  ['Malaysia', /\bmalaysia(n)?\b/i],
  ['Thailand', /\b(thailand|thai)\b/i],
  ['Vietnam', /\b(vietnam|viet nam|vietnamese)\b/i],
  ['Philippines', /\b(philippines|filipino)\b/i],
  ['Singapore', /\bsingapore(an)?\b/i],
  ['South Korea', /\bkorea\b/i],
  ['Southeast Asia', /\b(southeast asia|south-east asia|asean)\b/i],
  ['Australia', /\baustralia(n)?\b/i],
  ['New Zealand', /\bnew zealand\b/i],
  ['South Africa', /\bsouth africa(n)?\b/i],
  ['Nigeria', /\bnigeria(n)?\b/i],
  ['Kenya', /\bkenya(n)?\b/i],
  ['Ethiopia', /\bethiopia(n)?\b/i],
  ['Egypt', /\begypt(ian)?\b/i],
  ['Africa', /\b(africa|sub-saharan)\b/i],
  ['Israel', /\bisrael(i)?\b/i],
  ['Iran', /\biran(ian)?\b/i],
  ['Saudi Arabia', /\bsaudi\b/i],
  ['Latin America', /\blatin america(n)?\b/i],
  ['Middle East', /\bmiddle east(ern)?\b/i],
  ['OECD countries', /\boecd countries\b/i],
  ['Global', /\b(cross-country|cross-national|global|worldwide|\d+ countries)\b/i],
];

export function detectRegions(text: string, max = 3): string[] {
  const found: string[] = [];
  for (const [name, re] of REGIONS) {
    if (found.length >= max) break;
    if (!found.includes(name) && re.test(text)) found.push(name);
  }
  return found;
}
