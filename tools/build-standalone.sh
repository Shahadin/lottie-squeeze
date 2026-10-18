#!/bin/sh
# Regenerates the full pages from the source of truth, lottie-squeeze.html.
# The hosted artifact adds this document skeleton itself; static hosts need it written out.
cd "$(dirname "$0")/.." || exit 1
{
  printf '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="logo/v2-braces/logo-mark.svg" type="image/svg+xml"></head><body style="margin:0">\n'
  cat lottie-squeeze.html
  printf '\n</body></html>\n'
} > lottie-squeeze-standalone.html
cp lottie-squeeze-standalone.html index.html   # GitHub Pages serves index.html
echo "built lottie-squeeze-standalone.html and index.html"
