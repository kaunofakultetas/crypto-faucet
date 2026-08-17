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
from app.svm_faucet.svm_faucet import SVMFaucet


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

# Legacy (p2pkh, base58) anchors for the doge3 test network:
# TEST_PRIVATE_KEY / RECIPIENT_PRIVATE_KEY under Dogecoin's
# testnet P2PKH version byte 0x71.
ANCHOR_DOGE_ADDRESS = 'nXPtcJMdE3WEj63KpzXpm2zUsmXgCGqEeA'
ANCHOR_DOGE_RECIPIENT = 'nhbxsJJws6k39TiDyS12kkbjSvYZG4T4kH'

# Doge-scale UTXOs/amount (koinu) — the doge3 test config's fee
# rate and dust limit are ~100x the Bitcoin-style anchors above
ANCHOR_DOGE_UTXOS = [
    {'tx_hash': '33' * 32, 'tx_pos': 0, 'value': 6_000_000_000},
    {'tx_hash': '44' * 32, 'tx_pos': 1, 'value': 1_000_000_000},
]
ANCHOR_DOGE_AMOUNT_SAT = 5_000_000_000  # 50 tDOGE


# ---- Minimal test configs -----------------------------------

UTXO_TEST_CONFIGS = {
    'knf': {
        'id': 1, 'short_name': 'KNF', 'full_name': 'KNF Coin',
        'faucet': {'coin': 'knfcoin', 'network': 'mainnet', 'chunk_size': 1000,
                   'electrum_server': '127.0.0.1:9999'},
    },
    'btc4': {
        'id': 4, 'short_name': 'tBTC4', 'full_name': 'Bitcoin Testnet4',
        'faucet': {'coin': 'bitcoin', 'network': 'testnet', 'chunk_size': 0.01,
                   'electrum_server': '127.0.0.1:9999'},
    },
    # Legacy (pre-SegWit) dialect — the coin registry supplies the
    # base58 version bytes and doge-scale fee/dust
    'doge3': {
        'id': 5, 'short_name': 'tDOGE3', 'full_name': 'Dogecoin Testnet3',
        'faucet': {'coin': 'dogecoin', 'network': 'testnet', 'chunk_size': 50,
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

SVM_TEST_CONFIGS = {
    'testsvm': {
        'id': 1,
        'faucet': {
            'chain': 'solana',
            'network': 'devnet',
            'short_name': 'devSOL',
            'full_name': 'Test SVM',
            'rpc_url': 'http://127.0.0.1:9/<TEST_RPC_SECRET>',
            'chunk_size': 0.5,
        },
        'wallet': {'rpc_urls': ['http://public.example/rpc']},
        'explorer': {'block_explorer_urls': ['http://explorer.example']},
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
            return EVMFaucet(configs or EVM_TEST_CONFIGS)




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




############################################################
# make_svm_faucet
############################################################
#
# An SVMFaucet with the warmup patched out (no RPC calls) and
# the throwaway key injected as the Ed25519 seed. The RPC
# clients exist but are never called — patch their methods to
# feed a test (see fake_solana_rpc below).
#
# Used by:
#   - test_svm_faucet.py
############################################################

def make_svm_faucet(configs=None, private_key=TEST_PRIVATE_KEY):
    env = {'TEST_RPC_SECRET': 'sekretas-iš-env', 'FAUCET_PRIVATE_KEY': private_key}
    with mock.patch.dict(os.environ, env):
        with mock.patch.object(SVMFaucet, '_warm_up_networks', lambda self: None):
            return SVMFaucet(configs or SVM_TEST_CONFIGS)




############################################################
# fake_solana_rpc
############################################################
#
#   client = fake_solana_rpc(faucet, 'testsvm', balances={...})
#
# Points one network's RPC client at canned data: balances
# keyed by base58 address (absent reads as 0), a fixed
# blockhash, and send_transaction recording the broadcast
# instead of sending it. broadcast_error / balance_error
# drive the failure paths. Returns the client, so a test can
# assert on client.sent afterwards.
#
# Used by:
#   - test_svm_faucet.py
############################################################

def fake_solana_rpc(faucet, network, balances=None, broadcast_error=None, balance_error=None):
    # A valid base58 32-byte hash — Hash.from_string must parse it
    blockhash = '11111111111111111111111111111111'
    client = faucet._clients[network]
    client.sent = []

    def get_balance(address):
        if balance_error:
            raise RuntimeError(balance_error)
        return (balances or {}).get(str(address), 0)

    def send_transaction(signed_base64):
        if broadcast_error:
            raise RuntimeError(broadcast_error)
        client.sent.append(signed_base64)
        return 'sig' + '1' * 85

    client.get_balance = get_balance
    client.get_latest_blockhash = lambda: blockhash
    client.send_transaction = send_transaction
    client.get_version = lambda: '4.2.0'
    return client




############################################################
# sign_svm_claim
############################################################
#
#   address, signature, nonce = sign_svm_claim()
#
# A REAL Ed25519 signature over the exact message the SVM
# faucet verifies — the same wording the EVM flow uses.
# Signing with a different key than the claimed address is
# how the 403 path is tested (pass signer_seed).
#
# Used by:
#   - test_svm_faucet.py
############################################################

def sign_svm_claim(nonce='1785666345742', address_seed=None, signer_seed=None):
    from solders.keypair import Keypair

    address_kp = Keypair.from_seed(address_seed or bytes(range(32)))
    signer_kp = Keypair.from_seed(signer_seed) if signer_seed else address_kp

    message = CLAIM_MESSAGE.format(nonce=nonce)
    signature = signer_kp.sign_message(message.encode('utf-8'))

    return str(address_kp.pubkey()), str(signature), nonce




############################################################
# sign_claim
############################################################
#
#   address, signature, nonce = sign_claim()
#
# A REAL signature over the exact message the faucets verify
# — same wording as useWallet.js. Signing with a different
# key than the claimed address is how the 403 path is tested
# (pass signer_key).
#
# Used by:
#   - test_request_flows.py — every EVM / ERC-20 claim
############################################################

CLAIM_MESSAGE = 'Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}'


def sign_claim(nonce='1785666345742', address_key=RECIPIENT_PRIVATE_KEY, signer_key=None):
    from eth_account import Account
    from eth_account.messages import encode_defunct

    address = Account.from_key(bytes.fromhex(address_key)).address
    signer = Account.from_key(bytes.fromhex(signer_key or address_key))
    signature = signer.sign_message(encode_defunct(text=CLAIM_MESSAGE.format(nonce=nonce))).signature.hex()

    return address, signature, nonce




############################################################
# FakeEth
############################################################
#
# Stands in for w3.eth: the handful of calls a payout makes
# are canned, EVERYTHING else (notably .account, which does
# the real signature recovery) delegates to the genuine
# module — so tests exercise real crypto and only the network
# is faked. broadcast_error makes the send raise, which is
# how the release-the-cooldown paths are tested.
#
# Used by:
#   - fake_web3 (below)
############################################################

class FakeEth:

    def __init__(self, real_eth, balances, gas_price=1, broadcast_error=None, balance_error=None):
        self._real = real_eth
        self._balances = balances
        self.gas_price = gas_price
        self.broadcast_error = broadcast_error
        self.balance_error = balance_error
        self.sent = []

    def __getattr__(self, name):
        return getattr(self._real, name)

    def get_balance(self, address, *args, **kwargs):
        if self.balance_error:
            raise RuntimeError(self.balance_error)
        return self._balances.get(address.lower(), 0)

    def send_transaction(self, tx):
        if self.broadcast_error:
            raise RuntimeError(self.broadcast_error)
        self.sent.append(tx)
        return bytes.fromhex('ab' * 32)




############################################################
# fake_web3
############################################################
#
#   eth = fake_web3(faucet, 'testchain', balances={addr: wei})
#
# Swaps one network's w3.eth for a FakeEth and returns it, so
# a test can assert on eth.sent afterwards. Balance keys are
# lowercased addresses; anything absent reads as 0.
#
# Used by:
#   - test_request_flows.py — the EVM and ERC-20 flows
############################################################

def fake_web3(faucet, network, balances=None, **kwargs):
    w3 = faucet.w3_instances[network]
    eth = FakeEth(w3.eth, {k.lower(): v for k, v in (balances or {}).items()}, **kwargs)
    w3.eth = eth
    return eth




############################################################
# FakeErc20Contract
############################################################
#
# Stands in for the token contract: balanceOf reads a canned
# map, transfer records the call and returns a tx hash.
# transfer_error / estimate_error drive the failure paths
# (the engine falls back to a fixed gas limit when the
# estimate raises).
#
# Used by:
#   - fake_token_contract (below)
############################################################

class FakeErc20Contract:

    def __init__(self, balances, transfer_error=None, estimate_error=None, balance_error=None):
        self._balances = balances
        self.transfer_error = transfer_error
        self.estimate_error = estimate_error
        self.balance_error = balance_error
        self.transfers = []
        self.functions = self

    def balanceOf(self, address):
        contract = self

        class Call:
            def call(self):
                if contract.balance_error:
                    raise RuntimeError(contract.balance_error)
                return contract._balances.get(address.lower(), 0)

        return Call()

    def transfer(self, to_address, amount):
        contract = self

        class Transfer:
            def estimate_gas(self, tx):
                if contract.estimate_error:
                    raise RuntimeError(contract.estimate_error)
                return 60000

            def transact(self, tx):
                if contract.transfer_error:
                    raise RuntimeError(contract.transfer_error)
                contract.transfers.append((to_address, amount, tx))
                return bytes.fromhex('cd' * 32)

        return Transfer()




############################################################
# fake_token_contract
############################################################
#
#   with fake_token_contract(balances={...}) as contract:
#       faucet.request_tokens(...)
#
# Patches the module-level get_erc20_contract the ERC-20
# faucet calls, so every token read/write in the block hits
# the fake. Yields the contract for assertions.
#
# Used by:
#   - test_request_flows.py — the ERC-20 flows
############################################################

def fake_token_contract(balances=None, **kwargs):
    import contextlib

    contract = FakeErc20Contract({k.lower(): v for k, v in (balances or {}).items()}, **kwargs)

    @contextlib.contextmanager
    def patched():
        with mock.patch('app.erc_faucet.erc20_faucet.get_erc20_contract', return_value=contract):
            yield contract

    return patched()
