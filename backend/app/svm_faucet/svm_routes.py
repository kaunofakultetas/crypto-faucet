############################################################
#  [*] SVM Faucet HTTP API
#
#  The REST surface for the SVM side of the faucet (Solana),
#  consumed by the React frontend:
#
#    GET /api/svm/networks                  — available networks
#    GET /api/svm/<network>/faucet-balance  — faucet address + balance
#    GET /api/svm/<network>/request         — send one chunk
#                                             (?address, ?signature, ?nonce)
#
#  Shaped like the EVM and UTXO surfaces so the frontend can
#  treat all three alike. A deliberately thin layer: every
#  handler just forwards to the shared SVMFaucet instance,
#  which already returns (payload, http_status) tuples ready
#  to be jsonify()'d.
#
#  Used by:
#    - main.py — blueprint registration
############################################################


from flask import Blueprint, request, jsonify

from .svm_faucet import SVMFaucet
from main import SVM_NETWORK_CONFIGS


bp_svm_faucet = Blueprint('svm_faucet', __name__)


# The single faucet instance, shared by every request handler
# below. Its per-network state (RPC clients, send locks, the
# balance cache) is built once and guarded, so sharing it
# across threads is safe.
svm_faucet = SVMFaucet(SVM_NETWORK_CONFIGS)








############################################################
# get_networks
############################################################
#
# GET /api/svm/networks
#
# Network picker data for the frontend: names, symbols, chunk
# sizes, the public RPC a wallet should use, and which
# network to preselect. The backend's own RPC URL (which
# carries the API key) is never in this payload.
#
# Used by:
#   - components/Navbar.jsx — the SVM picker
#   - pages/Faucet_SVM/Page.jsx — display names + Phantom RPC
############################################################

@bp_svm_faucet.route('/api/svm/networks', methods=['GET'])
def get_networks():
    return jsonify(svm_faucet.get_networks()), 200








############################################################
# get_faucet_balance
############################################################
#
# GET /api/svm/<network>/faucet-balance
#
# The faucet's address and balance on one network, cached
# ~10 s server-side; a payout drops that cache so the page
# shows the new number on its next poll.
#
# Used by:
#   - pages/Faucet_SVM/Page.jsx — the balance poll
############################################################

@bp_svm_faucet.route('/api/svm/<network>/faucet-balance', methods=['GET'])
def get_faucet_balance(network):
    data, status = svm_faucet.get_faucet_balance(network)
    return jsonify(data), status








############################################################
# request_sol
############################################################
#
# GET /api/svm/<network>/request
#
# The actual payout: sends one chunk to ?address=. The
# Ed25519 signature (of the fixed message + nonce, made in
# the student's wallet) proves they control that address.
# Validation, the cooldown and the broadcast itself live in
# SVMFaucet.
#
# Used by:
#   - pages/Faucet_SVM/Page.jsx — the claim button
############################################################

@bp_svm_faucet.route('/api/svm/<network>/request', methods=['GET'])
def request_sol(network):
    to_address = request.args.get('address')
    signature = request.args.get('signature')
    nonce = request.args.get('nonce')
    data, status = svm_faucet.request_sol(network, to_address, signature, nonce)
    return jsonify(data), status
