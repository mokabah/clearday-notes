// End-to-end smoke test: drives a real headless Chrome through the Chrome DevTools Protocol.
// Usage: node scripts/e2e.mjs [--shots DIR]   (needs Chrome/Chromium; set CHROME to override the path)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const chromePath = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser']
  .map((c) => { try { return execFileSync('which', [c]).toString().trim(); } catch { return ''; } }).find(Boolean);
if (!chromePath) { console.log('skip: no Chrome found'); process.exit(0); }

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'text/html' }).end(await readFile(join(ROOT, p === '/' ? 'index.html' : p))); }
  catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'clearday-notes-e2e-'));
const chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolveWs, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolveWs(m[1]); });
  setTimeout(() => reject(new Error('chrome did not start')), 20000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const type = async (text) => { await send('Input.insertText', { text }); await sleep(40); };
const press = async (key, opts = {}) => {
  const base = { key, code: opts.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key), modifiers: opts.modifiers ?? 0,
    windowsVirtualKeyCode: opts.vk ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0) };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: key.length === 1 && !opts.modifiers ? key : undefined, ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(60);
};
const enter = async () => {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(80);
};
const text = (sel) => evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(n => n.textContent.trim())`);
const shot = async (name) => {
  if (!shotsDir) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotsDir, name), Buffer.from(r.result.data, 'base64'));
};

let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join(' | ')}`); }
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(800);
await evaluate('localStorage.clear()');
await send('Page.navigate', { url });
await sleep(800);

await step('starts empty with the add field focused', async () => {
  assert.equal(await evaluate('document.activeElement.id'), 'add-input');
  assert.equal(await evaluate('document.getElementById("list").children.length'), 0);
  assert.equal(await evaluate('document.getElementById("empty").hidden'), false);
});

await step('live chips preview the parsed text', async () => {
  await type('Call Alex tomorrow 3pm #family !high');
  const chips = await text('#chips .chip');
  assert.deepEqual(chips, ['Tomorrow', '3:00 PM', 'High', '#family']);
});

await step('Enter adds the task; a dated task leaves Today and lands in Upcoming', async () => {
  await enter();
  assert.equal(await evaluate('document.getElementById("add-input").value'), '');
  assert.equal(await evaluate('document.getElementById("list").children.length'), 0);
  await press('Escape', { code: 'Escape', vk: 27 });
  await press('g'); await press('2', { code: 'Digit2', vk: 50 });
  assert.equal((await text('#title'))[0], 'Upcoming');
  assert.deepEqual(await text('.t-title'), ['Call Alex']);
});

await step('tasks without a date added in Today default to today', async () => {
  await press('g'); await press('1', { code: 'Digit1', vk: 49 });
  await press('n');
  await type('Pay rent !!');
  await enter(); await type('Write report #work'); await enter();
  assert.deepEqual(await text('.t-title'), ['Pay rent', 'Write report']); // priority orders within a day
});

await step('selection, priority and completion by keyboard', async () => {
  await press('Escape', { code: 'Escape', vk: 27 });
  await press('j'); await press('j');
  assert.equal(await evaluate('document.querySelector(".task.selected .t-title")?.textContent'), 'Write report');
  await press('3', { code: 'Digit3', vk: 51 });
  assert.equal(await evaluate('document.querySelector(".task.selected .check").dataset.p'), '3');
  await press(' ', { code: 'Space', vk: 32 });
  await sleep(500);
  assert.deepEqual(await text('.t-title'), ['Pay rent']);
  assert.match(await evaluate('document.getElementById("toast").textContent'), /Done: Write report/);
});

await step('undo restores the completed task', async () => {
  await press('z');
  assert.deepEqual((await text('.t-title')).sort(), ['Pay rent', 'Write report']);
});

await step('inline edit re-parses text', async () => {
  await press('Escape', { code: 'Escape', vk: 27 });
  await press('j'); await press('e'); // the high-priority report now sorts first
  await sleep(100);
  await evaluate('document.querySelector(".edit-input").select()');
  await type('Write the report 2030-01-01 #work');
  await enter();
  await sleep(100);
  assert.deepEqual(await text('.t-title'), ['Pay rent']);
  await press('g'); await press('2', { code: 'Digit2', vk: 50 });
  assert.ok((await text('.t-title')).includes('Write the report'));
  await press('g'); await press('1', { code: 'Digit1', vk: 49 });
});

await step('command palette opens, filters, and runs a command', async () => {
  await press('k', { modifiers: 2, code: 'KeyK', vk: 75 });
  assert.equal(await evaluate('document.getElementById("palette").hidden'), false);
  await type('inbox'); await sleep(100);
  await enter();
  assert.equal((await text('#title'))[0], 'Inbox');
});

await step('focus mode shows a task and exits with Escape', async () => {
  await press('g'); await press('4', { code: 'Digit4', vk: 52 });
  await press('f');
  assert.equal(await evaluate('document.getElementById("focus").hidden'), false);
  assert.ok((await text('#focus-title'))[0].length > 0);
  await press('Escape', { code: 'Escape', vk: 27 });
  assert.equal(await evaluate('document.getElementById("focus").hidden'), true);
});

await step('theme picker opens, applies a theme and persists it', async () => {
  await press('t');
  assert.equal(await evaluate('document.getElementById("themes").hidden'), false);
  assert.equal(await evaluate('document.querySelectorAll(".theme-btn").length'), 10);
  await evaluate('document.querySelector(\'.theme-btn[data-theme="cat"]\').click()');
  assert.equal(await evaluate('document.documentElement.getAttribute("data-theme")'), 'cat');
  assert.equal(await evaluate('localStorage.getItem("clearday-notes.theme")'), 'cat');
  assert.equal(await evaluate('document.getElementById("themes").hidden'), true);
});

