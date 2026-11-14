import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../src/core/parser.js';

// Wednesday, 12 November 2025.
const NOW = new Date(2025, 10, 12, 9, 0);
const p = (s) => parseQuickAdd(s, NOW);

test('plain text is a title only', () => {
  assert.deepEqual(
    { ...p('Buy milk'), spans: undefined },
    { title: 'Buy milk', note: '', due: null, time: null, priority: 0, tags: [], spans: undefined },
  );
});

test('relative days', () => {
  assert.equal(p('Pay rent today').due, '2025-11-12');
  assert.equal(p('Pay rent tomorrow').due, '2025-11-13');
  assert.equal(p('Water the plants today').due, '2025-11-12');
  assert.equal(p('Plan trip day after tomorrow').due, '2025-11-14');
});

test('weekday names resolve to the upcoming day, and "next" skips a week when it is today', () => {
  assert.equal(p('Gym friday').due, '2025-11-14');
  assert.equal(p('Gym wednesday').due, '2025-11-12'); // today is Wednesday
  assert.equal(p('Gym next wednesday').due, '2025-11-19');
  assert.equal(p('Gym next monday').due, '2025-11-17');
  assert.equal(p('Gym this friday').due, '2025-11-14');
});

test('short weekday names need a cue word so ordinary words stay in the title', () => {
  const r = p('Buy sun cream');
  assert.equal(r.due, null);
  assert.equal(r.title, 'Buy sun cream');
  assert.equal(p('Call on mon').due, '2025-11-17');
  assert.equal(p('Call next sat').due, '2025-11-15');
});

test('next week means next Monday', () => {
  assert.equal(p('Review next week').due, '2025-11-17');
});

test('"in N days/weeks"', () => {
  assert.equal(p('Renew passport in 3 days').due, '2025-11-15');
  assert.equal(p('Renew passport in 2 weeks').due, '2025-11-26');
});

test('a bare number of days without a cue stays in the title', () => {
  const r = p('Pack food for 3 days');
  assert.equal(r.due, null);
  assert.equal(r.title, 'Pack food for 3 days');
});

test('explicit dates', () => {
  assert.equal(p('Deadline 2026-01-05').due, '2026-01-05');
  assert.equal(p('Deadline 24/12').due, '2025-12-24');
  assert.equal(p('Deadline 5/11').due, '2026-11-05'); // already past this year -> next year
  assert.equal(p('Deadline 1/3/27').due, '2027-03-01');
  assert.equal(p('Deadline 2025-02-30').due, null); // not a real date
});

test('times in several notations', () => {
  assert.equal(p('Call at 3pm').time, '15:00');
  assert.equal(p('Call 10:30 am').time, '10:30');
  assert.equal(p('Call 12am').time, '00:00');
  assert.equal(p('Call 12pm').time, '12:00');
  assert.equal(p('Call @ 15:45').time, '15:45');
  assert.equal(p('Meeting 9:05').time, '09:05');
  assert.equal(p('Meeting at 9').time, '09:00');
  assert.equal(p('Meeting at 7:30pm').time, '19:30');
  assert.equal(p('Call at 25:00').time, null);
});

test('a time without a date means today and is reported as implied', () => {
  const r = p('Stand-up at 9am');
  assert.equal(r.due, '2025-11-12');
  assert.ok(r.spans.some((s) => s.kind === 'date' && s.implied));
});

test('tonight sets a date and an evening time', () => {
  const r = p('Cook dinner tonight');
  assert.equal(r.due, '2025-11-12');
  assert.equal(r.time, '20:00');
  assert.equal(r.title, 'Cook dinner');
});

test('priority markers', () => {
  assert.equal(p('Fix bug !!!').priority, 3);
  assert.equal(p('Fix bug !!').priority, 2);
  assert.equal(p('Fix bug !').priority, 1);
  assert.equal(p('Fix bug !3').priority, 3);
  assert.equal(p('Fix bug !high').priority, 3);
  assert.equal(p('Fix bug !medium').priority, 2);
  assert.equal(p('Fix bug !low').priority, 1);
  assert.equal(p('Wow!').priority, 0); // "!" glued to a word is punctuation
  assert.equal(p('Fix bug !!!!').priority, 0); // four marks is not a priority
});

