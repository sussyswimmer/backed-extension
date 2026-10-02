// Static guards for the non-negotiables: only verify() makes VerifiedMatch, no HTML injection
// sinks or eval, strict CSP, no secrets in URLs or logs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { restoreJobState } from '../src/background/session';
import { newJobState } from '../src/background/pipeline';
import { redactSecrets } from '../src/shared/settings';
import manifest from '../manifest.config';

const ROOT = join(__dirname, '..');

function files(dir: string, exts = /\.(ts|tsx|html)$/): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

const SRC = files(join(ROOT, 'src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

describe('VerifiedMatch can only be constructed by verify()', () => {
  it('no other source file casts to VerifiedMatch', () => {
    const offenders = SRC.filter((f) => /as\s+(unknown\s+as\s+)?VerifiedMatch\b/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual(['src/background/match/verify.ts']);
  });
});

describe('no HTML injection sinks, no eval / remote code', () => {
  const SINKS = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write\(|\beval\(|new Function\(|setTimeout\(\s*['"`]|setInterval\(\s*['"`]/;
  it('src has none of them', () => {
    const offenders = SRC.filter((f) => SINKS.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('no remote scripts or stylesheets in extension pages', () => {
    for (const f of SRC.filter((x) => x.path.endsWith('.html'))) {
      expect(f.text, f.path).not.toMatch(/<script[^>]+src=["']https?:/i);
      expect(f.text, f.path).not.toMatch(/<link[^>]+href=["']https?:/i);
      expect(f.text, f.path).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i); // no inline scripts
    }
  });

  it('manifest CSP is strict and page access is optional', () => {
    const m = manifest as unknown as {
      content_security_policy: { extension_pages: string };
      host_permissions: string[];
      optional_host_permissions: string[];
    };
    const csp = m.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|https?:/);
    expect(m.host_permissions).not.toContain('<all_urls>');
    expect(m.optional_host_permissions).toContain('<all_urls>');
  });
});

describe('secrets', () => {
  it('no source file logs to the console', () => {
    const offenders = SRC.filter((f) => /console\.(log|info|debug|warn|error)\(/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keys are sent in headers, never as URL parameters', () => {
    const joined = SRC.map((f) => f.text).join('\n');
    expect(joined).not.toMatch(/searchParams\.(set|append)\(\s*['"](api_key|apikey|key|x-api-key)['"]/i);
    expect(joined).not.toMatch(/[?&](api_key|apikey|key)=\$\{/i);
  });

  it('redactSecrets removes keys and bearer tokens from any message', () => {
    const msg = 'Request failed for sk-abcdef1234567890 with Bearer exa_secret_token_99 and key myOpenAlexKey123';
    const out = redactSecrets(msg, ['myOpenAlexKey123']);
    expect(out).not.toContain('sk-abcdef1234567890');
    expect(out).not.toContain('exa_secret_token_99');
    expect(out).not.toContain('myOpenAlexKey123');
  });
});

describe('service worker killed mid-job', () => {
  it('a running job comes back as interrupted with its verified results kept', () => {
    const s = newJobState('claim', 'essay', 1);
    s.status = 'matching';
    s.refining = 'Refining: Vietnam';
    s.support = [{ candidateId: 'c1' } as never];
    const r = restoreJobState(JSON.parse(JSON.stringify(s)));
    expect(r?.status).toBe('interrupted');
    expect(r?.refining).toBeUndefined();
    expect(r?.progress.message).toMatch(/Search interrupted/);
    expect(r?.support).toHaveLength(1);
  });

  it('finished or stopped jobs are restored unchanged; junk is ignored', () => {
    const s = newJobState('claim', 'essay', 1);
    s.status = 'ready';
    expect(restoreJobState(s)?.status).toBe('ready');
    expect(restoreJobState(null)).toBeNull();
    expect(restoreJobState({ foo: 1 })).toBeNull();
  });
});