await step('labels: coloured, recolourable and renamable', async () => {
  await press('g'); await press('4', { code: 'Digit4', vk: 52 });
  const dot = 'getComputedStyle(document.querySelector("#tags .dot")).backgroundColor';
  assert.notEqual(await evaluate(dot), await evaluate('getComputedStyle(document.body).backgroundColor')); // not transparent
  assert.notEqual(await evaluate(dot), 'rgba(0, 0, 0, 0)');
  const before = await evaluate('document.querySelector("#tags .nav-row").getAttribute("style")');
  await evaluate('document.querySelector("#tags .dot-btn").click()');
  const after = await evaluate('document.querySelector("#tags .nav-row").getAttribute("style")');
  assert.notEqual(before, after);
  await evaluate('document.querySelector("#tags .nav").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
  await type('renamed'); await enter(); await sleep(100);
  assert.ok((await text('#tags .nav')).some((t) => t.startsWith('renamed')));
});

await step('notes after " // " are shown under the task', async () => {
  await evaluate('document.getElementById("add-input").focus()');
  await type('Pack bag tomorrow // passport and charger'); await enter();
  await press('Escape', { code: 'Escape', vk: 27 });
  await press('g'); await press('2', { code: 'Digit2', vk: 50 });
  assert.ok((await text('.note')).includes('passport and charger'));
});

await step('tasks persist across reload', async () => {
  await send('Page.navigate', { url });
  await sleep(800);
  await press('g'); await press('4', { code: 'Digit4', vk: 50 + 2 });
  assert.ok((await text('.t-title')).length >= 1);
});

await step('user text is never interpreted as HTML', async () => {
  await press('n');
  await type('<img src=x onerror=window.__pwned=1> hello'); await enter(); await sleep(100);
  assert.equal(await evaluate('window.__pwned === undefined'), true);
  assert.equal(await evaluate('document.querySelectorAll("#list img").length'), 0);
});

await step('narrow window collapses the sidebar without breaking', async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  await send('Emulation.clearDeviceMetricsOverride');
});

await step('the single-file build (dist) works from file://', async () => {
  execFileSync(process.execPath, ['scripts/bundle.mjs'], { cwd: ROOT, stdio: 'pipe' });
  errors.length = 0;
  await send('Page.navigate', { url: `file://${ROOT}/dist/clearday-notes.html` });
  await sleep(800);
  await evaluate('localStorage.clear()');
  await send('Page.navigate', { url: `file://${ROOT}/dist/clearday-notes.html` });
  await sleep(800);
  assert.equal((await text('.brand span:last-child'))[0], 'Clearday Notes');
  await evaluate('document.querySelector(".empty .sample").click()');
  await sleep(200);
  assert.ok((await text('.t-title')).length >= 3, `sample tasks shown: ${await text('.t-title')}`);
  await evaluate('document.getElementById("add-input").focus()');
  await type('Single file works'); await enter();
  assert.ok((await text('.t-title')).includes('Single file works'), `titles: ${await text('.t-title')}`);
  await press('Escape', { code: 'Escape', vk: 27 });
  await press('t'); assert.equal(await evaluate('document.querySelectorAll(".theme-btn").length'), 10);
  await press('Escape', { code: 'Escape', vk: 27 });
});

await step('no console errors or uncaught exceptions', async () => {
  assert.deepEqual(errors.filter((e) => !/favicon|sw\.js|serviceWorker/i.test(e)), []);
});

// Showcase screenshots (only with --shots): every theme with the sample data
if (shotsDir) {
  await send('Page.navigate', { url });
  await sleep(600);
  await evaluate('localStorage.clear()');
  await send('Page.navigate', { url });
  await sleep(600);
  await evaluate('document.querySelector(".empty .sample").click()');
  await sleep(300);
  await press('Escape', { code: 'Escape', vk: 27 });
  for (const t of ['light', 'dark', 'sage', 'forest', 'cat', 'terminal', 'repo', 'repo-dark', 'ink']) {
    await evaluate(`localStorage.setItem('clearday-notes.theme', '${t}'); document.documentElement.setAttribute('data-theme', '${t}'); document.getElementById('toast').hidden = true`);
    await press('Escape', { code: 'Escape', vk: 27 });
    await press('j'); await press('j');
    await sleep(250);
    await shot(`theme-${t}.png`);
  }
  await evaluate("localStorage.setItem('clearday-notes.theme','cat'); document.documentElement.setAttribute('data-theme','cat')");
  await press('t'); await sleep(250); await shot('theme-picker.png');
  await press('Escape', { code: 'Escape', vk: 27 });
  await evaluate("localStorage.setItem('clearday-notes.theme','terminal'); document.documentElement.setAttribute('data-theme','terminal')");
  await press('f'); await sleep(250); await shot('focus-terminal.png');
  await press('Escape', { code: 'Escape', vk: 27 });
  await evaluate("localStorage.setItem('clearday-notes.theme','dark'); document.documentElement.setAttribute('data-theme','dark')");
  await press('k', { modifiers: 2, code: 'KeyK', vk: 75 }); await sleep(250); await shot('palette-dark.png');
}

ws.close(); chrome.kill(); server.close();
if (failed) { console.log(`\n${failed} step(s) failed`); process.exit(1); }
console.log('\nall e2e steps passed');
