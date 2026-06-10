#!/bin/sh
# Installs the Playwright Chromium browser (plus OS deps) with retries.
# A single transient CDN or apt failure here used to abort the whole release
# container build (see the failed v3 image build), leaving production on an
# old image. Retrying makes the postinstall resilient to such flakes while
# still failing hard if the install is genuinely broken.
set -u

attempts=3
delay=15

i=1
while [ "$i" -le "$attempts" ]; do
  if playwright install --with-deps chromium; then
    exit 0
  fi
  echo "playwright install failed (attempt $i/$attempts)" >&2
  if [ "$i" -lt "$attempts" ]; then
    echo "retrying in ${delay}s..." >&2
    sleep "$delay"
  fi
  i=$((i + 1))
done

echo "playwright install failed after $attempts attempts" >&2
exit 1
