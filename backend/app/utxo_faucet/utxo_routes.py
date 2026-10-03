############################################################
#  [*] UTXO Faucet HTTP API
#
#  The REST surface for the UTXO side of the faucet (Bitcoin,
#  Litecoin, KNF), consumed by the React frontend:
#
#    GET /api/utxo/networks                    — available networks
#    GET /api/utxo/<network>/faucet-balance    — faucet address + balance
#    GET /api/utxo/<network>/request-btc       — send one chunk to ?address=
#    GET /api/utxo/<network>/graph             — one window of the
#                                                transaction graph
#    GET /api/utxo/<network>/transaction-days  — the graph's day list
#    GET /api/utxo/<network>/transaction/<txid> — one transaction
#    GET /api/utxo/<network>/set-address-name  — name an address
#
#  A deliberately thin layer: every handler just forwards to
#  the shared UTXOFaucet or UtxoGraphExplorer instance, which
#  already return (payload, http_status) tuples ready to be
#  jsonify()'d.
#
#  Used by:
#    - main.py — blueprint registration
############################################################


from flask import Blueprint, request, jsonify

from .utxo_faucet import UTXOFaucet
from .explorer import UtxoGraphExplorer
from ..config_loader import UTXO_NETWORK_CONFIGS


bp_utxo_faucet = Blueprint('utxo_faucet', __name__)


# The single faucet instance, shared by every request handler below.
# It keeps no per-request state (each call builds its own network
# context), so sharing it across threads is safe.
utxo_faucet = UTXOFaucet(UTXO_NETWORK_CONFIGS)

# The transaction graph's data source: its own Electrum
# connections, the faucet's identity and address dialects
utxo_explorer = UtxoGraphExplorer(utxo_faucet)








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








############################################################
# get_graph
############################################################
#
# GET /api/utxo/<network>/graph
#
# One window of the UTXO transaction graph: ?from= and ?to=
# are the unix bounds [from, to) of the day the page's slider
# picked, computed in the student's browser. Answers from the
# cache at once; a due crawl runs in the background and the
# answer's `updating` says so, its `crawl_error` why the
# network's last crawl failed.
#
# Used by:
#   - Graph_UTXO/hooks/useTransactionGraph.js — the day's data,
#     repolled while the day is today
############################################################

@bp_utxo_faucet.route('/api/utxo/<network>/graph', methods=['GET'])
def get_graph(network):
    from_ts = request.args.get('from', type=int)
    to_ts = request.args.get('to', type=int)
    data, status = utxo_explorer.get_graph(network, from_ts, to_ts)
    return jsonify(data), status








############################################################
# get_transaction_days
############################################################
#
# GET /api/utxo/<network>/transaction-days
#
# The days the faucet has mined transactions on, with counts,
# bucketed in ?tz — the browser's IANA zone name — for the
# page's day slider.
#
# Used by:
#   - Graph_UTXO/hooks/useTransactionGraph.js —
#     useTransactionDays
############################################################

@bp_utxo_faucet.route('/api/utxo/<network>/transaction-days', methods=['GET'])
def get_transaction_days(network):
    data, status = utxo_explorer.get_transaction_days(network, request.args.get('tz'))
    return jsonify(data), status








############################################################
# get_transaction
############################################################
#
# GET /api/utxo/<network>/transaction/<txid>
#
# One transaction in the graph's shape, plus the names of its
# addresses — fetched from the server when the cache lacks it.
# One that cannot be had is answered with the reason: a 404
# when the node said it does not exist, a 502 when the
# Electrum server refused it or sent one that cannot be read,
# a 503 when the server could not be asked at all.
#
# Used by:
#   - Graph_UTXO/components/TransactionModal.jsx — a link to a
#     transaction outside the day on screen
############################################################

@bp_utxo_faucet.route('/api/utxo/<network>/transaction/<txid>', methods=['GET'])
def get_transaction(network, txid):
    data, status = utxo_explorer.get_transaction(network, txid)
    return jsonify(data), status








############################################################
# set_address_name
############################################################
#
# GET /api/utxo/<network>/set-address-name
#
# Names ?address= (who controls it) with ?name= — an empty
# name clears it. The address must be valid on the network.
#
# Used by:
#   - Graph_UTXO/hooks/useTransactionGraph.js — renameAddress
############################################################

@bp_utxo_faucet.route('/api/utxo/<network>/set-address-name', methods=['GET'])
def set_address_name(network):
    data, status = utxo_explorer.set_address_name(network, request.args.get('address'), request.args.get('name'))
    return jsonify(data), status
