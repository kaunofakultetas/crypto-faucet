############################################################
#  [*] Faucet Backend — entrypoint & configuration
#
#  The Flask app plus the THREE config maps that drive every
#  faucet: EVM networks, ERC-20 tokens and UTXO networks.
#  All three are validated against app/config_models.py right
#  after their definitions — a misspelled key, a malformed
#  contract address or a token on an unknown network kills
#  the boot with a precise error instead of becoming a silent
#  runtime fallback.
#
#  Each network entry is sectioned by WHO consumes the
#  settings (top-level identity, then 'faucet' / 'metamask' /
#  'explorer') — the banner above each map spells its
#  sections out.
#
#  Run directly (python main.py) this file wires the
#  database, the four blueprints and the dev server. The
#  route modules import THIS module back for their config
#  maps — that is why the blueprint imports sit inside
#  __main__: by the time they run, main is fully defined and
#  the circular import resolves cleanly.
#
#  Used by:
#    - app/evm_faucet/evm_routes.py — EVM_NETWORK_CONFIGS
#    - app/erc_faucet/erc20_routes.py — ERC20_TOKEN_CONFIGS
#    - app/utxo_faucet/utxo_routes.py — UTXO_NETWORK_CONFIGS
#    - tests/ — config invariants + schema tests import main
#    - Dockerfile — CMD ["python3", "-u", "main.py"]
############################################################


import os
import json
import sqlite3
from flask import Flask, Response

from app.database.db import get_db_connection
from app.config_models import validate_configs


# The Flask app — the blueprint modules register their routes
# onto it in the __main__ block below.
app = Flask(__name__)








############################################################
# EVM_NETWORK_CONFIGS
############################################################
#
# EVM networks, one entry per chain, split by WHO consumes
# the settings:
#
#   (top level)  — identity every part of the app shares:
#                  id (picker order), chain_id
#   'faucet'     — the faucet itself, backend AND pages: the
#                  names the UI displays, the backend's own
#                  RPC connection and the payout size.
#                  <NAME> inside rpc_url is replaced with the
#                  environment variable of that name at
#                  startup (so the Infura key never sits in
#                  this file)
#   'metamask'   — what wallet_addEthereumChain hands the
#                  student's wallet; public endpoints only.
#                  chain_name is the network name MetaMask
#                  STORES — students keep seeing it in their
#                  wallet's network list
#   'explorer'   — the /graph transaction-flow scraper; omit
#                  the whole section if the chain has no
#                  Etherscan-style API
#
# Used by:
#   - app/evm_faucet/evm_routes.py — EVMFaucet and
#     EtherscanExplorer are built from this map
#   - app/erc_faucet/erc20_faucet.py — indirectly, through
#     the shared EVMFaucet instance
############################################################

