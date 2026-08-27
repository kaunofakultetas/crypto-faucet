############################################################
#  [*] SVM faucet — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up. Each test states the
#  behaviour the faucet SHOULD have and — all but one, see
#  ClusterSanityTests — is marked @unittest.expectedFailure
#  because today it does not. The moment a fix lands,
#  unittest reports the test as an "unexpected success" —
#  which FAILS the run — and that is the cue: drop the
#  decorator and move the test into its home file
#  (test_svm_faucet.py).
#
#  Offline, on the flow tests' fakes (tests/helpers.py): a
#  real Ed25519 signature from a throwaway seed and a canned
#  RPC client.
#
#  Reviewed and deliberately NOT pinned, because the vision
#  says otherwise: the claim nonce is an ownership proof,
#  not a replay guard (accepted — see verify_signature); a
#  broadcast whose reply is lost releases the cooldown
#  (accepted — see app/cooldown.py); success is reported on
#  acceptance with no confirmation poll (fire-and-forget is
#  the house pattern in every family — the commitment
#  comment in rpc_client.py now says so).
############################################################


import logging
import unittest

import requests

from app.svm_faucet.rpc_client import SolanaRpcClient
from tests import helpers


# Several tests make the RPC fail ON PURPOSE. Silenced for this
# module only.
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


CHUNK_LAMPORTS = 500_000_000            # the test config's 0.5 SOL

# Solana's cluster genesis hashes — the one fact that tells the
# clusters apart over RPC
GENESIS = {
    'mainnet': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    'devnet': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    'testnet': '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
}




############################################################
# SvmClaimCase
############################################################
#
# The claim fixture of test_svm_faucet.py, repeated here so
# this file stays standalone.
#
# Used by:
#   - the test classes below
############################################################

class SvmClaimCase(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_svm_faucet()
        self.address, self.signature, self.nonce = helpers.sign_svm_claim()

    def fake(self, faucet_lamports=10_000_000_000, **kwargs):
        balances = {self.address: 0, self.faucet.FAUCET_ADDRESS: faucet_lamports}
        return helpers.fake_solana_rpc(self.faucet, 'testsvm', balances=balances, **kwargs)

    def claim(self):
        return self.faucet.request_sol('testsvm', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testsvm', self.address) in self.faucet.cooldowns._last_claim




############################################################
# ClusterSanityTests
############################################################
#
# The config names a cluster ('devnet') and the RPC URL
# decides which cluster the faucet actually pays on — and
# nothing ever checks the two agree. The EVM faucet has THE
# config-sanity gate for exactly this (_verify_chain_id:
# the frontend trusts the config, the faucet pays over the
# RPC, a mismatch means different chains); the SVM faucet
# prints "ready" against any cluster, since getVersion
# answers the same everywhere. A mismatched genesis hash
# must refuse the payout; a matching one must not get in
# the way (the plain test — it documents the devnet hash a
# fix has to compare against).
############################################################

class ClusterSanityTests(SvmClaimCase):

    def answering(self, genesis_hash):
        # The fake client's request() is what a getGenesisHash probe
        # would reach — every other RPC call is already canned
        client = self.fake()
        client.request = lambda method, params=None: genesis_hash
        return client

    @unittest.expectedFailure
    def test_an_rpc_on_another_cluster_is_refused(self):
        client = self.answering(GENESIS['testnet'])          # config says devnet

        data, status = self.claim()

        self.assertNotEqual(status, 200)
        self.assertEqual(client.sent, [])
        self.assertFalse(self.claimed())

    def test_an_rpc_on_the_configured_cluster_pays(self):
        client = self.answering(GENESIS['devnet'])

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(len(client.sent), 1)




############################################################
# ConnectTimeoutTests
############################################################
#
# The client retries once on requests.ConnectionError — the
# right cure for a pooled keep-alive the server dropped, but
# ConnectTimeout is a SUBCLASS of ConnectionError, so a
# black-holed host (a stopped exit container) burns the full
# timeout twice, inside the send lock and at boot. A host
# that never answered the handshake must not be dialled
# again. Same pin as the MOVE client's.
############################################################

class ConnectTimeoutTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_a_connect_timeout_is_not_retried(self):
        client = SolanaRpcClient('http://black.hole/rpc')
        attempts = []

        def post(url, json=None, timeout=None):
            attempts.append(1)
            raise requests.exceptions.ConnectTimeout('no answer')

        client.session.post = post

        with self.assertRaises(requests.exceptions.ConnectTimeout):
            client.request('getVersion')

        self.assertEqual(len(attempts), 1)




if __name__ == '__main__':
    unittest.main()
