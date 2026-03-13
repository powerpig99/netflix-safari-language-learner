# Control Ownership Contract

This file defines the agreed control and lifecycle contract before further implementation changes.

## Goal

Prevent racing conditions and confused ownership by giving each control path exactly one owner at any moment, with explicit attach and release conditions.

The governing principle is:
- identify the most reliable signal
- use it directly
- do not add fallback paths to "increase reliability"
- if the reliable signal is still unclear, keep the failure visible until the boundary is understood
- do not keep weaker signals in reserve "just in case"
- if the right signal is unknown, stop branching and trace the boundary instead

Code should be as simple as possible, but not simpler than the required behavior and causal model.
Simplicity is for clarity, not for hiding uncertainty.
Fallbacks are not robustness; they are unresolved uncertainty disguised as architecture.

## Authoritative Signals

These signals must stay separate.

### 1. Playback Activation

Authoritative source:
- Netflix page-context watch-session/player state

Purpose:
- decide whether the extension should be active at all
- decide whether custom control interception can be attached

Must not depend on:
- visible Netflix controls
- generic `<video>` discovery alone
- subtitle visibility heuristics

### 2. Player Shell Binding

Authoritative source:
- the Netflix watch-player shell around the active playback video

Purpose:
- decide where the overlay and custom panel mount
- decide which player surface receives visibility classes

Must not depend on:
- whether Netflix controls are currently visible

### 3. Control Visibility

Authoritative source:
- extension-owned visibility controller on the watch-player shell

Purpose:
- reveal controls from explicit top/bottom hot zones
- keep controls visible while the pointer is inside visible Netflix control regions
- control panel visibility
- cursor visibility while playback UI is active

Must use as inputs only:
- player shell geometry
- pointer movement
- visible Netflix control-region DOM

Must not decide:
- whether playback is active
- whether interception should attach
- whether subtitle features are ready

### 4. Subtitle Timing Readiness

Authoritative source:
- deterministic subtitle timeline readiness

Purpose:
- gate subtitle-dependent learning features:
  - dual subtitles
  - word lookup
  - subtitle navigation
  - repeat
  - auto-pause

Must not decide:
- whether Netflix native play/pause should be intercepted by itself

### 5. Playback Command Path

Authoritative source:
- extension-owned page-player command bridge

Purpose:
- normal play/pause sends one `toggle-playback` command
- auto-pause is scheduled and sent from the page-player side using the same cue timeline and player clock
- subtitle navigation sends `seek` then `play`

Must not depend on:
- raw `video.paused`
- parallel DOM media commands
- inferred pause state from cue timing or auto-pause bookkeeping

## Ownership Rules

### Netflix Owns

- Fullscreen
- Native playback controls and keys that the extension does not customize
- Native playback state transitions outside extension-owned playback

### Extension Owns

- Play/pause during active customized playback
- Custom subtitle overlay
- Clickable original subtitle words
- Translation tooltip
- Auto-pause
- Previous subtitle
- Next subtitle
- Repeat subtitle
- Auto-resume after subtitle navigation
- Custom panel buttons
- Extension-only hotkeys

## Play/Pause Ownership Rule

Play/pause may be extension-owned only during active customized playback.

Current project choice:
- extension owns play/pause during active customized playback
- Netflix owns play/pause outside that state

### If extension owns play/pause

It must own all of these together:
- `space`
- bare video click
- extension play/pause hotkey (`j` / 8BitDo if kept)

And it must route them through one command path only:
- `toggle-playback`

And Netflix must not also handle those same inputs during that active state.

### If extension does not own play/pause

Netflix owns all play/pause inputs:
- `space`
- bare video click
- any native play/pause UI

The extension must not partially intercept them.

## Attach Conditions

Playback-control interception may attach only when all are true:

- `extensionEnabled`
- watch session is active
- real watch-player shell is mounted

If the implementation keeps extension-owned play/pause, it should attach from exactly one gate derived from:
- `adapter.isWatchPlaybackActive()`

That gate should be the single source of truth.

## Release Conditions

Playback-control interception must be released immediately when any of these become false:

- extension disabled
- watch session lost
- route leaves watch playback
- player shell/video detached

Release means actual teardown, not only guarded handlers.

Release must do all of:
- remove key listeners for extension-owned playback controls
- remove click listeners for extension-owned playback controls
- clear timers related to those controls
- clear stale control/cursor state
- stop native subtitle management if no longer active

## Visibility Rules

- Hot zones reveal controls.
- Visible Netflix control regions keep controls visible long enough to use them.
- Cursor visibility is movement-based and separate from control visibility.
- Panel and cursor visibility are extension-owned while playback interception is active.
- Tooltip cursor support is only for tooltip interaction and must not wake control visibility on its own.

Visibility logic must not attach or detach playback interception.

## Subtitle Rules

- Native Netflix subtitle text should remain hidden when extension subtitle mode is active.
- Extension overlay renders:
  - original line
  - translation line
- Original line is the clickable surface.
- If `Use Netflix subtitles if available` is enabled:
  - use Netflix target-language subtitle track for the second line when available for the video
  - if the selected target track has no active cue at a moment, show no translation text for that moment
  - preserve the second-line layout slot so the original line does not jump
- If no usable Netflix target-language track exists:
  - use cache
  - then live translation

## Navigation Rules

