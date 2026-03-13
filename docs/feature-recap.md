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
- Gemini model setting.
- Grok model setting.
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

### Netflix Owns

- Play/pause
- Fullscreen
- Native control-panel visibility
- Native playback keys and clicks
- Native playback state transitions

### Extension Owns

- Custom subtitle overlay
- Clickable original words
- Translation tooltip
- Auto-pause
- Previous subtitle
- Next subtitle
- Repeat subtitle
- Auto-resume after subtitle navigation
- Only the settings required for these functions

### Visibility Rules

- Extension controls should only be visible when Netflix native controls are visible.
- No extra visual effects beyond what is necessary for the learning features.

### Activation Rules

- Playback activation should use Netflix watch-session/player state.
- DOM mounting should use the Netflix watch-player shell.
- Native control-panel DOM should be used for visibility only, not playback activation.

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
- Extension-owned play/pause path
- Extra debug/export tooling after stabilization

## Undecided

- Whether the top-right custom panel remains as a permanent feature or becomes a thinner UI tied strictly to Netflix controls
- Whether playback speed stays in scope
- Whether multi-provider translation stays in scope or is reduced
- Whether `j` / 8BitDo play/pause stays extension-owned or is fully returned to Netflix semantics
