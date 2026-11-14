import { describeDate, describeOverdue, formatClock, formatTime, longDate, toISO } from '../core/dates.js';
import { parseQuickAdd, serializeTask } from '../core/parser.js';
import {
  addTask, allTags, clearDone, counts, createStore, cycleLabelColor, doneToday, emptyState, exportJSON,
  importJSON, labelColor, mergeImported, moveTask, removeTask, renameLabel, reschedule, sanitizeState,
  search, selectView, streak, toggleDone, updateTask,
} from '../core/store.js';
import { sampleState } from '../core/sample.js';
import { checkIcon, h } from './dom.js';

const STORAGE_KEY = 'clearday-notes.v1';
const THEME_KEY = 'clearday-notes.theme';
const THEME_INFO = {
  auto: { name: 'Auto', desc: 'Follows your system', c: ['#f6f3ee', '#fbf9f5', '#c8553d', '#26231f'] },
  light: { name: 'Paper', desc: 'Warm and quiet', c: ['#f6f3ee', '#fbf9f5', '#c8553d', '#26231f'] },
  dark: { name: 'Midnight', desc: 'Soft dark', c: ['#17171a', '#222227', '#e8785f', '#ece9e2'] },
  sage: { name: 'Sage', desc: 'Light green, calm', c: ['#eef1ea', '#f6f8f2', '#4f7a5a', '#232a22'] },
  forest: { name: 'Forest', desc: 'Deep green, pines', c: ['#0f1a14', '#172a21', '#7ccf8f', '#e3efe6'] },
  cat: { name: 'Cat', desc: 'Round and warm, with paw prints', c: ['#fff7ee', '#fffdf9', '#ee8a4a', '#4a3426'] },
  terminal: { name: 'Terminal', desc: 'For programmers', c: ['#080c08', '#0f170f', '#3ddc84', '#c6f1c6'] },
  repo: { name: 'Repo Light', desc: 'Issue-list style', c: ['#ffffff', '#f6f8fa', '#0969da', '#1f2328'] },
  'repo-dark': { name: 'Repo Dark', desc: 'Issue-list, dark', c: ['#0d1117', '#151b23', '#4493f8', '#e6edf3'] },
  ink: { name: 'Ink', desc: 'Black and white', c: ['#0d0d0d', '#171717', '#f2f2f2', '#f2f2f2'] },
};
const THEMES = Object.keys(THEME_INFO);
const EMPTY_GLYPH = { cat: '=^.^=', terminal: '$ _', forest: '♣', repo: '○', 'repo-dark': '○' };
const VIEW_META = {
  today: { label: 'Today', glyph: '○' },
  upcoming: { label: 'Upcoming', glyph: '→' },
  inbox: { label: 'Inbox', glyph: '▫' },
  all: { label: 'All', glyph: '≡' },
  done: { label: 'Done', glyph: '✓' },
};
const VIEW_ORDER = ['today', 'upcoming', 'inbox', 'all', 'done'];

const $ = (id) => document.getElementById(id);
const el = {
  views: $('views'), tags: $('tags'), tagsLabel: $('tags-label'), eyebrow: $('eyebrow'), title: $('title'),
  subtitle: $('subtitle'), adder: $('adder'), input: $('add-input'), chips: $('chips'), list: $('list'),
  empty: $('empty'), toast: $('toast'), focus: $('focus'), palette: $('palette'), paletteInput: $('palette-input'),
  paletteList: $('palette-list'), help: $('help'), importFile: $('import-file'), themes: $('themes'),
};

// ---- persistence (all guarded: storage can be missing, full or disabled) ----------------------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}
let saveWarned = false;
function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    if (!saveWarned) {
      saveWarned = true;
      toast('Could not save in this browser. Export a backup from the command palette.');
    }
  }
}

const store = createStore(load(), { onChange: save });
const ui = { view: 'today', tag: null, selected: null, editing: null, dragId: null, now: new Date() };

