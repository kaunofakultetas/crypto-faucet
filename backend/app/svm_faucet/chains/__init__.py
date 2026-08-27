############################################################
#  [*] SVM chain registry — protocol facts, not operator
#      choices
#
#  Every SVM chain's PROTOCOL CONSTANTS live here, one module
#  per chain: the native token it pays in, its decimals, the
#  per-signature fee and the rent-exempt minimum a fresh
#  account must receive to survive.
#
#  These are facts about the chain — Solana charges 5000
#  lamports per signature whether the operator likes it or
#  not — so the operator's config (_CONFIG/coins.py) never
#  sees them. It names a chain and a network flavour
#  ('solana' + 'devnet'); everything precise resolves here at
#  startup.
#
#  Adding a chain = one small module with NAME, SYMBOL,
#  DECIMALS, FEE_LAMPORTS, MIN_PAYOUT_LAMPORTS, NETWORKS —
#  and a line in CHAINS below.
#
#  Used by:
#    - app/config_models.py — boot validation of chain+network
#    - svm_faucet.py — per-network params at startup
############################################################


from . import solana


# Operator-facing chain name -> its parameter module
CHAINS = {
    'solana': solana,
}




############################################################
# chain_params
############################################################
#
# The resolved parameter dict for one chain on one network
# flavour. Raises ValueError naming the known options — the
# boot validation surfaces that message verbatim.
#
# Used by:
#   - app/config_models.py — SvmFaucetSection validator
#   - svm_faucet.py — SVMFaucet.__init__, once per network
############################################################

def chain_params(chain: str, network: str) -> dict:
    module = CHAINS.get(chain)
    if module is None:
        raise ValueError(f"unknown SVM chain '{chain}' — known chains: {sorted(CHAINS)}")

    if network not in module.NETWORKS:
        raise ValueError(
            f"chain '{chain}' has no '{network}' flavour — available: {sorted(module.NETWORKS)}"
        )

    return {
        'symbol': module.SYMBOL,
        'decimals': module.DECIMALS,
        'fee_lamports': module.FEE_LAMPORTS,
        'min_payout_lamports': module.MIN_PAYOUT_LAMPORTS,
        'genesis_hash': module.GENESIS_HASHES[network],
    }
