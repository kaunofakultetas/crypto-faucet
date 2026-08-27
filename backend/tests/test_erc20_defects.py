############################################################
#  [*] ERC-20 faucet — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up. Each test states the
#  behaviour the faucet SHOULD have and is marked
#  @unittest.expectedFailure because today it does not.
#  The moment a fix lands, unittest reports the test as an
#  "unexpected success" — which FAILS the run — and that is
#  the cue: drop the decorator and move the test into its
#  home file (test_request_flows.py).
#
#  Offline, on the flow tests' fakes (tests/helpers.py): a
#  real signature from a throwaway key, a canned w3.eth and
#  a canned token contract.
#
#  Reviewed and deliberately NOT pinned, because the vision
#  says otherwise: a broadcast is reported as success on
#  mempool acceptance with no receipt wait (fire-and-forget
#  is the house pattern in every family); no in-memory
#  ledger of in-flight token payouts (honouring the
#  estimate-gas revert below catches the over-commit case
#  the node can see, and the rest self-heals after one
#  cooldown); legacy gasPrice quoted once with no bump (see
#  the STEP 4 banner of request_tokens); the wallet's native
#  balance read per poll (deliberate — see get_token); the
#  cooldown claimed after the balance reads (a repeat claim
#  costing two reads is fine, the gate order is pinned by
#  test_request_flows.py); signature freshness (accepted —
#  see EVMFaucet.verify_signature).
############################################################


import logging
import unittest

from web3.exceptions import ContractLogicError

from tests import helpers


# The transfer is made to fail ON PURPOSE and the faucet logs
# that with logging.exception. Silenced for this module only.
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


ENOUGH_GAS = 30_000_000_000_000_000        # 0.03 ETH > the 0.025 threshold




############################################################
# LockWatchingEth
############################################################
#
# w3.eth that notes whether the network's send lock was HELD
# at the moment eth_gasPrice was asked for. None until the
# quote happens, then True/False.
#
# Used by:
#   - GasQuoteUnderLockTests
############################################################

class LockWatchingEth(helpers.FakeEth):

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




############################################################
# Erc20ClaimCase
############################################################
#
# The ERC-20 claim fixture of test_request_flows.py, repeated
# here so this file stays standalone.
#
# Used by:
#   - the test classes below
############################################################

class Erc20ClaimCase(unittest.TestCase):

    def setUp(self):
        self.evm = helpers.make_evm_faucet()
        self.faucet = helpers.make_erc20_faucet(evm_faucet=self.evm)
        self.address, self.signature, self.nonce = helpers.sign_claim()
        self.TOKENS = {self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}

    def fake(self, **kwargs):
        return helpers.fake_web3(
            self.evm, 'testchain',
            balances={self.address: ENOUGH_GAS, self.evm.FAUCET_ADDRESS: 10 ** 20},
            **kwargs,
        )

    def claim(self):
        return self.faucet.request_tokens('testchain', 'TST', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testchain', 'TST', self.address.lower()) in self.faucet.cooldowns._last_claim




############################################################
# EstimateRevertTests
############################################################
#
# estimate_gas is not a lookup: the node EXECUTES the
# transfer against current state, and a ContractLogicError
# is it saying the transfer fails (faucet drained by an
# unmined payout, a non-standard token, a wrong contract
# address). The bare fallback to a fixed gas limit throws
# that verdict away and broadcasts anyway — the student is
# told "sent", the transfer reverts on chain, gas is burnt.
# A revert must refuse the payout and release the slot; an
# estimator that merely can't estimate (zkSync-style chains)
# must keep falling back, as test_request_flows.py pins.
############################################################

class EstimateRevertTests(Erc20ClaimCase):

    @unittest.expectedFailure
    def test_a_transfer_the_node_says_reverts_is_not_broadcast(self):
        self.fake()
        with helpers.fake_token_contract(self.TOKENS, estimate_error=ContractLogicError('execution reverted')) as contract:
            data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())




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

class GasQuoteUnderLockTests(Erc20ClaimCase):

    @unittest.expectedFailure
    def test_gas_price_is_quoted_outside_the_send_lock(self):
        w3 = self.evm.w3_instances['testchain']
        eth = LockWatchingEth(w3.eth, {self.address.lower(): ENOUGH_GAS}, self.evm.send_lock_for('testchain'))
        w3.eth = eth

        with helpers.fake_token_contract(self.TOKENS):
            data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertIs(eth.quoted_under_lock, False)


if __name__ == '__main__':
    unittest.main()
