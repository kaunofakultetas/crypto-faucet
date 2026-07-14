# -----------------------------------------------------------
#  [*] EVM Faucet HTTP API
#
#  The REST surface for the EVM side of the faucet (Sepolia
#  and friends), consumed by the React frontend:
#
#    GET /api/evm/networks                          — available networks
#    GET /api/evm/<network>/faucet-balance          — faucet address + balance
#    GET /api/evm/<network>/request-eth             — send one chunk
#                                                     (?address, ?signature, ?nonce)
#    GET /api/evm/<network>/get-stored-transactions — flows for the tx graph
#                                                     (?address, ?hours)
#    GET /api/evm/set-address-name                  — label an address
#                                                     (?address, ?name)
#
#  A deliberately thin layer: every handler just forwards to
#  the shared EVMFaucet instance, which already returns
#  (payload, http_status) tuples ready to be jsonify()'d.
#
#  Used by:
#    - main.py — blueprint registration
# -----------------------------------------------------------

import os

from flask import Blueprint, request, jsonify

from .evm_faucet import EVMFaucet
from main import EVM_NETWORK_CONFIGS


bp_evm_faucet = Blueprint('evm_faucet', __name__)


# The single faucet instance, shared by every request handler below.
FAUCET_DEFAULT_NETWORK = os.getenv('FAUCET_DEFAULT_NETWORK', 'sepolia')
evm_faucet = EVMFaucet(EVM_NETWORK_CONFIGS, FAUCET_DEFAULT_NETWORK)




# -----------------------------------------------------------
# Faucet
# -----------------------------------------------------------

@bp_evm_faucet.route('/api/evm/<network>/request-eth', methods=['GET'])
def request_eth(network):
    # The actual payout: sends one chunk to ?address=... — the signature
    # (of the fixed message + nonce, made in MetaMask) proves the caller
    # controls that wallet. Validation and cooldown live in the faucet.
    to_address = request.args.get('address')
    signature = request.args.get('signature')
    nonce = request.args.get('nonce')
    data, status = evm_faucet.request_eth(network, to_address, signature, nonce)
    return jsonify(data), status


@bp_evm_faucet.route('/api/evm/<network>/faucet-balance', methods=['GET'])
def faucet_balance(network):
    # Faucet address and its balance, so the UI (and the operator)
    # can see whether the faucet needs a top-up.
    data, status = evm_faucet.get_faucet_balance(network)
    return jsonify(data), status


@bp_evm_faucet.route('/api/evm/networks', methods=['GET'])
def get_networks():
    # Network picker data for the frontend: names, chunk sizes
    # and which network to preselect.
    return jsonify(evm_faucet.get_networks())




# -----------------------------------------------------------
# Transaction explorer
# -----------------------------------------------------------

@bp_evm_faucet.route('/api/evm/<network>/get-stored-transactions', methods=['GET'])
def get_stored_transactions(network):
    # Aggregated transfer "flows" around ?address= for the graph view —
    # refreshes the local cache from Etherscan on every call.
    address = request.args.get('address')
    hours = request.args.get('hours', default=24, type=int)
    data, status = evm_faucet.get_stored_transactions(network, address, hours)
    return jsonify(data), status


@bp_evm_faucet.route('/api/evm/set-address-name', methods=['GET'])
def set_address_name():
    # Lets the user attach a human-readable label to an address,
    # shown on the nodes of the transaction graph.
    address = request.args.get('address')
    name = request.args.get('name')
    data, status = evm_faucet.set_address_name(address, name)
    return jsonify(data), status
