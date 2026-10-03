############################################################
#  [*] API route tests — the answers the faucet pages read
#
#  The faucet pages see the backend only through its HTTP
#  answers, and they hold those answers to a strict shape: a
#  faucet balance without its address, balance or claim size
#  is a failed read that keeps the claim button greyed out,
#  and a payout answer without its transaction id is shown to
#  the student as a failed claim although the coins went out.
#  The other test files call the faucet classes directly, so
#  a route reading the wrong query parameter, or an answer
#  field renamed on its way out, would pass all of them.
#
#  These tests send real requests through the whole Flask
#  app, for every faucet family, and pin what the pages read:
#  the field names and their types, balances converted from
#  the chain's smallest unit into whole coins, the next poll
#  answered from the balance cache, payout ids in the form
#  the block explorers link, and the network the navbar opens
#  first.
#
#  The app comes from helpers.import_main, so no warmup runs
#  and the real key is never loaded. Each test then swaps the
#  route modules' faucet instances for test-config ones whose
#  chain access is faked by the same fakes the claim-flow
#  tests use; the claim signatures are real.
############################################################


import os
import sys
import copy
import logging
import tempfile
import unittest
from unittest import mock

import requests
from embit import ec as embit_ec
from embit import script as embit_script

from tests import helpers


# The failing-read tests make the faucets log a traceback ON
# PURPOSE — silenced for this module, so a passing run reads
# clean
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)








############################################################
# RouteTestCase
############################################################
#
# What every test here shares: one app per test class, since
# building it is the slow part, a way to swap a route
# module's faucet instance for a test one, and a way to count
# the calls a fake receives. The route modules are taken from
# sys.modules, where import_main left them — importing one
# directly would build live faucets.
#
# Used by:
#   - every test class in this file
############################################################

