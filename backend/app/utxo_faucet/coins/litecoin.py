############################################################
#  [*] Litecoin — coin parameters
#
#  SegWit coin: bech32 addresses ('ltc' mainnet, 'tltc' on
#  every testnet flavour). The base58 version bytes are for
#  RECIPIENTS only — old-wallet addresses stay payable. The
#  p2sh bytes are Litecoin's OWN ('M' / 'Q'); the deprecated
#  Bitcoin-shared ones ('3' / '2') are not accepted.
#
#  Used by:
#    - coins/__init__.py — the registry
############################################################


NAME = 'Litecoin'

NETWORKS = {
    'mainnet': {'hrp': 'ltc', 'p2pkh_prefix': 0x30, 'p2sh_prefix': 0x32},
    'testnet': {'hrp': 'tltc', 'p2pkh_prefix': 0x6f, 'p2sh_prefix': 0x3a},
    'regtest': {'hrp': 'rltc', 'p2pkh_prefix': 0x6f, 'p2sh_prefix': 0x3a},
}

# Same conservative defaults as Bitcoin — Litecoin's relay
# minimums are lower, so these are comfortably standard
FEE_RATE = 10
DUST_LIMIT = 546
