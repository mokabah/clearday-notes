// Builds dist/clearday-notes.html: the whole app in ONE file that works offline when double-clicked.
// A small purpose-built bundler: it understands only the import/export forms this project uses.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const order = ['src/core/dates.js', 'src/core/parser.js', 'src/core/store.js', 'src/core/sample.js', 'src/ui/dom.js', 'src/ui/app.js'];
const idOf = (path) => `__m_${path.split('/').pop().replace('.js', '')}`;

function transform(path) {
  let src = readFileSync(path, 'utf8');
  const exported = [];
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => {
    exported.push(name);
    return `${kind} ${name}`;
  });
  if (/^export\s*\{|^export\s+default/m.test(src)) throw new Error(`unsupported export form in ${path}`);
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (m, names, from) => {
    const target = order.find((p) => p.endsWith(`/${from.split('/').pop()}`));
    if (!target) throw new Error(`cannot resolve import '${from}' in ${path}`);
    const list = names.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = ${idOf(target)};`;
  });
  if (/^import\s/m.test(src)) throw new Error(`unsupported import form in ${path}`);
  return `const ${idOf(path)} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();`;
}

const js = `'use strict';\n${order.map(transform).join('\n')}\n`;
const css = readFileSync('src/ui/styles.css', 'utf8');
let html = readFileSync('index.html', 'utf8');
const icon = `data:image/svg+xml,${encodeURIComponent(readFileSync('icons/icon.svg', 'utf8'))}`;
html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`)
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" type="image/svg+xml">`)
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="[^"]*"><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/clearday-notes.html', html);
console.log(`dist/clearday-notes.html  ${(html.length / 1024).toFixed(1)} KiB`);
