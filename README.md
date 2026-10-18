# Lottie Squeeze

Compress Lottie animations and turn videos (including transparent MOV/WebM) into Lottie files. Everything runs in the browser; files are never uploaded.

## Presets

| Preset | What it does | Risk |
|---|---|---|
| **Lossless** | Minifies; removes unused assets, hidden layers nothing depends on, keyframes that change nothing, and duplicate assets. No rounding, no image re-encoding; names, metadata, timing and expressions kept. | None found: pixel-identical (canvas + SVG, alpha included) on every test file. Savings are small on files that are already minified. |
| **Balanced** (default) | Lossless, plus shape/position rounding to 3 decimals (timing never rounded; colours and easing ≥ 3 decimals), After Effects metadata removed, PNG images to WebP only if they stay ≥ 32 dB PSNR. Names kept. | Tiny shape shifts (≤ 0.04% of pixels in tests). Images that can't stay ≥ 32 dB keep their original encoding. |
| **Maximum** | Balanced, plus 2-decimal rounding, layer names and hidden shapes removed, every image re-encoded down to 26 dB. | Visibly lossy. Breaks keypaths / dynamic colours. Repeat passes keep lowering image quality. |

Changing any setting after picking a preset switches to *Custom*.

Files with expressions keep names, metadata, hidden layers, keyframes and duplicate assets, because expressions can reach any of them.

## .lottie files

A `.lottie` input is rebuilt as a whole: every animation in it is optimized with the same settings, and every other file (manifest, themes, state machines, audio) is copied byte for byte. JSON input can also be downloaded as a `.lottie` (dotLottie v1). Packaging into a zip is compression of the container, not of the animation data, and is reported separately.

## Limits

Files over 100 MB, `.lottie` packages that unpack to more than 300 MB or hold more than 5,000 files are refused with a message, so the browser doesn't run out of memory.

## Files

| Path | What it is |
|---|---|
| `lottie-squeeze.html` | **Source of truth.** Edit this file. |
| `index.html`, `lottie-squeeze-standalone.html` | Generated full pages (for GitHub Pages or any static host). Don't edit by hand. |
| `tools/build-standalone.sh` | Regenerates the two pages above from the source. Run after every change. |
| `logo/` | Logo files (v1 bounce, v2 braces — v2 is in use). |
| `audit/` | Compression audit (PDF + HTML) and the reproducible test harness. |
| `baseline/` | Earlier engines (pre-upgrade and Phase 1), kept so the harness can compare. |
| `tests/real/` | Real Lottie files for testing. **Not committed** (see below). |

## Build

```bash
sh tools/build-standalone.sh
```

## Tests

Serve the folder locally (for example `python -m http.server 8765`), then open `http://localhost:8765/audit/harness.html` (add `?app=baseline` or `?app=phase1` to test an earlier engine) and run in the browser console:

| Function | Covers |
|---|---|
| `runRegressions()` | R1–R8: expressions and hidden layers, transparency, timing, names, repeat passes, mask flags, size reporting |
| `runPhase2()` | R9–R12: exact keyframe optimization, duplicate assets, .lottie export (incl. the official dotLottie player), repeat passes |
| `runPhase34()` | R13–R18: presets, worker output identical to on-page output, full .lottie rebuild, limits and error messages, freezes and image cache, cancellation |
| `runBench()` | Sizes, gzip, .lottie size and round trip, canvas and SVG pixel and alpha diffs, structural checks, per-feature isolation |
| `runReal()` | The same checks on every file in `tests/real/` |

Synthetic fixtures are generated from a fixed seed, so results are reproducible.

`tests/real/` holds real exports from the test suites of [lottie-web](https://github.com/airbnb/lottie-web) (MIT), [lottie-android](https://github.com/airbnb/lottie-android) (Apache-2.0) and [dotlottie-rs](https://github.com/LottieFiles/dotlottie-rs) (MIT). They are git-ignored; download them into that folder to run `runReal()` and the real-file parts of `runPhase34()`.

## Verified so far

lottie-web 5.12.2 (canvas and SVG) and the official dotlottie-web player, in Chromium, on synthetic fixtures and 25 real files. Android, iOS, React Native, Safari and Firefox are **not** verified.

## Ads

Ad placeholders are built in. To enable Google AdSense, set `enabled`, `client` and the slot ids in the `ADS` object near the end of the script in `lottie-squeeze.html`, then rebuild.
