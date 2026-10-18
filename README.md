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

In the browser console run `runRegressions()` (8 regression tests) or `runBench()` (benchmark: sizes, gzip, canvas and SVG pixel diffs, alpha diffs, structural checks). Fixtures are generated from a fixed seed, so results are reproducible.

## Status

Phase 1 of the engine upgrade is done (expression-safe hidden-layer removal, full alpha detection, property-aware rounding, separate name/metadata settings, no repeated lossy image compression, honest size statistics). Verified on synthetic fixtures with lottie-web 5.12.2 in Chromium only. Real After Effects / LottieFiles exports and Android/iOS players are not yet tested.

## Ads

Ad placeholders are built in. To enable Google AdSense, set `enabled`, `client` and the slot ids in the `ADS` object near the end of the script in `lottie-squeeze.html`, then rebuild.
