############################################################
# Author:           Tomas Vanagas
# Updated:          2025-09-04
# Version:          1.0
# Description:      EVM faucet flask routes 
############################################################



from flask import Blueprint, request, jsonify
import os
from .evm_faucet import EVMFaucet
from main import EVM_NETWORK_CONFIGS


bp_evm_faucet = Blueprint('evm_faucet', __name__)


FAUCET_DEFAULT_NETWORK = os.getenv('FAUCET_DEFAULT_NETWORK', 'sepolia')
evm_faucet = EVMFaucet(EVM_NETWORK_CONFIGS, FAUCET_DEFAULT_NETWORK)






############# Faucet #############
@bp_evm_faucet.route('/api/evm/<network>/request-eth', methods=['GET'])
def request_eth(network):
    to_address = request.args.get('address')
    signature = request.args.get('signature')
    nonce = request.args.get('nonce')
    data, status = evm_faucet.request_eth(network, to_address, signature, nonce)
    return jsonify(data), status



@bp_evm_faucet.route('/api/evm/<network>/faucet-balance', methods=['GET'])
def faucet_balance(network):
    data, status = evm_faucet.get_faucet_balance(network)
    return jsonify(data), status



@bp_evm_faucet.route('/api/evm/networks', methods=['GET'])
def get_networks():
    return jsonify(evm_faucet.get_networks())




############# Transaction explorer #############
@bp_evm_faucet.route('/api/evm/<network>/get-stored-transactions', methods=['GET'])
def get_stored_transactions(network):
    address = request.args.get('address')
    hours = request.args.get('hours', default=24, type=int)
    data, status = evm_faucet.get_stored_transactions(network, address, hours)
    return jsonify(data), status



@bp_evm_faucet.route('/api/evm/set-address-name', methods=['GET'])
def set_address_name():
    address = request.args.get('address')
    name = request.args.get('name')
    data, status = evm_faucet.set_address_name(address, name)
    return jsonify(data), status