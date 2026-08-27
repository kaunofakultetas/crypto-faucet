############################################################
#  [*] MOVE Faucet HTTP API
#
#  The REST surface for the Move side of the faucet (Sui),
#  consumed by the React frontend:
#
#    GET /api/move/networks                  — available networks
#    GET /api/move/<network>/faucet-balance  — faucet address + balance
#    GET /api/move/<network>/request         — send one chunk
#                                              (?address, ?signature, ?nonce)
#
#  Shaped like the other family surfaces so the frontend can
#  treat them all alike. A deliberately thin layer: every
#  handler just forwards to the shared MoveFaucet instance,
#  which already returns (payload, http_status) tuples ready
#  to be jsonify()'d.
#
#  Used by:
#    - main.py — blueprint registration
############################################################


from flask import Blueprint, request, jsonify

from .move_faucet import MoveFaucet
from ..config_loader import MOVE_NETWORK_CONFIGS


bp_move_faucet = Blueprint('move_faucet', __name__)


# The single faucet instance, shared by every request handler
# below. Its per-network state (GraphQL clients, send locks,
# the balance cache) is built once and guarded, so sharing it
# across threads is safe.
move_faucet = MoveFaucet(MOVE_NETWORK_CONFIGS)








############################################################
# get_networks
############################################################
#
# GET /api/move/networks
#
# Network picker data for the frontend: names, symbols, chunk
# sizes, the public GraphQL endpoint a page may query, and
# which network to preselect. The backend's own RPC URL is
# never in this payload.
#
# Used by:
#   - app/faucet_catalog/catalog_routes.py — the move slice
#   - pages/Faucet_MOVE/Page.jsx — display names + endpoints
############################################################

@bp_move_faucet.route('/api/move/networks', methods=['GET'])
def get_networks():
    return jsonify(move_faucet.get_networks()), 200








############################################################
# get_faucet_balance
############################################################
#
# GET /api/move/<network>/faucet-balance
#
# The faucet's address and balance on one network, cached
# ~10 s server-side; a payout drops that cache so the page
# shows the new number on its next poll.
#
# Used by:
#   - pages/Faucet_MOVE/Page.jsx — the balance poll
############################################################

@bp_move_faucet.route('/api/move/<network>/faucet-balance', methods=['GET'])
def get_faucet_balance(network):
    data, status = move_faucet.get_faucet_balance(network)
    return jsonify(data), status








############################################################
# request_move
############################################################
#
# GET /api/move/<network>/request
#
# The actual payout: sends one chunk to ?address=. The
# Ed25519 personal-message signature (of the fixed message +
# nonce, made in the student's wallet) proves they control
# that address. Validation, the cooldown and the broadcast
# itself live in MoveFaucet.
#
# Used by:
#   - pages/Faucet_MOVE/Page.jsx — the claim button
############################################################

@bp_move_faucet.route('/api/move/<network>/request', methods=['GET'])
def request_move(network):
    to_address = request.args.get('address')
    signature = request.args.get('signature')
    nonce = request.args.get('nonce')
    data, status = move_faucet.request_move(network, to_address, signature, nonce)
    return jsonify(data), status
