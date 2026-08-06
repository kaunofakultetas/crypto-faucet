############################################################
#  [*] KNF Coin — coin parameters
#
#  The faculty's own Litecoin-derived chain: SegWit, bech32
#  addresses under the 'knf' HRP. Mainnet only — there is no
#  public KNF testnet.
#
#  Used by:
#    - coins/__init__.py — the registry
############################################################


NAME = 'KNF Coin'

NETWORKS = {
    'mainnet': {'hrp': 'knf'},
}

# Litecoin-style relay rules
FEE_RATE = 10
DUST_LIMIT = 546
