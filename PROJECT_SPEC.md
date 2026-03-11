# Netflix Safari Language Learner

Project specification for a new, separate browser-extension project that targets Netflix on Safari while preserving the non-audio learning features from the current YLE extension.

This document is a planning artifact only. It references the current repository for reuse analysis, but it must not cause changes to the existing YLE project.

## 1. Project intent

Build a new Safari-first Web Extension for Netflix that provides:

- dual subtitles
- popup word translation
- subtitle translation with provider selection
- subtitle cache
- auto-pause at subtitle end
- previous subtitle / next subtitle navigation
- repeat current subtitle
- playback speed control
- extension enable/disable toggle
- settings/options page

The new project must explicitly exclude:

- screen recording
- audio extraction
- MP3 encoding
- audio download

## 2. Relationship to the current repository

The current repository is a working reference implementation for:

- translation providers and routing
- subtitle translation queueing
- word translation and tooltip behavior
- local IndexedDB caching
- general extension settings behavior

The current repository is not a suitable direct base for Netflix/Safari in-place because platform assumptions are spread across runtime, UI, selectors, events, and manifest configuration.

Current-repo references to review before implementation:

- `/Users/jingliang/Documents/active_projects/yle-language-reactor/manifest.json`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/background.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/contentscript.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/inject.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/platforms/yle/yle-injected.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/content/translation-api.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/content/translation-queue.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/content/word-translation.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/database.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/utils.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/content/subtitle-dom.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/content/ui-events.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/controls/control-panel.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/controls/control-integration.js`
- `/Users/jingliang/Documents/active_projects/yle-language-reactor/extension-options-page/options.js`

## 3. Goals

- Keep the new project fully separate from the current YLE codebase.
- Preserve the learning UX and the core translation/caching capabilities.
- Make platform integration explicit through a single Netflix adapter.
- Keep the runtime simple: one authoritative subtitle timeline source per platform.
- Fail safely when Netflix/Safari cannot provide a deterministic signal for a feature.
- Keep the first version shippable without adding a build step unless one becomes clearly necessary.

## 4. Non-goals

- Do not support YLE in this new project.
- Do not support Chrome as a first-class target in the initial release.
- Do not keep backward-compatibility with the old code structure.
- Do not include any audio recording or download workflow.
- Do not add generalized multi-platform support in v1.

## 5. Product scope

### 5.1 Required features

1. Display original Netflix subtitle text as clickable words.
2. Show translated subtitle text below the original when dual subtitles are enabled.
3. Translate visible and prefetched subtitles via the selected provider.
4. Cache subtitle translations locally.
5. Cache word translations locally.
6. Allow word-level translation tooltip lookup from subtitle text.
7. Support extension on/off toggling.
8. Support dual-subtitle on/off toggling.
9. Support auto-pause at the end of the active subtitle.
10. Support previous subtitle, next subtitle, and repeat current subtitle.
11. Support playback speed adjustment.
12. Support settings for target language and provider/API keys.

### 5.2 Explicitly removed feature

The following feature set is removed by design and must not be ported:

- download speech audio
- screen recording
- recording progress UI
- post-processing audio filters
- MP3 encoding
- background download-blob handling for generated audio

## 6. Key product constraints

- Safari Web Extension architecture must be used.
- Netflix player internals may change frequently.
- Subtitle rendering and timing access may differ between Safari and Chrome.
- Timing-based features must only run if a deterministic subtitle timeline exists.
- The project must not rely on multiple competing truth sources for active subtitle timing.

## 7. Core design principles

### 7.1 One authoritative trigger

For Netflix on Safari, the implementation must choose one authoritative source for subtitle timing and content. Candidate sources may include:

- native `video.textTracks` cues
- a single injected subtitle/network source in the page context
- a normalized Netflix subtitle data source exposed by internal player state

Only one source may drive the runtime for:

- timeline generation
- active subtitle resolution
- auto-pause timing
- previous/next/repeat navigation

### 7.2 One platform adapter

All Netflix-specific logic must live in one adapter layer. Core modules must not know about:

- Netflix selectors
- Netflix event names
- Netflix DOM structure
- Safari-specific player quirks

### 7.3 Explicit feature gating

If the adapter cannot provide a required deterministic signal:

- disable the affected feature in UI
- do not fake behavior with heuristics
- do not add hidden fallback branches in unrelated modules

### 7.4 Core and platform separation

The project must be organized around:

- reusable core modules
- a Netflix adapter
- UI modules that consume normalized adapter state
- a small extension API wrapper for browser storage/runtime/tabs APIs

## 8. Proposed project structure

```text
netflix-safari-language-learner/
  PROJECT_SPEC.md
  README.md
  manifest.json
  background.js
  content-script.js
  inject.js
  styles.css
  popup.html
  popup.js
  database.js
  utils/
    extension-api.js
    language-utils.js
    dom-utils.js
  core/
    settings.js
    subtitle-store.js
    translation-api.js
    translation-queue.js
    word-translation.js
    overlay-controller.js
    auto-pause.js
    control-actions.js
  platform/
    netflix-adapter.js
    netflix-injected.js
  ui/
    control-icons.js
    control-panel.js
    control-integration.js
  options/
    index.html
    options.css
    options.js
  tests/
    unit/
    manual/
