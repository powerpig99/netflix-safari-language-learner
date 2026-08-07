# Feature Recap

This file is a working inventory of what the Netflix Safari Language Learner currently does, what is optional, and what the narrowed project contract should be.

## Current Features

### Subtitle Overlay

- Custom dual-sub overlay replaces native subtitle display while extension subtitle mode is active.
- Original subtitle line is rendered by the extension.
- Translation subtitle line is rendered by the extension.
- Original subtitle words are clickable.
- Overlay works in windowed and fullscreen mode.
- Overlay is positioned relative to the rendered video area, not the full window.
- Subtitle size scales with video size.
- Subtitle font size options:
  - `S`
  - `M`
  - `L`
  - `XL`
  - `XXL`
  - `4K`
- Native Netflix subtitles are hidden while extension subtitle mode is active.
- Native Netflix subtitles are shown again when extension subtitle mode is disabled.

### Translation Sources

- Translation line can come from a Netflix target-language subtitle track when enabled and available.
- Translation line can come from cached machine translation.
- Translation line can come from live machine translation.
- If Netflix target-language subtitles are enabled for the second line and have a temporary cue gap, the translation row remains in layout so the original line does not jump.

### Word Lookup

- Clicking a word in the original subtitle shows a tooltip.
- Tooltip shows word translation.
- Tooltip includes a Wiktionary link.
- Tooltip works in windowed mode.
- Tooltip works in fullscreen mode.
- Tooltip has cached word-translation lookups.

### Playback Learning Controls

- Auto-pause near the end of the active subtitle.
- Previous subtitle.
- Next subtitle.
- Repeat current subtitle.
- Subtitle navigation resumes playback after seek.
- Playback speed control.

### Custom Panel And Visibility

- Custom top-right control panel exists.
- Custom cursor visibility logic exists during active playback.
- Panel visibility is intended to follow Netflix control visibility.
- Extension behavior is intended to activate only during real playback, not generic browsing.

### Settings Page

- Extension enabled.
- Dual subtitles enabled.
- Auto-pause enabled.
- Target language.
- `Use Netflix subtitles if available`.
- Translation provider.
- Provider API key fields where required.
- Gemini model setting (defaults: `gemini-3.5-flash-lite`, plus 3.1 / 2.5 Flash-Lite options).
- Grok model setting (defaults: `grok-4.3`; options include 4.5 and 4.20 non-reasoning).
- Default playback speed.
- Subtitle font size.

### Hotkeys Currently Implemented

- `d`: toggle dual subtitles
- `,`: previous subtitle
- `.`: next subtitle
- `i`: previous subtitle
- `g`: next subtitle
- `h`: repeat subtitle
- `r`: repeat subtitle
- `Shift+R`: retry subtitle translation
- `c`: retry subtitle translation
- `j`: play/pause through extension path
- `k`: decrease speed
- `[`: decrease speed
- `m`: increase speed
- `]`: increase speed
- `o`: toggle auto-pause
- `p`: toggle auto-pause
- `space`: present in keyboard module, but default-disabled, so Netflix should own it

### Translation Providers Currently Supported

- Google Translate
- Google Cloud
- DeepL
- Claude
- Gemini
- Grok
- Kimi

## Optional Extras Beyond Minimal Core

These are currently in the codebase, but are not obviously required by the narrowed functionality set:

- Multiple translation providers and API-key management
- Playback speed settings and controls
- Provider-specific model settings
- Retry translation command
- Custom top-right control panel as a full feature surface
- Extensive debug/export tooling
- Status/error banner messaging
- Extension-owned `j` / 8BitDo play-pause path

## Narrowed Project Contract

**Authoritative ownership:** [`control-ownership-contract.md`](control-ownership-contract.md). If this recap and the contract diverge, the contract wins.

### Netflix Owns

- Fullscreen
- Native playback controls and keys the extension does not customize
- Native playback state transitions outside extension-owned playback
- Native control chrome (as external visual exclusions)

### Extension Owns (during active customized watch playback)

- Play/pause for extension-owned inputs (`space` when enabled, bare video click, `j` / 8BitDo if kept) via one `toggle-playback` path
- Custom subtitle overlay
- Clickable original words
- Translation tooltip
- Auto-pause (page-timed on the same cue timeline)
- Previous subtitle / next subtitle / repeat
- Auto-resume after subtitle navigation
- Custom panel buttons and extension-only hotkeys
- Panel and cursor visibility while playback interception is active

### Visibility Rules

- Hot zones reveal controls; visible Netflix control regions keep them usable.
- Cursor visibility is movement-based and separate from control visibility.
- Visibility must not attach or detach playback interception.
- Native control-panel DOM is for visibility / exclusion regions only, not playback activation.

### Activation Rules

- Playback activation uses Netflix watch-session/player state (`adapter.isWatchPlaybackActive()`).
- DOM mounting uses the Netflix watch-player shell.
- Subtitle readiness does not decide watch-session activation.

## Likely Keep

- Dual subtitle overlay
- Clickable original words
- Tooltip translation
- Auto-pause
- Previous/next/repeat
- Auto-resume after subtitle navigation
- Target language setting
- `Use Netflix subtitles if available`
- Subtitle font size

## Likely Remove Or De-Scope

- Extra translation providers, if one provider path is enough
- Playback speed controls, if not part of the final core scope
- Retry translation command
- Extra debug/export tooling after stabilization (keep behavior; shrink production surface)

## Undecided (product, not ownership)

- Whether the top-right custom panel remains permanent or becomes a thinner scene widget (see overlay rewrite plan)
- Whether playback speed stays in core scope long term
- Whether multi-provider translation stays broad or is reduced to free Google + one AI provider

Play/pause during active customized playback remains **extension-owned** per the control-ownership contract until that contract is deliberately revised.
