# Netflix Safari Discovery

Status: **closed for v1** (authoritative source chosen and implemented)

This file is the Phase 0 discovery checkpoint from [`PROJECT_SPEC.md`](../PROJECT_SPEC.md). Residual Safari edge cases may still appear; they should be treated as hardening, not as reopening the source-of-truth decision.

## Questions (answered)

1. Does Safari expose usable Netflix caption timing via `video.textTracks`?
2. Are `text`, `startTime`, and `endTime` stable enough to drive navigation and auto-pause?
3. If not, can a single injected page-context source expose a stable subtitle timeline?
4. What is the safest mount target for the control panel?
5. What is the safest subtitle container reference for the overlay?
6. How should title extraction work across episode transitions?
7. Which events or mutations reliably indicate player ready, subtitle changes, and episode transitions?

## Decision (authoritative)

| Topic | Choice |
|-------|--------|
| **Authoritative subtitle source** | Single page-context path in `platform/netflix-injected.js` |
| **How** | LR-style Netflix player probe + read-only timed-text manifest capture (`JSON.parse`) + narrow request hydration (`JSON.stringify`) + WebVTT fetch/parse |
| **Not used for timing** | Subtitle DOM scraping; multi-source fallbacks; content-script auto-pause clocks |
| **Mount target** | Netflix watch-player shell around the active video (`platform/netflix-adapter.js`) |
| **Subtitle overlay placement** | Extension overlay positioned from rendered video rect (layout rewrite planned separately) |
| **Playback activation** | Page watch-session state → `adapter.isWatchPlaybackActive()` |
| **Auto-pause clock** | Page-side; prefer DOM `<video>.currentTime` on Safari (see control-ownership contract) |

### Features enabled from this source

When timeline is ready: dual subs, word lookup, prev/next/repeat, auto-pause.

When timeline is not ready: those features stay disabled; no heuristic faking.

### Explicit non-goals of discovery

- Do not reintroduce broader `Function.prototype.apply` interception (caused page-load regression).
- Do not use native control visibility as playback activation.
- Do not keep a weaker timing source “just in case.”

## Implemented discovery path

- `manifest.json` splits boot: tiny `document_start` injector + main runtime at `document_end`.
- `content-script.js` gates real work to Netflix watch routes; long-lived runtime uses `adapter.setWatchRouteActive` on route changes.
- `inject.js` injects the page script early enough for SPA watch transitions.
- `platform/netflix-injected.js` is the single deterministic subtitle + page-player command surface under test and in production use.
- Core modules stay platform-agnostic; timing features gate on timeline readiness.
- Architecture notes from LR research: [`docs/language-reactor-netflix-research.md`](language-reactor-netflix-research.md).
- Ownership rules: [`docs/control-ownership-contract.md`](control-ownership-contract.md).

## Residual validation (hardening, not re-decision)

Still worth re-checking after Netflix UI changes:

- Subtitles on before extension init vs toggled after init
- Episode transitions within a series
- Fullscreen windowed transitions
- Target-language Netflix track gaps when “Use Netflix subtitles if available” is on
- Safari version upgrades

### Capture template (for regression notes)

#### Environment

- Safari version:
- macOS version:
- Netflix page tested:
- Subtitle language tested:

#### Findings

- Timeline ready:
- cue timing stable:
- mount target:
- issues:

#### Decision

- Keep current injected source unless a clearer single signal replaces it entirely.
