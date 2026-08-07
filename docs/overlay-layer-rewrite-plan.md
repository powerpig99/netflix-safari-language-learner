# Overlay Layer Rewrite Plan

Status: in progress (C1–C2 foundation, 2026-08-07)

Landed so far:

- Shared geometry in `utils/dom-utils.js` (`getRenderedVideoRect`, `toLocalRect`, `isVisibleElement`)
- Pure layout engine in `core/overlay-layout-engine.js` (`computeSubtitlePlacement`, exclusion bands, exclusion store)
- `core/overlay-controller.js` places subtitles via the engine (no inline lift math)
- `ui/control-integration.js` publishes native control bands to `core.layoutExclusionStore` when controls are visible
- Unit tests: `tests/unit/dom-utils.test.js`, `tests/unit/overlay-layout-engine.test.js`

Also done after C2:

- Overlay no longer scans interactive Netflix nodes for collision lift
- 250ms layout polling removed; layout updates from ResizeObserver, render, and exclusion-store notifications
- Control integration publishes `native-controls` bands + `extension-panel` rect into the exclusion store

Still open for full rewrite:

- Single overlay scene root owning panel + subtitles + status
- pretext-owned line layout / clickable word tokens
- Remove independent panel CSS geometry ownership (panel still top/right absolute in CSS)

This document describes a full rewrite of extension display/layout around one extension-owned overlay layer inside the rendered video rect.

It does not change the active runtime contract by itself. It is a design and implementation plan for a new layout owner.

## Why this rewrite exists

The current implementation positions major UI pieces independently, then tries to avoid overlap afterward.

Current examples:

- `core/overlay-controller.js` computes subtitle overlay size, scale, and bottom offset independently.
- `core/overlay-controller.js` scans interactive nodes and lifts the subtitle block to dodge collisions.
- `ui/control-integration.js` owns a separate mounted control panel.
- `styles.css` gives the subtitle overlay and control panel separate absolute positioning rules.

That model has a structural flaw:

- each element claims space on its own
- conflict is discovered after placement
- conflict is resolved by compensating heuristics

This means overlap avoidance can improve, but it cannot become deterministic as long as there are multiple live position owners.

## Target simplification

The rewrite collapses display/layout into two layers only:

1. Video layer
   - one independent geometry source: the rendered video rect
2. Overlay layer
   - one extension-owned layout surface for all extension UI that appears over the video

Inside the overlay layer, no child decides its own screen position directly.

Instead:

- the overlay layout engine receives the available space
- layout rules and exclusions reshape that space
- text and controls are placed from that shared space model
- no child later "dodges" another child after independent placement

## Core principle

For display/layout, the authoritative geometry signal is:

- the rendered video rect, expressed in overlay-local coordinates

For extension overlay placement, the single owner is:

- the overlay scene controller

Children may own content and interaction state, but not final geometry.

## Goals

- Replace per-element absolute positioning with one overlay layout owner.
- Remove post-placement collision compensation from subtitle rendering.
- Use a shared available-space model for subtitles, translation, status, and custom controls.
- Make text layout deterministic enough that overlay conflicts are prevented instead of patched.
- Keep playback activation, subtitle timing, and control visibility ownership separate from layout ownership.

## Non-goals

- Do not change subtitle timing authority.
- Do not change playback ownership rules.
- Do not change navigation or auto-pause semantics.
- Do not introduce a generic full-screen constraint solver for arbitrary app UI.
- Do not keep CSS wrapping as the final authority once the new text layout path is active.

## Contract alignment

This plan keeps the current ownership split from `docs/control-ownership-contract.md`:

- playback activation still comes from page-context watch-session/player state
- player shell binding still decides mount target
- control visibility still comes from the visibility controller
- subtitle timing readiness still comes from deterministic timeline readiness

What changes is only the owner of extension overlay geometry.

## Root cause

The current layout path mixes multiple geometry owners:

