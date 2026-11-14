// Static sanity checks run in CI: every module referenced by the shell exists and parses,
// and the service-worker precache list matches the files on disk.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = ['index.html', 'sw.js', 'manifest.webmanifest', 'icons/icon.svg', 'src/ui/styles.css',
  'src/ui/app.js', 'src/ui/dom.js', 'src/core/dates.js', 'src/core/parser.js', 'src/core/store.js', 'src/core/sample.js'];
let bad = 0;
for (const f of files) {
  if (!existsSync(f)) { console.error(`missing: ${f}`); bad += 1; }
}
for (const f of files.filter((x) => x.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { console.error(`syntax: ${f}\n${e.stderr}`); bad += 1; }
}
JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
const sw = readFileSync('sw.js', 'utf8');
for (const f of files.filter((x) => !['sw.js'].includes(x))) {
  if (!sw.includes(`'${f}'`)) { console.error(`not precached: ${f}`); bad += 1; }
}
const html = readFileSync('index.html', 'utf8');
if (/<script(?![^>]*\bsrc=)/i.test(html) || /\son\w+=/i.test(html)) { console.error('inline script or handler in index.html'); bad += 1; }
if (bad) process.exit(1);
console.log(`ok: ${files.length} files checked`);
