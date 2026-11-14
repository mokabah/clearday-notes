# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please do not disclose security issues in public issues. Use GitHub's **Report a
vulnerability** option on the repository's Security tab (private vulnerability reporting).
If that option is not available, open an issue that states only that you wish to report a
security matter, without technical details, and a maintainer will arrange a private channel.

Clearday Notes has no runtime dependencies, makes no network requests, and stores data only in the
browser's `localStorage`. Relevant issues are most likely to concern the handling of imported
files, the rendering of task text, or the content security policy. Task text is inserted
through text nodes only, and the page ships with a strict `Content-Security-Policy`.
