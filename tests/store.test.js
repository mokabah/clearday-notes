import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTask, allTags, clearDone, counts, createStore, emptyState, exportJSON, importJSON, mergeImported,
  moveTask, normalizeTask, removeTask, reschedule, sanitizeState, search, selectView, sortOpen, streak,
  toggleDone, updateTask, doneToday,
} from '../src/core/store.js';

const NOW = new Date(2025, 10, 12, 10, 0); // Wed 12 Nov 2025
const add = (s, f) => addTask(s, f, NOW);

test('addTask trims, normalises and prepends; empty titles are rejected', () => {
  let s = add(emptyState(), { title: '  Buy   milk ', tags: ['Home', 'home', ' '], priority: 2 });
  assert.equal(s.tasks[0].title, 'Buy milk');
  assert.deepEqual(s.tasks[0].tags, ['home']);
  const same = add(s, { title: '   ' });
  assert.equal(same, s);
  s = add(s, { title: 'Second' });
  assert.equal(s.tasks[0].title, 'Second');
});

test('invalid fields are repaired, not trusted', () => {
  const t = normalizeTask({ title: 'x', due: '2025-02-30', time: '25:00', priority: 9, tags: 'nope' }, NOW);
  assert.equal(t.due, null);
  assert.equal(t.time, null);
  assert.equal(t.priority, 0);
  assert.deepEqual(t.tags, []);
  assert.equal(normalizeTask({ title: 'x', time: '10:00' }, NOW).time, null); // time without a date
  assert.equal(normalizeTask(null), null);
  assert.equal(normalizeTask({ title: 42 }), null);
  assert.equal(normalizeTask({ title: 'a'.repeat(900) }, NOW).title.length, 500);
});

test('toggleDone records and clears completion time', () => {
  let s = add(emptyState(), { title: 'a' });
  const id = s.tasks[0].id;
  s = toggleDone(s, id, NOW);
  assert.equal(s.tasks[0].done, true);
  assert.equal(s.tasks[0].completedAt, NOW.getTime());
  s = toggleDone(s, id, NOW);
  assert.equal(s.tasks[0].done, false);
  assert.equal(s.tasks[0].completedAt, null);
  assert.equal(toggleDone(s, 'missing', NOW), s);
});

test('updateTask keeps id and creation time and ignores empty titles', () => {
  let s = add(emptyState(), { title: 'a' });
  const { id, created } = s.tasks[0];
  s = updateTask(s, id, { title: 'b', id: 'hack', created: 1 }, NOW);
  assert.equal(s.tasks[0].id, id);
  assert.equal(s.tasks[0].created, created);
  assert.equal(s.tasks[0].title, 'b');
  assert.equal(updateTask(s, id, { title: '' }, NOW), s);
});

test('removeTask and clearDone', () => {
  let s = add(add(emptyState(), { title: 'a' }), { title: 'b' });
  s = toggleDone(s, s.tasks[0].id, NOW);
  assert.equal(clearDone(s).tasks.length, 1);
  assert.equal(removeTask(s, 'nope'), s);
  assert.equal(removeTask(s, s.tasks[0].id).tasks.length, 1);
});

test('moveTask reorders before a target, or to the end', () => {
  let s = emptyState();
  for (const t of ['c', 'b', 'a']) s = add(s, { title: t }); // order: a b c
  const [a, b, c] = s.tasks;
  assert.deepEqual(moveTask(s, c.id, a.id).tasks.map((t) => t.title), ['c', 'a', 'b']);
  assert.deepEqual(moveTask(s, a.id, null).tasks.map((t) => t.title), ['b', 'c', 'a']);
  assert.equal(moveTask(s, a.id, a.id), s);
  assert.equal(moveTask(s, a.id, b.id), s); // already directly before b
  assert.equal(moveTask(s, 'missing', a.id), s);
});

