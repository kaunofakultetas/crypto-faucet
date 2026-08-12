############################################################
#  [*] Bitcoin — coin parameters
#
#  SegWit coin: bech32 addresses. The 'tb' HRP covers every
#  Bitcoin testnet flavour (testnet3 and testnet4 share it).
#  The base58 version bytes are for RECIPIENTS only — the
#  chain never abolished legacy addresses, so students'
#  old-wallet p2pkh/p2sh addresses stay payable; the faucet
#  itself lives on bech32.
#
#  Used by:
#    - coins/__init__.py — the registry
############################################################


NAME = 'Bitcoin'

NETWORKS = {
    'mainnet': {'hrp': 'bc', 'p2pkh_prefix': 0x00, 'p2sh_prefix': 0x05},
    'testnet': {'hrp': 'tb', 'p2pkh_prefix': 0x6f, 'p2sh_prefix': 0xc4},
    'regtest': {'hrp': 'bcrt', 'p2pkh_prefix': 0x6f, 'p2sh_prefix': 0xc4},
}

# Conservative classroom defaults: 10 sat/vB clears any
# testnet mempool, 546 sat is the standard dust threshold
FEE_RATE = 10
DUST_LIMIT = 546