- subtitle block geometry is derived in `core/overlay-controller.js`
- control panel geometry is implicit in `styles.css`
- Netflix controls become dynamic obstacles discovered by DOM scans
- final text flow is still delegated to browser CSS wrapping

This creates four separate geometry authorities:

1. rendered video rect math
2. per-component absolute positioning
3. DOM collision heuristics
4. CSS line wrapping

The rewrite removes that split and makes overlay geometry flow through one path:

- rendered video rect
- overlay scene input
- overlay layout engine
- overlay scene output
- renderer

## Proposed architecture

### Layer model

#### Layer 1: Video geometry layer

Responsibility:

- resolve the rendered video rect
- expose it as the root bounds for overlay layout

Rules:

- no child layout logic in this layer
- no subtitle-specific collision logic in this layer
- no control visibility logic in this layer

#### Layer 2: Overlay scene layer

Responsibility:

- own one overlay root mounted to the watch player shell
- hold all extension UI that visually sits on the video
- compute all extension overlay geometry from one scene input

Overlay-scoped UI in target design:

- original subtitle line
- translation line
- status/error line
- custom control panel
- optional future transient UI such as inline indicators

Tooltip handling is called out separately below because it is transient and anchor-driven.

## Authoritative signals

### 1. Playback activation

Owner:

- `adapter.isWatchPlaybackActive()`

Used for:

- attach/release the overlay scene root

Must not be used for:

- subtitle layout geometry

### 2. Player shell binding

Owner:

- watch-player shell around the active video

Used for:

- overlay root mount target

### 3. Video geometry

Owner:

- one shared rendered video rect function

Used for:

- overlay bounds
- safe insets
- coordinate normalization

### 4. Control visibility and exclusion regions

Owner:

- visibility controller

Used for:

- whether control-related overlay nodes are visible
- which top/bottom regions are reserved from subtitle text flow

Important rule:

- the visibility controller may publish exclusion regions
- it must not place overlay children directly

### 5. Subtitle content

Owner:

- subtitle store plus translation queue plus settings

Used for:

- which content nodes exist
- which rows must reserve space even when empty

### 6. Overlay scene geometry

Owner:

- overlay scene controller plus pure layout engine

Used for:

- all final positions and sizes of extension overlay nodes

## Scene inputs

The new overlay layout engine should take one normalized input object.

Suggested shape:

```js
{
  bounds: { x, y, width, height },
  safeInsets: { top, right, bottom, left },
  visibility: {
    controlsVisible: boolean,
    cursorVisible: boolean,
    panelVisible: boolean
  },
  exclusions: [
    { id, type, rect, priority }
  ],
  settings: {
    extensionEnabled,
    dualSubEnabled,
    subtitleFontSize,
    useNetflixTargetSubtitlesIfAvailable
  },
  subtitle: {
    originalText,
    translationText,
    translationReserved,
    statusText,
    sourceLanguage,
    targetLanguage
  },
  controls: {
    visible,
    buttons,
    speedValue,
    statusText
  }
}
```

All coordinates should be overlay-local, not viewport-global.

## Scene outputs

The layout engine should return one full scene description.

Suggested shape:

```js
{
  nodes: [
    {
      id,
      kind,
      rect,
      zIndex,
      hidden,
      data
    }
  ],
  textRuns: [
    {
      id,
      rect,
      lines: [
        {
          text,
          rect,
          tokens
        }
      ]
    }
  ],
  debug: {
    availableRegions,
    chosenRegions,
    rejectedLayouts
  }
}
```

The renderer should not invent geometry beyond this output.

## Layout primitives

The new engine does not need to become a generic 2D packer.

It only needs a small set of primitives:

- root bounds
- insets
- reserved bands
- exclusion rects
- anchored boxes
- flowing text blocks
- vertical stacks

That is enough for this product shape.

## Available-space model

The engine should represent free space as the video bounds minus:

