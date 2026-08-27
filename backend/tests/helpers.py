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
import importlib
import requests
from unittest import mock

from app.utxo_faucet.utxo_faucet import UTXOFaucet
from app.evm_faucet.evm_faucet import EVMFaucet
from app.erc_faucet.erc20_faucet import ERC20Faucet
from app.svm_faucet.svm_faucet import SVMFaucet
from app.move_faucet.move_faucet import MoveFaucet
from app.svm_faucet.chains import solana as solana_chain


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

# p2wpkh addresses of TEST_PRIVATE_KEY / RECIPIENT_PRIVATE_KEY
# under Litecoin testnet's 'tltc' HRP — the live ltc4 network's
# dialect, distinct from Bitcoin's in HRP and base58 prefixes
ANCHOR_LTC_ADDRESS = 'tltc1qyvsy6ypssxmqmdzthzua3qwupkey90p3p9mzk0'
ANCHOR_LTC_RECIPIENT = 'tltc1qjvdp4aw57jzch2lfw0geews8cpqnzt2dk0uxcx'

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
    # The live Litecoin network — SegWit like btc4, but its own
    # HRP ('tltc') and base58 prefixes
    'ltc4': {
        'id': 2, 'short_name': 'tLTC4', 'full_name': 'Litecoin Testnet4',
        'faucet': {'coin': 'litecoin', 'network': 'testnet', 'chunk_size': 1000,
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

MOVE_TEST_CONFIGS = {
    'testmove': {
        'id': 1,
        'faucet': {
            'chain': 'sui',
            'network': 'testnet',
            'short_name': 'tSUI',
            'full_name': 'Test MOVE',
            'rpc_url': 'http://127.0.0.1:9/<TEST_RPC_SECRET>',
            'chunk_size': 0.5,
        },
        'wallet': {'rpc_urls': ['http://public.example/graphql']},
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

    # The cluster probe goes through request() itself, so a test can
    # answer it with another cluster's genesis by replacing request
    genesis = solana_chain.GENESIS_HASHES[faucet.NETWORK_CONFIGS[network]['faucet']['network']]

    def request(method, params=None):
        if method == 'getGenesisHash':
            return genesis
        raise RuntimeError(f'unexpected Solana RPC call {method}')

    client.get_balance = get_balance
    client.get_latest_blockhash = lambda: blockhash
    client.send_transaction = send_transaction
    client.get_version = lambda: '4.2.0'
    client.request = request
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
# make_move_faucet
############################################################
#
# A MoveFaucet with the warmup patched out (no GraphQL calls)
# and the throwaway key injected as the Ed25519 seed. The
# clients exist but are never called — patch their methods to
# feed a test (see fake_sui_graphql below).
#
# Used by:
#   - test_move_faucet.py
############################################################

def make_move_faucet(configs=None, private_key=TEST_PRIVATE_KEY):
    env = {'TEST_RPC_SECRET': 'sekretas-iš-env', 'FAUCET_PRIVATE_KEY': private_key}
    with mock.patch.dict(os.environ, env):
        with mock.patch.object(MoveFaucet, '_warm_up_networks', lambda self: None):
            return MoveFaucet(configs or MOVE_TEST_CONFIGS)




############################################################
# fake_sui_graphql
############################################################
#
#   client = fake_sui_graphql(faucet, 'testmove', balances={...})
#
# Points one network's GraphQL client at canned data: MIST
# balances keyed by address (absent reads as 0), a fixed
# node-built transaction, and execute() recording the
# broadcast instead of sending it. build_error /
# execute_error / balance_error drive the failure paths.
# Returns the client, so a test can assert on client.executed
# afterwards.
#
# Used by:
#   - test_move_faucet.py
############################################################

def fake_sui_graphql(faucet, network, balances=None, build_error=None, execute_error=None, balance_error=None):
    # What the node would answer from simulateTransaction — any
    # base64 payload works, the faucet only signs it
    built_tx = 'dGVzdC10cmFuc2FjdGlvbi1iY3M='
    client = faucet._clients[network]
    client.executed = []

    def get_balance(address, coin_type):
        if balance_error:
            raise RuntimeError(balance_error)
        return (balances or {}).get(address, 0)

    def build_transfer(sender, recipient_b64, amount_b64):
        if build_error:
            raise RuntimeError(build_error)
        client.built = {'sender': sender, 'recipient': recipient_b64, 'amount': amount_b64}
        return built_tx

    def execute(tx_bcs, signature):
        if execute_error:
            raise RuntimeError(execute_error)
        client.executed.append({'tx_bcs': tx_bcs, 'signature': signature})
        return 'digest' + '1' * 38

    client.get_balance = get_balance
    client.build_transfer = build_transfer
    client.execute = execute
    client.get_chain_identifier = lambda: 'testchain-id'
    return client




############################################################
# sign_move_claim
############################################################
#
#   address, signature, nonce = sign_move_claim()
#
# A REAL Sui personal-message signature over the exact
# message the MOVE faucet verifies: Ed25519 over blake2b-256
# of intent (3,0,0) + the BCS-encoded message, serialized as
# base64 of flag || sig || pubkey — the scheme was confirmed
# against the node's own verifySignature. Signing with a
# different key than the claimed address is how the 403 path
# is tested (pass signer_seed).
#
# Used by:
#   - test_move_faucet.py
############################################################

def sign_move_claim(nonce='1785666345742', address_seed=None, signer_seed=None):
    import base64
    import hashlib
    from solders.keypair import Keypair

    address_kp = Keypair.from_seed(address_seed or bytes(range(32)))
    signer_kp = Keypair.from_seed(signer_seed) if signer_seed else address_kp

    address = '0x' + hashlib.blake2b(
        bytes([0]) + bytes(address_kp.pubkey()), digest_size=32).hexdigest()

    message = CLAIM_MESSAGE.format(nonce=nonce).encode('utf-8')
    payload = bytes([3, 0, 0]) + bytes([len(message)]) + message
    digest = hashlib.blake2b(payload, digest_size=32).digest()
    signature = base64.b64encode(
        bytes([0]) + bytes(signer_kp.sign_message(digest)) + bytes(signer_kp.pubkey())).decode()

    return address, signature, nonce




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
# _as_exception
############################################################
#
# The fakes' *_error knobs take either a string — raised as
# a RuntimeError with that text, the node REJECTING the call
# — or an exception instance, raised as-is: how a typed
# failure such as web3's ContractLogicError is staged.
#
# Used by:
#   - FakeEth, FakeErc20Contract — every *_error raise
############################################################

def _as_exception(error):
    if isinstance(error, BaseException):
        return error
    return RuntimeError(error)




############################################################
# FakeEth
############################################################
#
# Stands in for w3.eth: the handful of calls a payout makes
# are canned, EVERYTHING else (notably .account, which does
# the real signature recovery) delegates to the genuine
# module — so tests exercise real crypto and only the network
# is faked. broadcast_error makes the send raise, which is
# how the release-the-cooldown paths are tested (see
# _as_exception for what the *_error knobs accept). chain_id
# answers the payout path's config-sanity gate — the test
# config's id by default, anything else to test the refusal.
#
# Used by:
#   - fake_web3 (below)
############################################################

class FakeEth:

    def __init__(self, real_eth, balances, gas_price=1, chain_id=12345, broadcast_error=None, balance_error=None):
        self._real = real_eth
        self._balances = balances
        self.gas_price = gas_price
        self.chain_id = chain_id
        self.broadcast_error = broadcast_error
        self.balance_error = balance_error
        self.sent = []

    def __getattr__(self, name):
        return getattr(self._real, name)

    def get_balance(self, address, *args, **kwargs):
        if self.balance_error:
            raise _as_exception(self.balance_error)
        return self._balances.get(address.lower(), 0)

    def send_transaction(self, tx):
        if self.broadcast_error:
            raise _as_exception(self.broadcast_error)
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
                    raise _as_exception(contract.balance_error)
                return contract._balances.get(address.lower(), 0)

        return Call()

    def transfer(self, to_address, amount):
        contract = self

        class Transfer:
            def estimate_gas(self, tx):
                if contract.estimate_error:
                    raise _as_exception(contract.estimate_error)
                return 60000

            def transact(self, tx):
                if contract.transfer_error:
                    raise _as_exception(contract.transfer_error)
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








############################################################
# UnreachableEth / unreachable_web3
############################################################
#
# w3.eth on a network whose RPC can't be reached: the
# chain-id probe raises like a transport failure and counts
# how many times it was asked — the pin for "local checks
# never cost a round-trip". Installed by unreachable_web3.
#
# Used by:
#   - test_request_flows.py — the local-checks-first tests
#   - test_evm_defects.py — RpcFailuresAreRememberedTests
############################################################

class UnreachableEth(FakeEth):

    probes = 0

    @property
    def chain_id(self):
        self.probes += 1
        raise requests.ConnectionError('rpc unreachable')

    @chain_id.setter
    def chain_id(self, value):
        pass


def unreachable_web3(faucet, network, balances=None):
    w3 = faucet.w3_instances[network]
    eth = UnreachableEth(w3.eth, {k.lower(): v for k, v in (balances or {}).items()})
    w3.eth = eth
    return eth








############################################################
# LockWatchingEth / lock_watching_web3
############################################################
#
# w3.eth that notes whether the network's send lock was HELD
# at the moment eth_gasPrice was asked for — None until the
# quote happens, then True/False. The pin for "the price
# quote never holds the chain's payouts".
#
# Used by:
#   - test_request_flows.py — the gas-quote tests
############################################################

class LockWatchingEth(FakeEth):

    def __init__(self, real_eth, balances, lock, **kwargs):
        self.lock = lock
        self.quoted_under_lock = None
        super().__init__(real_eth, balances, **kwargs)

    @property
    def gas_price(self):
        self.quoted_under_lock = self.lock.locked()
        return 1

    @gas_price.setter
    def gas_price(self, value):
        pass


def lock_watching_web3(faucet, network, balances=None):
    w3 = faucet.w3_instances[network]
    eth = LockWatchingEth(w3.eth, {k.lower(): v for k, v in (balances or {}).items()}, faucet.send_lock_for(network))
    w3.eth = eth
    return eth








############################################################
# import_main
############################################################
#
#   main = helpers.import_main(db_path)
#
# main wires the WHOLE app at import — every faucet is built
# (warmups patched out here, so nothing touches a network),
# the schema and demo chain go into db_path, and the real
# config's <PLACEHOLDERS> resolve against dummy values when
# the environment has none. Reloads on every call, so each
# test gets a fresh app object.
#
# Used by:
#   - test_main.py
############################################################

def import_main(db_path):
    from app.database.db import get_db_connection

    env = {'INFURA_PROJECT_ID': 'test-infura', 'ETHERSCAN_API_KEY': 'test-etherscan',
           'FAUCET_PRIVATE_KEY': TEST_PRIVATE_KEY}
    patches = [
        mock.patch.dict(os.environ, {k: v for k, v in env.items() if not os.getenv(k)}),
        mock.patch.object(EVMFaucet, '_warm_up_networks', lambda self: None),
        mock.patch.object(ERC20Faucet, '_warm_up_tokens', lambda self: None),
        mock.patch.object(UTXOFaucet, '_warm_up_networks', lambda self: None),
        mock.patch.object(SVMFaucet, '_warm_up_networks', lambda self: None),
        mock.patch.object(MoveFaucet, '_warm_up_networks', lambda self: None),
        mock.patch('app.database.db_init.get_db_connection', side_effect=lambda: get_db_connection(db_path)),
    ]
    for active in patches:
        active.start()
    try:
        import main
        return importlib.reload(main)
    finally:
        for active in patches:
            active.stop()








############################################################
# FollowingElectrum
############################################################
#
#   server = FollowingElectrum(faucet, 'btc4', utxos)
#
# A canned Electrum server whose UTXO set FOLLOWS the payouts:
# a broadcast removes the inputs it spends and adds the change
# output it creates, like the real server after a refresh — for
# tests that run several payouts in a row and look at what the
# wallet has become.
#
# Used by:
#   - test_utxo_engine.py — the consolidation tests
############################################################

class FollowingElectrum:

    def __init__(self, faucet, network, utxos):
        from embit.transaction import Transaction
        self._Transaction = Transaction
        self.utxos = [dict(u) for u in utxos]
        self.faucet_script = faucet._setup_wallet_for_network(network).script_pubkey.data
        client = faucet._electrum_clients[network]
        client.list_unspent = lambda scripthash: [dict(u) for u in self.utxos]
        client.get_balance = lambda scripthash: {'confirmed': 1.0, 'unconfirmed': 0.0, 'total': 1.0}
        client.request = self.broadcast

    def broadcast(self, method, params):
        tx = self._Transaction.from_string(params[0])
        spent = {(vin.txid[::-1].hex(), vin.vout) for vin in tx.vin}
        self.utxos = [u for u in self.utxos if (u['tx_hash'], u['tx_pos']) not in spent]
        for pos, out in enumerate(tx.vout):
            if out.script_pubkey.data == self.faucet_script:
                self.utxos.append({'tx_hash': tx.txid().hex(), 'tx_pos': pos, 'value': out.value})
        return tx.txid().hex()
