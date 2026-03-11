# Netflix Safari Language Learner

Safari-first Web Extension scaffold for Netflix language learning.

This repository is intentionally separate from the existing YLE extension. The scaffold follows [`PROJECT_SPEC.md`](/Users/jingliang/Documents/active_projects/netflix-safari-language-learner/PROJECT_SPEC.md) and keeps platform-specific logic isolated behind a Netflix adapter.

## Current scaffold status

- MV3 Safari-compatible Web Extension structure with no build step
- background translation router with provider selection
- IndexedDB cache for subtitle and word translations
- content runtime split into core, platform, and UI layers
- popup and options pages for basic settings
- discovery and manual QA docs

## Not finished yet

- Netflix discovery results in [`docs/discovery.md`](/Users/jingliang/Documents/active_projects/netflix-safari-language-learner/docs/discovery.md)
- hard validation that Safari `textTracks` are deterministic enough for all timing features
- real Netflix DOM hardening across fullscreen and episode transitions
- unit test runner and coverage

## Layout

```text
.
├── PROJECT_SPEC.md
├── README.md
├── manifest.json
├── background.js
├── content-script.js
├── inject.js
├── styles.css
├── popup.html
├── popup.js
├── database.js
├── utils/
├── core/
├── platform/
├── ui/
├── options/
├── docs/
└── tests/
```

## Next steps

1. Complete the Netflix/Safari discovery spike and document the results.
2. Confirm whether `video.textTracks` can remain the single authoritative subtitle source.
3. Harden selectors and lifecycle handling against real Netflix episode transitions.
4. Add unit coverage for translation queue, navigation targets, and auto-pause timing.
