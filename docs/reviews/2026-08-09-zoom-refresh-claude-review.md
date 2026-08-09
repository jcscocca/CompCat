# Zoom refresh stability — independent Claude review

**Date:** 2026-08-09

**Reviewer:** Claude Sonnet through Claude Code 2.1.126, medium effort, read-only

**Artifact reviewed:**
[`docs/superpowers/specs/2026-08-09-zoom-refresh-stability-design.md`](../superpowers/specs/2026-08-09-zoom-refresh-stability-design.md)

## Method

Two repository-aware review attempts were made first with Claude Opus and Claude Sonnet.
Both exceeded the local CLI execution window before returning a result, so neither was
treated as feedback. The successful review used tools-disabled Claude Sonnet with the full
draft specification in its prompt and requested a skeptical frontend correctness,
race-condition, timing, and accessibility review.

## Verdict

**REVISE**

Claude supported the stale-while-revalidate direction and two-tier timing, but found the
draft underspecified at the points most likely to create lifecycle defects.

## Findings and disposition

| Finding | Severity | Disposition |
|---|---|---|
| The two debounce durations did not say whether they shared one timer, allowing an old viewport timer to survive a scope change. | Blocking | Specify one serialized timer/request lane; every change cancels it. |
| Abort alone was not an explicit guarantee against a late stale response committing. | Blocking | Add a monotonically increasing request generation checked on every resolution. |
| Immediate `aria-busy` could temporarily suppress preserved content for assistive technology while sighted users saw no state. | Blocking | Gate both `aria-busy` and `Updating…` at 400 ms. |
| The state table accidentally increased initial load from 300 ms to 700 ms. | Blocking | Keep initial load and scope changes at 300 ms; use 700 ms only after a successful response. |
| Clearing after a transient viewport failure recreated the blank-map failure mode. | Significant | Preserve the prior response, mark it `Previous view`, and keep that state until success. |
| Popup lifetime during background refresh was not called out as an intentional change. | Non-blocking | Specify and test that popups close on collection replacement, not camera movement. |
| Tests were missing mid-debounce scope changes, late stale responses, successful zero-result scopes, and exact rate assertions. | Significant | Add all four to acceptance criteria and automated verification. |

## Final specification changes

The revised design now defines:

- one timer, one active controller, and one request-generation sequence;
- 300 ms for first load/scope changes and 700 ms for same-scope viewport refreshes;
- atomic preservation of current points and counts during same-scope refresh;
- delayed visual and accessibility refresh state at the same 400 ms threshold;
- persistent stale labeling after a failed viewport refresh;
- explicit popup lifetime and expanded race-condition coverage.