EVM_NETWORK_CONFIGS = {
    'sepolia': {
        'id': 1,
        'chain_id': 11155111,
        'faucet': {
            'short_name': "SepETH",
            'full_name': 'Sepolia',
            'rpc_url': 'https://sepolia.infura.io/v3/<INFURA_PROJECT_ID>',
            'chunk_size': 0.2,
        },
        'metamask': {
            'chain_name': 'Sepolia',
            'native_currency': {
                'name': 'Ethereum',
                'symbol': 'SepETH',
                'decimals': 18
            },
            'rpc_urls': ['https://rpc.sepolia.org'],
            'block_explorer_urls': ['https://sepolia.etherscan.io'],
        },
        'explorer': {
            'etherscan_api_url': 'https://api.etherscan.io/v2/api',
        },
    },
    'zkSyncSepolia': {
        'id': 3,
        'chain_id': 300,
        'faucet': {
            'short_name': "ETH",
            'full_name': 'zkSync Sepolia Testnet',
            'rpc_url': 'https://zksync-sepolia.infura.io/v3/<INFURA_PROJECT_ID>',
            'chunk_size': 0.05,
        },
        'metamask': {
            'chain_name': 'zkSync Sepolia Testnet',
            'native_currency': {
                'name': 'Ethereum',
                'symbol': 'ETH',
                'decimals': 18
            },
            'rpc_urls': ['https://sepolia.era.zksync.dev'],
            'block_explorer_urls': ['https://block-explorer-api.sepolia.zksync.dev'],
        },
        'explorer': {
            'etherscan_api_url': 'https://block-explorer-api.sepolia.zksync.dev/api',
        },
    },
    'polygonZkEvm': {
        'id': 4,
        'chain_id': 2442,
        'faucet': {
            'short_name': "ETH",
            'full_name': 'Polygon zkEVM Cardona Testnet',
            'rpc_url': 'https://rpc.cardona.zkevm-rpc.com',
            'chunk_size': 0.05,
        },
        'metamask': {
            'chain_name': 'Polygon zkEVM Cardona Testnet',
            'native_currency': {
                'name': 'Ethereum',
                'symbol': 'ETH',
                'decimals': 18
            },
            'rpc_urls': ['https://rpc.cardona.zkevm-rpc.com'],
            'block_explorer_urls': ['https://explorer-ui.cardona.zkevm-rpc.com'],
        },
        'explorer': {
            'etherscan_api_url': 'https://api-cardona-zkevm.polygonscan.com/api',
        },
    },
    'lineaSepolia': {
        'id': 5,
        'chain_id': 59141,
        'faucet': {
            'short_name': "ETH",
            'full_name': 'Linea Sepolia',
            'rpc_url': 'https://linea-sepolia.infura.io/v3/<INFURA_PROJECT_ID>',
            'chunk_size': 0.05,
        },
        'metamask': {
            'chain_name': 'Linea Sepolia',
            'native_currency': {
                'name': 'LineaETH',
                'symbol': 'LineaETH',
                'decimals': 18
            },
            'rpc_urls': ['https://linea-sepolia-rpc.publicnode.com'],
            'block_explorer_urls': ['https://explorer.linea.build'],
        },
        'explorer': {
            'etherscan_api_url': 'https://api-explorer.sepolia.linea.build/api',
        },
    },
    "hoodi": {
        'id': 6,
        'chain_id': 560048,
        'faucet': {
            'short_name': "ETH",
            'full_name': 'Ethereum Hoodi',
            'rpc_url': 'https://rpc.hoodi.ethpandaops.io',
            'chunk_size': 0.05,
        },
        'metamask': {
            'chain_name': 'Ethereum Hoodi',
            'native_currency': {
                'name': 'Ethereum',
                'symbol': 'ETH',
                'decimals': 18
            },
            'rpc_urls': ['https://rpc.hoodi.ethpandaops.io'],
            'block_explorer_urls': ['https://light-hoodi.beaconcha.in'],
        },
        'explorer': {
            'etherscan_api_url': 'https://api.etherscan.io/v2/api',
        },
    },
    "arbitrumSepolia": {
        'id': 7,
        'chain_id': 421614,
        'faucet': {
            'short_name': "ETH",
            'full_name': 'Arbitrum Sepolia',
            'rpc_url': 'https://arbitrum-sepolia.infura.io/v3/<INFURA_PROJECT_ID>',
            'chunk_size': 0.05,
        },
        'metamask': {
            'chain_name': 'Arbitrum Sepolia',
            'native_currency': {
                'name': 'Ethereum',
                'symbol': 'ETH',
                'decimals': 18
            },
            'rpc_urls': ['https://sepolia.arbitrum.io/rpc'],
        },
        # no 'explorer' — Arbitrum Sepolia has no API configured,
        # so the /graph feature is off for this chain
    }
}








############################################################
# ERC20_TOKEN_CONFIGS
############################################################
#
# ERC-20 test tokens, token-first: each token is defined once
# and lists every chain it is deployed on (network key ->
# contract address). Network keys must exist in
# EVM_NETWORK_CONFIGS — validation refuses unknown ones.
# Adding a chain to a token = one deployments line; adding a
# token = one block.
#
# Used by:
#   - app/erc_faucet/erc20_routes.py — builds the ERC20Faucet
############################################################

ERC20_TOKEN_CONFIGS = {
    'LINK': {
        'name': 'Chainlink',
        'decimals': 18,
        'chunk_size': 5,
        'deployments': {
            # Official Chainlink token on Sepolia (docs.chain.link)
            'sepolia': '0x779877A7B0D9E8603169DdbD7836e478b4624789',
        },
    },
}








############################################################
# UTXO_NETWORK_CONFIGS
############################################################
#
# UTXO networks, same sectioning idea as the EVM config:
#
#   (top level)  — identity: id (picker order), names
#   'faucet'     — what the BACKEND payout machinery uses:
#                  payout size, mainnet/testnet flavour, the
#                  bech32 HRP addresses are built with, and
#                  the ElectrumX endpoint (host:port, SSL)
#   'explorer'   — where the UI links a transaction / address
#
# Used by:
#   - app/utxo_faucet/utxo_routes.py — builds the UTXOFaucet
############################################################