- base safe insets
- visible Netflix control bands
- extension-owned control panel rect
- any other active exclusion rects explicitly passed into the scene

The key rule is:

- exclusions reshape available space before placement
- no placed node later applies a compensating "lift"

## Layout order

The overlay scene should place nodes in a stable order.

Recommended order:

1. root bounds and safe insets
2. external exclusion regions from Netflix controls
3. extension control panel region
4. status/error block
5. subtitle block
6. translation block
7. optional transient nodes

This order gives top-priority UI first claim on space and makes subtitle flow adapt to what remains.

## Text layout strategy

`pretext` should be used as the text measurement and line-routing engine inside the overlay scene, not as a second owner beside CSS.

Relevant external references:

- [Pretext README](https://raw.githubusercontent.com/chenglou/pretext/main/README.md)
- [Pretext demos index](https://chenglou.me/pretext/)
- [Dynamic Layout demo](https://chenglou.me/pretext/dynamic-layout/)
- [Rich Text demo](https://chenglou.me/pretext/rich-note/)

### Rules for using `pretext`

- `prepare()` or `prepareWithSegments()` happens when text or font config changes.
- resize or exclusion changes rerun only the cheap layout step.
- DOM must render the line decisions from the layout engine, not re-wrap them independently.
- font shorthands used by `pretext` must match rendered CSS exactly.

Important caveat from `pretext` docs:

- `system-ui` is unsafe for accurate layout on macOS
- use explicit named fonts for the new overlay path

### Subtitle block strategy

The subtitle block should no longer be "bottom center with lift."

Instead:

1. define a preferred subtitle region near the lower part of the video
2. subtract visible exclusions from that region
3. convert remaining width by row into a width profile
4. run text layout against that width profile
5. pick the highest subtitle block position that satisfies:
   - minimum readable width
   - minimum bottom affinity
   - no overlap with exclusions

For row-varying width, the engine should use the `layoutNextLine()` style of flow that `pretext` exposes for changing widths by line.

### Translation block strategy

The translation row is a sibling node in the same block stack, not an independently placed overlay.

Rules:

- when dual subtitles are disabled, translation node does not exist
- when Netflix target subtitles are enabled but no cue exists, preserve the row slot with empty content
- translation always consumes shared scene space through the same stack rules as original text

### Status block strategy

The status or error block should become another scene node with explicit priority.

Initial recommendation:

- prefer top-center or upper-third placement
- reserve its rect before subtitle placement
- do not let subtitle layout overlap it

## Control panel strategy

The custom control panel should move into the same overlay scene.

This means:

- remove its independent `top/right` CSS authority
- represent it as an anchored scene node with known intrinsic metrics
- feed its final rect back into the available-space model before subtitle placement

The visibility controller still decides whether the panel is visible.
The layout engine decides where the visible panel sits.

Recommended first layout rule:

- anchor panel to top-right inside the overlay root
- reserve that rect in the scene before laying out status and subtitle blocks

This still uses a preferred anchor, but not an independent geometry owner.

## Netflix controls as external exclusions

Netflix native controls are not overlay-scene children, but they still occupy visual space over the video.

The rewrite should stop scanning every interactive node to infer collisions.

Instead, the visibility controller should publish stable exclusion regions such as:

- top controls band rect
- bottom controls band rect
- title/back region rect if distinct

The overlay layout engine should consume those as explicit external exclusions.

That is a major simplification:

- fewer geometry inputs
- clearer ownership
- no subtitle-specific DOM scan heuristics

## Word interaction strategy

Clickable original words are the hardest part of the rewrite and must be handled explicitly.

### Constraint

If `pretext` decides line breaks but DOM inline flow still wraps naturally, the browser becomes a second layout owner and word hit targets can drift from the computed layout.

That must not happen.

### Target strategy

Render original subtitle text as layout-owned lines.

Recommended approach:

- renderer creates one positioned line container per computed line
- each line container renders tokens assigned to that line
- the browser is allowed to place tokens inline inside that line container, but not to wrap to another line
- line containers are the vertical layout authority

This keeps:

- deterministic line breaks from the layout engine
- normal DOM buttons for clickable words
- stable anchors for tooltips

### Required feasibility spike

Before full migration, verify:

- `pretext` line output can be mapped cleanly back to subtitle tokens
- mixed punctuation, CJK, and bidi text still produce correct clickable token grouping
- Safari text rendering stays acceptably close to `pretext` measurement with the chosen explicit font stack

If token mapping cannot be made deterministic enough, stop and document the gap before full rewrite.

## Tooltip strategy

Tooltip UI is transient and anchor-driven, so it should not block the base rewrite.

Plan:

- phase 1 of the rewrite keeps tooltip rendering separate from base scene flow
- tooltip remains anchored to the clicked word within the overlay root or fullscreen root
- tooltip does not become a scene exclusion until proven necessary

Rationale:

- the main root-cause problem is persistent overlay layout conflict
- tooltip overlap is a secondary transient problem

If later needed, tooltip can become an optional transient exclusion published back into the scene.

## Scheduling and updates

The new overlay scene controller should coalesce all layout work into one frame-driven update path.

Inputs that may schedule a new scene computation:

- mount target changed
- rendered video rect changed
- control visibility changed
- exclusion rects changed
- active subtitle changed
- translation state changed
- settings affecting font or visibility changed

Rules:

- no polling interval for steady-state layout
- use `ResizeObserver`, explicit store subscriptions, and visibility updates
- batch scene input collection and layout into one `requestAnimationFrame`

## Proposed module plan

### New modules

#### `core/overlay-scene-controller.js`

Responsibilities:

- attach and release the overlay root
- gather normalized scene inputs
- schedule layout
- call renderer

#### `core/overlay-layout-engine.js`

Responsibilities:

- pure geometry calculation
- build available space
- place boxes and text blocks

#### `core/overlay-text-layout.js`

Responsibilities:

- wrap `pretext`
- cache prepared text by content and font config
- expose line-layout helpers for fixed-width and varying-width rows

#### `core/overlay-renderer.js`

Responsibilities:

- render scene output to DOM
- reconcile nodes without inventing layout
- expose anchors for interactions

#### `core/overlay-scene-types.js`

Responsibilities:

- define canonical scene input/output shapes

### Existing modules to shrink or repurpose

#### `core/overlay-controller.js`

Target:

- delete after migration

Reason:

- it currently mixes mount lifecycle, geometry, collision heuristics, and rendering

#### `ui/control-integration.js`

Keep:

- playback interception ownership
- control visibility ownership

Remove:

- direct mounting of panel DOM as an independently positioned element

Add:

- publishing stable visibility state and exclusion rects to the overlay scene controller

#### `ui/control-panel.js`

Target:

- convert from standalone mounted widget to scene-node content model plus event bindings

#### `core/word-translation.js`

Keep:

- lookup logic
- tooltip resolution

Adjust:

- interaction hooks to work with line-owned word buttons in the new renderer

#### `styles.css`

Target:

- move from absolute per-component layout rules to mostly visual styling rules
- keep typography, color, and surfaces
- remove geometry ownership for overlay children

## Implementation phases

### Phase 0: design and feasibility

Deliverables:

- this plan
- scene input/output type definitions
- a small local spike that proves:
  - rendered video rect can drive a full overlay root
  - control exclusions can be reduced to stable bands
  - `pretext` line decisions can be rendered with clickable word tokens

Exit criteria:

- no unresolved uncertainty on token-to-line mapping for supported languages

### Phase 1: shared geometry foundation

Work:

- extract one shared rendered video rect helper
- create overlay root that exactly matches the rendered video rect
- stop per-feature geometry duplication

Deliverables:

- root overlay element mounted once
- local coordinate conversion utilities
- tests for video-rect math

Exit criteria:

- all overlay children can be expressed in overlay-local coordinates

### Phase 2: scene controller and pure layout engine skeleton

Work:

- introduce `overlay-scene-controller`
- introduce `overlay-layout-engine`
- feed root bounds, safe insets, and placeholder exclusions through the new path
- render debug boxes only

Deliverables:

- one frame-scheduled scene update path
- debug rendering of available regions and chosen regions

Exit criteria:

- debug overlay reflects geometry changes with no polling loop

### Phase 3: subtitle stack migration

Work:

- move original subtitle line, translation line, and status line to scene-owned layout
- integrate `pretext`
- render fixed line containers from scene output

Deliverables:

- subtitle rendering no longer uses bottom-lift heuristics
- translation reserved-slot behavior preserved
- status block participates in the same scene

Exit criteria:

- current subtitle features work with no DOM collision scan in subtitle layout

### Phase 4: control panel migration

Work:

- move control panel into the overlay scene
- replace standalone panel geometry with scene-node geometry
- make visibility controller publish exclusion rects rather than direct panel placement

Deliverables:

- panel remains visible and interactive
- subtitles adapt to the panel through shared scene rules

Exit criteria:

- no independent panel mount/layout owner remains

### Phase 5: cleanup and deletion

Work:

- remove old overlay controller
- remove interval-based layout refresh
- remove bottom-lift DOM scan
- remove absolute panel geometry rules
- delete obsolete helpers and dead CSS

Exit criteria:

- exactly one extension overlay geometry path remains

## Delete list

The rewrite should explicitly target deletion of:

- subtitle bottom-lift heuristic logic
- per-call scan of interactive nodes for subtitle collision avoidance
- overlay polling interval for layout refresh
- separate panel mount/layout ownership
- CSS-owned subtitle wrapping as the final line-break authority
- duplicate rendered-video-rect implementations

## Testing plan

### Unit tests

Add pure tests for:

- rendered video rect calculation
- exclusion band normalization
- available-space subtraction
- subtitle width-profile generation
- scene node placement rules
- translation reserved-slot behavior

### Integration tests

Add focused tests for:

- scene update on subtitle change
- scene update on control visibility change
- panel exclusion affecting subtitle placement
- line container rendering for interactive words

### Manual smoke checklist

Verify:

- windowed playback
- fullscreen playback
- subtitles on before extension init
- subtitles toggled on after init
- controls hidden
- controls visible
- long one-line subtitle
- multi-line subtitle
- dual subtitles on and off
- Netflix target-language cue gap with reserved translation row
- status/error line visible
- word tooltip opening from computed line layout
- small viewport
- large viewport
- CJK subtitle text
- Arabic or bidi subtitle text
- episode transition

## Open questions

These questions must be resolved during the feasibility phase, not masked by fallback code.

1. Can `pretext` line output be mapped to clickable word tokens with enough fidelity for punctuation, CJK, and bidi?
2. What exact named font should the overlay own so `pretext` and DOM stay in sync on Safari/macOS?
3. Can Netflix control exclusions be reduced to stable bands without reintroducing hidden overlap cases?
4. Should the status block prefer upper-third placement or join the subtitle stack in some states?
5. Does the custom control panel remain a permanent top-right anchored node, or can it become a more compact scene widget?

## No-go rules for this rewrite

- No child overlay component may set final screen geometry outside the scene output.
- No subtitle-specific collision avoidance scans after subtitle placement.
- No keeping CSS line wrapping as a fallback once `pretext`-owned line layout is active.
- No second geometry owner for the control panel.
- No fallback to old independent layout paths "just in case."

## Success criteria

The rewrite is successful only if all of these are true:

- the rendered video rect is the only root geometry source
- the overlay scene controller is the only extension overlay geometry owner
- visible exclusions reshape available space before placement
- subtitles, translation, status, and control panel all participate in one scene layout path
- the old bottom-lift conflict-avoidance model is gone
- there is no parallel legacy layout path left alive