// ---- theme -------------------------------------------------------------------------------------
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto' || !THEMES.includes(theme)) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
function currentTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
}
function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* theme just will not persist */ }
  applyTheme(theme);
  toast(`Theme: ${THEME_INFO[theme]?.name ?? theme}`);
  if (store.state.tasks.length === 0) renderList();
}
function cycleTheme() {
  setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]);
}
function openThemes() {
  const now = currentTheme();
  el.themes.querySelector('.theme-grid').replaceChildren(...THEMES.map((id) => {
    const info = THEME_INFO[id];
    const [bg, surface, accent, ink] = info.c;
    return h('button', { class: 'theme-btn', type: 'button', 'aria-pressed': String(id === now), dataset: { theme: id },
      onClick: () => { setTheme(id); el.themes.hidden = true; } },
    h('span', { class: 'swatch', style: `background:${bg}` },
      h('i', { style: `background:${surface}` }),
      h('span', { class: 'body' }, h('b', { style: `background:${ink};width:70%` }), h('b', { style: `background:${accent};width:38%` }))),
    h('span', { class: 'theme-name' }, info.name), h('span', { class: 'theme-desc' }, info.desc));
  }));
  el.themes.hidden = false;
  el.themes.querySelector(`[data-theme="${CSS.escape(now)}"]`)?.focus();
}

// ---- toast -------------------------------------------------------------------------------------
let toastTimer;
function toast(message, action) {
  clearTimeout(toastTimer);
  el.toast.replaceChildren(h('span', {}, message));
  if (action) {
    el.toast.append(h('button', { type: 'button', onClick: () => { action.run(); hideToast(); } }, action.label));
  }
  el.toast.hidden = false;
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}
function hideToast() { el.toast.hidden = true; }

// ---- derived data ------------------------------------------------------------------------------
function visible() {
  return selectView(store.state, ui.view, ui.now, ui.tag);
}

function groupsFor(tasks) {
  if (ui.view !== 'today' && ui.view !== 'upcoming') return [{ label: null, tasks }];
  const today = toISO(ui.now);
  const late = tasks.filter((t) => t.due < today);
  const rest = tasks.filter((t) => t.due >= today);
  const groups = [];
  if (late.length) groups.push({ label: 'Overdue', late: true, tasks: late });
  if (ui.view === 'upcoming') {
    const byDay = new Map();
    for (const t of rest) byDay.set(t.due, [...(byDay.get(t.due) ?? []), t]);
    for (const [due, list] of byDay) groups.push({ label: describeDate(due, ui.now), tasks: list });
  } else if (rest.length) {
    groups.push({ label: late.length ? 'Today' : null, tasks: rest });
  }
  return groups;
}

// ---- rendering ---------------------------------------------------------------------------------
function render() {
  renderSidebar();
  renderHeader();
  renderList();
  renderChips();
}

function renderSidebar() {
  const c = counts(store.state, ui.now);
  el.views.replaceChildren(...VIEW_ORDER.map((v, i) => h('button', {
    class: 'nav', type: 'button', 'aria-current': String(ui.view === v && !ui.tag), title: `${VIEW_META[v].label} (${i + 1})`,
    onClick: () => go(v),
  }, h('span', { class: 'glyph' }, VIEW_META[v].glyph), VIEW_META[v].label,
  v !== 'done' || c.done ? h('span', { class: `count${v === 'today' && c.overdue ? ' alert' : ''}` }, c[v] || '') : null)));

  const tags = allTags(store.state);
  el.tagsLabel.hidden = tags.length === 0;
  el.tags.replaceChildren(...tags.map(([tag, n]) => h('div', { class: 'nav-row', style: `--lc: var(--l${labelColor(store.state, tag)})` },
    h('button', { class: 'dot-btn', type: 'button', title: 'Change label colour', 'aria-label': `Change colour of label ${tag}`,
      onClick: () => store.apply(cycleLabelColor, tag) }, h('span', { class: 'dot' })),
    h('button', {
      class: 'nav', type: 'button', 'aria-current': String(ui.tag === tag), title: 'Double-click to rename',
      onClick: () => go('all', tag), onDblclick: (e) => startRename(e.currentTarget, tag),
    }, tag, h('span', { class: 'count' }, n)))));
}

function startRename(button, tag) {
  const input = h('input', { class: 'rename', type: 'text', value: tag, 'aria-label': `Rename label ${tag}`, spellcheck: 'false' });
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const next = input.value;
    if (commit && next.trim()) {
      const target = next.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
      if (ui.tag === tag) ui.tag = target;
      store.apply(renameLabel, tag, next);
    }
    renderSidebar();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  button.replaceChildren(input);
  input.focus();
  input.select();
}