class RouteTestCase(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        handle, cls.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        cls.client = helpers.import_main(cls.db_path).app.test_client()

    @classmethod
    def tearDownClass(cls):
        os.unlink(cls.db_path)

    def serve(self, module_name, attribute, faucet):
        # The route functions read the module attribute on every
        # request, so swapping it reroutes them all
        patcher = mock.patch.object(sys.modules[module_name], attribute, faucet)
        patcher.start()
        self.addCleanup(patcher.stop)

    def get(self, path, **params):
        response = self.client.get(path, query_string=params)
        return response.status_code, response.get_json()

    def count_calls(self, owner, name):
        # Wraps owner.<name> so every call is noted before it runs
        calls = []
        original = getattr(owner, name)

        def counting(*args, **kwargs):
            calls.append(args)
            return original(*args, **kwargs)

        setattr(owner, name, counting)
        return calls








############################################################
# EvmRouteTests
############################################################
#
# The native EVM faucet on the test chain, which pays 0.05
# tETH per claim and holds 1.5 tETH here.
############################################################

class EvmRouteTests(RouteTestCase):

    FAUCET_WEI = 1_500_000_000_000_000_000

    def setUp(self):
        self.faucet = helpers.make_evm_faucet()
        self.serve('app.evm_faucet.evm_routes', 'evm_faucet', self.faucet)
        self.address, self.signature, self.nonce = helpers.sign_claim()
        self.eth = helpers.fake_web3(self.faucet, 'testchain', balances={
            self.address: 0,
            self.faucet.FAUCET_ADDRESS: self.FAUCET_WEI,
        })

    def test_the_networks_answer_is_the_catalog_unchanged(self):
        # The page finds its network, chain id and explorer here
        status, body = self.get('/api/evm/networks')

        self.assertEqual(status, 200)
        self.assertEqual(body, self.faucet.get_networks())

    def test_the_balance_answer_carries_what_the_page_shows(self):
        # The address feeds the return QR code; the balance and the
        # claim size are whole coins
        status, body = self.get('/api/evm/testchain/faucet-balance')

        self.assertEqual(status, 200)
        self.assertEqual(body['address'], self.faucet.FAUCET_ADDRESS.lower())
        self.assertEqual(body['balance'], 1.5)
        self.assertEqual(body['chunk_size'], 0.05)

    def test_the_next_poll_is_answered_from_the_cache(self):
        # Every open page polls every few seconds — one RPC read
        # serves them all until the cache expires
        reads = self.count_calls(self.eth, 'get_balance')

        first = self.get('/api/evm/testchain/faucet-balance')
        second = self.get('/api/evm/testchain/faucet-balance')

        self.assertEqual(second, first)
        self.assertEqual(len(reads), 1)

    def test_a_failed_balance_read_says_why(self):
        # The page shows this sentence where the numbers would stand
        self.eth.balance_error = requests.ReadTimeout('read timed out')
        status, body = self.get('/api/evm/testchain/faucet-balance')

        self.assertEqual(status, 500)
        self.assertEqual(body, {'error': 'Nepavyko gauti čiaupo balanso: tinklo RPC serveris neatsakė per 10 s.'})

    def test_a_claim_answers_with_the_hash_in_its_0x_form(self):
        # The form MetaMask shows and the page links to the block
        # explorer; the three query parameters reach the claim
        status, body = self.get('/api/evm/testchain/request',
                                address=self.address, signature=self.signature, nonce=self.nonce)

        self.assertEqual(status, 200, body)
        self.assertEqual(body['transaction_hash'], '0x' + 'ab' * 32)
        self.assertEqual(body['amount'], 0.05)
        self.assertEqual(len(self.eth.sent), 1)








############################################################
# Erc20RouteTests
############################################################
#
# The TST token on the test chain: 4 TST per claim, 100 TST
# in the faucet, and a student holding 0.03 tETH for gas —
# above the 0.025 threshold.
############################################################

class Erc20RouteTests(RouteTestCase):

    STUDENT_WEI = 30_000_000_000_000_000

    def setUp(self):
        self.evm = helpers.make_evm_faucet()
        self.faucet = helpers.make_erc20_faucet(evm_faucet=self.evm)
        self.serve('app.erc_faucet.erc20_routes', 'erc20_faucet', self.faucet)
        self.address, self.signature, self.nonce = helpers.sign_claim()
        self.eth = helpers.fake_web3(self.evm, 'testchain', balances={
            self.address: self.STUDENT_WEI,
            self.evm.FAUCET_ADDRESS: 10 ** 20,
        })
        self.contract = self.enterContext(helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}))

    def test_the_token_answer_carries_what_the_page_shows(self):
        # One card per chain the token is deployed on — the config's
        # unknown ghostchain left out — with the faucet's balance in
        # whole tokens and the explorer the payout links to
        status, body = self.get('/api/erc20/token/TST')

        self.assertEqual(status, 200)
        self.assertEqual(body['token']['symbol'], 'TST')
        self.assertEqual(body['token']['chunk_size'], 4.0)
        self.assertEqual(body['faucet_address'], self.evm.FAUCET_ADDRESS.lower())
        self.assertEqual([deployment['network'] for deployment in body['deployments']], ['testchain'])
        self.assertEqual(body['deployments'][0]['balance'], 100.0)
        self.assertIsNone(body['deployments'][0]['balance_error'])
        self.assertEqual(body['deployments'][0]['block_explorer_urls'], ['http://explorer.example'])

    def test_a_faucet_balance_that_cannot_be_read_says_why(self):
        # The card shows a dash, and this sentence under it
        self.contract.balance_errors = {self.evm.FAUCET_ADDRESS.lower(): requests.ReadTimeout('read timed out')}
        status, body = self.get('/api/erc20/token/TST')

        self.assertEqual(status, 200)
        self.assertIsNone(body['deployments'][0]['balance'])
        self.assertEqual(body['deployments'][0]['balance_error'],
                         'Nepavyko gauti čiaupo TST balanso: tinklo RPC serveris neatsakė per 10 s.')

    def test_a_connected_wallet_gets_its_gas_balance_in_wei(self):
        # The gas gate's two inputs, as strings of digits — amounts
        # in wei outgrow a JavaScript number
        status, body = self.get('/api/erc20/token/TST', address=self.address)

        deployment = body['deployments'][0]
        self.assertEqual(deployment['wallet_native_wei'], str(self.STUDENT_WEI))
        self.assertIsNone(deployment['wallet_native_error'])
        self.assertEqual(deployment['min_native_wei'], '25000000000000000')

    def test_a_gas_balance_that_cannot_be_read_says_why(self):
        # The gas check then cannot run — the page says so instead
        # of silently letting the claim through
        self.eth.balance_errors = {self.address.lower(): requests.ConnectionError('refused')}
        status, body = self.get('/api/erc20/token/TST', address=self.address)

        deployment = body['deployments'][0]
        self.assertIsNone(deployment['wallet_native_wei'])
        self.assertEqual(deployment['wallet_native_error'], 'Nepavyko patikrinti jūsų piniginės balanso tinklo mokesčiams: '
                                                            'nepavyko prisijungti prie tinklo RPC serverio.')

    def test_the_next_poll_is_answered_from_the_cache(self):
        reads = self.count_calls(self.contract, 'balanceOf')

        first = self.get('/api/erc20/token/TST')
        second = self.get('/api/erc20/token/TST')

        self.assertEqual(second, first)
        self.assertEqual(len(reads), 1)

    def test_a_claim_answers_with_the_hash_in_its_0x_form(self):
        status, body = self.get('/api/erc20/testchain/TST/request',
                                address=self.address, signature=self.signature, nonce=self.nonce)

        self.assertEqual(status, 200, body)
        self.assertEqual(body['transaction_hash'], '0x' + 'cd' * 32)
        self.assertEqual(body['amount'], 4.0)
        self.assertEqual(len(self.contract.transfers), 1)








