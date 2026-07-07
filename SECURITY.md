# Security Policy

Thanks for helping keep Mnema and the people who self-host it safe. We take
security reports seriously and will work with you in good faith to confirm and
fix anything you find.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** A public
issue tells everyone about the hole before there's a fix.

Report it privately, one of two ways:

1. **GitHub Private Vulnerability Reporting (preferred).** On this repository, go
   to the **Security** tab → **Report a vulnerability**. This opens a private
   advisory visible only to you and the maintainer. It keeps the whole
   conversation — and any fix — in one place until it's ready to disclose.
2. **Email (fallback).** If you can't use GitHub's flow, email
   **mnema@theboringpeople.in** with the details. Please include
   "Mnema security" in the subject so it routes correctly.

Whichever you use, a useful report includes:

- What the issue is and the impact you think it has.
- Steps to reproduce (a proof-of-concept, request, or minimal repo helps a lot).
- The version, tag, or commit you're running, and how you're deployed
  (Docker Compose, behind a reverse proxy, etc.).

## What to expect

We're a small team, so timelines are honest rather than aspirational:

- **Acknowledgement within 72 hours** that we've received your report.
- **Triage within 7 days** — we confirm whether it reproduces, assess severity,
  and tell you what we plan to do.
- We'll keep you updated as we work on a fix, and let you know when it ships. If
  you'd like credit in the advisory, tell us how you'd like to be named.

## Supported versions

Security fixes land against the **latest tagged release** on `main`. If you're
running an older tag, the fix is to upgrade to the newest release — we don't
backport to prior tags.

| Version               | Supported          |
| :-------------------- | :----------------: |
| Latest tagged release | ✅                 |
| Older tags            | ❌ (upgrade)       |

Self-hosters: pin to a release tag and upgrade when a new one lands. See
[RELEASING.md](./RELEASING.md).

## Safe harbor

We will not pursue or support legal action against anyone who, in good faith,
finds and reports a vulnerability under this policy — as long as you avoid
privacy violations, data destruction, and any disruption to others' service
while researching, and you give us a reasonable chance to fix the issue before
disclosing it publicly. If in doubt about whether an action is in scope, ask
first in your private report.

This is a fair-code project, not a company with a bounty program: **we do not
offer paid bug bounties.** We do offer our genuine thanks and public credit in
the security advisory if you'd like it.
