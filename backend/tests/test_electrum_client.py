############################################################
#  [*] Electrum client regression tests
#
#  The protocol plumbing every UTXO payout rides on, tested
#  against a FAKE socket — no server, no certificates, fully
#  deterministic:
#
#    framing  — the handshake goes first, requests are
#               newline-delimited JSON, a reply split across
#               TCP chunks is reassembled, trailing bytes are
#               ignored
#    healing  — a dropped socket reconnects and retries ONCE;
#               a server-side error does NOT retry (the server
#               answered, asking again changes nothing)
#    queries  — the satoshi→coin conversion behind every
#               balance the pages show
#
#  The fake socket also records what was sent, so ordering
#  claims ("server.version must be the first message") are
#  asserted rather than assumed.
############################################################


import io
import json
import socket
import contextlib
import unittest
from unittest.mock import patch

from app.utxo_faucet.electrum_client import (
    ElectrumClient,
    ELECTRUM_CLIENT_NAME,
    ELECTRUM_PROTOCOL_VERSION,
)


def rpc_ok(result):
    # One well-formed newline-delimited Electrum reply
    return (json.dumps({'jsonrpc': '2.0', 'id': 1, 'result': result}) + '\n').encode()


def rpc_error(message):
    return (json.dumps({'jsonrpc': '2.0', 'id': 1, 'error': {'message': message}}) + '\n').encode()


HANDSHAKE = rpc_ok(['ElectrumX 2.0.0', '1.4'])




############################################################
# FakeElectrumSocket
############################################################
#
# Stands in for the SSL socket. Each script entry is the
# reply to the NEXT sendall — bytes, a list of byte chunks
# (to split one reply across recv calls), or an Exception to
# raise instead. Everything sent is recorded.
#
# Used by:
#   - fake_transport (below)
############################################################

class FakeElectrumSocket:

    def __init__(self, script):
        self.script = list(script)
        self.sent = []
        self.closed = False
        self._chunks = []

    def setsockopt(self, *args):
        pass

    def sendall(self, data):
        self.sent.append(data)
        reply = self.script.pop(0) if self.script else b''
        if isinstance(reply, Exception):
            raise reply
        self._chunks = list(reply) if isinstance(reply, list) else [reply]

    def recv(self, size):
        if not self._chunks:
            return b''
        chunk = self._chunks.pop(0)
        if isinstance(chunk, Exception):
            raise chunk
        return chunk

    def close(self):
        self.closed = True

    def requests(self):
        # The decoded JSON of everything this socket was asked to send
        return [json.loads(line.decode()) for line in self.sent]




############################################################
# fake_transport
############################################################
#
#   with fake_transport(script1, script2) as sockets:
#       ...
#
# Patches out socket creation and the TLS wrap: every
# connection attempt hands back the next scripted socket, and
# `sockets` collects them in order — so a test can assert HOW
# MANY connections were opened, which is what proves the
# retry-once rule.
#
# Used by:
#   - every test below
############################################################

def fake_transport(*scripts):
    import contextlib

    sockets = []

    def create_connection(address, timeout=None):
        script = scripts[len(sockets)] if len(sockets) < len(scripts) else []
        sock = FakeElectrumSocket(script)
        sockets.append(sock)
        return sock

    class FakeContext:
        check_hostname = True
        verify_mode = None

        def wrap_socket(self, sock, server_hostname=None):
            return sock

    @contextlib.contextmanager
    def patched():
        with patch('app.utxo_faucet.electrum_client.socket.create_connection', create_connection):
            with patch('app.utxo_faucet.electrum_client.ssl.create_default_context', FakeContext):
                yield sockets

    return patched()




############################################################
# ElectrumFramingTests
############################################################
#
# The wire format: what goes out, in what order, and how a
# reply is read back off the stream.
############################################################

