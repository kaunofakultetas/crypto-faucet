############################################################
# ERC20 Faucet Routes
############################################################

from flask import Blueprint, request, jsonify
from .erc20_faucet import ERC20Faucet
from main import EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS

bp_erc20_faucet = Blueprint('erc20_faucet', __name__)
erc20_faucet = ERC20Faucet(EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS)


@bp_erc20_faucet.route('/api/erc20/tokens', methods=['GET'])
def get_tokens():
    """Get all supported ERC20 tokens"""
    data, status = erc20_faucet.get_token_configs()
    return jsonify(data), status


@bp_erc20_faucet.route('/api/erc20/<network>/balances', methods=['GET'])
def get_faucet_balances(network):
    """Get faucet balances for all tokens on a network"""
    data, status = erc20_faucet.get_faucet_balances(network)
    return jsonify(data), status


@bp_erc20_faucet.route('/api/erc20/<network>/<token>/request', methods=['GET'])
def request_tokens(network, token):
    """Request ERC20 tokens"""
    to_address = request.args.get('address')
    signature = request.args.get('signature')
    nonce = request.args.get('nonce')
    
    data, status = erc20_faucet.request_tokens(
        network, token, to_address, signature, nonce
    )
    return jsonify(data), status