test('views split tasks into today, upcoming, inbox, done', () => {
  let s = emptyState();
  s = add(s, { title: 'late', due: '2025-11-10' });
  s = add(s, { title: 'now', due: '2025-11-12' });
  s = add(s, { title: 'soon', due: '2025-11-20' });
  s = add(s, { title: 'someday' });
  s = add(s, { title: 'finished' });
  s = toggleDone(s, s.tasks[0].id, NOW);
  const titles = (v) => selectView(s, v, NOW).map((t) => t.title);
  assert.deepEqual(titles('today'), ['late', 'now']);
  assert.deepEqual(titles('upcoming'), ['soon']);
  assert.deepEqual(titles('inbox'), ['someday']);
  assert.deepEqual(titles('done'), ['finished']);
  assert.equal(titles('all').length, 4);
  assert.deepEqual(counts(s, NOW), { today: 2, upcoming: 1, inbox: 1, all: 4, done: 1, overdue: 1 });
});

test('sortOpen orders by date, then time, then priority, then manual order', () => {
  let s = emptyState();
  s = add(s, { title: 'p0-late-time', due: '2025-11-12', time: '15:00' });
  s = add(s, { title: 'p3', due: '2025-11-12', priority: 3 });
  s = add(s, { title: 'p0', due: '2025-11-12' });
  s = add(s, { title: 'early', due: '2025-11-12', time: '08:00' });
  assert.deepEqual(sortOpen(s.tasks).map((t) => t.title), ['early', 'p0-late-time', 'p3', 'p0']);
});

test('tag filter and tag counts', () => {
  let s = add(emptyState(), { title: 'a', tags: ['work'] });
  s = add(s, { title: 'b', tags: ['work', 'home'] });
  s = add(s, { title: 'c', tags: ['home'], due: '2025-11-12' });
  assert.deepEqual(allTags(s), [['home', 2], ['work', 2]]);
  assert.deepEqual(selectView(s, 'all', NOW, 'work').map((t) => t.title).sort(), ['a', 'b']);
});

test('search needs every word and looks at note and tags', () => {
  let s = add(emptyState(), { title: 'Write report', note: 'for Alex', tags: ['work'] });
  s = add(s, { title: 'Buy milk' });
  assert.equal(search(s, 'report alex').length, 1);
  assert.equal(search(s, 'WORK').length, 1);
  assert.equal(search(s, 'report milk').length, 0);
  assert.equal(search(s, '   ').length, 0);
});

test('streak counts consecutive days ending today or yesterday', () => {
  const day = (offset) => new Date(2025, 10, 12 + offset, 12).getTime();
  const mk = (...offsets) => ({
    version: 1,
    tasks: offsets.map((o, i) => normalizeTask({ id: `x${i}`, title: 't', done: true, completedAt: day(o) }, NOW)),
  });
  assert.equal(streak(mk(0, -1, -2), NOW), 3);
  assert.equal(streak(mk(-1, -2), NOW), 2); // today not yet done: streak is still alive
  assert.equal(streak(mk(-2, -3), NOW), 0); // broken
  assert.equal(streak(mk(0, -2), NOW), 1);
  assert.equal(streak(emptyState(), NOW), 0);
  assert.equal(doneToday(mk(0, 0, -1), NOW), 2);
});

test('store: apply, undo, redo, no-op does not pollute history', () => {
  const store = createStore();
  assert.equal(store.apply(addTask, { title: 'a' }, NOW), true);
  assert.equal(store.apply(addTask, { title: '' }, NOW), false);
  assert.equal(store.state.tasks.length, 1);
  store.apply(addTask, { title: 'b' }, NOW);
  assert.equal(store.undo(), true);
  assert.equal(store.state.tasks.length, 1);
  assert.equal(store.canRedo, true);
  assert.equal(store.redo(), true);
  assert.equal(store.state.tasks.length, 2);
  store.undo();
  store.apply(addTask, { title: 'c' }, NOW); // new edit clears redo
  assert.equal(store.canRedo, false);
  assert.equal(createStore().undo(), false);
});

test('store: history is capped and subscribers are notified', () => {
  const store = createStore();
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  for (let i = 0; i < 130; i += 1) store.apply(addTask, { title: `t${i}` }, NOW);
  assert.equal(calls, 130);
  let undone = 0;
  while (store.undo()) undone += 1;
  assert.equal(undone, 100);
  const before = calls;
  off();
  store.redo();
  assert.equal(calls, before); // unsubscribed: no further notifications
});