function renderHeader() {
  const c = counts(store.state, ui.now);
  const name = ui.tag ? `#${ui.tag}` : VIEW_META[ui.view].label;
  el.eyebrow.textContent = ui.view === 'today' && !ui.tag ? longDate(ui.now) : 'Clearday Notes';
  el.title.textContent = name;
  document.title = `${name} · Clearday Notes`;
  const n = visible().length;
  let sub = '';
  if (ui.view === 'today' && !ui.tag) {
    const d = doneToday(store.state, ui.now);
    const s = streak(store.state, ui.now);
    sub = n ? `${n} to do${c.overdue ? `, ${c.overdue} overdue` : ''}` : d ? 'All clear.' : 'A clean slate.';
    if (d) sub += ` · ${d} done today`;
    if (s >= 2) sub += ` · ${s}-day streak`;
  } else if (ui.view === 'done') {
    sub = n ? `${n} completed` : '';
  } else {
    sub = n ? `${n} ${n === 1 ? 'task' : 'tasks'}` : '';
  }
  el.subtitle.textContent = sub;
}

const EMPTY_COPY = {
  today: ['◌', 'Nothing due.', 'Type above to add something, or press <n>.'],
  upcoming: ['◌', 'Nothing scheduled ahead.', 'Add a date like "friday" or "in 3 days".'],
  inbox: ['◌', 'Inbox is empty.', 'Tasks without a date land here.'],
  all: ['◌', 'No open tasks.', ''],
  done: ['◌', 'Nothing finished yet.', ''],
};

function renderList() {
  const tasks = visible();
  if (ui.selected && !tasks.some((t) => t.id === ui.selected)) ui.selected = null;
  const frag = document.createDocumentFragment();
  for (const g of groupsFor(tasks)) {
    if (g.label) frag.append(h('li', { class: `group-label${g.late ? ' late' : ''}`, role: 'presentation' }, g.label));
    for (const t of g.tasks) frag.append(taskRow(t));
  }
  el.list.replaceChildren(frag);
  el.empty.hidden = tasks.length > 0;
  if (!tasks.length) {
    const [glyph, line, hint] = EMPTY_COPY[ui.view];
    const fresh = store.state.tasks.length === 0;
    el.empty.replaceChildren(h('span', { class: 'big' }, EMPTY_GLYPH[currentTheme()] ?? glyph), h('b', {}, line), hint ? h('div', {}, hint) : null,
      fresh ? h('button', { class: 'sample', type: 'button', onClick: loadSample }, 'Try it with sample tasks') : null);
  }
}

function metaFor(t) {
  const bits = [];
  if (t.due) {
    const late = !t.done && t.due < toISO(ui.now);
    const label = describeDate(t.due, ui.now) + (t.time ? ` · ${formatTime(t.time)}` : '');
    bits.push(h('span', { class: late ? 'late' : '' }, late ? `${label} · ${describeOverdue(t.due, ui.now)}` : label));
  }
  for (const tag of t.tags) bits.push(h('span', { class: 'tag', style: `--lc: var(--l${labelColor(store.state, tag)})` }, tag));
  return bits;
}

function taskRow(t) {
  const row = h('li', {
    class: `task${t.done ? ' done' : ''}${ui.selected === t.id ? ' selected' : ''}`,
    dataset: { id: t.id }, draggable: ui.editing === t.id || t.done ? null : 'true',
    onClick: (e) => { if (!e.target.closest('button,input')) select(t.id); },
    onDblclick: (e) => { if (!e.target.closest('button,input')) startEdit(t.id); },
    onDragstart: (e) => { ui.dragId = t.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); },
    onDragend: () => { ui.dragId = null; clearDropMarks(); row.classList.remove('dragging'); },
    onDragover: (e) => { if (!ui.dragId || ui.dragId === t.id) return; e.preventDefault(); clearDropMarks(); row.classList.add('drop-before'); },
    onDrop: (e) => {
      e.preventDefault();
      const id = ui.dragId;
      clearDropMarks();
      if (id) store.apply(moveTask, id, t.id);
    },
  },
  h('button', {
    class: 'check', type: 'button', dataset: { p: t.priority || '' },
    'aria-label': t.done ? `Mark "${t.title}" as not done` : `Complete "${t.title}"`, 'aria-pressed': String(t.done),
    onClick: () => complete(t.id),
  }, checkIcon()),
  h('div', { class: 'body' },
    ui.editing === t.id ? editField(t) : h('div', { class: 't-title' }, t.title),
    ui.editing === t.id ? null : h('div', { class: 'meta' }, ...metaFor(t)),
    ui.editing === t.id || !t.note ? null : h('div', { class: 'note', title: t.note }, t.note)),
  h('div', { class: 'actions' },
    !t.done && t.due ? h('button', { class: 'icon-btn', type: 'button', title: 'Move to tomorrow', onClick: () => snooze(t.id) }, 'Tomorrow') : null,
    h('button', { class: 'icon-btn', type: 'button', title: 'Edit (e)', onClick: () => startEdit(t.id) }, 'Edit'),
    h('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': `Delete "${t.title}"`, onClick: () => del(t.id) }, '✕')));
  return row;
}

