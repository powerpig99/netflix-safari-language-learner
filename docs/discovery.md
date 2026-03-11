# Netflix Safari Discovery

Status: in progress

This file is the required Phase 0 discovery checkpoint from [`PROJECT_SPEC.md`](/Users/jingliang/Documents/active_projects/netflix-safari-language-learner/PROJECT_SPEC.md).

## Questions

1. Does Safari expose usable Netflix caption timing via `video.textTracks`?
2. Are `text`, `startTime`, and `endTime` stable enough to drive navigation and auto-pause?
3. If not, can a single injected page-context source expose a stable subtitle timeline?
4. What is the safest mount target for the control panel?
5. What is the safest subtitle container reference for the overlay?
6. How should title extraction work across episode transitions?
7. Which events or mutations reliably indicate player ready, subtitle changes, and episode transitions?

## Current provisional decision

- Authoritative source target: a single page-context Netflix player or subtitle source that can expose deterministic timing without mutating Netflix's runtime in a way that blocks page boot
- Reason: deterministic timing is still the requirement, but page-load safety is a harder constraint than premature subtitle capture
- Required validation: real Safari playback on Netflix episodes with subtitles toggled before and after extension init, including episode transitions
- Current rule: do not use subtitle DOM fallback for runtime features; subtitle-dependent features stay disabled until a safe deterministic source is confirmed

## Implemented discovery path

- `manifest.json` now splits boot in the LR shape: a tiny `document_start` injector and the main runtime at `document_end`.
- `content-script.js` still gates all real initialization until the route is a Netflix watch page.
- `inject.js` now auto-injects the page script from the tiny `document_start` loader so page-context hooks exist early enough for Netflix SPA watch transitions.
- `platform/netflix-injected.js` is now the single deterministic subtitle source candidate under test. It:
  - probes the LR-style Netflix player API
  - captures timed-text manifests through a read-only `JSON.parse` hook
  - patches matching outgoing Netflix request payloads through a narrow `JSON.stringify` hook to request richer subtitle hydration
  - fetches and parses WebVTT when the active subtitle track resolves to a hydrated manifest entry
  - publishes normalized timeline and active-cue state back to the adapter
- The current implementation now uses the minimal LR-style `JSON.stringify` hydration patch, but it still does not patch `Function.prototype.apply`.
- Core subtitle, translation, overlay, and control modules remain part of the watch-page runtime.
- `platform/netflix-adapter.js` is still temporary, but the current rule is to keep core functionality loaded and gate subtitle-timed behavior only on the presence of a deterministic source.
- A previous broader interception path caused a Netflix page-load regression and has been removed. The active version uses only read-side manifest capture plus the narrow write-side request hydration patch.
- Concrete LR architecture findings are recorded in [`docs/language-reactor-netflix-research.md`](/Users/jingliang/Documents/active_projects/netflix-safari-language-learner/docs/language-reactor-netflix-research.md).

## Capture template

### Environment

- Safari version:
- macOS version:
- Netflix page tested:
- Subtitle language tested:

### Findings

- `textTracks` available:
- cue timing stable:
- subtitle DOM selector:
- control panel mount target:
- title extraction method:

### Decision

- Chosen authoritative source:
- Features enabled from that source:
- Features explicitly disabled:
- Follow-up implementation work:
