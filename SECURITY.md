# Security Policy

## Supported Versions

Only the latest release line receives security updates.

| Version | Supported |
|---------|-----------|
| latest  | ✅        |
| older   | ❌        |

## Reporting a Vulnerability

**Please do not file a public GitHub issue for security vulnerabilities.**

Instead, report them privately via one of:

1. **GitHub Security Advisories** — preferred. Go to the [Security tab](https://github.com/LeoKun1231/claude-proxy/security/advisories/new) of this repository and click "Report a vulnerability".
2. **Email** — send details to the maintainer listed in the GitHub profile.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected version(s)
- Suggested mitigation, if any

You will receive an acknowledgement within **72 hours**. We aim to publish a fix within **14 days** for high-severity issues and coordinate disclosure with the reporter.

## Scope

In scope:

- The desktop application (Rust backend, React frontend)
- The local HTTP proxy (`127.0.0.1:5055`)
- Config file handling and storage

Out of scope:

- Vulnerabilities in upstream Claude/Anthropic/OpenAI services
- Issues that require physical access to an unlocked user machine
- Bugs that do not cross a trust boundary (e.g., a local user writing their own malicious config)

Thank you for helping keep Claude Proxy and its users safe.
