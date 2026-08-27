############################################################
#  [*] ERC-20 Faucet HTTP API
#
#  The REST surface for the ERC-20 token faucet, consumed by
#  the React frontend. Token-first, because that is how a
#  student picks: the token comes before the chain.
#
#    GET /api/erc20/tokens                    — every token +
#                                               its networks
#    GET /api/erc20/token/<symbol>            — one token on
#                                               every chain it
#                                               lives on
#    GET /api/erc20/<network>/<token>/request — send one chunk
#                                               (?address, ?signature, ?nonce)
#
#  A deliberately thin layer: every handler just forwards to
#  the shared ERC20Faucet instance, which is composed WITH the
#  native EVM faucet — same wallet, same Web3 connections,
#  same send lock.
#
#  Used by:
#    - main.py — blueprint registration
############################################################


from flask import Blueprint, request, jsonify

from .erc20_faucet import ERC20Faucet
from app.evm_faucet.evm_routes import evm_faucet
from ..config_loader import ERC20_TOKEN_CONFIGS


bp_erc20_faucet = Blueprint('erc20_faucet', __name__)


# The single instance, composed with the shared EVM faucet so
# token and native payouts never race each other's nonces.
erc20_faucet = ERC20Faucet(evm_faucet, ERC20_TOKEN_CONFIGS)








############################################################
# get_tokens
############################################################
#
# GET /api/erc20/tokens
#
# The token catalog: every token with its metadata and the
# networks it is deployed on, plus which one to preselect. No
# RPC calls, so the navbar's token picker is instant.
#
# Used by:
#   - components/Navbar.jsx — the ERC-20 token picker
#   - App.jsx — the ERC-20 default token
############################################################

@bp_erc20_faucet.route('/api/erc20/tokens', methods=['GET'])
def get_tokens():
    data, status = erc20_faucet.get_token_catalog()
    return jsonify(data), status








############################################################
# get_token
############################################################
#
# GET /api/erc20/token/<symbol>
#
# One token across every chain it lives on: the faucet's
# balance per chain plus the network metadata MetaMask needs
# for wallet_addEthereumChain and wallet_watchAsset. Balances
# are cached ~10 s server-side. An optional ?address= adds
# that wallet's native balance per chain (wallet_native_wei) —
# the page gates its claim buttons on it.
#
# Used by:
#   - pages/Faucet_ERC20/Page.jsx — the page's poll
############################################################

@bp_erc20_faucet.route('/api/erc20/token/<symbol>', methods=['GET'])
def get_token(symbol):
    data, status = erc20_faucet.get_token(symbol, request.args.get('address'))
    return jsonify(data), status








############################################################
# request_tokens
############################################################
#
# GET /api/erc20/<network>/<token>/request
#
# The actual payout: sends one chunk of the token on the named
# chain to ?address= — the signature (of the fixed message +
# nonce, made in MetaMask) proves the caller controls that
# wallet, exactly like the native ETH flow. The wallet's own
# current chain does not matter.
#
# Used by:
#   - pages/Faucet_ERC20/Page.jsx — each chain row's claim
#     button
############################################################

@bp_erc20_faucet.route('/api/erc20/<network>/<token>/request', methods=['GET'])
def request_tokens(network, token):
    to_address = request.args.get('address')
    signature = request.args.get('signature')
    nonce = request.args.get('nonce')
    data, status = erc20_faucet.request_tokens(network, token, to_address, signature, nonce)
    return jsonify(data), status
