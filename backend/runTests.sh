#!/bin/sh
# -----------------------------------------------------------
#  [*] Backend — regression test runner
#
#  Builds the backend's PRODUCTION image from this folder
#  under a tag of its own (the same Python, the same pinned
#  packages and the same source that ship — the running
#  faucet's image is left alone) and runs the offline
#  unittest suite inside a throwaway container. The container
#  gets no network, so a test that reaches out fails instead
#  of passing by luck, and no faucet key or API keys, so no
#  test can touch real funds. The coin configuration the
#  backend reads at load time is mounted read-only from
#  _CONFIG. Extra arguments go to unittest's discovery — a
#  file pattern, a test-name filter, verbose output.
#
#  The live smoke layer needs the running backend and stays
#  opt-in; tests/README.md has that command, and the quicker
#  run inside the running container while developing.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build -t faucet-backend-check .
sudo docker run --rm --name faucet-backend-tests --network none \
  -v "$(cd .. && pwd)/_CONFIG:/config:ro" \
  faucet-backend-check python -m unittest discover -s tests "$@"
