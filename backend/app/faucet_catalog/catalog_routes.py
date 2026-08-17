############################################################
#  [*] Faucet catalog — the one-request bootstrap
#
#  The REST surface is a single endpoint:
#
#    GET /api/faucet/catalog — every family's public catalog
#                              in ONE payload
#
#  { 'utxo': …, 'evm': …, 'svm': …, 'erc20': …, 'move': … }
#  — each value
#  is exactly what that family's own catalog endpoint answers
#  (get_networks / get_token_catalog). The navbar decides the
#  whole faucet UI from this one answer — which families
#  exist (an empty slice is a family the operator disabled),
#  what each offers and what to preselect — instead of
#  reconciling five separate requests. The per-family
#  endpoints stay: the pages keep using them.
#
#  Pure composition over the singletons the family route
#  modules already built — no state, no config of its own.
#
#  Used by:
#    - main.py — blueprint registration
#    - components/Navbar.jsx — useFaucetCatalogs (the only
#      frontend consumer; pages use the family endpoints)
############################################################


from flask import Blueprint, jsonify

from app.evm_faucet.evm_routes import evm_faucet
from app.utxo_faucet.utxo_routes import utxo_faucet
from app.svm_faucet.svm_routes import svm_faucet
from app.erc_faucet.erc20_routes import erc20_faucet
from app.move_faucet.move_routes import move_faucet


bp_faucet_catalog = Blueprint('faucet_catalog', __name__)








############################################################
# get_catalog
############################################################
#
# GET /api/faucet/catalog
#
# The five family catalogs, composed fresh per request — all
# of them are pure config compositions, so this costs no RPC
# calls. get_token_catalog returns (payload, status); only
# the payload belongs in the bundle.
#
# Used by:
#   - components/Navbar.jsx — useFaucetCatalogs
############################################################

@bp_faucet_catalog.route('/api/faucet/catalog', methods=['GET'])
def get_catalog():
    return jsonify({
        'utxo': utxo_faucet.get_networks(),
        'evm': evm_faucet.get_networks(),
        'svm': svm_faucet.get_networks(),
        'erc20': erc20_faucet.get_token_catalog()[0],
        'move': move_faucet.get_networks(),
    }), 200
