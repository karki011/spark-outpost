# Security policy

Spark Outpost runs coding agents on your Mac with access to your repositories, keychain items and other apps, so we take reports seriously.

## Report a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([new advisory](https://github.com/karki011/spark-outpost/security/advisories/new)). Don't open a public issue, pull request or discussion for it.

Include what you can:

- the version, or the commit if you built from source;
- what an attacker can do and what they need first (a malicious repository, web page, calendar invite, paired device, and so on);
- steps to reproduce, or a proof of concept;
- any logs, with secrets removed.

We aim to acknowledge a report within a week and to agree on a fix and a disclosure date with you. We credit reporters in the advisory unless you'd rather not be named.

## In scope

- The desktop app, the local API and worker, and the remote gateway for paired devices.
- Ways around the approval gate, the safety floor, the publish rules, the Browser pane's partitions, Mac control's refusals or the secret-file protections described in [AGENTS.md](AGENTS.md) and [docs/guide](docs/guide).
- Secrets leaking into logs, tool results, events, the database or anything that leaves the computer.
- The update feed and how the app verifies what it downloads.

## Out of scope

- What an agent does in a mode you chose that runs without review (for example Bypass permissions or Full access). Spark flags those actions; it does not stop them by design.
- Terminal sessions, which run the provider's CLI under its own permission mode.
- Vulnerabilities in Claude Code, Codex or other third-party tools; report those to their maintainers.

## Supported versions

Only the latest release gets security fixes.
