############################################################
# Author:           Tomas Vanagas
# Updated:          2025-09-04
# Version:          1.0
# Description:      Main file for the faucet backend
############################################################



import os
import json
import sqlite3
from flask import Flask, Response


app = Flask(__name__)



EVM_NETWORK_CONFIGS = {
    'sepolia': {
        'id': 1,
        'chunk_size': 0.2,
        'chain_id': 11155111,
        'infura_network': 'sepolia',
        'short_name': "SepETH",
        'full_name': 'Sepolia',
        'native_currency': {
            'name': 'Ethereum',
            'symbol': 'SepETH',
            'decimals': 18
        },
        'rpc_urls': ['https://rpc.sepolia.org'],
        'block_explorer_urls': ['https://sepolia.etherscan.io'],
        'etherscan_api_url': 'https://api.etherscan.io/v2/api',
    },
    'zkSyncSepolia': {
        'id': 3,
        'chunk_size': 0.05,
        'chain_id': 300,
        'infura_network': 'zksync-sepolia',
        'short_name': "ETH",
        'full_name': 'zkSync Sepolia Testnet',
        'native_currency': {
            'name': 'Ethereum',
            'symbol': 'ETH',
            'decimals': 18
        },
        'rpc_urls': ['https://sepolia.era.zksync.dev'],
        'block_explorer_urls': ['https://block-explorer-api.sepolia.zksync.dev'],
        'etherscan_api_url': 'https://block-explorer-api.sepolia.zksync.dev/api'
    },
    'polygonZkEvm': {
        'id': 4,
        'chunk_size': 0.05,
        'chain_id': 2442,
        'infura_network': 'https://rpc.cardona.zkevm-rpc.com',
        'short_name': "ETH",
        'full_name': 'Polygon zkEVM Cardona Testnet',
        'native_currency': {
            'name': 'Ethereum',
            'symbol': 'ETH',
            'decimals': 18
        },
        'rpc_urls': ['https://rpc.cardona.zkevm-rpc.com'],
        'block_explorer_urls': ['https://explorer-ui.cardona.zkevm-rpc.com'],
        'etherscan_api_url': 'https://api-cardona-zkevm.polygonscan.com/api'
    },
    'lineaSepolia': {
        'id': 5,
        'chunk_size': 0.05,
        'chain_id': 59141,
        'infura_network': 'linea-sepolia',
        'short_name': "ETH",
        'full_name': 'Linea Sepolia',
        'native_currency': {
            'name': 'LineaETH',
            'symbol': 'LineaETH',
            'decimals': 18
        },
        'rpc_urls': ['https://linea-sepolia-rpc.publicnode.com'],
        'block_explorer_urls': ['https://explorer.linea.build'],
        'etherscan_api_url': 'https://api-explorer.sepolia.linea.build/api'
    },
    "hoodi": {
        'id': 6,
        'chunk_size': 0.05,
        'chain_id': 560048,
        'infura_network': 'https://rpc.hoodi.ethpandaops.io',
        'short_name': "ETH",
        'full_name': 'Ethereum Hoodi',
        'native_currency': {
            'name': 'Ethereum',
            'symbol': 'ETH',
            'decimals': 18
        },
        'rpc_urls': ['https://rpc.hoodi.ethpandaops.io'],
        'block_explorer_urls': ['https://light-hoodi.beaconcha.in'],
        'etherscan_api_url': 'https://api.etherscan.io/v2/api',
    },
    "arbitrumSepolia": {
        'id': 7,
        'chunk_size': 0.05,
        'chain_id': 421614,
        'infura_network': 'arbitrum-sepolia',
        'short_name': "ETH",
        'full_name': 'Arbitrum Sepolia',
        'native_currency': {
            'name': 'Ethereum',
            'symbol': 'ETH',
            'decimals': 18
        },
        'rpc_urls': ['https://sepolia.arbitrum.io/rpc'],
    }
}







UTXO_NETWORK_CONFIGS = {
    'knf': {
        'id': 1,
        'chunk_size': 25,
        'short_name': "KNF",
        'full_name': 'KNF Coin',
        'network': 'mainnet',
        'hrp': 'knf',
        'electrum_server': '158.129.172.247:49002',
        'block_explorer': 'https://knfcoin.knf.vu.lt/explorer'
    },
    'ltc4': {
        'id': 2,
        'chunk_size': 0.1,
        'short_name': "tLTC4",
        'full_name': 'Litecoin Testnet4',
        'network': 'testnet',
        'hrp': 'tltc',
        'electrum_server': '158.129.172.247:50002',
        'block_explorer': 'https://litecoinspace.org/testnet'
    },
    'btc3': {
        'id': 3,
        'chunk_size': 0.005,
        'short_name': "tBTC3",
        'full_name': 'Bitcoin Testnet3',
        'network': 'testnet',
        'hrp': 'tb',
        'electrum_server': '158.129.172.247:51002',
        'block_explorer': 'https://mempool.space/testnet'
    },
    'btc4': {
        'id': 4,
        'chunk_size': 0.01,
        'short_name': "tBTC4",
        'full_name': 'Bitcoin Testnet4',
        'network': 'testnet',
        'hrp': 'tb',
        'electrum_server': '158.129.172.247:52002',
        'block_explorer': 'https://mempool.space/testnet4'
    }
}





@app.route('/api/get-example-blockchain', methods=['GET'])
def get_example_blockchain():
    conn = sqlite3.connect('transactions.db')
    c = conn.cursor()
    c.execute('''
        SELECT
            json_group_array(
                json_object(
                    'data', Transactions, 
                    'previousHash', PrevBlock, 
                    'nonce', Nonce, 
                    'hash', BlockHash
                )
            ) AS json_block
        FROM BlockchainSimulator_Blocks
    ''')
    result = c.fetchone()[0]
    result = json.dumps(json.loads(result), indent=4)
    c.close()
    return Response(result, mimetype='application/json')








if __name__ == '__main__':
    APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'

    # Initialize database
    from app.database.db_init import init_db
    init_db()

    # Register blueprints
    from app.evm_faucet.evm_routes import bp_evm_faucet
    app.register_blueprint(bp_evm_faucet, url_prefix='')

    from app.utxo_faucet.utxo_routes import bp_utxo_faucet
    app.register_blueprint(bp_utxo_faucet, url_prefix='')

    from app.reorg_attack.routes import bp_reorg_attack
    app.register_blueprint(bp_reorg_attack, url_prefix='')

    # Run backend
    app.run(host='0.0.0.0', port=8000, debug=APP_DEBUG)