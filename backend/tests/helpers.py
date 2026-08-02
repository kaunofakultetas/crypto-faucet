############################################################
#  [*] Test helpers
#
#  Everything the test files share: throwaway keys, minimal
#  test configs, the recorded byte ANCHORS, and factories
#  that build faucet instances safely — with the startup
#  warmups patched out (no sockets, no RPC) and a throwaway
#  key injected instead of the real one from the container
#  environment.
#
#  The anchors were recorded during the bitcoinlib→embit
#  migration, where the legacy engine and embit produced the
#  IDENTICAL txid for the same inputs. If a deliberate change
#  breaks one, re-record it HERE and say so in the commit.
#
#  Used by:
#    - every test_*.py file in this package
############################################################


import os
from unittest import mock

from app.utxo_faucet.utxo_faucet import UTXOFaucet
from app.evm_faucet.evm_faucet import EVMFaucet
from app.erc_faucet.erc20_faucet import ERC20Faucet


# Throwaway secp256k1 keys — NEVER the real faucet key. The UTXO
# anchors below are derived from TEST_PRIVATE_KEY, so it must not
# change without re-recording them.
TEST_PRIVATE_KEY = 'cc' * 32
RECIPIENT_PRIVATE_KEY = 'bb' * 32


# ---- Recorded anchors (embit migration, key cc*32) ----------

# p2wpkh address of TEST_PRIVATE_KEY under the 'knf' HRP
ANCHOR_KNF_ADDRESS = 'knf1qyvsy6ypssxmqmdzthzua3qwupkey90p3lcuzy4'

# txid prefix of the payout built from ANCHOR_UTXOS + amount
# 250000 sat to the RECIPIENT key's knf address (fee rate 10,
# 2 inputs, payout + change outputs). The txid covers version,
# inputs, outputs and locktime — any byte drift changes it.
ANCHOR_TXID_PREFIX = '5cad5657115dafb6'

ANCHOR_UTXOS = [
    {'tx_hash': '11' * 32, 'tx_pos': 0, 'value': 200000},
    {'tx_hash': '22' * 32, 'tx_pos': 1, 'value': 150000},
]
ANCHOR_AMOUNT_SAT = 250000


# ---- Minimal test configs -----------------------------------

UTXO_TEST_CONFIGS = {
    'knf': {
        'id': 1, 'short_name': 'KNF', 'full_name': 'KNF Coin',
        'faucet': {'chunk_size': 1000, 'network': 'mainnet', 'hrp': 'knf',
                   'electrum_server': '127.0.0.1:9999'},
    },
    'btc4': {
        'id': 4, 'short_name': 'tBTC4', 'full_name': 'Bitcoin Testnet4',
        'faucet': {'chunk_size': 0.01, 'network': 'testnet', 'hrp': 'tb',
                   'electrum_server': '127.0.0.1:9999'},
    },
}

EVM_TEST_CONFIGS = {
    'testchain': {
        'id': 1,
        'chain_id': 12345,
        'faucet': {
            'short_name': 'tETH',
            'full_name': 'Test Chain',
            'rpc_url': 'http://127.0.0.1:9/<TEST_RPC_SECRET>',
            'chunk_size': 0.05,
        },
        'metamask': {
            'chain_name': 'Test Chain',
            'native_currency': {'name': 'Ethereum', 'symbol': 'tETH', 'decimals': 18},
            'rpc_urls': ['http://public.example/rpc'],
            'block_explorer_urls': ['http://explorer.example'],
        },
        'explorer': {'etherscan_api_url': 'http://scan.example/api'},
    },
}

ERC20_TEST_CONFIGS = {
    'TST': {
        'name': 'Test Token',
        'decimals': 18,
        'chunk_size': 4,
        'deployments': {
            'testchain': '0x' + '11' * 20,
            # deliberately unknown network — deployments_of must drop it
            'ghostchain': '0x' + '22' * 20,
        },
    },
}




############################################################
# make_utxo_faucet
############################################################
#
# A UTXOFaucet with the warmup patched out (no sockets are
# opened) and the throwaway key injected. Electrum clients
# exist but are never connected — patch their methods to feed
# a test (see fake_electrum below).
#
# Used by:
#   - test_utxo_engine.py
############################################################

def make_utxo_faucet(configs=None):
    with mock.patch.dict(os.environ, {'FAUCET_PRIVATE_KEY': TEST_PRIVATE_KEY}):
        with mock.patch.object(UTXOFaucet, '_warm_up_networks', lambda self: None):
            return UTXOFaucet(configs or UTXO_TEST_CONFIGS)




############################################################
# fake_electrum
############################################################
#
# Points one network's ElectrumClient at canned data:
# list_unspent returns the given UTXOs, request() captures a
# broadcast instead of sending it. Returns the capture dict —
# captured['raw'] holds the raw tx hex after a payout.
#
# Used by:
#   - test_utxo_engine.py
############################################################

def fake_electrum(faucet, network, utxos):
    captured = {}
    client = faucet._electrum_clients[network]
    client.list_unspent = lambda scripthash: [dict(u) for u in utxos]
    client.get_balance = lambda scripthash: {'confirmed': 1.0, 'unconfirmed': 0.0, 'total': 1.0}
    client.request = lambda method, params: captured.__setitem__('raw', params[0]) or 'txid-ok'
    return captured




############################################################
# make_evm_faucet
############################################################
#
# An EVMFaucet with the warmup patched out (Web3 objects are
# created but nothing is called over RPC) and throwaway
# env: the test key plus TEST_RPC_SECRET for the <NAME>
# template-substitution test.
#
# Used by:
#   - test_evm_faucet.py / test_erc20_faucet.py
############################################################

def make_evm_faucet(configs=None, private_key=TEST_PRIVATE_KEY):
    env = {'TEST_RPC_SECRET': 'sekretas-iš-env', 'FAUCET_PRIVATE_KEY': private_key}
    with mock.patch.dict(os.environ, env):
        with mock.patch.object(EVMFaucet, '_warm_up_networks', lambda self: None):
            return EVMFaucet(configs or EVM_TEST_CONFIGS, 'testchain')




############################################################
# make_erc20_faucet
############################################################
#
# An ERC20Faucet composed with a warmup-free EVMFaucet.
#
# Used by:
#   - test_erc20_faucet.py
############################################################

def make_erc20_faucet(evm_faucet=None, token_configs=None):
    evm = evm_faucet or make_evm_faucet()
    with mock.patch.object(ERC20Faucet, '_warm_up_tokens', lambda self: None):
        return ERC20Faucet(evm, token_configs or ERC20_TEST_CONFIGS)