function clearDropMarks() {
  for (const n of el.list.querySelectorAll('.drop-before')) n.classList.remove('drop-before');
}

function editField(t) {
  const input = h('input', { class: 'edit-input', type: 'text', value: serializeTask(t), 'aria-label': 'Edit task', spellcheck: 'false' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(t.id, input.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
  });
  input.addEventListener('blur', () => { if (ui.editing === t.id) commitEdit(t.id, input.value); });
  queueMicrotask(() => { input.focus(); input.select(); });
  return input;
}

function renderChips() {
  const text = el.input.value;
  if (!text.trim()) { el.chips.replaceChildren(); return; }
  const r = parseQuickAdd(text, ui.now);
  const chips = [];
  if (r.due) chips.push(h('span', { class: 'chip' }, describeDate(r.due, ui.now)));
  if (r.time) chips.push(h('span', { class: 'chip' }, formatTime(r.time)));
  if (r.priority) chips.push(h('span', { class: 'chip' }, ['', 'Low', 'Medium', 'High'][r.priority]));
  for (const tag of r.tags) chips.push(h('span', { class: 'chip label', style: `--lc: var(--l${labelColor(store.state, tag)})` }, `#${tag}`));
  if (r.note) chips.push(h('span', { class: 'chip neutral' }, 'note'));
  el.chips.replaceChildren(...chips);
}

// ---- actions -----------------------------------------------------------------------------------
function loadSample() {
  store.apply(mergeImported, sampleState(ui.now));
  toast('Sample tasks added.', { label: 'Undo', run: () => store.undo() });
}

function go(view, tag = null) {
  ui.view = view;
  ui.tag = tag;
  ui.selected = null;
  ui.editing = null;
  render();
}

function select(id) {
  ui.selected = id;
  for (const n of el.list.querySelectorAll('.task')) n.classList.toggle('selected', n.dataset.id === id);
  const node = el.list.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
  node?.scrollIntoView({ block: 'nearest' });
}

function complete(id) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) return;
  const row = el.list.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
  const finish = () => {
    store.apply(toggleDone, id);
    if (!t.done) toast(`Done: ${t.title}`, { label: 'Undo', run: () => store.undo() });
  };
  if (row && !t.done && ui.view !== 'all') {
    row.classList.add('done', 'leaving');
    setTimeout(finish, 260);
  } else {
    finish();
  }
}

function del(id) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) return;
  store.apply(removeTask, id);
  toast(`Deleted: ${t.title}`, { label: 'Undo', run: () => store.undo() });
}

function snooze(id) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) return;
  const next = new Date(ui.now.getFullYear(), ui.now.getMonth(), ui.now.getDate() + 1);
  store.apply(reschedule, id, toISO(next), t.time);
  toast('Moved to tomorrow', { label: 'Undo', run: () => store.undo() });
}

function startEdit(id) {
  ui.editing = id;
  ui.selected = id;
  renderList();
}
function cancelEdit() {
  ui.editing = null;
  renderList();
  el.input.blur();
}
function commitEdit(id, text) {
  if (ui.editing !== id) return;
  ui.editing = null;
  const r = parseQuickAdd(text, ui.now);
  if (r.title) {
    store.apply(updateTask, id, { title: r.title, note: r.note, due: r.due, time: r.time, priority: r.priority, tags: r.tags });
  }
  renderList();
}

function submitAdd(e) {
  e?.preventDefault();
  const r = parseQuickAdd(el.input.value, ui.now);
  if (!r.title) {
    if (el.input.value.trim()) toast('Add a few words describing the task.');
    return;
  }
  // Adding while viewing a tag keeps the task in that tag; adding in Today defaults to today.
  const tags = ui.tag && !r.tags.includes(ui.tag) ? [...r.tags, ui.tag] : r.tags;
  const due = r.due ?? (ui.view === 'today' && !ui.tag ? toISO(ui.now) : null);
  store.apply(addTask, { title: r.title, note: r.note, due, time: r.time, priority: r.priority, tags });
  el.input.value = '';
  renderChips();
}