class ElectrumFramingTests(unittest.TestCase):

    def test_endpoint_with_port_is_split(self):
        client = ElectrumClient('158.129.172.247:50002')
        self.assertEqual(client.host, '158.129.172.247')
        self.assertEqual(client.port, 50002)

    def test_bare_host_defaults_to_the_ssl_port(self):
        client = ElectrumClient('electrum.example')
        self.assertEqual(client.port, 50002)

    def test_handshake_is_the_first_message_on_the_wire(self):
        # Recent ElectrumX closes the session with "server.version
        # must be first msg" if anything else arrives first
        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, rpc_ok({'confirmed': 0})]) as sockets:
            client.request('blockchain.scripthash.get_balance', ['ff'])

        requests = sockets[0].requests()
        self.assertEqual(requests[0]['method'], 'server.version')
        self.assertEqual(requests[0]['params'], [ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION])
        self.assertEqual(requests[1]['method'], 'blockchain.scripthash.get_balance')

    def test_requests_are_newline_delimited_json(self):
        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, rpc_ok([])]) as sockets:
            client.request('blockchain.scripthash.listunspent', ['aa'])

        payload = sockets[0].sent[1]
        self.assertTrue(payload.endswith(b'\n'))
        self.assertEqual(payload.count(b'\n'), 1)
        self.assertEqual(json.loads(payload.decode())['params'], ['aa'])

    def test_reply_split_across_chunks_is_reassembled(self):
        # TCP does not respect message boundaries — a long listunspent
        # answer arrives in pieces
        body = rpc_ok([{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 12345}])
        chunks = [body[i:i + 7] for i in range(0, len(body), 7)]

        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, chunks]):
            result = client.request('blockchain.scripthash.listunspent', ['aa'])

        self.assertEqual(result[0]['value'], 12345)

    def test_bytes_after_the_newline_are_ignored(self):
        # Only the first line belongs to this request
        noisy = rpc_ok({'confirmed': 7}) + b'{"garbage": true}\n'

        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, noisy]):
            result = client.request('blockchain.scripthash.get_balance', ['ff'])

        self.assertEqual(result['confirmed'], 7)

    def test_debug_mode_prints_timings_without_changing_the_result(self):
        # APP_DEBUG makes the client print() a timing line per call —
        # captured here so a passing run stays quiet
        client = ElectrumClient('host:1', debug=True, label='btc4')
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            with fake_transport([HANDSHAKE, rpc_ok({'confirmed': 1})]):
                result = client.request('m', [])

        self.assertEqual(result['confirmed'], 1)
        self.assertIn("Electrum request 'm'", printed.getvalue())
        self.assertIn('btc4', printed.getvalue())




############################################################
# ElectrumHealingTests
############################################################
#
# The self-healing contract: one instance lives for the whole
# process, so it has to survive Electrum restarts and idle
# disconnects on its own.
############################################################

class ElectrumHealingTests(unittest.TestCase):

    def test_first_request_connects_lazily(self):
        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, rpc_ok({'confirmed': 0})]) as sockets:
            self.assertIsNone(client.ssock)
            client.request('m', [])
            self.assertEqual(len(sockets), 1)

    def test_connect_is_idempotent(self):
        # The startup warmup calls connect(); a later request must
        # reuse that same socket
        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, rpc_ok({'confirmed': 0})]) as sockets:
            client.connect()
            client.connect()
            client.request('m', [])
            self.assertEqual(len(sockets), 1)

    def test_dropped_socket_reconnects_and_retries_once(self):
        # The server closed the connection while idle: recv returns
        # nothing -> reconnect on a fresh socket and repeat the call
        client = ElectrumClient('host:1')
        with fake_transport(
            [HANDSHAKE, b''],                       # socket 1: dies on the real request
            [HANDSHAKE, rpc_ok({'confirmed': 500})],  # socket 2: answers
        ) as sockets:
            result = client.request('blockchain.scripthash.get_balance', ['ff'])

        self.assertEqual(result['confirmed'], 500)
        self.assertEqual(len(sockets), 2)
        self.assertTrue(sockets[0].closed)

    def test_socket_error_reconnects_and_retries_once(self):
        client = ElectrumClient('host:1')
        with fake_transport(
            [HANDSHAKE, OSError('connection reset')],
            [HANDSHAKE, rpc_ok({'confirmed': 1})],
        ) as sockets:
            result = client.request('m', [])

        self.assertEqual(result['confirmed'], 1)
        self.assertEqual(len(sockets), 2)

    def test_the_retry_happens_exactly_once(self):
        # A server that is simply down must fail, not loop
        client = ElectrumClient('host:1')
        with fake_transport(
            [HANDSHAKE, OSError('down')],
            [HANDSHAKE, OSError('still down')],
            [HANDSHAKE, rpc_ok({'confirmed': 1})],
        ) as sockets:
            with self.assertRaises(OSError):
                client.request('m', [])

        self.assertEqual(len(sockets), 2)

    def test_malformed_reply_reconnects_and_retries(self):
        # A reply with no 'result' means the framing desynced —
        # a fresh socket is the only cure
        client = ElectrumClient('host:1')
        with fake_transport(
            [HANDSHAKE, (json.dumps({'jsonrpc': '2.0', 'id': 1}) + '\n').encode()],
            [HANDSHAKE, rpc_ok({'confirmed': 2})],
        ) as sockets:
            result = client.request('m', [])

        self.assertEqual(result['confirmed'], 2)
        self.assertEqual(len(sockets), 2)

    def test_server_side_error_is_not_retried(self):
        # The server ANSWERED (bad scripthash, unknown method) —
        # reconnecting would only ask the same question again
        client = ElectrumClient('host:1')
        with fake_transport(
            [HANDSHAKE, rpc_error('scripthash is not a valid hex string')],
            [HANDSHAKE, rpc_ok({'confirmed': 1})],
        ) as sockets:
            with self.assertRaises(RuntimeError):
                client.request('m', [])

        self.assertEqual(len(sockets), 1)

    def test_a_healed_client_keeps_serving(self):
        # After a heal the NEW socket is the live one — the next
        # request must not open a third connection
        client = ElectrumClient('host:1')
        with fake_transport(
            [HANDSHAKE, b''],
            [HANDSHAKE, rpc_ok({'confirmed': 1}), rpc_ok({'confirmed': 2})],
        ) as sockets:
            client.request('m', [])
            second = client.request('m', [])

        self.assertEqual(second['confirmed'], 2)
        self.assertEqual(len(sockets), 2)

    def test_unconfigured_endpoint_raises(self):
        client = ElectrumClient('')
        with fake_transport():
            with self.assertRaises(ValueError):
                client.request('m', [])




