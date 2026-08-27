############################################################
#  [*] MOVE faucet — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up. Each test states the
#  behaviour the faucet SHOULD have and is marked
#  @unittest.expectedFailure because today it does not.
#  The moment a fix lands, unittest reports the test as an
#  "unexpected success" — which FAILS the run — and that is
#  the cue: drop the decorator and move the test into its
#  home file (test_move_faucet.py, test_config_models.py,
#  test_sui_graphql_client.py).
#
#  Offline, on the flow tests' fakes (tests/helpers.py): a
#  real Ed25519 personal-message signature from a throwaway
#  seed and a canned GraphQL client.
#
#  Reviewed and deliberately NOT pinned, because the vision
#  says otherwise: the node-built transaction bytes are
#  signed uninspected (accepted for testnet coin against
#  Mysten's own node — see _sign_transaction and
#  chains/sui.py); the claim nonce is an ownership proof,
#  not a replay guard (accepted — see verify_signature); an
#  execute whose reply is lost releases the cooldown
#  (accepted — see app/cooldown.py); the cooldown is claimed
#  after the recipient's balance read, and the faucet's
#  balance is read outside the send lock (a double-click or
#  a lost race costs one round-trip and a self-correcting
#  message — not worth reordering pinned gates).
############################################################


import copy
import base64
import logging
import unittest

import requests

from app.config_models import validate_configs
from app.move_faucet.graphql_client import SuiGraphqlClient
from tests import helpers


# The claim flow's failure paths log tracebacks on purpose
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)




############################################################
# MoveClaimCase
############################################################
#
# The claim fixture of test_move_faucet.py, repeated here so
# this file stays standalone.
#
# Used by:
#   - WalletSchemeTests
############################################################

class MoveClaimCase(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_move_faucet()
        self.address, self.signature, self.nonce = helpers.sign_move_claim()

    def fake(self, **kwargs):
        balances = {self.address: 0, self.faucet.FAUCET_ADDRESS: 10_000_000_000}
        return helpers.fake_sui_graphql(self.faucet, 'testmove', balances=balances, **kwargs)




############################################################
# WalletSchemeTests
############################################################
#
# verify_signature accepts flag-0 Ed25519 signatures only.
# A Slush account created with Google sign-in is zkLogin
# (flag 5), a hardware or multisig account is flag 1-3 or 6
# — all of them sign happily in the wallet and are then told
# "the signature somehow doesn't match", which points the
# student at the signature, not at the account type, and no
# retry will ever succeed. At minimum the refusal must NAME
# the unsupported wallet type as a 400; better, delegate
# non-Ed25519 flags to the node's own verifySignature (then
# the fake client needs that method and this pin becomes
# "accepted").
############################################################

class WalletSchemeTests(MoveClaimCase):

    @unittest.expectedFailure
    def test_a_non_ed25519_signature_is_named_not_called_a_mismatch(self):
        self.fake()
        zklogin = base64.b64encode(bytes([5]) + b'\x00' * 200).decode()      # flag 5: zkLogin

        data, status = self.faucet.request_move('testmove', self.address, zklogin, self.nonce)

        self.assertEqual(status, 400)
        self.assertNotIn('neatitinka', data['error'])




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
# again.
############################################################

class ConnectTimeoutTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_a_connect_timeout_is_not_retried(self):
        client = SuiGraphqlClient('http://black.hole/graphql')
        attempts = []

        def post(url, json=None, timeout=None):
            attempts.append(1)
            raise requests.exceptions.ConnectTimeout('no answer')

        client.session.post = post

        with self.assertRaises(requests.exceptions.ConnectTimeout):
            client.request('{ chainIdentifier }')

        self.assertEqual(len(attempts), 1)




############################################################
# ChunkConversionTests
############################################################
#
# chunk_size is a float and int(float * 10**9) TRUNCATES:
# 1.001 becomes 1 000 999 999 MIST while the page advertises
# 1.001. And nothing bounds the result — a chunk below one
# MIST floors to 0, and "wallet holds >= 0" is always true,
# so every student is told their wallet already has enough.
# Convert exactly; refuse an unpayable chunk at boot, as the
# SVM schema does.
############################################################

class ChunkConversionTests(unittest.TestCase):

    def move(self, chunk_size):
        configs = copy.deepcopy(helpers.MOVE_TEST_CONFIGS)
        configs['testmove']['faucet']['chunk_size'] = chunk_size
        return configs

    @unittest.expectedFailure
    def test_chunk_size_converts_to_mist_exactly(self):
        faucet = helpers.make_move_faucet(self.move(1.001))
        self.assertEqual(faucet._chunk_mist('testmove'), 1_001_000_000)

    @unittest.expectedFailure
    def test_a_chunk_below_one_mist_fails_the_boot(self):
        with self.assertRaises(ValueError):
            validate_configs({}, {}, {}, {}, self.move(5e-10))




############################################################
# PlaceholderTests
############################################################
#
# <NAME> placeholders in rpc_url resolve from the environment
# with '' as the default, so a variable the operator forgot
# (or docker-compose does not forward) yields 'https:///…',
# which boots green, warms up with one buried traceback,
# lists the network and 500s every claim. An unresolvable
# placeholder is an operator error: fail the boot, loudly.
############################################################

class PlaceholderTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_an_unset_placeholder_fails_the_boot(self):
        configs = copy.deepcopy(helpers.MOVE_TEST_CONFIGS)
        configs['testmove']['faucet']['rpc_url'] = 'https://<NOT_SET_ANYWHERE>/graphql'

        with self.assertRaises(ValueError):
            helpers.make_move_faucet(configs)


if __name__ == '__main__':
    unittest.main()