UTXO_NETWORK_CONFIGS = {
    'knf': {
        'id': 1,
        'short_name': "KNF",
        'full_name': 'KNF Coin',
        'faucet': {
            'chunk_size': 1000,
            'network': 'mainnet',
            'hrp': 'knf',
            'electrum_server': '158.129.172.247:49002',
        },
        'explorer': {
            'block_explorer': 'https://knfcoin.knf.vu.lt/explorer',
        },
    },
    'ltc4': {
        'id': 2,
        'short_name': "tLTC4",
        'full_name': 'Litecoin Testnet4',
        'faucet': {
            'chunk_size': 1000,
            'network': 'testnet',
            'hrp': 'tltc',
            'electrum_server': '158.129.172.247:50002',
        },
        'explorer': {
            'block_explorer': 'https://litecoinspace.org/testnet',
        },
    },
    # 'btc3': {
    #     'id': 3,
    #     'short_name': "tBTC3",
    #     'full_name': 'Bitcoin Testnet3',
    #     'faucet': {
    #         'chunk_size': 0.005,
    #         'network': 'testnet',
    #         'hrp': 'tb',
    #         'electrum_server': '158.129.172.247:51002',
    #     },
    #     'explorer': {
    #         'block_explorer': 'https://mempool.space/testnet',
    #     },
    # },
    'btc4': {
        'id': 4,
        'short_name': "tBTC4",
        'full_name': 'Bitcoin Testnet4',
        'faucet': {
            'chunk_size': 0.01,
            'network': 'testnet',
            'hrp': 'tb',
            'electrum_server': '158.129.172.247:52002',
        },
        'explorer': {
            'block_explorer': 'https://mempool.space/testnet4',
        },
    },
    # 'doge3': {
    #     'id': 5,
    #     'short_name': "tDOGE3",
    #     'full_name': 'Dogecoin Testnet3',
    #     'faucet': {
    #         'chunk_size': 0.01,
    #         'network': 'testnet',
    #         'hrp': 'doge',
    #         'electrum_server': '158.129.172.247:53002',
    #     },
    #     'explorer': {
    #         'block_explorer': 'https://mempool.space/testnet3',
    #     },
    # }
}








############################################################
# Config validation
############################################################
#
# The three maps above are VALIDATED before anything uses
# them — a misspelled key, a malformed contract address or a
# token on an unknown network kills the boot with a precise
# error instead of becoming a silent runtime fallback. What
# comes back is the same maps, normalized (optional sections
# dropped instead of None). The enforced schema lives in
# app/config_models.py.
############################################################

EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS, UTXO_NETWORK_CONFIGS = validate_configs(
    EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS, UTXO_NETWORK_CONFIGS,
)








############################################################
# get_example_blockchain
############################################################
#
# GET /api/get-example-blockchain
#
# The pre-mined demo chain for the blockchain simulator: the
# stored blocks packed into one JSON array straight out of
# SQLite. Lives here rather than in a blueprint because it is
# the app's single standalone route.
#
# Used by:
#   - pages/BlockchainSimulator/Page.jsx — loads the demo
#     chain on mount
############################################################

@app.route('/api/get-example-blockchain', methods=['GET'])
def get_example_blockchain():
    with get_db_connection() as conn:
        sqlFetchData = conn.execute('''
            SELECT
                json_group_array(
                    json_object(
                        'data', Transactions, 
                        'previousHash', PrevBlock, 
                        'nonce', Nonce, 
                        'hash', BlockHash
                    )
                ) AS json_block
            FROM BlockchainSimulator_Blocks
        ''')
        returnJson = sqlFetchData.fetchone()[0]
    return Response(returnJson, mimetype='application/json')








############################################################
# Entrypoint
############################################################
#
# Wires the whole backend when run directly: the database
# schema, the four feature blueprints, then the dev server.
# The blueprint imports are deliberately DEFERRED to down
# here — the route modules import main back for their config
# maps, and at this point main is fully defined, so the
# circular import resolves cleanly.
############################################################

if __name__ == '__main__':
    APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'


    # STEP 1: the SQLite schema (idempotent).
    # =======================================
    from app.database.db_init import init_db
    init_db()


    # STEP 2: the feature blueprints — each import builds and
    # warms its faucet singletons, so the startup console report
    # happens here.
    # ==========================================================
    from app.evm_faucet.evm_routes import bp_evm_faucet
    app.register_blueprint(bp_evm_faucet, url_prefix='')

    from app.utxo_faucet.utxo_routes import bp_utxo_faucet
    app.register_blueprint(bp_utxo_faucet, url_prefix='')

    from app.erc_faucet.erc20_routes import bp_erc20_faucet
    app.register_blueprint(bp_erc20_faucet, url_prefix='')

    from app.reorg_attack.routes import bp_reorg_attack
    app.register_blueprint(bp_reorg_attack, url_prefix='')


    # STEP 3: the dev server. Debug mode means hot reload AND
    # the Werkzeug debugger — never expose it publicly.
    # =======================================================
    app.run(host='0.0.0.0', port=8000, debug=APP_DEBUG)
