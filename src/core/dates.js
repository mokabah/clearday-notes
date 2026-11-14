// Date helpers. All dates are local calendar dates stored as "YYYY-MM-DD" strings.
// Every function that depends on "today" takes `now` explicitly so it can be tested.

export const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n) => String(n).padStart(2, '0');

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse "YYYY-MM-DD" into a local Date at midnight, or return null if it is not a real date. */
export function fromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, n) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a, b) {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** The next occurrence of `weekday` (0 = Sunday) strictly after `from`. */
export function nextWeekday(from, weekday) {
  let delta = (weekday - from.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(from, delta);
}

/** The upcoming occurrence of `weekday`, counting today if it matches. */
export function thisWeekday(from, weekday) {
  return addDays(from, (weekday - from.getDay() + 7) % 7);
}

export function validTime(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** "Today", "Tomorrow", "Mon 17 Nov", or "Overdue" wording for a due date. */
export function describeDate(iso, now) {
  const date = fromISO(iso);
  if (!date) return '';
  const delta = diffDays(now, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const base = `${SHORT_DAYS[date.getDay()]} ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

export function describeOverdue(iso, now) {
  const date = fromISO(iso);
  if (!date) return '';
  const days = diffDays(date, now);
  return days <= 0 ? '' : days === 1 ? '1 day late' : `${days} days late`;
}

export function formatTime(t) {
  if (!validTime(t)) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function longDate(now) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const day = WEEKDAYS_EN[now.getDay()];
  return `${day[0].toUpperCase()}${day.slice(1)}, ${now.getDate()} ${months[now.getMonth()]}`;
}
