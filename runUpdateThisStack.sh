#!/bin/bash

# Dapps
mkdir -p ./dapps-server/data

# 51% attack tool
mkdir -p ./litecoind-public
mkdir -p ./litecoind-private
mkdir -p ./litecoind-dummy

# Run the stack
sudo docker-compose down --timeout 60
sudo docker-compose up -d --build
