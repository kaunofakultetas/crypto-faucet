############################################################
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
############################################################


from flask import Blueprint, request, jsonify

from .utxo_faucet import UTXOFaucet
from ..config_loader import UTXO_NETWORK_CONFIGS


bp_utxo_faucet = Blueprint('utxo_faucet', __name__)


# The single faucet instance, shared by every request handler below.
# It keeps no per-request state (each call builds its own network
# context), so sharing it across threads is safe.
utxo_faucet = UTXOFaucet(UTXO_NETWORK_CONFIGS)








############################################################
# get_networks
############################################################
#
# GET /api/utxo/networks
#
# Network picker data for the frontend: names, chunk sizes
# and which network to preselect. Shaped like the EVM
# equivalent so the frontend can treat both alike.
#
# Used by:
#   - Faucet_UTXO/Page.jsx — useFaucetInfo's display names
#   - components/Navbar.jsx — useNetworksDirectory
############################################################

@bp_utxo_faucet.route('/api/utxo/networks', methods=['GET'])
def get_networks():
    return jsonify(utxo_faucet.get_networks()), 200








############################################################
# faucet_balance
############################################################
#
# GET /api/utxo/<network>/faucet-balance
#
# The faucet address and its confirmed/unconfirmed balance,
# so the UI (and the operator) can see whether the faucet
# needs a top-up.
#
# Used by:
#   - Faucet_UTXO/Page.jsx — useFaucetInfo's 5 s repoll
############################################################

@bp_utxo_faucet.route('/api/utxo/<network>/faucet-balance', methods=['GET'])
def faucet_balance(network):
    data, status = utxo_faucet.get_faucet_balance(network)
    return jsonify(data), status








############################################################
# request_btc
############################################################
#
# GET /api/utxo/<network>/request-btc
#
# The actual payout: sends one chunk of the network's coin to
# ?address= — validation, the cooldown and the broadcast live
# in UTXOFaucet.request_crypto.
#
# Used by:
#   - Faucet_UTXO/Page.jsx — handleRequest
############################################################

@bp_utxo_faucet.route('/api/utxo/<network>/request-btc', methods=['GET'])
def request_btc(network):
    to_address = request.args.get('address')
    data, status = utxo_faucet.request_crypto(network, to_address)
    return jsonify(data), status
