#!/bin/sh
# -----------------------------------------------------------
#  [*] Frontend — tests against the real MetaMask
#
#  Runs the faucet's pages in a real Chromium with the real
#  MetaMask extension, the way the lectures go: a brand-new
#  wallet connects, has a network added and claims; the same
#  wallet comes back at a later lecture, locked, and claims
#  on other networks; tokens are claimed and shown in
#  MetaMask; MetaMask is installed next to an open page. The
#  vitest suite cannot do this — it runs against a stand-in
#  wallet, and the wallet students install changes every
#  week. Meant to be run before a laboratory, not on every
#  change: it takes some seven minutes.
#
#  Three steps. The builder stage of the PRODUCTION Dockerfile
#  is built first, as the regression runner does, so the site
#  under test is the one that ships. Dockerfile.metamask then
#  adds Chromium and two MetaMask builds: the Chrome Web
#  Store's build of the day, fetched anew once a day, and an
#  older release for the wallet of a returning student. Last,
#  the tests run in a throwaway container WITHOUT any network:
#  nothing can be paid out, a backend double answers the
#  pages, and MetaMask works offline, marking its signature
#  window "Security check unavailable". Extra arguments go to
#  Playwright (a file under tests/, -g "part of a test's
#  name").
#
#  Three variables change a run. METAMASK_VERSION names a
#  release to test in place of the store's build, to see
#  whether an older one behaved differently. METAMASK_PREVIOUS
#  names the release the returning student's wallet is made
#  under. ONLINE, set to anything, lets the container reach
#  the internet: MetaMask then runs as it does in the lecture
#  room, with the settings and safety checks it downloads —
#  the backend stays the double, so still nothing is paid.
#
#  app/tests-metamask/README.md says what each test covers
#  and how to read a failure.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

NETWORK="--network none"
if [ -n "$ONLINE" ]; then
  NETWORK="--env METAMASK_ONLINE=1"
fi

sudo docker build --target builder -t faucet-vite-check .
sudo docker build -f Dockerfile.metamask -t faucet-vite-metamask \
  --build-arg METAMASK_PREVIOUS="${METAMASK_PREVIOUS:-13.54.0}" \
  --build-arg METAMASK_VERSION="${METAMASK_VERSION:-store}" \
  --build-arg METAMASK_FETCHED="$(date +%F)" .
sudo docker run --rm --name faucet-vite-metamask-tests $NETWORK --shm-size=2g --memory=8g --memory-swap=8g --cpus=8 \
  faucet-vite-metamask npx playwright test "$@"
