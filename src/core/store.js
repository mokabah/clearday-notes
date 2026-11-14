// Task store: pure state transitions plus a small observable wrapper with undo/redo.
// No DOM access, so everything here is unit-tested under Node.

import { toISO, fromISO, validTime } from './dates.js';

export const SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 100;

let counter = 0;
export function newId() {
  counter += 1;
  return `t${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyState() {
  return { version: SCHEMA_VERSION, tasks: [], labels: {} };
}

/** Coerce arbitrary input into a valid task, or return null if it has no usable title. */
export function normalizeTask(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  if (!title) return null;
  const due = typeof raw.due === 'string' && fromISO(raw.due) ? raw.due : null;
  const time = due && validTime(raw.time) ? raw.time : null;
  const priority = Number.isInteger(raw.priority) && raw.priority >= 0 && raw.priority <= 3 ? raw.priority : 0;
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase().slice(0, 40)))]
    : [];
  const created = Number.isFinite(raw.created) ? raw.created : now.getTime();
  const done = raw.done === true;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 5000) : '',
    done,
    completedAt: done && Number.isFinite(raw.completedAt) ? raw.completedAt : done ? created : null,
    due,
    time,
    priority,
    tags,
    created,
  };
}

/** Validate and repair imported or stored data. Never throws. */
export const LABEL_COLORS = 8;

function sanitizeLabels(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (k.length <= 40 && Number.isInteger(v) && v >= 0 && v < LABEL_COLORS) out[k.toLowerCase()] = v;
    }
  }
  return out;
}

export function sanitizeState(raw, now = new Date()) {
  const state = emptyState();
  if (raw && !Array.isArray(raw)) state.labels = sanitizeLabels(raw.labels);
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.tasks) ? raw.tasks : [];
  const seen = new Set();
  for (const item of list) {
    const task = normalizeTask(item, now);
    if (!task) continue;
    if (seen.has(task.id)) task.id = newId();
    seen.add(task.id);
    state.tasks.push(task);
  }
  return state;
}

// ---- pure transitions: (state, ...args) => newState ---------------------------------------

export function addTask(state, fields, now = new Date()) {
  const task = normalizeTask({ ...fields, done: false, created: now.getTime() }, now);
  if (!task) return state;
  return { ...state, tasks: [task, ...state.tasks] };
}

export function updateTask(state, id, patch, now = new Date()) {
  let changed = false;
  const tasks = state.tasks.map((t) => {
    if (t.id !== id) return t;
    const next = normalizeTask({ ...t, ...patch, id: t.id, created: t.created }, now);
    if (!next) return t;
    changed = true;
    return next;
  });
  return changed ? { ...state, tasks } : state;
}

export function toggleDone(state, id, now = new Date()) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return state;
  return updateTask(state, id, { done: !t.done, completedAt: t.done ? null : now.getTime() }, now);
}

export function removeTask(state, id) {
  const tasks = state.tasks.filter((t) => t.id !== id);
  return tasks.length === state.tasks.length ? state : { ...state, tasks };
}

export function clearDone(state) {
  const tasks = state.tasks.filter((t) => !t.done);
  return tasks.length === state.tasks.length ? state : { ...state, tasks };
}

/** Move task `id` so that it sits directly before `beforeId` (or at the end when null). */
export function moveTask(state, id, beforeId) {
  if (id === beforeId) return state;
  const from = state.tasks.findIndex((t) => t.id === id);
  if (from < 0) return state;
  const tasks = state.tasks.slice();
  const [item] = tasks.splice(from, 1);
  let to = beforeId == null ? tasks.length : tasks.findIndex((t) => t.id === beforeId);
  if (to < 0) to = tasks.length;
  tasks.splice(to, 0, item);
  return tasks.every((t, i) => t === state.tasks[i]) ? state : { ...state, tasks };
}

/** Push an open task to a new date ("snooze"). */
export function reschedule(state, id, due, time = null, now = new Date()) {
  return updateTask(state, id, { due, time }, now);
}

// ---- labels --------------------------------------------------------------------------------

function hashTag(tag) {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

/** Colour slot (0-7) of a label: the user's choice, otherwise a stable pick from its name. */
export function labelColor(state, tag) {
  const chosen = state.labels?.[tag];
  return Number.isInteger(chosen) ? chosen : hashTag(tag) % LABEL_COLORS;
}

export function cycleLabelColor(state, tag) {
  const next = (labelColor(state, tag) + 1) % LABEL_COLORS;
  return { ...state, labels: { ...state.labels, [tag]: next } };
}

export function renameLabel(state, from, to) {
  const target = to.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 40);
  if (!target || target === from) return state;
  const tasks = state.tasks.map((t) => (t.tags.includes(from)
    ? { ...t, tags: [...new Set(t.tags.map((x) => (x === from ? target : x)))] }
    : t));
  const labels = { ...state.labels };
  if (labels[from] !== undefined) { labels[target] ??= labels[from]; delete labels[from]; }
  return { ...state, tasks, labels };
}

// ---- selectors -----------------------------------------------------------------------------

const dueKey = (t) => (t.due ? `${t.due}T${t.time ?? '99:99'}` : '9999');

/** Stable ordering: overdue/dated first by time, then priority, otherwise keep manual order. */
export function sortOpen(tasks) {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ka = dueKey(a.t);
      const kb = dueKey(b.t);
      if (ka !== kb) return ka < kb ? -1 : 1;
      if (a.t.priority !== b.t.priority) return b.t.priority - a.t.priority;
      return a.i - b.i;
    })
    .map((x) => x.t);
}

export const VIEWS = ['today', 'upcoming', 'inbox', 'all', 'done'];

export function selectView(state, view, now = new Date(), tag = null) {
  const today = toISO(now);
  let tasks = state.tasks;
  if (tag) tasks = tasks.filter((t) => t.tags.includes(tag));
  switch (view) {
    case 'today':
      return sortOpen(tasks.filter((t) => !t.done && t.due && t.due <= today));
    case 'upcoming':
      return sortOpen(tasks.filter((t) => !t.done && t.due && t.due > today));
    case 'inbox':
      return tasks.filter((t) => !t.done && !t.due);
    case 'done':
      return tasks.filter((t) => t.done).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    case 'all':
    default:
      return tasks.filter((t) => !t.done);
  }
}

export function counts(state, now = new Date()) {
  const out = {};
  for (const v of VIEWS) out[v] = selectView(state, v, now).length;
  out.overdue = state.tasks.filter((t) => !t.done && t.due && t.due < toISO(now)).length;
  return out;
}

export function allTags(state) {
  const map = new Map();
  for (const t of state.tasks) {
    if (t.done) continue;
    for (const tag of t.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Plain case-insensitive search over title, note and tags; all words must match. */
export function search(state, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return state.tasks.filter((t) => {
    const hay = `${t.title} ${t.note} ${t.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Streak of consecutive days (ending today or yesterday) with at least one completed task. */
export function streak(state, now = new Date()) {
  const days = new Set(state.tasks.filter((t) => t.done && t.completedAt).map((t) => toISO(new Date(t.completedAt))));
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(toISO(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(toISO(cursor))) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export function doneToday(state, now = new Date()) {
  const today = toISO(now);
  return state.tasks.filter((t) => t.done && t.completedAt && toISO(new Date(t.completedAt)) === today).length;
}

// ---- observable wrapper with undo -----------------------------------------------------------

export function createStore(initial = emptyState(), { onChange } = {}) {
  let state = initial;
  const past = [];
  let future = [];
  const listeners = new Set();
  const emit = () => {
    for (const fn of listeners) fn(state);
    if (onChange) onChange(state);
  };

  return {
    get state() { return state; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Apply a pure transition; no-ops (same reference returned) leave history untouched. */
    apply(transition, ...args) {
      const next = transition(state, ...args);
      if (next === state) return false;
      past.push(state);
      if (past.length > HISTORY_LIMIT) past.shift();
      future = [];
      state = next;
      emit();
      return true;
    },
    undo() {
      if (!past.length) return false;
      future.push(state);
      state = past.pop();
      emit();
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(state);
      state = future.pop();
      emit();
      return true;
    },
    replace(next) {
      past.push(state);
      future = [];
      state = next;
      emit();
    },
  };
}

// ---- import / export -------------------------------------------------------------------------

export function exportJSON(state) {
  return JSON.stringify({ app: 'clearday-notes', version: SCHEMA_VERSION, exported: new Date().toISOString(), tasks: state.tasks, labels: state.labels }, null, 2);
}

export function importJSON(text, now = new Date()) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  const state = sanitizeState(raw, now);
  const given = Array.isArray(raw) ? raw.length : Array.isArray(raw?.tasks) ? raw.tasks.length : -1;
  if (given < 0) return { ok: false, error: 'No task list found in this file.' };
  return { ok: true, state, skipped: given - state.tasks.length };
}

/** Merge imported tasks into the current state; ids that already exist are skipped. */
export function mergeImported(state, imported) {
  const have = new Set(state.tasks.map((t) => t.id));
  const fresh = imported.tasks.filter((t) => !have.has(t.id));
  const labels = { ...imported.labels, ...state.labels }; // the current colours win
  const sameLabels = Object.keys(labels).length === Object.keys(state.labels ?? {}).length;
  if (!fresh.length && sameLabels) return state;
  return { ...state, tasks: [...fresh, ...state.tasks], labels };
}
