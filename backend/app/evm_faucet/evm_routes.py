############################################################
#  [*] EVM Faucet HTTP API
#
#  The REST surface for the EVM side of the faucet (Sepolia
#  and friends), consumed by the React frontend:
#
#    GET /api/evm/networks                          — available networks
#    GET /api/evm/<network>/faucet-balance          — faucet address + balance
#    GET /api/evm/<network>/request                 — send one chunk
#                                                     (?address, ?signature, ?nonce)
#    GET /api/evm/<network>/get-stored-transactions — flows for the tx graph
#                                                     (?address, ?from, ?to)
#    GET /api/evm/<network>/transaction-days        — days the root address
#                                                     transacted (?address, ?tz_offset)
#    GET /api/evm/set-address-name                  — label an address
#                                                     (?address, ?name)
#
#  A deliberately thin layer: every handler just forwards to
#  the shared EVMFaucet instance, which already returns
#  (payload, http_status) tuples ready to be jsonify()'d.
#
#  Used by:
#    - main.py — blueprint registration
############################################################


from flask import Blueprint, request, jsonify

from .evm_faucet import EVMFaucet
from .explorer import EtherscanExplorer
from main import EVM_NETWORK_CONFIGS


bp_evm_faucet = Blueprint('evm_faucet', __name__)


# Two single instances, shared by every request handler below:
# the faucet (payouts, balances) and the Etherscan explorer
# behind the transaction graph — separate features, separate
# classes. The faucet's own address is passed as trusted: it is
# a high-degree hub by design (hundreds of student payouts) and
# must not trip the explorer's public-hub protection.
evm_faucet = EVMFaucet(EVM_NETWORK_CONFIGS)
evm_explorer = EtherscanExplorer(EVM_NETWORK_CONFIGS, trusted_addresses=[evm_faucet.FAUCET_ADDRESS])








############################################################
# request_eth
############################################################
#
# GET /api/evm/<network>/request
#
# The actual payout: sends one chunk of the NATIVE coin to
# ?address= — the route says "request", not "request-eth",
# because not every chain's native currency is ETH. The
# signature (of the fixed message + nonce, made in MetaMask)
# proves the caller controls that wallet. Validation, the
# cooldown and the broadcast itself live in EVMFaucet.
#
# Used by:
#   - Faucet_EVM/Page.jsx — the page's claim flow
############################################################

@bp_evm_faucet.route('/api/evm/<network>/request', methods=['GET'])
def request_eth(network):
    to_address = request.args.get('address')
    signature = request.args.get('signature')
    nonce = request.args.get('nonce')
    data, status = evm_faucet.request_eth(network, to_address, signature, nonce)
    return jsonify(data), status








############################################################
# faucet_balance
############################################################
#
# GET /api/evm/<network>/faucet-balance
#
# The faucet address and its balance, so the UI (and the
# operator) can see whether the faucet needs a top-up.
#
# Used by:
#   - Faucet_EVM/Page.jsx — useFaucetInfo's 3 s repoll
#   - Graph/Page.jsx — resolving the graph's root address
############################################################

@bp_evm_faucet.route('/api/evm/<network>/faucet-balance', methods=['GET'])
def faucet_balance(network):
    data, status = evm_faucet.get_faucet_balance(network)
    return jsonify(data), status








############################################################
# get_networks
############################################################
#
# GET /api/evm/networks
#
# Network picker data for the frontend: names, chain ids and
# which network to preselect. The same payload feeds
# MetaMask's wallet_addEthereumChain when the chain is
# missing there. Composed in EVMFaucet.get_networks — the
# config's backend-only sections never reach the browser.
#
# Used by:
#   - Faucet_EVM/Page.jsx — useFaucetInfo
#   - components/Navbar.jsx — useNetworksDirectory
#   - App.jsx — the "/" redirect's default network
############################################################

@bp_evm_faucet.route('/api/evm/networks', methods=['GET'])
def get_networks():
    return jsonify(evm_faucet.get_networks())








############################################################
# get_stored_transactions
############################################################
#
# GET /api/evm/<network>/get-stored-transactions
#
# Aggregated transfer "flows" around ?address= for the graph
# view — refreshes the local cache from Etherscan (via the
# explorer, not the faucet). ?from and ?to (unix seconds,
# half-open [from, to) window) select the day the page's date
# slider picked; both are required.
#
# Used by:
#   - Graph/CryptoFlowGraph.jsx — useTransactionGraph's
#     sweeps and double-click expands
############################################################

@bp_evm_faucet.route('/api/evm/<network>/get-stored-transactions', methods=['GET'])
def get_stored_transactions(network):
    address = request.args.get('address')
    from_ts = request.args.get('from', type=int)
    to_ts = request.args.get('to', type=int)
    data, status = evm_explorer.get_stored_transactions(network, address, from_ts, to_ts)
    return jsonify(data), status








############################################################
# get_transaction_days
############################################################
#
# GET /api/evm/<network>/transaction-days
#
# The days ?address= itself transacted on, with per-day
# counts — what the graph page's date slider offers (days
# with no root activity would render a lone faucet node, so
# they're not listed). ?tz_offset (browser's UTC offset in
# seconds) aligns the day buckets to the student's local
# days.
#
# Used by:
#   - Graph/Page.jsx — the date slider's day list
############################################################

@bp_evm_faucet.route('/api/evm/<network>/transaction-days', methods=['GET'])
def get_transaction_days(network):
    tz_offset = request.args.get('tz_offset', default=0, type=int)
    address = request.args.get('address')
    data, status = evm_explorer.get_transaction_days(network, tz_offset, address)
    return jsonify(data), status








############################################################
# set_address_name
############################################################
#
# GET /api/evm/set-address-name
#
# Attaches a human-readable label to an address, shown on the
# nodes of the transaction graph.
#
# Used by:
#   - Graph/CryptoFlowGraph.jsx — renameNode's fire-and-forget
#     save
############################################################

@bp_evm_faucet.route('/api/evm/set-address-name', methods=['GET'])
def set_address_name():
    address = request.args.get('address')
    name = request.args.get('name')
    data, status = evm_explorer.set_address_name(address, name)
    return jsonify(data), status





