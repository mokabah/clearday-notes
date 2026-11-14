# Design notes

## Goal

A to-do list that a person can use for years without it becoming a second job. The measure of success is how rarely the user has to think about the tool.

## Decisions

| Decision | Reason |
| --- | --- |
| A single text input for creation | Forms cost more time than the task they describe. Parsing is shown as chips so the user can verify it without a second step. |
| *Today* is the default view and groups overdue work separately | The most useful question is "what now?". Overdue is named, not alarming. |
| Tasks sort by date, time, then priority, and only then by manual order | A sensible default means most users never need to drag. Manual order applies within equal dates and in Inbox/All. |
| Edit as text | The edit field contains the serialised sentence; the same parser reads it back. One mental model for create and edit. |
| Undo instead of confirmation dialogs | Dialogs interrupt every deletion to protect against a rare mistake. Undo protects at no cost to the common case. |
| No accounts, no network | Privacy is a property of the architecture rather than a policy. |
| Plain ES modules, no framework or build step | The whole application can be read in an afternoon and runs without tooling. |
| Strict Content-Security-Policy; user text only through text nodes | Task text is untrusted input (it may be imported from a file). |
| Focus mode is one screen with one task | It is the smallest possible implementation of "work on one thing". |
| Colour carries meaning for priority, lateness and labels | Everything else is neutral. Labels are the one place the user chooses colour. |
| Themes change character, not behaviour | Terminal, Cat, Forest and Repo restyle type, shape and decoration through CSS variables and small overrides; behaviour is identical in every theme. |

## Deliberately absent

Sub-tasks, projects, labels with colours, recurring tasks, reminders, sync, collaboration, statistics dashboards. Each can be argued for; each adds controls and states. They are candidates only if they can be added without making the default screen busier.

## Roadmap (not promised)

1. Recurring tasks written as text (`every monday`), preserving the one-input principle.
2. Optional notifications for tasks with a time.
3. Encrypted, user-held file sync (for example a folder watched by the Electron shell).
4. More languages for the parser, contributed with tests.
