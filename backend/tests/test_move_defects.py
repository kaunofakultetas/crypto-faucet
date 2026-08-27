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
#  home file (test_sui_graphql_client.py).
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


import logging
import unittest

import requests

from app.move_faucet.graphql_client import SuiGraphqlClient
from tests import helpers


# The claim flow's failure paths log tracebacks on purpose
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)




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




if __name__ == '__main__':
    unittest.main()