############################################################
# ElectrumQueryTests
############################################################
#
# The two scripthash queries the faucet actually calls, and
# the satoshi→coin conversion behind every balance shown on
# the pages.
############################################################

class ElectrumQueryTests(unittest.TestCase):

    def balance_from(self, result):
        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, rpc_ok(result)]):
            return client.get_balance('ff' * 32)

    def test_satoshis_become_whole_coins(self):
        balance = self.balance_from({'confirmed': 150_000_000, 'unconfirmed': 50_000_000})

        self.assertEqual(balance['confirmed'], 1.5)
        self.assertEqual(balance['unconfirmed'], 0.5)
        self.assertEqual(balance['total'], 2.0)

    def test_missing_fields_read_as_zero(self):
        # An address the server has never seen answers with {}
        balance = self.balance_from({})

        self.assertEqual(balance, {'confirmed': 0.0, 'unconfirmed': 0.0, 'total': 0.0})

    def test_unconfirmed_can_be_negative(self):
        # Electrum reports outgoing unconfirmed spends as negative —
        # the total must reflect that, not ignore it
        balance = self.balance_from({'confirmed': 100_000_000, 'unconfirmed': -20_000_000})

        self.assertEqual(balance['total'], 0.8)

    def test_list_unspent_passes_the_scripthash_through(self):
        utxos = [{'tx_hash': 'aa' * 32, 'tx_pos': 1, 'value': 999}]

        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, rpc_ok(utxos)]) as sockets:
            result = client.list_unspent('cd' * 32)

        self.assertEqual(result, utxos)
        sent = sockets[0].requests()[1]
        self.assertEqual(sent['method'], 'blockchain.scripthash.listunspent')
        self.assertEqual(sent['params'], ['cd' * 32])





############################################################
# ElectrumSessionTests
############################################################
#
# The session invariants: a failed handshake leaves no socket
# behind (its late reply can never answer the next request),
# a reply carrying another id is a broken stream and never
# the answer, and a reply that never ends is abandoned within
# a bound instead of buffered without one.
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


class ElectrumSessionTests(unittest.TestCase):

    def test_a_failed_handshake_leaves_no_socket_behind(self):
        client = ElectrumClient('host:1')
        with fake_transport([[socket.timeout('timed out')]]) as sockets:
            with self.assertRaises(OSError):
                client.connect()

        self.assertIsNone(client.ssock)
        self.assertTrue(sockets[0].closed)

    def test_the_request_after_a_failed_handshake_gets_a_real_answer(self):
        client = ElectrumClient('host:1')
        with fake_transport(
            [[socket.timeout('timed out')], HANDSHAKE],     # socket 1: the handshake reply arrives late, on the NEXT read
            [HANDSHAKE, rpc_ok([])],                         # socket 2: a clean session
        ):
            with self.assertRaises(OSError):
                client.connect()
            self.assertEqual(client.list_unspent('ff'), [])

    def test_a_reply_for_another_request_is_not_taken_as_the_answer(self):
        stale = (json.dumps({'jsonrpc': '2.0', 'id': 'someone-else', 'result': 'WRONG'}) + '\n').encode()
        client = ElectrumClient('host:1')
        with fake_transport([HANDSHAKE, stale], [HANDSHAKE, rpc_ok('RIGHT')]) as sockets:
            self.assertEqual(client.request('m', []), 'RIGHT')
        self.assertEqual(len(sockets), 2)                    # the desynced session was dropped

    def test_a_reply_that_never_ends_is_abandoned_within_a_bound(self):
        dribbler = DribblingSocket()
        sockets = [dribbler, FakeElectrumSocket([OSError('down')])]     # the retry's socket fails at once
        client = ElectrumClient('host:1')

        class NoTls:
            check_hostname = True
            verify_mode = None

            def wrap_socket(self, sock, server_hostname=None):
                return sock

        with patch('app.utxo_faucet.electrum_client.socket.create_connection',
                   lambda address, timeout=None: sockets.pop(0)):
            with patch('app.utxo_faucet.electrum_client.ssl.create_default_context', NoTls):
                with self.assertRaises(Exception):
                    client.request('m', [])

        self.assertLessEqual(dribbler.streamed, 16 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
