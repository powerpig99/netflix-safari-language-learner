# Manual Smoke Checklist

- Load a Netflix episode page with subtitles already enabled.
- Load a Netflix episode page with subtitles disabled, then enable subtitles after the extension initializes.
- Toggle subtitles off and confirm overlay state clears without stale text.
- Toggle extension on and off from the popup.
- If deterministic subtitle timing becomes ready, confirm dual subtitles, navigation, repeat, and auto-pause all enable together.
- If they do not enable, confirm the failure is due to the deterministic source state, not because the controls disappeared from the runtime.
- Change playback speed and verify the current video updates immediately.
- Enter fullscreen and confirm the overlay and controls still mount correctly.
- Let an episode transition to the next episode and confirm the control panel stays mounted and playback-speed control still works.
- Confirm the Netflix page itself still boots normally with the extension enabled.
- If subtitle-dependent features stay disabled, inspect `__NLL_NETFLIX_PAGE_DEBUG__.getState()` in the page context.
- If `getState()` says the manifest is still missing, reload directly into a watch page and inspect `__NLL_NETFLIX_PAGE_DEBUG__.getManifest()`.
- If `getState()` says the manifest is captured but no download URL is available, inspect `__NLL_NETFLIX_PAGE_DEBUG__.getRawPlayerState()` in the page context.
- If the manifest is still not hydrated after reload, inspect `__NLL_NETFLIX_PAGE_DEBUG__.getState().requestHydration` to confirm the narrow `JSON.stringify` patch is firing.
- Inspect `__NLL_DEBUG__.adapter.getDebugState()` in the extension/content-script context and compare its `pageState.status` to the page-context report.
