# Netflix Safari Language Learner

Safari-first Web Extension for Netflix language learning: dual subtitles, word lookup, translation cache, auto-pause, and subtitle navigation.

The project is separate from the YLE extension. Platform-specific logic stays behind a Netflix adapter. Product and runtime rules for playback, control, and subtitles are defined in [`docs/control-ownership-contract.md`](docs/control-ownership-contract.md).

## Current status (MVP in use)

- MV3 Safari-compatible Web Extension (no build step)
- Page-context Netflix adapter for deterministic subtitle timeline + playback commands
- Dual subtitles, word tooltip lookup, multi-provider translation, IndexedDB cache
- Page-owned auto-pause; extension-owned prev/next/repeat during active watch playback
- Custom control panel + settings (popup + options page)
- Safari Xcode wrapper under `safari-xcode/`
- Unit tests under `tests/unit/` (Node test runner; not all modules covered)

Planning history lives in [`PROJECT_SPEC.md`](PROJECT_SPEC.md). Feature inventory: [`docs/feature-recap.md`](docs/feature-recap.md). Subtitle source discovery: [`docs/discovery.md`](docs/discovery.md).

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
├── tests/
└── safari-xcode/
```

## Translation providers

Default provider is free Google Translate. Optional providers: Google Cloud, DeepL, Claude, Gemini, Grok, Kimi.

Model defaults (verified 2026-08):

| Provider | Default model ID |
|----------|------------------|
| Gemini | `gemini-3.5-flash-lite` |
| Grok | `grok-4.3` |
| Claude | `claude-haiku-4-5-20251001` (fixed) |
| Kimi | `kimi-for-coding` (Kimi Code API) |

Stale stored model IDs are migrated on settings load.

## Tests

```bash
node --test tests/unit/*.test.js
```

Manual smoke: [`tests/manual/smoke-checklist.md`](tests/manual/smoke-checklist.md).

## Next steps

1. Reliability: coalesce adapter DOM scanning; harden translation-queue async state.
2. Overlay rewrite: single geometry owner ([`docs/overlay-layer-rewrite-plan.md`](docs/overlay-layer-rewrite-plan.md)).
3. Slim debug/trace surface in `content-script.js`.
4. Broader unit coverage for navigation, auto-pause, and adapter events.
