############################################################
#  [*] Sui — chain parameters
#
#  The reference Move chain. Balances are counted in MIST
#  (1 SUI = 1e9). There is no rent-exempt minimum — Sui's
#  storage model refunds rebates instead — so any positive
#  payout is spendable. Gas for a payout is chosen by the
#  node itself during transaction resolution; FEE_MIST is
#  only the safety margin the faucet must hold ON TOP of the
#  chunk before it commits to a payout.
#
#  Used by:
#    - chains/__init__.py — the registry
############################################################


NAME = 'Sui'

SYMBOL = 'SUI'

# MIST per SUI is 1e9 — nine decimals, like Solana's lamports
DECIMALS = 9

# The full SUI coin type tag, as GraphQL wants it spelled
COIN_TYPE = '0x2::sui::SUI'

# Safety margin over the chunk for gas — a simple transfer
# costs well under 0.005 SUI at the reference gas price; the
# margin is deliberately generous
FEE_MIST = 10_000_000

# 'mainnet' is listed for completeness only: the faucet signs
# node-built transaction bytes unverified (see
# MoveFaucet._sign_transaction), so point it at nothing that
# holds real value.
NETWORKS = ('mainnet', 'testnet', 'devnet')
