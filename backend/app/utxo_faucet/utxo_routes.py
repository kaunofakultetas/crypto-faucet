############################################################
# Author:           Tomas Vanagas
# Updated:          2025-09-04
# Version:          1.0
# Description:      UTXO faucet flask routes 
############################################################


from flask import Blueprint, request, jsonify
from .utxo_faucet import UTXOFaucet
from main import UTXO_NETWORK_CONFIGS

bp_utxo_faucet = Blueprint('utxo_faucet', __name__)



# Single configured UTXO faucet instance supporting Bitcoin and Litecoin networks
utxo_faucet = UTXOFaucet(UTXO_NETWORK_CONFIGS)


def _display_names_for_chain(chain: str, coin_type: str = 'bitcoin'):
    """Get display names for chain based on network and coin type."""
    c = (chain or '').lower()
    
    if coin_type.lower() == 'litecoin':
        if c == 'mainnet':
            return 'Litecoin', 'LTC'
        elif c == 'regtest':
            return 'Litecoin Regtest', 'LTC'
        else:  # testnet
            return 'Litecoin Testnet', 'LTC'
    else:  # bitcoin
        if c == 'mainnet':
            return 'Bitcoin', 'BTC'
        elif c == 'regtest':
            return 'Bitcoin Regtest', 'BTC'
        else:  # testnet
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
    data, status = utxo_faucet.request_crypto(network, to_address)
    return jsonify(data), status


