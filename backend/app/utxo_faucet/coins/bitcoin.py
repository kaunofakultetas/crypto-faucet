############################################################
#  [*] Bitcoin — coin parameters
#
#  SegWit coin: bech32 addresses. The 'tb' HRP covers every
#  Bitcoin testnet flavour (testnet3 and testnet4 share it).
#
#  Used by:
#    - coins/__init__.py — the registry
############################################################


NAME = 'Bitcoin'

NETWORKS = {
    'mainnet': {'hrp': 'bc'},
    'testnet': {'hrp': 'tb'},
    'regtest': {'hrp': 'bcrt'},
}

# Conservative classroom defaults: 10 sat/vB clears any
# testnet mempool, 546 sat is the standard dust threshold
FEE_RATE = 10
DUST_LIMIT = 546
