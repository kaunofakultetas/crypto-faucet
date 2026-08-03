#!/bin/bash



# STEP 1: Create necessary files and directories
# ====================================
mkdir -p ./_DATA/backend
mkdir -p ./_DATA/dapps
mkdir -p ./_DATA/etherpad
touch .env




# STEP 2: Generate faucet private key if it doesn't exist
# =======================================================
if [ ! -f .env ] || ! grep -q "^FAUCET_PRIVATE_KEY=" .env; then
    echo "Generating FAUCET_PRIVATE_KEY..."
    FAUCET_PRIVATE_KEY="$(openssl rand -hex 32)"

    # Only add newline if file doesn't end with one
    [ -f .env ] && [ -n "$(tail -c1 .env 2>/dev/null)" ] && echo "" >> .env
    echo "FAUCET_PRIVATE_KEY=$FAUCET_PRIVATE_KEY" >> .env
    echo "FAUCET_PRIVATE_KEY added to .env"
fi




# STEP 3: Run the stack
# =====================
sudo docker-compose down --timeout 60
sudo docker-compose up -d --build



