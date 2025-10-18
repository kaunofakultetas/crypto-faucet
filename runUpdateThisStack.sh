#!/bin/bash

# Dapps
mkdir -p ./dapps-server/data

# 51% attack tool
mkdir -p ./knfcoind-public
mkdir -p ./knfcoind-public/electrumx
mkdir -p ./knfcoind-private
mkdir -p ./knfcoind-dummy


# Run the stack
sudo docker-compose down --timeout 60
sudo docker-compose up -d --build
