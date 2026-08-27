############################################################
#  [*] EVM faucet — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up. Each test states the
#  behaviour the faucet SHOULD have and is marked
#  @unittest.expectedFailure because today it does not.
#  The moment a fix lands, unittest reports the test as an
#  "unexpected success" — which FAILS the run — and that is
#  the cue: drop the decorator and move the test into its
#  home file (test_request_flows.py, test_explorer.py).
#
#  Everything is offline, on the same fakes as the flow tests
#  (tests/helpers.py): real signatures from throwaway keys, a
#  canned w3.eth, a throwaway SQLite file for the explorer.
#
#  Reviewed and deliberately NOT pinned, because the vision
#  says otherwise: aggregate outflow is unbounded (a lab
#  faucet paying testnet coin — accepted); a timed-out
#  broadcast releases the cooldown (see app/cooldown.py); the
#  claim nonce is an ownership proof, not a replay guard
#  (accepted); legacy gasPrice with no fee headroom (fee
#  dynamics, not offline-testable); the warmup blocking the
#  constructor (it IS the boot report, by design).
############################################################


import os
import copy
import logging
import tempfile
import unittest
from unittest.mock import patch

import requests

from tests import helpers
from app.database.db import get_db_connection
from app.evm_faucet.explorer import EtherscanExplorer


# Most of these make the transport fail ON PURPOSE and the
# faucet logs that with logging.exception. Silenced for this
# module only; SecretInLogsTests re-enables logging, since the
# log output IS what it checks.
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


FAUCET = '0x' + 'fa' * 20




############################################################
# UnreachableEth
############################################################
#
# w3.eth on a network whose RPC can't be reached: the
# chain-id probe raises like a transport failure and counts
# how many times it was asked. Installed by unreachable_web3.
#
# Used by:
#   - RpcFailuresAreRememberedTests
#   - LocalChecksFirstTests
############################################################

class UnreachableEth(helpers.FakeEth):

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
# EvmClaimCase / Erc20ClaimCase
############################################################
#
# The claim fixtures of test_request_flows.py, repeated here
# so this file stays standalone: a warmup-free faucet, one
# signed claim from the throwaway recipient key, and the
# fake/claim/claimed shorthands.
#
# Used by:
#   - GasReservationTests, TokenFaucetGasTests,
#     GasQuoteUnderLockTests
############################################################

