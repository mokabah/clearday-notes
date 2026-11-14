// Natural-language quick add (English keywords).
//
//   "Call Alex tomorrow 3pm #work !high"  ->  title, due, time, priority, tags
//
// The parser is deliberately transparent: every recognised fragment is returned in `spans`
// so the interface can show it as a chip, and the user can see exactly what will be saved.
// To keep a phrase literal, wrap the whole input in double quotes.

import {
  WEEKDAYS_EN, addDays, fromISO, nextWeekday, thisWeekday, toISO, validTime,
} from './dates.js';

const PRIORITY_WORDS = {
  high: 3, medium: 2, med: 2, low: 1,
};

const weekdayIndex = (word) => {
  const w = word.toLowerCase().replace(/[’']/g, '');
  return WEEKDAYS_EN.findIndex((d) => d === w || d.slice(0, 3) === w);
};

const FULL_DAY_NAMES = WEEKDAYS_EN;
const SHORT_DAY_NAMES = ['sun', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each rule: regex plus a function that turns a match into {kind, value, label} or null. */
function dateRules(now) {
  const full = FULL_DAY_NAMES.map(escape).join('|');
  const short = SHORT_DAY_NAMES.map(escape).join('|');
  return [
    {
      re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
      fn: (m) => {
        const d = fromISO(m[0]);
        return d ? { value: toISO(d) } : null;
      },
    },
    {
      re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
      fn: (m) => {
        const day = Number(m[1]);
        const month = Number(m[2]);
        let year = m[3] ? Number(m[3]) : now.getFullYear();
        if (year < 100) year += 2000;
        let d = fromISO(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        if (d && !m[3] && toISO(d) < toISO(now)) {
          d = fromISO(`${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }
        return d ? { value: toISO(d) } : null;
      },
    },
    { re: /\bday after tomorrow\b/i, fn: () => ({ value: toISO(addDays(now, 2)) }) },
    { re: /\btomorrow\b/i, fn: () => ({ value: toISO(addDays(now, 1)) }) },
    { re: /\btoday\b/i, fn: () => ({ value: toISO(now) }) },
    {
      re: /\btonight\b/i,
      fn: () => ({ value: toISO(now), time: '20:00' }),
    },
    { re: /\bnext week\b/i, fn: () => ({ value: toISO(nextWeekday(now, 1)) }) },
    {
      // "in 3 days", "in 2 weeks". A bare "3 days" is too ambiguous in titles, so "in" is required.
      re: /\bin\s+(\d{1,3})\s*(day|days|week|weeks)\b/i,
      fn: (m) => {
        const n = Number(m[1]);
        return { value: toISO(addDays(now, m[2].toLowerCase().startsWith('w') ? n * 7 : n)) };
      },
    },
    {
      re: new RegExp(`\\b(?:(next|this)\\s+)?(${full})\\b`, 'i'),
      fn: (m) => {
        const idx = weekdayIndex(m[2]);
        if (idx < 0) return null;
        const d = (m[1] || '').toLowerCase() === 'next' ? nextWeekday(now, idx) : thisWeekday(now, idx);
        return { value: toISO(d) };
      },
    },
    {
      // Short names ("mon", "sat") are only accepted with a cue word, so "sun cream" stays a title.
      re: new RegExp(`\\b(?:on|next|this)\\s+(${short})\\b`, 'i'),
      fn: (m) => {
        const idx = weekdayIndex(m[1]);
        if (idx < 0) return null;
        const next = /^next/i.test(m[0]);
        return { value: toISO(next ? nextWeekday(now, idx) : thisWeekday(now, idx)) };
      },
    },
  ];
}

function to24(hour, minute, meridiem) {
  let h = hour;
  if (meridiem) {
    const pm = meridiem.toLowerCase() === 'pm';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || minute > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const TIME_RULES = [
  {
    // "at 3pm", "at 9", "@ 15:30"
    re: /(?:\bat\s+|@\s*)(\d{1,2})(?:[:.](\d{2}))?(?:\s*(am|pm))?\b/i,
    fn: (m) => to24(Number(m[1]), Number(m[2] || 0), m[3]),
  },
  {
    // "3pm", "10:30 am"
    re: /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    fn: (m) => to24(Number(m[1]), Number(m[2] || 0), m[3]),
  },
  {
    // bare "15:30" or "9:05"
    re: /\b([01]?\d|2[0-3]):([0-5]\d)\b/,
    fn: (m) => to24(Number(m[1]), Number(m[2]), null),
  },
];

function blank(text, start, end) {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

/**
 * Parse a quick-add line.
 * @returns {{title: string, note: string, due: string|null, time: string|null, priority: number,
 *            tags: string[], spans: Array<{kind: string, text: string, value: string|number}>}}
 */
export function parseQuickAdd(input, now = new Date()) {
  const result = { title: '', note: '', due: null, time: null, priority: 0, tags: [], spans: [] };
  if (typeof input !== 'string') return result;
  const trimmed = input.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    result.title = trimmed.slice(1, -1).trim();
    return result;
  }

  // A note follows " // " and is kept verbatim (it is never searched for dates or tags).
  let body = input;
  const noteAt = / \/\/ /.exec(input);
  if (noteAt) {
    result.note = input.slice(noteAt.index + 4).trim();
    body = input.slice(0, noteAt.index);
  }
  let work = ` ${body} `;

  // Tags: #work, #side-project
  work = work.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (all, lead, tag) => {
    const t = tag.toLowerCase();
    if (!result.tags.includes(t)) result.tags.push(t);
    result.spans.push({ kind: 'tag', text: `#${tag}`, value: t });
    return lead;
  });

  // Priority: !, !!, !!!, !1..!3, !high, !medium, !low
  work = work.replace(/(^|\s)(!{1,3}|![123]|!(?:high|medium|med|low))(?=\s|$)/i,
    (all, lead, token) => {
      const word = token.slice(1).toLowerCase();
      let p;
      if (/^!+$/.test(token)) p = token.length;
      else if (/^\d$/.test(word)) p = Number(word);
      else p = PRIORITY_WORDS[word];
      result.priority = p;
      result.spans.push({ kind: 'priority', text: token, value: p });
      return lead;
    });

  // Time first, so that "at 3pm" is not mistaken for part of a date.
  for (const rule of TIME_RULES) {
    const m = rule.re.exec(work);
    if (!m) continue;
    const t = rule.fn(m);
    if (!t) continue;
    result.time = t;
    result.spans.push({ kind: 'time', text: m[0].trim(), value: t });
    work = blank(work, m.index, m.index + m[0].length);
    break;
  }

  for (const rule of dateRules(now)) {
    const m = rule.re.exec(work);
    if (!m) continue;
    const found = rule.fn(m, work);
    if (!found) continue;
    result.due = found.value;
    if (found.time && !result.time) result.time = found.time;
    // Swallow a directly preceding "on" or "by".
    let start = m.index;
    const before = /\b(on|by)\s+$/i.exec(work.slice(0, start));
    if (before) start = before.index;
    result.spans.push({ kind: 'date', text: work.slice(start, m.index + m[0].length).trim(), value: found.value });
    work = blank(work, start, m.index + m[0].length);
    break;
  }

  // A time with no date means "today".
  if (result.time && !result.due) {
    result.due = toISO(now);
    result.spans.push({ kind: 'date', text: 'today', value: result.due, implied: true });
  }

  result.title = work.replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim();
  if (result.time && !validTime(result.time)) result.time = null;
  return result;
}

/** Turn a task back into quick-add text, so editing re-uses the same parser. */
export function serializeTask(task) {
  const extras = [];
  if (task.due) extras.push(task.due);
  if (task.due && task.time) extras.push(`at ${task.time}`);
  for (const tag of task.tags ?? []) extras.push(`#${tag}`);
  if (task.priority) extras.push('!'.repeat(task.priority));
  // A title that would itself be read as a date, tag or priority is protected with quotes,
  // which is only possible when nothing else follows it.
  const probe = parseQuickAdd(task.title, new Date(2000, 0, 3));
  const risky = probe.title !== task.title || probe.spans.length > 0 || probe.note !== '';
  if (risky && extras.length === 0 && !task.note) return `"${task.title}"`;
  const text = [task.title, ...extras].join(' ');
  return task.note ? `${text} // ${task.note}` : text;
}
