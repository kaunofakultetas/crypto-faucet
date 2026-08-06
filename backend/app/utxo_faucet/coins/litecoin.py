############################################################
#  [*] Litecoin — coin parameters
#
#  SegWit coin: bech32 addresses ('ltc' mainnet, 'tltc' on
#  every testnet flavour).
#
#  Used by:
#    - coins/__init__.py — the registry
############################################################


NAME = 'Litecoin'

NETWORKS = {
    'mainnet': {'hrp': 'ltc'},
    'testnet': {'hrp': 'tltc'},
    'regtest': {'hrp': 'rltc'},
}

# Same conservative defaults as Bitcoin — Litecoin's relay
# minimums are lower, so these are comfortably standard
FEE_RATE = 10
DUST_LIMIT = 546