function move(delta) {
  const tasks = visible();
  if (!tasks.length) return;
  const i = tasks.findIndex((t) => t.id === ui.selected);
  const next = i < 0 ? (delta > 0 ? 0 : tasks.length - 1) : Math.min(tasks.length - 1, Math.max(0, i + delta));
  select(tasks[next].id);
}

function setPriority(id, p) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (t) store.apply(updateTask, id, { priority: t.priority === p ? 0 : p });
}

// ---- data: export / import -----------------------------------------------------------------------
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportData() {
  download(`clearday-notes-${toISO(new Date())}.json`, exportJSON(store.state), 'application/json');
  toast('Backup downloaded.');
}
function exportMarkdown() {
  const lines = ['# Clearday Notes', ''];
  for (const t of store.state.tasks) {
    const bits = [t.due ? ` (${t.due}${t.time ? ` ${t.time}` : ''})` : '', t.tags.map((x) => ` #${x}`).join('')].join('');
    lines.push(`- [${t.done ? 'x' : ' '}] ${t.title}${bits}`);
  }
  download(`clearday-notes-${toISO(new Date())}.md`, `${lines.join('\n')}\n`, 'text/markdown');
}
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files[0];
  el.importFile.value = '';
  if (!file) return;
  if (file.size > 5_000_000) { toast('That file is too large to be a Clearday Notes backup.'); return; }
  const result = importJSON(await file.text());
  if (!result.ok) { toast(result.error); return; }
  const before = store.state;
  store.apply(mergeImported, result);
  const added = store.state.tasks.length - before.tasks.length;
  toast(`Imported ${added} ${added === 1 ? 'task' : 'tasks'}${result.skipped ? `, skipped ${result.skipped}` : ''}.`,
    added ? { label: 'Undo', run: () => store.undo() } : undefined);
});

// ---- overlays ------------------------------------------------------------------------------------
function openOverlay(node) { node.hidden = false; }
function closeOverlays() {
  for (const n of [el.palette, el.help, el.themes]) n.hidden = true;
  if (!el.focus.hidden) exitFocus();
}
const overlayOpen = () => !el.palette.hidden || !el.help.hidden || !el.focus.hidden || !el.themes.hidden;

// command palette
function commands() {
  const list = [
    { name: 'New task', hint: 'N', run: () => el.input.focus() },
    ...VIEW_ORDER.map((v, i) => ({ name: `Go to ${VIEW_META[v].label}`, hint: String(i + 1), run: () => go(v) })),
    { name: 'Start focus mode', hint: 'F', run: () => startFocus() },
    { name: 'Undo', hint: 'Z', run: () => store.undo() },
    { name: 'Redo', hint: 'Shift Z', run: () => store.redo() },
    { name: 'Choose theme…', hint: 'T', run: openThemes },
    { name: 'Next theme', hint: '', run: cycleTheme },
    ...THEMES.map((th) => ({ name: `Theme: ${THEME_INFO[th].name}`, hint: '', run: () => setTheme(th) })),
    { name: 'Load sample tasks', hint: '', run: loadSample },
    { name: 'Clear completed tasks', hint: '', run: () => { store.apply(clearDone); toast('Cleared completed tasks.', { label: 'Undo', run: () => store.undo() }); } },
    { name: 'Export backup (JSON)', hint: '', run: exportData },
    { name: 'Export as Markdown', hint: '', run: exportMarkdown },
    { name: 'Import backup (JSON)', hint: '', run: () => el.importFile.click() },
    { name: 'Keyboard shortcuts', hint: '?', run: showHelp },
  ];
  for (const [tag] of allTags(store.state)) list.push({ name: `Filter by #${tag}`, hint: '', run: () => go('all', tag) });
  return list;
}
let palItems = [];
let palIndex = 0;
function openPalette() {
  openOverlay(el.palette);
  el.paletteInput.value = '';
  renderPalette();
  el.paletteInput.focus();
}
function renderPalette() {
  const q = el.paletteInput.value.trim().toLowerCase();
  const cmds = commands().filter((c) => !q || c.name.toLowerCase().includes(q));
  const tasks = q ? search(store.state, q).slice(0, 8).map((t) => ({
    name: t.title, hint: t.done ? 'done' : t.due ? describeDate(t.due, ui.now) : 'inbox',
    run: () => { go(t.done ? 'done' : t.due ? (t.due <= toISO(ui.now) ? 'today' : 'upcoming') : 'inbox'); select(t.id); },
  })) : [];
  palItems = [...cmds, ...tasks];
  palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
  el.paletteList.replaceChildren(...palItems.map((c, i) => h('li', {
    role: 'option', 'aria-selected': String(i === palIndex),
    onClick: () => runPalette(i), onMousemove: () => { palIndex = i; markPalette(); },
  }, h('span', {}, c.name), h('span', { class: 'hint' }, c.hint))));
  if (!palItems.length) el.paletteList.replaceChildren(h('li', { class: 'hint' }, 'No matches'));
}
function markPalette() {
  [...el.paletteList.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === palIndex)));
  el.paletteList.children[palIndex]?.scrollIntoView({ block: 'nearest' });
}
function runPalette(i) {
  const item = palItems[i];
  el.palette.hidden = true;
  if (item) item.run();
}
el.paletteInput.addEventListener('input', () => { palIndex = 0; renderPalette(); });
el.paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); markPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = Math.max(0, palIndex - 1); markPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIndex); }
});

