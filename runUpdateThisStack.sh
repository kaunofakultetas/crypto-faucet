#!/bin/bash

mkdir -p ./litecoind

# Run the stack
sudo docker-compose down --timeout 60
sudo docker-compose up -d --build