test('tags are lower-cased, deduplicated and unicode aware', () => {
  const r = p('Write report #Work #work #side-project #café');
  assert.deepEqual(r.tags, ['work', 'side-project', 'café']);
  assert.equal(r.title, 'Write report');
});

test('a full line combines every part', () => {
  const r = p('Call Alex on friday at 3pm #family !high');
  assert.deepEqual(
    { title: r.title, due: r.due, time: r.time, priority: r.priority, tags: r.tags },
    { title: 'Call Alex', due: '2025-11-14', time: '15:00', priority: 3, tags: ['family'] },
  );
  assert.deepEqual(r.spans.map((s) => s.kind).sort(), ['date', 'priority', 'tag', 'time']);
});

test('the preposition before a date is swallowed with it', () => {
  assert.equal(p('Submit report by friday').title, 'Submit report');
  assert.equal(p('Submit report on friday').title, 'Submit report');
});

test('quotes keep the whole line literal', () => {
  const r = p('"Call Alex tomorrow #work"');
  assert.equal(r.title, 'Call Alex tomorrow #work');
  assert.equal(r.due, null);
  assert.deepEqual(r.tags, []);
});

test('empty and non-string input never throws', () => {
  assert.equal(p('').title, '');
  assert.equal(p('   ').title, '');
  assert.equal(parseQuickAdd(undefined, NOW).title, '');
  assert.equal(parseQuickAdd(42, NOW).title, '');
  assert.equal(p('tomorrow').title, ''); // nothing left: the caller must reject it
});

test('very long input is handled', () => {
  const r = p(`${'word '.repeat(5000)}tomorrow`);
  assert.equal(r.due, '2025-11-13');
});

import { serializeTask } from '../src/core/parser.js';

test('serializeTask output parses back to the same fields', () => {
  const task = { title: 'Call Alex', due: '2025-11-14', time: '15:00', tags: ['family', 'side-project'], priority: 3 };
  const r = p(serializeTask(task));
  assert.deepEqual(
    { title: r.title, due: r.due, time: r.time, tags: r.tags, priority: r.priority },
    { title: 'Call Alex', due: '2025-11-14', time: '15:00', tags: ['family', 'side-project'], priority: 3 },
  );
});

test('serializeTask quotes a bare title that would otherwise be parsed', () => {
  const text = serializeTask({ title: 'Ship it tomorrow', due: null, time: null, tags: [], priority: 0 });
  assert.equal(text, '"Ship it tomorrow"');
  assert.equal(p(text).title, 'Ship it tomorrow');
  assert.equal(serializeTask({ title: 'Plain', due: null, time: null, tags: [], priority: 0 }), 'Plain');
});

test('a note follows " // " and is kept verbatim', () => {
  const r = p('Call Alex tomorrow // bring #the docs !!! at 9am');
  assert.equal(r.title, 'Call Alex');
  assert.equal(r.due, '2025-11-13');
  assert.equal(r.note, 'bring #the docs !!! at 9am');
  assert.deepEqual(r.tags, []);
  assert.equal(r.priority, 0);
  assert.equal(p('See http://example.com/a').note, ''); // no spaces around //: a URL, not a note
  assert.equal(p('"keep // literal"').title, 'keep // literal');
});

test('serializeTask round-trips notes', () => {
  const task = { title: 'Pay rent', due: '2025-11-14', time: null, tags: ['home'], priority: 1, note: 'use the bank app' };
  const r = p(serializeTask(task));
  assert.equal(r.note, 'use the bank app');
  assert.equal(r.title, 'Pay rent');
  assert.deepEqual(r.tags, ['home']);
});
