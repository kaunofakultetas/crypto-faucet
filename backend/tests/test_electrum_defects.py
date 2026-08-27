############################################################
#  [*] Electrum client — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up. Each test states the
#  behaviour the client SHOULD have and is marked
#  @unittest.expectedFailure because today it does not.
#  The moment a fix lands, unittest reports the test as an
#  "unexpected success" — which FAILS the run — and that is
#  the cue: drop the decorator and move the test into its
#  home file (test_electrum_client.py).
#
#  Rides on test_electrum_client.py's fake socket — no
#  server, no certificates, fully deterministic.
#
#  Reviewed and deliberately NOT pinned, because the vision
#  says otherwise: certificates are not verified (weighed —
#  see the electrum_client.py header); a broadcast whose
#  reply is lost releases the cooldown (accepted — see
#  app/cooldown.py); the UTXO fields the server returns are
#  trusted (our own server; an on-path peer is the accepted
#  TLS exposure, and the one dialect whose signature does
#  not commit to amounts is disabled); the reply loop has a
#  per-read timeout but no overall deadline (pinning one
#  needs a fake clock — the per-read timeout stands, and the
#  size cap below bounds the other half of that problem).
############################################################


import json
import socket
import unittest
from unittest.mock import patch

from app.utxo_faucet.electrum_client import ElectrumClient
from tests.test_electrum_client import FakeElectrumSocket, fake_transport, rpc_ok, HANDSHAKE




############################################################
# HandshakeLeakTests
############################################################
#
# _connect assigns the socket BEFORE the server.version
# handshake, and nothing unassigns it when the handshake
# fails — the class invariant "ssock set ⇒ session
# introduced" breaks. The handshake reply then arrives on
# the next read, so the next request (a balance, a UTXO
# list) is answered with the server's version string,
# silently, and every reply after it is one request behind.
# A failed handshake must leave no socket behind.
############################################################

class HandshakeLeakTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_a_failed_handshake_leaves_no_socket_behind(self):
        client = ElectrumClient('host:1')
        with fake_transport([[socket.timeout('timed out')]]):
            with self.assertRaises(OSError):
                client.connect()

        self.assertIsNone(client.ssock)

    @unittest.expectedFailure
    def test_the_request_after_a_failed_handshake_gets_a_real_answer(self):
        client = ElectrumClient('host:1')
        with fake_transport(
            [[socket.timeout('timed out')], HANDSHAKE],     # socket 1: the handshake reply arrives late, on the NEXT read
            [HANDSHAKE, rpc_ok([])],                         # socket 2: a clean session
        ):
            with self.assertRaises(OSError):
                client.connect()
            self.assertEqual(client.list_unspent('ff'), [])




############################################################
# ReplyMatchingTests
############################################################
#
# Every request goes out with the same id and the reply's
# id is never read, so a reply meant for another request —
# the queued handshake above, or anything left on a
# desynced stream — is accepted as the answer to whatever
# was asked. The one place a wrong answer can be attributed
# to a money-moving call. A reply that is not for THIS
# request must be treated as a broken stream (reconnect,
# retry once), never returned.
############################################################

class ReplyMatchingTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_a_reply_for_another_request_is_not_taken_as_the_answer(self):
        stale = (json.dumps({'jsonrpc': '2.0', 'id': 'someone-else', 'result': 'WRONG'}) + '\n').encode()
        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, stale], [HANDSHAKE, rpc_ok('RIGHT')]):
            self.assertEqual(client.request('m', []), 'RIGHT')




############################################################
# ResponseSizeTests
############################################################
#
# The reply loop appends chunks until a newline shows up,
# with no cap — a peer that streams newline-free bytes
# grows the backend's memory without bound, under the
# client lock. A reply must be abandoned once it is clearly
# not a JSON-RPC line any more.
############################################################

class DribblingSocket(FakeElectrumSocket):
    # Answers the handshake, then streams 1 MB of 'x' per read,
    # never a newline, up to LIMIT — then hangs up

    CHUNK = b'x' * (1024 * 1024)
    LIMIT = 40 * 1024 * 1024

    def __init__(self):
        super().__init__([HANDSHAKE])
        self.streamed = 0

    def sendall(self, data):
        if self.script:
            super().sendall(data)

    def recv(self, size):
        if self._chunks:
            return super().recv(size)
        if self.streamed >= self.LIMIT:
            return b''
        self.streamed += len(self.CHUNK)
        return self.CHUNK


class NoTlsContext:
    check_hostname = True
    verify_mode = None

    def wrap_socket(self, sock, server_hostname=None):
        return sock


class ResponseSizeTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_a_reply_that_never_ends_is_abandoned_within_a_bound(self):
        dribbler = DribblingSocket()
        sockets = [dribbler, FakeElectrumSocket([OSError('down')])]     # the retry's socket fails at once
        client = ElectrumClient('host:1')

        with patch('app.utxo_faucet.electrum_client.socket.create_connection',
                   lambda address, timeout=None: sockets.pop(0)):
            with patch('app.utxo_faucet.electrum_client.ssl.create_default_context', NoTlsContext):
                with self.assertRaises(Exception):
                    client.request('m', [])

        self.assertLessEqual(dribbler.streamed, 16 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
