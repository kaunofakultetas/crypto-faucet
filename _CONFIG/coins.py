############################################################
#  [*] Coins configuration — the operator-editable file
#
#  The FIVE config maps that drive every faucet: UTXO
#  networks, EVM networks, SVM networks, MOVE networks and
#  ERC-20 tokens.
#  This file is MOUNTED into the backend container
#  (./_CONFIG:/config) and loaded by main.py at startup —
#  editing it needs a backend restart (docker restart
#  faucet-backend), never an image rebuild. In dev mode
#  Flask's reloader watches this file and restarts by itself.
#
#  Everything here is validated on boot against
#  app/config_models.py — a misspelled key, a malformed
#  contract address or a token on an unknown network kills
#  the boot with a precise error in the container logs.
#
#  Icons live next door in icons/<type>/<key>.svg (or .png /
#  .webp), where <type> is evm / erc20 / utxo / svm / move
#  and <key> is the entry's key in these maps ('sepolia', 'LINK',
#  'btc4'). Dropping a file there is enough — no restart
#  needed.
#
#  Used by:
#    - backend/main.py — loaded at startup, validated, then
#      re-exported under these same names
############################################################









############################################################
# UTXO_NETWORK_CONFIGS
############################################################
#
# UTXO networks, same sectioning idea as the EVM config:
#
#   (top level)  — identity: id (picker order), names
#   'faucet'     — the OPERATOR's choices: which coin, which
#                  network flavour, the payout size and the
#                  ElectrumX endpoint (host:port, SSL)
#   'explorer'   — where the UI links a transaction / address
#
# 'coin' names an entry of the backend's coin registry
# (app/utxo_faucet/coins/): 'bitcoin', 'litecoin', 'knfcoin',
# 'dogecoin'. Everything protocol-precise — address version
# bytes, bech32 prefixes, fee rates, dust limits — lives in
# that registry, not here. An unknown coin or flavour fails
# the boot naming the known options.
############################################################

UTXO_NETWORK_CONFIGS = {
    'knf': {
        'id': 1,
        'short_name': "KNF",
        'full_name': 'KNF Coin',
        'faucet': {
            'coin': 'knfcoin',
            'network': 'mainnet',
            'chunk_size': 1000,
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
            'coin': 'litecoin',
            'network': 'testnet',
            'chunk_size': 1000,
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
    #         'coin': 'bitcoin',
    #         'network': 'testnet',
    #         'chunk_size': 0.005,
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
            'coin': 'bitcoin',
            'network': 'testnet',
            'chunk_size': 0.01,
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
    #         'coin': 'dogecoin',
    #         'network': 'testnet',
    #         'chunk_size': 50,
    #         'electrum_server': '158.129.172.247:53002',
    #     },
    #     'explorer': {
    #         'block_explorer': 'https://blockexplorer.one/dogecoin/testnet',
    #     },
    # }
}









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
############################################################

EVM_NETWORK_CONFIGS = {
    'sepolia': {
        'id': 1,
        'chain_id': 11155111,
        'faucet': {
            'short_name': "SepETH",
            'full_name': 'Ethereum Sepolia',
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
            'full_name': 'zkSync Sepolia',
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
    },
    "polygonAmoy": {
        'id': 8,
        'chain_id': 80002,
        'faucet': {
            'short_name': "POL",
            'full_name': 'Polygon Amoy',
            'rpc_url': 'https://polygon-amoy.infura.io/v3/<INFURA_PROJECT_ID>',
            'chunk_size': 0.05,
        },
        'metamask': {
            'chain_name': 'Amoy',
            'native_currency': {
                'name': 'POL',
                'symbol': 'POL',
                'decimals': 18
            },
            'rpc_urls': ['https://polygon-amoy-bor-rpc.publicnode.com'],
            'block_explorer_urls': ['https://amoy.polygonscan.com'],
        },
        'explorer': {

            'etherscan_api_url': 'https://api.etherscan.io/v2/api',
        },
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
# SVM_NETWORK_CONFIGS
############################################################
#
# SVM networks (Solana and the rollups reusing its runtime),
# split by WHO consumes the settings:
#
#   (top level)  — identity: id (picker order)
#   'faucet'     — the OPERATOR's choices: which chain, which
#                  network flavour, the names the UI shows,
#                  the backend's own RPC and the payout size.
#                  <NAME> inside rpc_url is replaced with the
#                  environment variable of that name at
#                  startup (so the API key never sits here)
#   'wallet'     — the PUBLIC RPC the student's Phantom
#                  wallet should talk to
#   'explorer'   — where the UI links a transaction / address
#
# 'chain' names an entry of the backend's SVM chain registry
# (app/svm_faucet/chains/): 'solana'. Everything
# protocol-precise — the native symbol, lamport decimals, the
# per-signature fee, the rent-exempt minimum — lives in that
# registry, not here. A chunk_size below the chain's
# rent-exempt minimum fails the boot.
#
# The faucet signs with the same FAUCET_PRIVATE_KEY as EVM and
# UTXO, used here as an Ed25519 seed: a DIFFERENT address that
# must be funded on each SVM chain separately.
############################################################

SVM_NETWORK_CONFIGS = {
    'solanaDevnet': {
        'id': 1,
        'faucet': {
            'chain': 'solana',
            'network': 'devnet',
            'short_name': "devSOL",
            'full_name': 'Solana Devnet',
            'rpc_url': 'https://solana-devnet.infura.io/v3/<INFURA_PROJECT_ID>',
            'chunk_size': 5,
        },
        'wallet': {
            'rpc_urls': ['https://api.devnet.solana.com'],
        },
        'explorer': {
            'block_explorer_urls': ['https://explorer.solana.com/?cluster=devnet'],
        },
    },
}













############################################################
# MOVE_NETWORK_CONFIGS
############################################################
#
# Move networks (Sui and anything else added to the chain
# registry), split by WHO consumes the settings:
#
#   (top level)  — identity: id (picker order)
#   'faucet'     — the OPERATOR's choices: which chain, which
#                  network flavour, the names the UI shows,
#                  the backend's own GraphQL endpoint and the
#                  payout size. <NAME> inside rpc_url is
#                  replaced with the environment variable of
#                  that name at startup
#   'wallet'     — the PUBLIC GraphQL endpoint the page may
#                  query for the student's balance
#   'explorer'   — where the UI links a transaction / address
#
# 'chain' names an entry of the backend's chain registry
# (app/move_faucet/chains/): 'sui'. Everything
# protocol-precise — the native symbol, MIST decimals, the
# coin type tag, the gas margin — lives in that registry,
# not here.
#
# The faucet signs with the same FAUCET_PRIVATE_KEY as the
# other families, used as an Ed25519 seed and hashed into a
# Sui address: a DIFFERENT wallet that must be funded on
# each Move chain separately.
############################################################

MOVE_NETWORK_CONFIGS = {
    'suiTestnet': {
        'id': 1,
        'faucet': {
            'chain': 'sui',
            'network': 'testnet',
            'short_name': "tSUI",
            'full_name': 'Sui Testnet',
            'rpc_url': 'https://graphql.testnet.sui.io/graphql',
            'chunk_size': 0.5,
        },
        'wallet': {
            'rpc_urls': ['https://graphql.testnet.sui.io/graphql'],
        },
        'explorer': {
            'block_explorer_urls': ['https://suiscan.xyz/testnet'],
        },
    },
}