############################################################
# SvmRouteTests
############################################################
#
# The Solana faucet on the test network: 0.5 SOL per claim,
# 2.5 SOL in the faucet, balances read in lamports.
############################################################

class SvmRouteTests(RouteTestCase):

    FAUCET_LAMPORTS = 2_500_000_000

    def setUp(self):
        self.faucet = helpers.make_svm_faucet()
        self.serve('app.svm_faucet.svm_routes', 'svm_faucet', self.faucet)
        self.address, self.signature, self.nonce = helpers.sign_svm_claim()
        self.rpc = helpers.fake_solana_rpc(self.faucet, 'testsvm', balances={
            self.faucet.FAUCET_ADDRESS: self.FAUCET_LAMPORTS,
        })

    def test_the_networks_answer_is_the_catalog_unchanged(self):
        status, body = self.get('/api/svm/networks')

        self.assertEqual(status, 200)
        self.assertEqual(body, self.faucet.get_networks())

    def test_the_balance_answer_carries_what_the_page_shows(self):
        status, body = self.get('/api/svm/testsvm/faucet-balance')

        self.assertEqual(status, 200)
        self.assertEqual(body['address'], self.faucet.FAUCET_ADDRESS)
        self.assertEqual(body['balance'], 2.5)
        self.assertEqual(body['chunk_size'], 0.5)

    def test_the_next_poll_is_answered_from_the_cache(self):
        reads = self.count_calls(self.rpc, 'get_balance')

        first = self.get('/api/svm/testsvm/faucet-balance')
        second = self.get('/api/svm/testsvm/faucet-balance')

        self.assertEqual(second, first)
        self.assertEqual(len(reads), 1)

    def test_a_failed_balance_read_says_why(self):
        helpers.fake_solana_rpc(self.faucet, 'testsvm', balance_error=requests.ConnectionError('refused'))
        status, body = self.get('/api/svm/testsvm/faucet-balance')

        self.assertEqual(status, 500)
        self.assertEqual(body, {'error': 'Nepavyko gauti čiaupo balanso: nepavyko prisijungti prie tinklo RPC serverio.'})

    def test_a_claim_answers_with_the_transaction_signature(self):
        status, body = self.get('/api/svm/testsvm/request',
                                address=self.address, signature=self.signature, nonce=self.nonce)

        self.assertEqual(status, 200, body)
        self.assertEqual(body['transaction_id'], 'sig' + '1' * 85)
        self.assertEqual(body['amount'], 0.5)
        self.assertEqual(len(self.rpc.sent), 1)








############################################################
# MoveRouteTests
############################################################
#
# The Sui faucet on the test network: 0.5 SUI per claim,
# 2.5 SUI in the faucet, balances read in MIST.
############################################################

