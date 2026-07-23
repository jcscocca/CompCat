# Security Policy

CompCat is a **portfolio / showcase project** — a public repository and an occasional,
on-demand demo, not an operated multi-user service (see [`docs/ROADMAP.md`](docs/ROADMAP.md),
Phase 7). Please read the scope notes below before reporting.

## Reporting a vulnerability

Report suspected vulnerabilities **privately** through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
open the repository's **Security → Report a vulnerability** tab. Please do **not** open a
public issue for a security report.

When you report, include:

- affected file(s)/endpoint(s) and the commit or version,
- reproduction steps or a proof of concept,
- the impact you observed.

You'll get an acknowledgement as soon as the maintainer sees it; this is a personal project,
so response is best-effort rather than on a guaranteed SLA.

## Scope

In scope — issues in the code in this repository, for example:

- authentication/session handling (`app/sessions.py`, the public/internal/admin API tiers),
- the internal-tier edge gate and admin-token handling,
- injection, SSRF, or XSS in the backend or the React dashboard,
- privacy leaks (exact coordinates escaping the generalized-coordinate paths),
- bypasses of the **product invariant** — anything that makes the assistant score/rank places
  as safe/unsafe/dangerous, or claim a user was present at an incident.

Out of scope / known and documented — CompCat **deliberately does not implement** production
authentication, encryption at rest, or per-user tenant isolation; these are called out as
unplanned in the README and roadmap. Reports that amount to "there is no user-account system"
are known non-goals, not vulnerabilities. Findings that require enabling the off-by-default
internal tier (`MCA_INTERNAL_TIER_ENABLED`) or personal uploads
(`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS`) in a prod-like environment should say so explicitly.

## Data

The bundled crime CSVs are **synthetic** samples, and the deployed app makes zero third-party
requests. No real personal data ships in this repository.