class EvmClaimCase(unittest.TestCase):

    CHUNK_WEI = 50_000_000_000_000_000     # 0.05 ETH

    def setUp(self):
        self.faucet = helpers.make_evm_faucet()
        self.address, self.signature, self.nonce = helpers.sign_claim()

    def fake(self, user_balance=0, faucet_balance=10 ** 20, **kwargs):
        return helpers.fake_web3(
            self.faucet, 'testchain',
            balances={self.address: user_balance, self.faucet.FAUCET_ADDRESS: faucet_balance},
            **kwargs,
        )

    def claim(self):
        return self.faucet.request_eth('testchain', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testchain', self.address.lower()) in self.faucet.cooldowns._last_claim


class Erc20ClaimCase(unittest.TestCase):

    ENOUGH_GAS = 30_000_000_000_000_000    # 0.03 ETH > the 0.025 threshold
    TOKENS = {FAUCET: 100 * 10 ** 18}

    def setUp(self):
        self.evm = helpers.make_evm_faucet()
        self.faucet = helpers.make_erc20_faucet(evm_faucet=self.evm)
        self.address, self.signature, self.nonce = helpers.sign_claim()
        self.TOKENS = {self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}

    def fake(self, faucet_native_balance=0, **kwargs):
        return helpers.fake_web3(
            self.evm, 'testchain',
            balances={self.address: self.ENOUGH_GAS, self.evm.FAUCET_ADDRESS: faucet_native_balance},
            **kwargs,
        )

    def claim(self):
        return self.faucet.request_tokens('testchain', 'TST', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testchain', 'TST', self.address.lower()) in self.faucet.cooldowns._last_claim




############################################################
# GasReservationTests
############################################################
#
# the "faucet is empty" gate compares the wallet
# against the chunk alone, but the node reserves
# value + gas_limit * gasPrice up front. A wallet inside that
# window passes the gate, is rejected by the node and bounces
# as a retryable 500 forever — the "tell the lecturer" 503 is
# never reached. The ERC-20 faucet checks only the TOKEN
# balance, so a gasless wallet "sends" tokens it can't
# broadcast.
############################################################

class GasReservationTests(EvmClaimCase):

    GAS_PRICE = 20_000_000_000                 # 20 gwei
    RESERVATION = 210_000 * GAS_PRICE          # what the node holds back for the gas limit

    @unittest.expectedFailure
    def test_wallet_that_cannot_cover_value_plus_gas_is_503(self):
        # One wei short of chunk + reservation: "faucet empty", not a
        # broadcast that the node bounces
        eth = self.fake(faucet_balance=self.CHUNK_WEI + self.RESERVATION - 1, gas_price=self.GAS_PRICE)
        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertEqual(eth.sent, [])
        self.assertFalse(self.claimed())


class TokenFaucetGasTests(Erc20ClaimCase):

    @unittest.expectedFailure
    def test_token_payout_from_a_gasless_faucet_wallet_is_503(self):
        # No native coin on the faucet wallet — transfer() can't be
        # paid for, so the answer is "faucet empty", not a 200
        self.fake(faucet_native_balance=0)
        with helpers.fake_token_contract(self.TOKENS) as contract:
            data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())




############################################################
# AddressNameTests
############################################################
#
# set_address_name accepts any non-empty string as
# the address and any length as the name, and upserts both
# into the shared Graph_Addresses table every viewer reads.
# Same throwaway-SQLite fixture as test_explorer.py.
############################################################

class AddressNameTests(unittest.TestCase):

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        with get_db_connection(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE Graph_Addresses (
                    address TEXT NULL, name TEXT NULL,
                    is_contract INTEGER NULL, is_hub INTEGER NULL,
                    UNIQUE (address)
                )
            ''')
        self.db_patch = patch(
            'app.evm_faucet.explorer.get_db_connection',
            side_effect=lambda: get_db_connection(self.db_path),
        )
        self.db_patch.start()
        self.explorer = EtherscanExplorer(
            {'testchain': {'chain_id': 12345, 'explorer': {'etherscan_api_url': 'http://etherscan.invalid/api'}}},
            trusted_addresses=[FAUCET],
        )

    def tearDown(self):
        self.db_patch.stop()
        os.unlink(self.db_path)

    def row_count(self):
        with get_db_connection(self.db_path) as conn:
            return conn.execute('SELECT COUNT(*) FROM Graph_Addresses').fetchone()[0]

    def stored_name(self, address):
        with get_db_connection(self.db_path) as conn:
            row = conn.execute('SELECT name FROM Graph_Addresses WHERE address = ?', [address.lower()]).fetchone()
        return row[0] if row else None

    @unittest.expectedFailure
    def test_a_non_address_is_400_and_stores_nothing(self):
        data, status = self.explorer.set_address_name('not-an-address', 'graffiti')

        self.assertEqual(status, 400)
        self.assertEqual(self.row_count(), 0)

    @unittest.expectedFailure
    def test_an_overlong_name_is_not_stored_verbatim(self):
        # 4 KB of URL is not a label — refuse it or cut it, never keep it
        name = 'x' * 4096
        self.explorer.set_address_name(FAUCET, name)
        self.assertNotEqual(self.stored_name(FAUCET), name)




############################################################
# SecretInLogsTests
############################################################
#
# the <NAME> placeholders in faucet.rpc_url resolve
# from the environment so the config never holds the Infura
# key — but requests puts the FULL resolved URL into its
# exception text, and logging.exception prints that
# traceback. The resolved value must never reach the log,
# whatever it looks like (so a scrub keyed on the resolved
# placeholder values, not on Infura's /v3/<hex> shape).
############################################################

class SecretInLogsTests(unittest.TestCase):

    SECRET = 'sekretas-iš-env'                 # what helpers.make_evm_faucet puts in TEST_RPC_SECRET

    @unittest.expectedFailure
    def test_transport_error_traceback_is_scrubbed(self):
        faucet = helpers.make_evm_faucet()
        helpers.fake_web3(
            faucet, 'testchain',
            balance_error=f"HTTPConnectionPool(host='127.0.0.1', port=9): Max retries exceeded with url: /{self.SECRET}",
        )

        logging.disable(logging.NOTSET)
        try:
            with self.assertLogs(level='ERROR') as captured:
                faucet.get_faucet_balance('testchain')
        finally:
            logging.disable(logging.CRITICAL)

        self.assertNotIn(self.SECRET, '\n'.join(captured.output))




############################################################
# RpcFailuresAreRememberedTests
############################################################
#
# only SUCCESSFUL RPC answers are cached. During an
# outage every 3-second poll from every open tab, and every
# claim, repeats the full round-trip (10 s timeout each,
# one Werkzeug thread parked per call) instead of answering
# from the remembered failure.
############################################################

class RpcFailuresAreRememberedTests(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_evm_faucet()

    @unittest.expectedFailure
    def test_failed_balance_read_is_not_retried_on_the_next_poll(self):
        eth = helpers.fake_web3(self.faucet, 'testchain', balance_error='rpc down')
        reads = []
        real_get_balance = eth.get_balance
        eth.get_balance = lambda *args, **kwargs: (reads.append(1), real_get_balance(*args, **kwargs))[1]

        self.faucet.get_faucet_balance('testchain')
        self.faucet.get_faucet_balance('testchain')

        self.assertEqual(len(reads), 1)

    @unittest.expectedFailure
    def test_unreachable_chain_id_probe_is_not_repeated_per_claim(self):
        eth = unreachable_web3(self.faucet, 'testchain')
        address, signature, nonce = helpers.sign_claim()

        self.faucet.request_eth('testchain', address, signature, nonce)
        self.faucet.request_eth('testchain', address, signature, nonce)

        self.assertEqual(eth.probes, 1)




############################################################
# LocalChecksFirstTests
############################################################
#
# The chain-id probe runs before the free local
# checks, so on an unverified network a request with no
# usable parameters at all still costs an RPC round-trip.
# Parameter presence and address parsing come first; the
# probe is only paid for by a request that could pay out.
############################################################

class LocalChecksFirstTests(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_evm_faucet()
        self.eth = unreachable_web3(self.faucet, 'testchain')
        self.address, self.signature, self.nonce = helpers.sign_claim()

    @unittest.expectedFailure
    def test_missing_parameters_are_400_without_touching_the_rpc(self):
        data, status = self.faucet.request_eth('testchain', self.address, '', self.nonce)

        self.assertEqual(status, 400)
        self.assertEqual(self.eth.probes, 0)

    @unittest.expectedFailure
    def test_bad_address_is_400_without_touching_the_rpc(self):
        data, status = self.faucet.request_eth('testchain', 'not-an-address', self.signature, self.nonce)

        self.assertEqual(status, 400)
        self.assertEqual(self.eth.probes, 0)

    @unittest.expectedFailure
    def test_token_claim_with_missing_parameters_is_400_without_touching_the_rpc(self):
        erc20 = helpers.make_erc20_faucet(evm_faucet=self.faucet)
        data, status = erc20.request_tokens('testchain', 'TST', self.address, '', self.nonce)

        self.assertEqual(status, 400)
        self.assertEqual(self.eth.probes, 0)




############################################################
# GasQuoteUnderLockTests
############################################################
#
# The eth_gasPrice round-trip is evaluated inside the send
# lock — the lock native and token payouts on a chain share
# to take turns at the pending nonce. A price quote needs no
# such protection, and on a slow provider it holds the whole
# chain's payouts for up to the 10 s RPC timeout. Quote it
# first, lock only for nonce + broadcast.
############################################################

class LockWatchingEth(helpers.FakeEth):

    def __init__(self, real_eth, balances, lock, **kwargs):
        self.lock = lock
        self.quoted_under_lock = None       # None until asked, then True/False
        super().__init__(real_eth, balances, **kwargs)

    @property
    def gas_price(self):
        self.quoted_under_lock = self.lock.locked()
        return 1

    @gas_price.setter
    def gas_price(self, value):
        pass


class GasQuoteUnderLockTests(EvmClaimCase):

    @unittest.expectedFailure
    def test_gas_price_is_quoted_outside_the_send_lock(self):
        w3 = self.faucet.w3_instances['testchain']
        balances = {self.address.lower(): 0, self.faucet.FAUCET_ADDRESS.lower(): 10 ** 20}
        eth = LockWatchingEth(w3.eth, balances, self.faucet.send_lock_for('testchain'))
        w3.eth = eth

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertIs(eth.quoted_under_lock, False)




############################################################
# PlaceholderTests
############################################################
#
# <NAME> placeholders in rpc_url resolve from the environment
# with '' as the default, so a variable the operator forgot
# yields 'https:///…', which boots green and fails every
# claim. An unresolvable placeholder is an operator error:
# fail the boot, loudly. Same pin as the MOVE faucet's.
############################################################

class PlaceholderTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_an_unset_placeholder_fails_the_boot(self):
        configs = copy.deepcopy(helpers.EVM_TEST_CONFIGS)
        configs['testchain']['faucet']['rpc_url'] = 'https://<NOT_SET_ANYWHERE>/rpc'

        with self.assertRaises(ValueError):
            helpers.make_evm_faucet(configs)


if __name__ == '__main__':
    unittest.main()