class MoveRouteTests(RouteTestCase):

    FAUCET_MIST = 2_500_000_000

    def setUp(self):
        self.faucet = helpers.make_move_faucet()
        self.serve('app.move_faucet.move_routes', 'move_faucet', self.faucet)
        self.address, self.signature, self.nonce = helpers.sign_move_claim()
        self.graphql = helpers.fake_sui_graphql(self.faucet, 'testmove', balances={
            self.faucet.FAUCET_ADDRESS: self.FAUCET_MIST,
        })

    def test_the_networks_answer_is_the_catalog_unchanged(self):
        status, body = self.get('/api/move/networks')

        self.assertEqual(status, 200)
        self.assertEqual(body, self.faucet.get_networks())

    def test_the_balance_answer_carries_what_the_page_shows(self):
        status, body = self.get('/api/move/testmove/faucet-balance')

        self.assertEqual(status, 200)
        self.assertEqual(body['address'], self.faucet.FAUCET_ADDRESS)
        self.assertEqual(body['balance'], 2.5)
        self.assertEqual(body['chunk_size'], 0.5)

    def test_the_next_poll_is_answered_from_the_cache(self):
        reads = self.count_calls(self.graphql, 'get_balance')

        first = self.get('/api/move/testmove/faucet-balance')
        second = self.get('/api/move/testmove/faucet-balance')

        self.assertEqual(second, first)
        self.assertEqual(len(reads), 1)

    def test_a_failed_balance_read_says_why(self):
        helpers.fake_sui_graphql(self.faucet, 'testmove', balance_error=requests.ReadTimeout('read timed out'))
        status, body = self.get('/api/move/testmove/faucet-balance')

        self.assertEqual(status, 500)
        self.assertEqual(body, {'error': 'Nepavyko gauti čiaupo balanso: Sui GraphQL serveris neatsakė per 20 s.'})

    def test_a_claim_answers_with_the_transaction_digest(self):
        status, body = self.get('/api/move/testmove/request',
                                address=self.address, signature=self.signature, nonce=self.nonce)

        self.assertEqual(status, 200, body)
        self.assertEqual(body['transaction_id'], 'digest' + '1' * 38)
        self.assertEqual(body['amount'], 0.5)
        self.assertEqual(len(self.graphql.executed), 1)








############################################################
# UtxoRouteTests
############################################################
#
# The UTXO faucet on btc4: 0.01 tBTC per claim, paid by
# address alone — this family asks for no signature.
############################################################

class UtxoRouteTests(RouteTestCase):

    def setUp(self):
        self.faucet = helpers.make_utxo_faucet()
        self.serve('app.utxo_faucet.utxo_routes', 'utxo_faucet', self.faucet)
        self.captured = helpers.fake_electrum(self.faucet, 'btc4', [{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 2_000_000}])
        self.electrum = self.faucet._electrum_clients['btc4']
        self.electrum.get_balance = lambda scripthash: {'confirmed': 1.0, 'unconfirmed': 0.25, 'total': 1.25}

        prv = embit_ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
        self.recipient = embit_script.p2wpkh(prv.get_public_key()).address({'bech32': 'tb'})

    def test_the_networks_answer_is_the_catalog_unchanged(self):
        status, body = self.get('/api/utxo/networks')

        self.assertEqual(status, 200)
        self.assertEqual(body, self.faucet.get_networks())

    def test_the_balance_answer_carries_what_the_page_shows(self):
        # The balance counts the unconfirmed coins too, so a payout's
        # change shows up at once
        status, body = self.get('/api/utxo/btc4/faucet-balance')

        self.assertEqual(status, 200)
        self.assertEqual(body['address'], self.faucet._setup_wallet_for_network('btc4').address)
        self.assertEqual(body['balance'], 1.25)
        self.assertEqual(body['chunk_size'], 0.01)

    def test_the_next_poll_is_answered_from_the_cache(self):
        reads = self.count_calls(self.electrum, 'get_balance')

        first = self.get('/api/utxo/btc4/faucet-balance')
        second = self.get('/api/utxo/btc4/faucet-balance')

        self.assertEqual(second, first)
        self.assertEqual(len(reads), 1)

    def test_a_failed_balance_read_says_why(self):
        def down(scripthash):
            raise ConnectionRefusedError(111, 'Connection refused')

        self.electrum.get_balance = down
        status, body = self.get('/api/utxo/btc4/faucet-balance')

        self.assertEqual(status, 500)
        self.assertEqual(body, {'error': 'Nepavyko gauti čiaupo balanso: nepavyko prisijungti prie Electrum serverio.'})

    def test_a_claim_answers_with_the_transaction_id(self):
        status, body = self.get('/api/utxo/btc4/request-btc', address=self.recipient)

        self.assertEqual(status, 200, body)
        self.assertEqual(body['transaction_id'], 'txid-ok')
        self.assertEqual(body['amount'], 0.01)
        self.assertIn('raw', self.captured)








