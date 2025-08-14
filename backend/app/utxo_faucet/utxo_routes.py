from flask import Blueprint, request, jsonify
import os
from .utxo_faucet import UTXOFaucet
from main import UTXO_NETWORK_CONFIGS

bp_utxo_faucet = Blueprint('utxo_faucet', __name__)



# Single configured UTXO faucet instance (BTC testnet/mainnet/regtest via env)
utxo_faucet = UTXOFaucet(UTXO_NETWORK_CONFIGS)


def _display_names_for_chain(chain: str):
    c = (chain or '').lower()
    if c == 'mainnet':
        return 'Bitcoin', 'BTC'
    if c == 'regtest':
        return 'Bitcoin Regtest', 'BTC'
    # default to testnet
    return 'Bitcoin Testnet', 'BTC'


@bp_utxo_faucet.route('/api/utxo/networks', methods=['GET'])
def get_networks():
    return jsonify(utxo_faucet.get_networks()), 200


@bp_utxo_faucet.route('/api/utxo/<network>/faucet-balance', methods=['GET'])
def faucet_balance(network):
    data, status = utxo_faucet.get_faucet_balance(network)
    return jsonify(data), status


@bp_utxo_faucet.route('/api/utxo/<network>/request-btc', methods=['GET'])
def request_btc(network):
    to_address = request.args.get('address')
    data, status = utxo_faucet.request_btc(network, to_address)
    return jsonify(data), status


