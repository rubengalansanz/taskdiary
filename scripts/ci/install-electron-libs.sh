#!/usr/bin/env bash
# Installs the shared libraries the Electron binary needs on a bare Ubuntu runner.
#
# `xvfb-run` supplies a display, not the libraries. Without this the app dies before the first
# assertion, and a runner problem arrives dressed as a broken test — which is exactly the kind
# of failure that teaches you to distrust your own suite.
#
# Ubuntu 24.04 renamed several of these to a `t64` variant, so both spellings are attempted and
# a miss is tolerated: the step that actually launches the app is the real gate, and its error
# names the missing library instead of "the smokes are red".
set -uo pipefail

sudo apt-get update

for pkg in libgtk-3-0 libgtk-3-0t64 \
           libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
           libatk1.0-0 libatk1.0-0t64 libatspi2.0-0 libatspi2.0-0t64 \
           libsecret-1-0 libasound2 libasound2t64 libgbm1; do
  sudo apt-get install -y --no-install-recommends "$pkg" || true
done