# Language Reactor Netflix Research

Date: 2026-03-11

This note captures direct findings from the current public Language Reactor Chrome package plus supporting official/public references.

## Package inspected

- Extension: Language Reactor
- Chrome extension ID: `hoombieeljmmljlkjmnheibnpciblicm`
- Public package version inspected: `5.1.7`
- Package timestamp from the CRX contents: `2026-03-06`

## Confirmed boot pattern

From the package `manifest.json`:

- Netflix uses exactly one content script: `content_netflix.js`
- That content script runs at `document_start`
- The heavy Netflix logic is not in the content script bundle; it lives in a separate web-accessible file: `pageScript_lln.min.js`

From the shipped `content_netflix.js`:

- The file is tiny and only runs in the top frame
- It injects `pageScript_lln.min.js` into the page context
- It tags the injected script with a nonce-like value
- It bridges messages between the page script and the extension runtime

This is the first architectural rule to copy on Safari: keep the early content script minimal and move real Netflix logic into the page context.

## Confirmed Netflix player API usage

From the shipped `pageScript_lln.min.js`, Language Reactor polls:

- `window.netflix.appContext.state.playerApp.getAPI().videoPlayer`
- `videoPlayer.getAllPlayerSessionIds()`
- `videoPlayer.getVideoPlayerBySessionId(sessionId)`

It then operates on the active watch-session player with methods including:

- `getTimedTextTrackList`
- `getTimedTextTrack`
- `setTimedTextTrack`
- `getAudioTrackList`
- `getAudioTrack`
- `setAudioTrack`
- `getCurrentTime`
- `seek`
- `play`
- `pause`
- `getPlaybackRate`
- `setPlaybackRate`
- `getMovieId`
- `getElement`

This is the second architectural rule to copy on Safari: the authoritative playback control surface is the Netflix player API in page context, not the raw DOM video alone.

## Confirmed subtitle-manifest path

From the shipped `pageScript_lln.min.js`:

- `JSON.parse` is patched to capture parsed objects containing `result.timedtexttracks`
- Parsed manifests are cached by `movieId`
- `JSON.stringify` is patched to modify outgoing Netflix request payloads so subtitle data is richer
- The patch explicitly adds the WebVTT profile `webvtt-lssdh-ios8`
- The patch also sets flags such as `supportsPartialHydration` and `showAllSubDubTracks`

The page script then:

- matches the active Netflix text-track ID against the cached manifest
- finds the corresponding `ttDownloadables["webvtt-lssdh-ios8"]`
- extracts a downloadable subtitle URL
- fetches the WebVTT
- parses and normalizes cues for its own subtitle pipeline

This is the third architectural rule to copy on Safari: the timed subtitle source is tied to Netflix manifests plus page-context player state, not rendered subtitle DOM text.

## Confirmed extra Netflix runtime patching

The shipped page script also patches `Function.prototype.apply` to override several Netflix feature/config lookups related to precise seeking and buffering.

That means Language Reactor is not only reading Netflix internals; it also alters some player/runtime behavior to make playback control more deterministic.

## Safari implications

What to port first:

1. Tiny `document_start` loader only.
2. Dedicated injected page-context Netflix script.
3. Page-context access to `netflix.appContext.state.playerApp.getAPI().videoPlayer`.
4. Watch-session resolution via `getAllPlayerSessionIds()` and `getVideoPlayerBySessionId(...)`.
5. Use Netflix player APIs for track switching and seeking.
6. Only after player API parity is confirmed, test whether Safari tolerates the same manifest interception pattern LR uses on Chrome.

What not to do:

- do not rely on subtitle DOM scraping for timing
- do not rely on raw `video.currentTime = ...` as the long-term seek primitive if the Netflix player API is available
- do not move the whole extension runtime to `document_start`

## Current repo status against LR

- matched: tiny `document_start` loader plus separate injected page script
- matched: passive page-context probe for the Netflix player API
- missing: actual watch-session player binding
- missing: player-API-based audio/subtitle switching
- missing: manifest cache and WebVTT retrieval
- missing: decision on whether Safari can tolerate LR-style manifest/runtime patching without breaking page boot

## Sources

- Official Chrome Web Store listing: https://chromewebstore.google.com/detail/language-reactor/hoombieeljmmljlkjmnheibnpciblicm
- Public CRX package, downloaded from Google's extension update service for the same extension ID: https://clients2.google.com/service/update2/crx?response=redirect&prodversion=142.0.0.0&acceptformat=crx3&x=id%3Dhoombieeljmmljlkjmnheibnpciblicm%26uc
- Official forum thread about forcing original tracks: https://forum.languagelearningwithnetflix.com/t/force-original-tracks-now-a-setting/875
- Official forum thread about subtitle timing being synced to the media's original-language track: https://forum.languagelearningwithnetflix.com/t/sync-subtitles-to-users-native-language-instead-of-medias-original-language/25672
