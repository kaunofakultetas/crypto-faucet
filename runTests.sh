#!/bin/bash
set -e

# Run the tests
sudo docker build -t faucet-backend ./backend
sudo -n docker run --rm \
    -v $PWD/backend:/app \
    -v $PWD/_CONFIG:/config:ro \
    -w /app faucet-backend \
    python -m unittest discover -s tests
