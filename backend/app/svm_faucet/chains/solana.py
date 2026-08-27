############################################################
#  [*] Solana — chain parameters
#
#  The reference SVM chain. Balances are counted in LAMPORTS
#  (1 SOL = 1e9), a signature costs a flat 5000 lamports, and
#  an account holding less than the rent-exempt minimum is
#  purged by the runtime — so a payout below that would fund
#  an account that immediately disappears.
#
#  Used by:
#    - chains/__init__.py — the registry
############################################################


NAME = 'Solana'

SYMBOL = 'SOL'

# Lamports per SOL is 1e9 — nine decimals, not eighteen
DECIMALS = 9

# Flat per-signature fee; our payouts carry exactly one
FEE_LAMPORTS = 5000

# Rent-exempt minimum for a bare system account (0 bytes of
# data). Paying a fresh wallet less than this creates an
# account the runtime then reclaims — the student would see
# the transfer confirm and the balance vanish.
MIN_PAYOUT_LAMPORTS = 890880

NETWORKS = ('mainnet', 'devnet', 'testnet')

# Each cluster's genesis hash — the one fact that tells them
# apart over RPC. The faucet refuses to pay on an RPC whose
# genesis is not the configured cluster's.
GENESIS_HASHES = {
    'mainnet': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    'devnet': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    'testnet': '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
}