```

## 9. Architecture overview

### 9.1 Runtime flow

1. `content-script.js` boots.
2. `inject.js` injects `platform/netflix-injected.js` only if needed by the chosen adapter strategy.
3. `platform/netflix-adapter.js` discovers the authoritative subtitle source and emits normalized events.
4. `core/subtitle-store.js` holds current timeline, active subtitle, and feature availability.
5. `core/translation-queue.js` and `core/translation-api.js` manage subtitle translation.
6. `core/word-translation.js` manages word tooltip lookup and caching.
7. `ui/control-integration.js` binds UI controls to `core/control-actions.js`.
8. `core/overlay-controller.js` renders original and translated subtitles.

### 9.2 Normalized adapter contract

The adapter must expose a narrow interface similar to:

```js
/**
 * @typedef {{
 *   id: 'netflix',
 *   init: () => Promise<void>,
 *   getVideo: () => HTMLVideoElement|null,
 *   getTitle: () => string|null,
 *   getMountTarget: () => HTMLElement|null,
 *   getSubtitleContainer: () => HTMLElement|null,
 *   getTimeline: () => Array<{startTime:number,endTime:number,text:string}>,
 *   getFeatureAvailability: () => {
 *     dualSubs: boolean,
 *     wordLookup: boolean,
 *     subtitleNavigation: boolean,
 *     autoPause: boolean,
 *     repeat: boolean
 *   },
 *   subscribe: (listener: (event: PlatformEvent) => void) => () => void
 * }} PlatformAdapter
 */
