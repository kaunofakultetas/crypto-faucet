############################################################
#  [*] Chain registry — protocol facts, not operator choices
#
#  Every Move chain's PROTOCOL CONSTANTS live here, one
#  module per chain: the native symbol, its decimal count,
#  the coin type tag and the gas safety margin. These are
#  facts about the chain, so the operator's config
#  (_CONFIG/coins.py) never sees them — it names a chain and
#  a network flavour ('sui' + 'testnet'); everything precise
#  resolves from here at startup.
#
#  Adding a chain = one small module with NAME, SYMBOL,
#  DECIMALS, COIN_TYPE, FEE_MIST, NETWORKS — and a line in
#  CHAINS below.
#
#  Used by:
#    - app/config_models.py — boot validation of chain+network
#    - move_faucet.py — per-network params at startup
############################################################


from . import sui


# Operator-facing chain name -> its parameter module
CHAINS = {
    'sui': sui,
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
#   - app/config_models.py — MoveFaucetSection validator
#   - move_faucet.py — MoveFaucet.__init__, once per network
############################################################

def chain_params(chain: str, network: str) -> dict:
    module = CHAINS.get(chain)
    if module is None:
        raise ValueError(f"unknown chain '{chain}' — known chains: {sorted(CHAINS)}")

    if network not in module.NETWORKS:
        raise ValueError(
            f"chain '{chain}' has no '{network}' flavour — available: {sorted(module.NETWORKS)}"
        )

    return {
        'symbol': module.SYMBOL,
        'decimals': module.DECIMALS,
        'coin_type': module.COIN_TYPE,
        'fee_mist': module.FEE_MIST,
    }