############################################################
# CatalogRouteTests
############################################################
#
# The navbar's one request: every family's networks in one
# answer, each with the network the navbar opens first — the
# family's preferred network when the operator configured
# it, otherwise the one with the lowest picker id. The test
# configs give each preferred network a HIGHER id than the
# test network beside it, so only the preference can pick it.
############################################################

class CatalogRouteTests(RouteTestCase):

    PREFERRED = {'evm': 'sepolia', 'utxo': 'btc4', 'svm': 'solanaDevnet', 'move': 'suiTestnet'}

    def build(self, with_preferred):
        evm_configs = copy.deepcopy(helpers.EVM_TEST_CONFIGS)
        svm_configs = copy.deepcopy(helpers.SVM_TEST_CONFIGS)
        move_configs = copy.deepcopy(helpers.MOVE_TEST_CONFIGS)
        utxo_configs = copy.deepcopy(helpers.UTXO_TEST_CONFIGS)
        if with_preferred:
            evm_configs['sepolia'] = dict(copy.deepcopy(evm_configs['testchain']), id=2)
            svm_configs['solanaDevnet'] = dict(copy.deepcopy(svm_configs['testsvm']), id=2)
            move_configs['suiTestnet'] = dict(copy.deepcopy(move_configs['testmove']), id=2)
        else:
            del utxo_configs['btc4']

        evm = helpers.make_evm_faucet(evm_configs)
        faucets = {
            'evm_faucet': evm,
            'erc20_faucet': helpers.make_erc20_faucet(evm_faucet=evm),
            'svm_faucet': helpers.make_svm_faucet(svm_configs),
            'move_faucet': helpers.make_move_faucet(move_configs),
            'utxo_faucet': helpers.make_utxo_faucet(utxo_configs),
        }
        for attribute, faucet in faucets.items():
            self.serve('app.faucet_catalog.catalog_routes', attribute, faucet)

        status, body = self.get('/api/faucet/catalog')
        self.assertEqual(status, 200)
        return body

    def test_every_family_is_in_the_catalog(self):
        body = self.build(with_preferred=True)

        self.assertEqual(sorted(body), ['erc20', 'evm', 'move', 'svm', 'utxo'])
        self.assertEqual(body['erc20']['default_token'], 'TST')

    def test_the_preferred_network_opens_first_when_configured(self):
        body = self.build(with_preferred=True)

        for family, network in self.PREFERRED.items():
            self.assertEqual(body[family]['default_network'], network, family)

    def test_without_it_the_lowest_picker_id_opens_first(self):
        # The test configs hold no sepolia, solanaDevnet or
        # suiTestnet, and btc4 is removed here
        body = self.build(with_preferred=False)

        self.assertEqual(body['evm']['default_network'], 'testchain')
        self.assertEqual(body['utxo']['default_network'], 'knf')
        self.assertEqual(body['svm']['default_network'], 'testsvm')
        self.assertEqual(body['move']['default_network'], 'testmove')

    def test_each_utxo_network_shows_its_own_claim_size(self):
        # The UTXO page's "you will receive" line reads it here
        body = self.build(with_preferred=True)

        networks = body['utxo']['networks']
        self.assertEqual(networks['btc4']['chunk_size'], 0.01)
        self.assertEqual(networks['knf']['chunk_size'], 1000.0)


if __name__ == '__main__':
    unittest.main()
