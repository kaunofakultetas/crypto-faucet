#!/bin/bash
set -e

# Run the tests
sudo docker exec -w /app faucet-backend python -m unittest discover -s tests
