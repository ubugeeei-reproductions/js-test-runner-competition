#!/bin/sh
# UF_BROWSER for `uf test --browser`: Playwright's headless Chromium, started with --no-sandbox as
# Playwright starts it for the other runners (Ubuntu 24.04 blocks Chromium's own sandbox).
exec "$REPRO_CHROMIUM" --no-sandbox "$@"
