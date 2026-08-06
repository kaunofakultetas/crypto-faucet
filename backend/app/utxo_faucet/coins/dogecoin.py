############################################################
#  [*] Dogecoin — coin parameters
#
#  LEGACY coin: Dogecoin never activated SegWit, so addresses
#  are base58check keyed by version byte — mainnet P2PKH 0x1e
#  ('D'), testnet P2PKH 0x71 ('n'/'m') and P2SH 0xc4 ('2').
#
#  Used by:
#    - coins/__init__.py — the registry
############################################################


NAME = 'Dogecoin'

NETWORKS = {
    'mainnet': {'p2pkh_prefix': 0x1e, 'p2sh_prefix': 0x16},
    'testnet': {'p2pkh_prefix': 0x71, 'p2sh_prefix': 0xc4},
}

# Dogecoin relay minimums are ~100x Bitcoin's (0.001 DOGE/kB
# min fee, 0.01 DOGE dust) — 1000 koinu/B keeps payouts
# comfortably standard
FEE_RATE = 1000
DUST_LIMIT = 1000000
