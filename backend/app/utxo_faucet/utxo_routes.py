# -----------------------------------------------------------
#  [*] UTXO Faucet HTTP API
#
#  The REST surface for the UTXO side of the faucet (Bitcoin,
#  Litecoin, KNF), consumed by the React frontend:
#
#    GET /api/utxo/networks                  — available networks
#    GET /api/utxo/<network>/faucet-balance  — faucet address + balance
#    GET /api/utxo/<network>/request-btc     — send one chunk to ?address=
#
#  A deliberately thin layer: every handler just forwards to
#  the shared UTXOFaucet instance, which already returns
#  (payload, http_status) tuples ready to be jsonify()'d.
#
#  Used by:
#    - main.py — blueprint registration
# -----------------------------------------------------------

from flask import Blueprint, request, jsonify

from .utxo_faucet import UTXOFaucet
from main import UTXO_NETWORK_CONFIGS


bp_utxo_faucet = Blueprint('utxo_faucet', __name__)


# The single faucet instance, shared by every request handler below.
# It keeps no per-request state (each call builds its own network
# context), so sharing it across threads is safe.
utxo_faucet = UTXOFaucet(UTXO_NETWORK_CONFIGS)




# -----------------------------------------------------------
# Networks
# -----------------------------------------------------------

@bp_utxo_faucet.route('/api/utxo/networks', methods=['GET'])
def get_networks():
    # Network picker data for the frontend: names, chunk sizes
    # and which network to preselect.
    return jsonify(utxo_faucet.get_networks()), 200




# -----------------------------------------------------------
# Balance / payout
# -----------------------------------------------------------

@bp_utxo_faucet.route('/api/utxo/<network>/faucet-balance', methods=['GET'])
def faucet_balance(network):
    # Faucet address and its confirmed/unconfirmed balance, so the UI
    # (and the operator) can see whether the faucet needs a top-up.
    data, status = utxo_faucet.get_faucet_balance(network)
    return jsonify(data), status


@bp_utxo_faucet.route('/api/utxo/<network>/request-btc', methods=['GET'])
def request_btc(network):
    # The actual payout: sends one chunk of the network's coin to
    # ?address=... — validation and cooldown live in the faucet itself.
    to_address = request.args.get('address')
    data, status = utxo_faucet.request_crypto(network, to_address)
    return jsonify(data), status
