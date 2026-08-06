############################################################
#  [*] Coin registry — protocol facts, not operator choices
#
#  Every UTXO coin's PROTOCOL CONSTANTS live here, one module
#  per coin: address parameters per network flavour (bech32
#  HRP on SegWit coins, base58 version bytes on legacy ones)
#  and the coin's relay economics (fee rate, dust limit).
#
#  These are facts about the coin — a Dogecoin testnet
#  address starts with 'n' whether the operator likes it or
#  not — so the operator's config (_CONFIG/coins.py) never
#  sees them. It names a coin and a network flavour
#  ('dogecoin' + 'testnet'); everything precise resolves from
#  here at startup.
#
#  Adding a coin = one small module with NAME, NETWORKS,
#  FEE_RATE, DUST_LIMIT — and a line in COINS below.
#
#  Used by:
#    - app/config_models.py — boot validation of coin+network
#    - utxo_faucet.py — per-network params at startup
############################################################


from . import bitcoin, litecoin, knfcoin, dogecoin


# Operator-facing coin name -> its parameter module
COINS = {
    'bitcoin': bitcoin,
    'litecoin': litecoin,
    'knfcoin': knfcoin,
    'dogecoin': dogecoin,
}




############################################################
# coin_params
############################################################
#
# The resolved parameter dict for one coin on one network
# flavour: the address params ('hrp', or 'p2pkh_prefix' +
# 'p2sh_prefix') merged with the coin's fee_rate and
# dust_limit. Raises ValueError naming the known options —
# the boot validation surfaces that message verbatim.
#
# Used by:
#   - app/config_models.py — UtxoFaucetSection validator
#   - utxo_faucet.py — UTXOFaucet.__init__, once per network
############################################################

def coin_params(coin: str, network: str) -> dict:
    module = COINS.get(coin)
    if module is None:
        raise ValueError(f"unknown coin '{coin}' — known coins: {sorted(COINS)}")

    address_params = module.NETWORKS.get(network)
    if address_params is None:
        raise ValueError(
            f"coin '{coin}' has no '{network}' flavour — available: {sorted(module.NETWORKS)}"
        )

    return {
        **address_params,
        'fee_rate': module.FEE_RATE,
        'dust_limit': module.DUST_LIMIT,
    }