```

The adapter event vocabulary should stay small:

- `playerReady`
- `captionsChanged`
- `timelineReady`
- `activeSubtitleChanged`
- `titleChanged`
- `platformError`

## 10. Data model

### 10.1 Subtitle cue

```js
{
  startTime: number,
  endTime: number,
  text: string
}
```

### 10.2 Active subtitle state

```js
{
  cue: SubtitleCue | null,
  renderedText: string | null,
  translationKey: string | null
}
```

### 10.3 Feature availability

```js
{
  dualSubs: boolean,
  wordLookup: boolean,
  subtitleNavigation: boolean,
  autoPause: boolean,
  repeat: boolean,
  playbackSpeed: boolean,
  settings: boolean
}
```

## 11. Module-by-module port plan

### 11.1 Reuse with minimal adaptation

These are good candidates to copy into the new project and then rename or lightly adapt:

- current `background.js`
  - keep translation routing/provider logic
  - remove YLE tab aggregation logic
  - remove `downloadBlob` message path
- current `database.js`
- current `content/translation-api.js`
- current `content/translation-queue.js`
- current `content/word-translation.js`
- current `utils.js`
  - move browser API wrappers into `utils/extension-api.js`
- current options-page logic from `extension-options-page/`

### 11.2 Reuse only after extraction

These files contain useful logic but must be split before reuse:

- current `controls/control-actions.js`
  - keep generic video seek/playback logic
  - remove YLE-specific focus behavior
- current `content/settings.js`
  - keep generic settings bootstrap and auto-pause state
  - remove YLE-specific caption event wiring

### 11.3 Rewrite from scratch

These should not be copied directly:

- current `manifest.json`
- current `contentscript.js`
- current `inject.js`
- current `platforms/yle/yle-injected.js`
- current `content/subtitle-dom.js`
- current `content/ui-events.js`
- current `controls/control-panel.js`
- current `controls/control-integration.js`
- current `popup.html`
- current `popup.js`
- current `styles.css`

### 11.4 Do not port

- `lib/mp3-encoder.js`
- `controls/audio-encoder.js`
- `controls/audio-filters.js`
- `controls/screen-recorder.js`
- any manifest permission or background message path used only for audio download
- any recorder UI markup or recorder-related keyboard bindings

## 12. Netflix/Safari discovery spike

Before implementation of feature-complete behavior, run a discovery phase and write down the results in `docs/discovery.md`.

Required spike questions:

1. Does Safari expose usable Netflix caption timing via `video.textTracks`?
2. If yes, are cue `text`, `startTime`, and `endTime` stable enough to drive all timing features?
3. If no, can an injected page-context observer access a stable Netflix subtitle timeline?
4. What DOM node is the safest mount target for a control panel?
5. What DOM node is the safest subtitle container reference for overlay placement?
6. How can title extraction be done reliably across episode transitions?
7. What events or mutations reliably indicate:
   - player ready
   - title change
   - subtitle track enabled/disabled
   - subtitle line change
   - episode transition

Decision rule for the spike:

- If `textTracks` is reliable, use only `textTracks`.
- If `textTracks` is unreliable but one injected source is reliable, use only that injected source.
- If neither is reliable, ship a reduced-scope version that disables navigation and auto-pause until a deterministic source is found.

## 13. Feature behavior contracts

### 13.1 Dual subtitles

Trigger:

- active subtitle changes

Expected result:

- original subtitle line renders as clickable words
- translated subtitle line renders below it when enabled

Unavailable-source behavior:

- if no active subtitle signal exists, show nothing and do not render stale data

### 13.2 Word translation

Trigger:

- user clicks a word in the rendered original subtitle line

Expected result:

- tooltip opens
- cached result is used if present
- Wiktionary and/or LLM fallback behavior matches the new project decision

Unavailable-source behavior:

- if subtitle text is unavailable, word lookup is disabled

### 13.3 Auto-pause

Trigger:

- active subtitle with deterministic `endTime`

Expected result:

- playback pauses slightly before or at subtitle end according to chosen implementation

Unavailable-source behavior:

- auto-pause control is disabled

### 13.4 Previous / next / repeat

Trigger:

- user presses control button or keyboard shortcut

Expected result:

- seek to deterministic target cue boundary

Unavailable-source behavior:

- controls are disabled

## 14. UI requirements

- Keep the UI compact and integrated with the player.
- Remove the audio download button entirely.
- Feature disablement must be visible and intentional, not hidden.
- Avoid player-focus hacks unless discovery proves they are required.
- Prefer an overlay that follows the native subtitle container rather than replacing unrelated player DOM.

## 15. Extension API wrapper

Create one wrapper module for browser APIs used by the project:

- storage get/set
- runtime sendMessage
- runtime openOptionsPage
- tabs query/sendMessage, only if required

This wrapper should abstract away direct `chrome.*` usage so Safari-specific differences are isolated.

## 16. Manifest requirements

The new manifest must:

- target Netflix URLs only for v1
- exclude `downloads` permission
- exclude any recording/audio libraries from content scripts
- keep only permissions actually required by translation, storage, and settings
- keep web-accessible resources limited to the injected Netflix adapter, if injection is still required after discovery

## 17. Settings and storage

Required stored settings:

- extensionEnabled
- dualSubEnabled
- autoPauseEnabled
- playbackSpeed
- targetLanguage
- translationProvider
- provider API keys and model overrides as needed
- subtitle font size, if retained

Storage rules:

- local cache in IndexedDB for translations
- sync storage for settings and API keys where appropriate
- explicit migration path if key names differ from the YLE project

## 18. Testing strategy

### 18.1 Unit tests

Port or add tests for:

- translation queue behavior
- database cache behavior
- navigation target selection
- auto-pause scheduling with deterministic cue timing
- adapter event normalization

### 18.2 Manual smoke tests

Create a checklist covering:

- episode page load
- episode transition
- subtitles on before extension init
- subtitles toggled on after extension init
- subtitles toggled off
- dual subtitles on/off
- extension on/off
- provider switch
- target language switch
- tooltip word lookup
- previous / next / repeat
- auto-pause
- playback speed
- full-screen mode

### 18.3 Regression rule

Every feature must be tested in Safari first. Chrome parity is optional until Safari behavior is stable.

## 19. Risks

- Netflix may not expose a reliable subtitle timeline in Safari.
- Netflix DOM structure may change often.
- Safari may differ in WebExtension API behavior from Chrome.
- Player overlay mounting may break on full-screen or episode transitions.
- Legal or store-review constraints may require reduced implementation scope.

## 20. Compliance and safety boundaries

- Do not attempt to export, record, or save protected media.
- Do not reintroduce recording under another name.
- Do not hide unsupported states; disable features explicitly.
- Keep network access limited to translation providers and only for user-requested translation behavior.

## 21. Initial implementation phases

### Phase 0: Discovery

- confirm subtitle/timing source
- confirm mount target
- confirm title extraction
- confirm caption enabled/disabled signal

### Phase 1: Skeleton

- create project files
- add manifest
- add extension API wrapper
- add background translation router

### Phase 2: Core port

- port database
- port translation queue
- port translation APIs
- port word translation
- port settings/options

### Phase 3: Netflix adapter

- implement player readiness detection
- implement subtitle timeline acquisition
- implement active subtitle events
- implement title change detection
- implement feature-availability reporting

### Phase 4: UI

- build overlay controller
- build control panel without audio button
- wire control actions to adapter-backed subtitle timeline

### Phase 5: QA and hardening

- manual smoke pass
- unit test coverage for deterministic timing behavior
- simplify any duplicate state discovered during implementation

## 22. Definition of done

The new project is ready for initial use when:

1. It runs as a Safari Web Extension on Netflix.
2. It supports dual subtitles, word lookup, translation, cache, speed control, and settings.
3. Timing-based features run only when backed by a deterministic subtitle timeline.
4. There is no recording or audio-download code in the project.
5. Platform-specific code is isolated to the Netflix adapter layer.
6. The current YLE repository remains unchanged.

## 23. References

Safari extension references:

- https://developer.apple.com/documentation/safariservices/safari-web-extensions
- https://developer.apple.com/documentation/safariservices/updating-a-safari-web-extension
- https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility
- https://developer.apple.com/safari/extensions/

Current repository principle reference:

- `/Users/jingliang/Documents/active_projects/yle-language-reactor/docs/principles/ultimate-simplicity.md`

## 24. Kickoff checklist

- [ ] Create the new project repository or working folder.
- [ ] Copy this spec into the new project root.
- [ ] Complete the Netflix/Safari discovery spike.
- [ ] Decide the single authoritative subtitle source.
- [ ] Scaffold the extension skeleton.
- [ ] Port only the approved reusable modules.
- [ ] Build the Netflix adapter before building the full UI.
- [ ] Keep recording/audio code out from day one.