// help
const SHORTCUTS = [
  ['N or /', 'Add a task'], ['J / K or ↓ / ↑', 'Move selection'], ['Space or X', 'Complete / reopen'],
  ['E or Enter', 'Edit selected'], ['1 2 3', 'Set priority low / medium / high'], ['S', 'Snooze to tomorrow'],
  ['Delete', 'Delete selected'], ['Z / Shift Z', 'Undo / redo'], ['F', 'Focus on selected or first task'],
  ['G then 1–5', 'Go to view'], ['T', 'Choose theme'], ['Ctrl K', 'Command palette'], ['?', 'This help'], ['Esc', 'Close / cancel'],
];
function showHelp() {
  $('help-body').replaceChildren(h('h3', {}, 'Keyboard shortcuts'),
    h('div', { class: 'help-grid' }, SHORTCUTS.flatMap(([k, d]) => [h('span', {}, h('kbd', {}, k)), h('span', {}, d)])));
  openOverlay(el.help);
}

// focus mode
const FOCUS_SECONDS = 25 * 60;
const focus = { id: null, timer: null, endsAt: 0 };
function startFocus() {
  const tasks = selectView(store.state, 'today', ui.now).concat(selectView(store.state, 'inbox', ui.now));
  const pool = visible().length ? visible() : tasks;
  const t = pool.find((x) => x.id === ui.selected) ?? pool[0];
  if (!t) { toast('Nothing to focus on yet.'); return; }
  showFocus(t.id);
}
function showFocus(id) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) { exitFocus(); return; }
  focus.id = id;
  stopTimer();
  $('focus-title').textContent = t.title;
  $('focus-meta').textContent = [t.due ? describeDate(t.due, ui.now) : '', t.time ? formatTime(t.time) : '', ...t.tags.map((x) => `#${x}`)].filter(Boolean).join(' · ');
  $('focus-timer').textContent = formatClock(FOCUS_SECONDS);
  $('focus-start').textContent = 'Start 25 min';
  el.focus.hidden = false;
  $('focus-start').focus();
}
function stopTimer() { clearInterval(focus.timer); focus.timer = null; }
function exitFocus() { stopTimer(); focus.id = null; el.focus.hidden = true; }
function tickFocus() {
  const left = (focus.endsAt - Date.now()) / 1000;
  $('focus-timer').textContent = formatClock(left);
  if (left <= 0) {
    stopTimer();
    $('focus-start').textContent = 'Again';
    document.title = 'Time is up · Clearday Notes';
    toast('Time is up. Take a breath.');
  }
}
$('focus-start').addEventListener('click', () => {
  if (focus.timer) { stopTimer(); $('focus-start').textContent = 'Resume'; return; }
  const remaining = $('focus-start').textContent === 'Resume' ? parseClock($('focus-timer').textContent) : FOCUS_SECONDS;
  focus.endsAt = Date.now() + remaining * 1000;
  focus.timer = setInterval(tickFocus, 250);
  $('focus-start').textContent = 'Pause';
  tickFocus();
});
function parseClock(text) { const [m, s] = text.split(':').map(Number); return m * 60 + s; }
$('focus-done').addEventListener('click', () => {
  const id = focus.id;
  const t = store.state.tasks.find((x) => x.id === id);
  if (t && !t.done) store.apply(toggleDone, id);
  nextFocus(id);
});
$('focus-skip').addEventListener('click', () => nextFocus(focus.id, true));
$('focus-exit').addEventListener('click', exitFocus);
function nextFocus(fromId, keep = false) {
  const open = selectView(store.state, 'today', ui.now).concat(selectView(store.state, 'inbox', ui.now)).filter((t) => keep || t.id !== fromId);
  const i = open.findIndex((t) => t.id === fromId);
  const next = open[(i + 1) % open.length] ?? null;
  if (next && next.id !== fromId) showFocus(next.id);
  else { exitFocus(); toast(keep ? 'No other task to focus on.' : 'All clear. Nicely done.'); }
}

