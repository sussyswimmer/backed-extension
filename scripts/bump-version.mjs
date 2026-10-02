// Bump the extension version (manifest.config.ts reads it from package.json).
// Usage: npm run version:bump -- [patch|minor|major]   (default: patch)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const kind = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: npm run version:bump -- [patch|minor|major]');
  process.exit(2);
}
for (const file of ['package.json', 'package-lock.json']) {
  const path = join(import.meta.dirname, '..', file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const [major, minor, patch] = String(json.version).split('.').map(Number);
  const next = kind === 'major' ? `${major + 1}.0.0` : kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  json.version = next;
  if (json.packages?.['']) json.packages[''].version = next;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  if (file === 'package.json') console.log(`version ${major}.${minor}.${patch} → ${next}`);
}
