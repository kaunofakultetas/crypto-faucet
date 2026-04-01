#!/bin/bash

# Dapps
mkdir -p ./_DATA/dapps

# 51% attack tool
mkdir -p ./_DATA/fullnodes/public
mkdir -p ./_DATA/fullnodes/private
mkdir -p ./_DATA/fullnodes/dummy

# Notes
mkdir -p ./_DATA/etherpad




# Run the stack
sudo docker-compose down --timeout 60
sudo docker-compose up -d --build