test('export then import round-trips; garbage is rejected or repaired', () => {
  let s = add(emptyState(), { title: 'a', due: '2025-11-13', time: '09:30', tags: ['x'], priority: 2 });
  s = add(s, { title: 'b' });
  const back = importJSON(exportJSON(s), NOW);
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.tasks, s.tasks);
  assert.equal(importJSON('not json', NOW).ok, false);
  assert.equal(importJSON('{"foo":1}', NOW).ok, false);
  const messy = importJSON(JSON.stringify([{ title: 'ok' }, { title: '' }, 5, null]), NOW);
  assert.equal(messy.ok, true);
  assert.equal(messy.state.tasks.length, 1);
  assert.equal(messy.skipped, 3);
});

test('duplicate ids in imported data are made unique; merge skips known ids', () => {
  const st = sanitizeState([{ id: 'a', title: '1' }, { id: 'a', title: '2' }], NOW);
  assert.notEqual(st.tasks[0].id, st.tasks[1].id);
  const base = add(emptyState(), { title: 'mine' });
  const incoming = { tasks: [base.tasks[0], normalizeTask({ title: 'new' }, NOW)] };
  assert.equal(mergeImported(base, incoming).tasks.length, 2);
  assert.equal(mergeImported(base, { tasks: [base.tasks[0]] }), base);
});

test('reschedule moves a task to a new date and clears time', () => {
  let s = add(emptyState(), { title: 'a', due: '2025-11-12', time: '10:00' });
  s = reschedule(s, s.tasks[0].id, '2025-11-13', null, NOW);
  assert.equal(s.tasks[0].due, '2025-11-13');
  assert.equal(s.tasks[0].time, null);
});

import { cycleLabelColor, labelColor, renameLabel, LABEL_COLORS } from '../src/core/store.js';
import { sampleState } from '../src/core/sample.js';

test('label colours: stable default, cycling wraps, invalid stored values are dropped', () => {
  const s = emptyState();
  assert.equal(labelColor(s, 'work'), labelColor(s, 'work'));
  assert.ok(labelColor(s, 'work') >= 0 && labelColor(s, 'work') < LABEL_COLORS);
  let t = s;
  const start = labelColor(t, 'work');
  for (let i = 0; i < LABEL_COLORS; i += 1) t = cycleLabelColor(t, 'work');
  assert.equal(labelColor(t, 'work'), start);
  const clean = sanitizeState({ tasks: [], labels: { a: 3, b: 99, c: 'x', d: -1 } }, NOW);
  assert.deepEqual(clean.labels, { a: 3 });
  assert.deepEqual(sanitizeState([], NOW).labels, {});
});

test('renaming a label updates tasks, merges duplicates and moves its colour', () => {
  let s = add(emptyState(), { title: 'a', tags: ['work', 'urgent'] });
  s = add(s, { title: 'b', tags: ['work'] });
  s = { ...s, labels: { work: 4 } };
  const r = renameLabel(s, 'work', ' #Job ');
  assert.deepEqual(r.tasks.map((t) => t.tags).sort(), [['job'], ['job', 'urgent']]);
  assert.equal(r.labels.job, 4);
  assert.equal(r.labels.work, undefined);
  const merged = renameLabel(r, 'urgent', 'job');
  assert.deepEqual(merged.tasks.find((t) => t.title === 'a').tags, ['job']);
  assert.equal(renameLabel(s, 'work', 'work'), s);
  assert.equal(renameLabel(s, 'work', '   '), s);
});

test('export and import keep label colours; merge keeps current colours', () => {
  let s = add(emptyState(), { title: 'a', tags: ['x'] });
  s = { ...s, labels: { x: 5 } };
  const back = importJSON(exportJSON(s), NOW);
  assert.deepEqual(back.state.labels, { x: 5 });
  const merged = mergeImported({ ...emptyState(), labels: { x: 1 } }, back.state);
  assert.equal(merged.labels.x, 1);
});

test('sample data is valid, relative to now, and includes a done task', () => {
  const st = sampleState(NOW);
  assert.ok(st.tasks.length >= 8);
  assert.ok(st.tasks.some((t) => t.done));
  assert.ok(st.tasks.some((t) => t.due && t.due < '2025-11-12' && !t.done)); // an overdue one
  assert.equal(selectView(st, 'today', NOW).length >= 3, true);
  assert.ok(Object.keys(st.labels).length >= 5);
  assert.ok(st.tasks.every((t) => t.note !== undefined));
});