- Previous / next / repeat are extension-owned.
- These features require deterministic subtitle timing.
- On navigation:
  - issue one atomic `seek-and-play` transition
  - the real `seeked` boundary initiates the target cue
  - no intermediate pre-seek state may arm or fire auto-pause

## Auto-Pause Rules

- Auto-pause is extension-owned, but page-timed.
- It requires deterministic subtitle timing.
- It is scheduled in the page script from the same live player clock and resolved cue timeline that determine the active subtitle cue.
- On Safari, the authoritative auto-pause clock should be the rendered DOM `<video>.currentTime` when available.
- Player/session time may still be logged for comparison, but it must not outrank the DOM video clock for the pause threshold if the two diverge.
- It is a threshold-crossing event for one cue traversal:
  - traversal is anchored to the cue itself
  - trigger time is `cue.endTime - lead`
  - it fires only when playback crosses that trigger on the same clock
- Cue initiation is the only thing that arms auto-pause.
  - normal playback entering a new cue initiates that cue traversal
  - navigation initiates the target cue only at the real `seeked` boundary
- Arming the feature must not seed traversal from refresh snapshots.
- The page-side loop itself must acquire the live cue from the resolved timeline and anchor traversal from that cue's own start.
- Any pause clears the active timer for the current traversal.
- Plain pause/resume must not create a new cue traversal or re-derive the trigger from a second timing source.
- Once playback resumes after that crossing, that trigger is already behind playback time; the next eligible trigger is the next cue traversal.
- It pauses slightly before the subtitle ends.
- It always sends one `pause` command when the cue-end trigger fires.
- It must not add a second content-script scheduler, sampled wall-clock compensation, or any parallel timing source.

## No-Go Rules

- No mixed ownership of the same input path.
- No fallback from extension-owned playback control to raw DOM video methods if that reintroduces a second owner.
- No using native control visibility as playback activation.
- No using subtitle readiness as a proxy for watch-session activation.
- No broad generic extension behavior outside real playback.
- No fallback activation path from generic video presence once `adapter.isWatchPlaybackActive()` exists.
- No compensation for uncertain playback state or timing.
- No fallback timing/state/control path once a more reliable signal has been identified.
- No keeping a weaker signal in the live decision path "just in case."
- If the authoritative signal is still unknown, log and expose that uncertainty instead of masking it with another branch.
- No simplification that reduces causal clarity or required functionality.
- No fallback branch kept only because we are unwilling to commit to the most reliable signal.
- No random success from a weaker path may be treated as deterministic correctness.

## Implementation Checklist

Before making more control changes, implementation should verify:

1. There is one explicit playback activation function.
2. There is one explicit playback-control interception function.
3. Attach and release are real listener lifecycle changes, not only boolean guards.
4. Visibility is separate from activation.
5. Subtitle readiness is separate from activation.
6. Playback commands have one authoritative command path.
7. Native and extension ownership for each key/click path is unambiguous.
8. The live decision path uses the most reliable known signal directly.
9. There is no weaker fallback left in the decision path out of habit or caution.
10. If the signal is still unresolved, the code leaves that boundary visible instead of masking it with another branch.
10. Any unresolved boundary is explicit in code/docs/logging instead of hidden behind alternate behavior.

## Current Wiring

This section records the intended implementation path so future modifications can be checked against it.

### Playback Activation

File:
- `platform/netflix-adapter.js`

Authoritative function:
- `adapter.isWatchPlaybackActive()`

Rules:
- session activity comes from page-context watch-session state
- video binding requires both:
  - active watch session
  - a real watch-player shell around the bound video
- native control-panel DOM must not decide activation

### Runtime State Sync

File:
- `content-script.js`

Rules:
- `subtitleStore.playerReady` mirrors `adapter.isWatchPlaybackActive()`
- runtime sync must not derive activation from:
  - generic video presence
  - `featureAvailability.dualSubs`
  - control visibility

### Playback-Control Interception

File:
- `ui/control-integration.js`

Authoritative function:
- local playback interception gate derived from `adapter.isWatchPlaybackActive()`

Rules:
- `space`, bare video click, and extension play/pause hotkey are attached together
- they are detached together
- attach/detach is real listener lifecycle, not only a guard inside handlers
- visibility listeners are separate from playback interception listeners

### Playback Commands

Files:
- `platform/netflix-injected.js`
- `platform/netflix-adapter.js`
- `core/control-actions.js`

Authoritative path:
- normal play/pause: `adapter.togglePlayback()`
- auto-pause: page-script cue timer -> `sessionPlayer.pause()` / `mediaElement.pause()`
- subtitle navigation: one page-owned `adapter.seekAndPlay()` transition

Rules:
- raw DOM media methods must not become a second owner
- normal play/pause does not branch on inferred paused state in the content script
- subtitle navigation is one atomic transition, not two cross-context commands
- the real `seeked` boundary initiates the target cue traversal
- auto-pause may not re-arm from any intermediate pre-seek state
- content script does not own an auto-pause timer

### Visibility

File:
- `ui/control-integration.js`

Rules:
- hot zones reveal controls
- visible Netflix native control regions keep them visible
- cursor visibility is movement-timed and separate from control visibility
- panel and cursor visibility are extension-owned while playback interception is active
- visibility must not wake or keep playback interception alive by itself
- tooltip cursor support must not become a playback-control activation path
