# Quick-add parser

Implemented in `src/core/parser.js`. All behaviour below is covered by `tests/parser.test.js`.

## Order of recognition

1. If the whole line is wrapped in double quotes, it is the title, unparsed.
2. Text after the first ` // ` (spaces on both sides) is the note and is kept verbatim; only the text before it is parsed. `http://x` is not a note.
3. Tags (`#word`, Unicode letters, digits, `_`, `-`) are removed and lower-cased.
4. One priority marker (`!`, `!!`, `!!!`, `!1`–`!3`, `!high|medium|med|low`) is removed. A marker must be a separate word.
5. One time is removed (`at 3pm`, `@ 15:30`, `10:30 am`, `15:30`, `at 9`).
6. One date is removed, with a directly preceding `on` or `by`.
7. A time without a date implies today.
8. What remains, with whitespace collapsed, is the title. An empty title is rejected by the caller.

Only the first match of each kind is used, and every recognised fragment is returned in `spans` so the interface can show it.

## Rules chosen to avoid false positives

* A bare number of days ("pack food for 3 days") is not a date. It needs `in` ("in 3 days").
* Short weekday names (`sun`, `mon`, `sat`) need a cue (`on`, `next`, `this`), so "sun cream" stays a title.
* `5/11` is day/month. If that date has already passed this year, it means next year.
* `2025-02-30` is not a real date and is ignored.
* `Wow!` is punctuation, and `!!!!` is not a priority.
* "Weekday" means the coming one, counting today. `next friday` is always strictly after today.
* `next week` means the coming Monday.

## Known limits

* English only. Words from other languages are left in the title unchanged.
* No recurring phrases ("every monday"), no ranges, no month names ("12 december"). They are left in the title.
* Weekday names depend on the system clock; the parser takes `now` as a parameter so tests are deterministic.
* Interpretations are fixed rules, not guesses. When in doubt the parser leaves text in the title, and the chips show what was understood.
