############################################################
#  [*] Address dialects — how a UTXO chain formats & signs
#
#  A dialect is an ADDRESS-FORMAT FAMILY, not a coin: one
#  class serves every network of its kind, instantiated with
#  that network's parameters from the config's faucet section.
#
#    segwit.py — SegwitDialect(hrp): bech32 addresses, p2wpkh
#                spending, BIP-143 witness signing
#                (knf, ltc4, btc4)
#    legacy.py — LegacyDialect(p2pkh_prefix, p2sh_prefix):
#                base58 addresses, p2pkh spending,
#                pre-BIP-143 scriptSig signing (doge3)
#
#  Every dialect answers the same five questions: the
#  faucet's own script, its address, whether a recipient
#  address is valid, that address as a scriptPubKey, and how
#  to sign one input — plus TX_VERSION and the INPUT_SIZE /
#  OUTPUT_SIZE fee-estimate constants. The engine holds ONE
#  code path and asks the dialect at each of those points.
#
#  Used by:
#    - utxo_faucet.py — dialect_for() per configured network
############################################################


from .segwit import SegwitDialect
from .legacy import LegacyDialect




############################################################
# dialect_for
############################################################
#
# The single decision point turning a coin's resolved params
# (coins/ registry) into its dialect object: a 'p2pkh_prefix'
# marks a legacy pre-SegWit coin, an 'hrp' a SegWit one.
#
# Used by:
#   - utxo_faucet.py — UTXOFaucet.__init__, once per network
############################################################

def dialect_for(params: dict):
    if 'p2pkh_prefix' in params:
        return LegacyDialect(params['p2pkh_prefix'], params.get('p2sh_prefix'))

    hrp = params.get('hrp')
    if not hrp:
        raise ValueError("coin params need 'hrp' (SegWit) or 'p2pkh_prefix' (legacy)")
    return SegwitDialect(hrp)
