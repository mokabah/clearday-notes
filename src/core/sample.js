// Sample tasks for a first look. Dates are relative to `now`, so the sample is always current.
import { addDays, toISO } from './dates.js';
import { sanitizeState } from './store.js';

export function sampleState(now = new Date()) {
  const day = (n) => toISO(addDays(now, n));
  const at = (n) => now.getTime() - n * 60_000;
  const tasks = [
    { title: 'Finish the quarterly report', due: day(0), time: '16:00', priority: 3, tags: ['work'], note: 'Send the draft to Alex before 5 pm.' },
    { title: 'Reply to Alex', due: day(0), tags: ['family'] },
    { title: 'Pay the electricity bill', due: day(-1), priority: 2, tags: ['home'], note: 'Use the banking app.' },
    { title: 'Feed the cat', due: day(0), time: '18:30', tags: ['home', 'cat'] },
    { title: 'Merge the pull request', due: day(1), time: '10:00', tags: ['code'] },
    { title: 'Book flights for the trip', due: day(5), tags: ['trip'], priority: 1 },
    { title: 'Read for twenty minutes', tags: ['personal'] },
    { title: 'Sketch an idea for the logo', tags: ['creative'] },
    { title: 'Back up the photo folder', done: true, completedAt: at(30), tags: ['home'] },
  ].map((t, i) => ({ ...t, id: `sample${i}`, created: at(600 - i) }));
  return sanitizeState({ tasks, labels: { work: 5, family: 7, home: 3, cat: 1, code: 6, trip: 4, personal: 2, creative: 0 } }, now);
}
