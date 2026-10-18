# Lottie Squeeze

Compress Lottie animations and turn videos (including transparent MOV/WebM) into Lottie files. Everything runs in the browser; files are never uploaded.

## Files

| Path | What it is |
|---|---|
| `lottie-squeeze.html` | **Source of truth.** Edit this file. |
| `index.html`, `lottie-squeeze-standalone.html` | Generated full pages (for GitHub Pages or any static host). Don't edit by hand. |
| `tools/build-standalone.sh` | Regenerates the two pages above from the source. Run after every change. |
| `logo/` | Logo files (v1 bounce, v2 braces — v2 is in use). |
| `audit/` | Compression audit (PDF + HTML) and the reproducible test harness. |
| `baseline/` | The pre-upgrade engine, kept so the harness can compare before and after. |

## Build

```bash
sh tools/build-standalone.sh
```

## Tests

Serve the folder locally (for example `python -m http.server 8765`), then open:

- `http://localhost:8765/audit/harness.html`: current engine
- `http://localhost:8765/audit/harness.html?app=baseline`: pre-upgrade engine

- `http://localhost:8765/audit/harness.html?app=phase1`: Phase 1 engine

In the browser console run `runRegressions()` (R1–R8), `runPhase2()` (R9–R12: keyframes, duplicate assets, .lottie export incl. the official dotLottie player) or `runBench()` (sizes, gzip, .lottie size and round trip, canvas and SVG pixel diffs, alpha diffs, structural checks, per-feature isolation). Fixtures are generated from a fixed seed, so results are reproducible.

## Status

Phase 2 adds exact keyframe optimization, duplicate-asset merging and `.lottie` (dotLottie v1) export. Each is pixel-identical on its own in the tests, and exported files reopen to identical data and load in the official LottieFiles player.

Phase 1 of the engine upgrade is done (expression-safe hidden-layer removal, full alpha detection, property-aware rounding, separate name/metadata settings, no repeated lossy image compression, honest size statistics). Verified on synthetic fixtures with lottie-web 5.12.2 in Chromium only. Real After Effects / LottieFiles exports and Android/iOS players are not yet tested.

## Ads

Ad placeholders are built in. To enable Google AdSense, set `enabled`, `client` and the slot ids in the `ADS` object near the end of the script in `lottie-squeeze.html`, then rebuild.