// ---- keyboard ------------------------------------------------------------------------------------
let gPending = false;
let gTimer;
function typing(e) {
  const n = e.target;
  return n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n?.isContentEditable;
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); el.palette.hidden ? openPalette() : closeOverlays(); return; }
  if (e.key === 'Escape') {
    if (overlayOpen()) { e.preventDefault(); closeOverlays(); return; }
    if (document.activeElement === el.input) { el.input.value = ''; el.input.blur(); renderChips(); return; }
    ui.selected = null; renderList(); return;
  }
  if (overlayOpen() || typing(e) || mod || e.altKey) return;

  const sel = ui.selected;
  const k = e.key;
  if (gPending) {
    gPending = false;
    if (/^[1-5]$/.test(k)) { e.preventDefault(); go(VIEW_ORDER[Number(k) - 1]); return; }
  }
  switch (k) {
    case 'g': gPending = true; clearTimeout(gTimer); gTimer = setTimeout(() => { gPending = false; }, 900); break;
    case 'n': case '/': e.preventDefault(); el.input.focus(); break;
    case 'j': case 'ArrowDown': e.preventDefault(); move(1); break;
    case 'k': case 'ArrowUp': e.preventDefault(); move(-1); break;
    case ' ': case 'x': if (sel) { e.preventDefault(); complete(sel); } break;
    case 'e': case 'Enter': if (sel) { e.preventDefault(); startEdit(sel); } break;
    case 'Delete': case 'Backspace': if (sel) { e.preventDefault(); const tasks = visible(); const i = tasks.findIndex((t) => t.id === sel); del(sel); const after = visible(); ui.selected = after[Math.min(i, after.length - 1)]?.id ?? null; renderList(); } break;
    case '1': case '2': case '3': if (sel) setPriority(sel, Number(k)); else if (!e.shiftKey) go(VIEW_ORDER[Number(k) - 1]); break;
    case '4': case '5': go(VIEW_ORDER[Number(k) - 1]); break;
    case 's': if (sel) snooze(sel); break;
    case 'z': e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); break;
    case 'Z': e.preventDefault(); store.redo(); break;
    case 'f': startFocus(); break;
    case 't': openThemes(); break;
    case '?': showHelp(); break;
    default:
  }
});

el.adder.addEventListener('submit', submitAdd);
el.input.addEventListener('input', renderChips);
$('btn-palette').addEventListener('click', openPalette);
$('btn-help').addEventListener('click', showHelp);
$('btn-themes').addEventListener('click', openThemes);
el.themes.addEventListener('keydown', (e) => {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys)) return;
  e.preventDefault();
  const btns = [...el.themes.querySelectorAll('.theme-btn')];
  const i = btns.indexOf(document.activeElement);
  btns[(i + keys[e.key] + btns.length) % btns.length]?.focus();
});
for (const n of [el.palette, el.help, el.themes]) n.addEventListener('mousedown', (e) => { if (e.target === n) n.hidden = true; });

// ---- lifecycle -----------------------------------------------------------------------------------
store.subscribe(() => { if (ui.editing === null) render(); else { renderSidebar(); renderHeader(); } });

// keep "today" correct across midnight and sleep, and sync other tabs
setInterval(() => {
  const now = new Date();
  if (toISO(now) !== toISO(ui.now)) { ui.now = now; render(); } else ui.now = now;
}, 30_000);
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  try { store.replace(e.newValue ? sanitizeState(JSON.parse(e.newValue)) : emptyState()); } catch { /* ignore a half-written value */ }
});

applyTheme(currentTheme());
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
render();
if (!store.state.tasks.length) el.input.focus();
