############################################################
#  [*] Electrum watcher tests
#
#  Offline checks of ElectrumWatcher — the subscription
#  connection that tells the UTXO graph when a watched
#  address changes: every scripthash subscribed once, a
#  pushed notification reported as a change, first sight NOT
#  reported, a reconnect resubscribing and reporting only what
#  changed while away, a ping on a quiet session, a failing
#  handler never stopping the thread, and too many
#  subscriptions starting over with the newest.
#
#  The server is the test itself, on the other end of a
#  socketpair the watcher's opener hands out (no TLS, no
#  network); the timings are shrunk so the watcher's thread
#  answers within milliseconds.
############################################################


import json
import queue
import socket
import logging
import unittest
from unittest.mock import patch

from app.utxo_faucet import electrum_watcher as watcher_module
from app.utxo_faucet.electrum_watcher import ElectrumWatcher


# A dropped connection is logged ON PURPOSE by the watcher —
# silenced for this module, so a passing run reads clean
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)








############################################################
# FakeServer
############################################################
#
# The test's end of one connection: reads the watcher's
# requests line by line, answers them, pushes notifications.
#
# Used by:
#   - Connections, WatcherTests (below)
############################################################

class FakeServer:

    def __init__(self, sock):
        self.sock = sock
        self.sock.settimeout(5)
        self.buffer = b''

    def request(self):
        while b'\n' not in self.buffer:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError('the watcher closed the connection')
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b'\n', 1)
        return json.loads(line)

    def send(self, message):
        self.sock.sendall((json.dumps(message) + '\n').encode())

    def answer_subscriptions(self, statuses):
        # Answers as many subscriptions as `statuses` holds, each
        # with its scripthash's status; returns the scripthashes
        asked = []
        for _ in statuses:
            request = self.request()
            assert request['method'] == 'blockchain.scripthash.subscribe', request
            scripthash = request['params'][0]
            asked.append(scripthash)
            self.send({'jsonrpc': '2.0', 'id': request['id'], 'result': statuses[scripthash]})
        return asked

    def notify(self, scripthash, status):
        self.send({'jsonrpc': '2.0', 'method': 'blockchain.scripthash.subscribe', 'params': [scripthash, status]})








############################################################
# Connections
############################################################
#
# The watcher's opener: every call is a fresh socketpair —
# the watcher gets one end, the test the other as a
# FakeServer, in the order the watcher (re)connected.
#
# Used by:
#   - WatcherTests (below)
############################################################

class Connections:

    def __init__(self):
        self.servers = queue.Queue()
        self.opened = []

    def open(self):
        client, server = socket.socketpair()
        self.opened.append(server)
        self.servers.put(FakeServer(server))
        return client

    def next_server(self):
        return self.servers.get(timeout=5)

    def close(self):
        for sock in self.opened:
            sock.close()








############################################################
# WatcherTests
############################################################

class WatcherTests(unittest.TestCase):

    def setUp(self):
        self.patches = [
            patch.object(watcher_module, 'READ_TICK_S', 0.02),
            patch.object(watcher_module, 'RETRY_FIRST_S', 0.01),
        ]
        for active in self.patches:
            active.start()
        self.connections = Connections()
        self.changes = queue.Queue()
        self.watcher = self.make_watcher(self.changes.put)

    def tearDown(self):
        for watcher in self.watchers:
            watcher.close()
        self.connections.close()
        for active in self.patches:
            active.stop()

    def make_watcher(self, on_change):
        watcher = ElectrumWatcher('unused:1', on_change, label='test', opener=self.connections.open)
        self.watchers = [*getattr(self, 'watchers', []), watcher]
        return watcher

    def assert_no_change(self):
        with self.assertRaises(queue.Empty):
            self.changes.get(timeout=0.2)

    def test_every_watched_scripthash_is_subscribed_once(self):
        self.watcher.watch({'aa', 'bb'})
        server = self.connections.next_server()

        self.assertEqual(sorted(server.answer_subscriptions({'aa': 's1', 'bb': None})), ['aa', 'bb'])
        self.watcher.watch({'aa', 'cc'})                       # only cc is new
        self.assertEqual(server.answer_subscriptions({'cc': 'u1'}), ['cc'])
        self.assert_no_change()                                # first sight is no change

    def test_a_notification_is_a_change(self):
        self.watcher.watch({'aa'})
        server = self.connections.next_server()
        server.answer_subscriptions({'aa': 's1'})

        server.notify('aa', 's2')
        self.assertEqual(self.changes.get(timeout=5), 'aa')

    def test_a_reconnect_reports_only_what_changed_while_away(self):
        self.watcher.watch({'aa', 'bb'})
        server = self.connections.next_server()
        server.answer_subscriptions({'aa': 's1', 'bb': 't1'})

        server.sock.close()                                    # the server goes away
        server = self.connections.next_server()                # the watcher is back
        self.assertEqual(sorted(server.answer_subscriptions({'aa': 's2', 'bb': 't1'})), ['aa', 'bb'])
        self.assertEqual(self.changes.get(timeout=5), 'aa')
        self.assert_no_change()

    def test_a_quiet_session_is_pinged(self):
        with patch.object(watcher_module, 'PING_EVERY_S', 0.05):
            self.watcher.watch({'aa'})
            server = self.connections.next_server()
            server.answer_subscriptions({'aa': 's1'})
            self.assertEqual(server.request()['method'], 'server.ping')

    def test_a_failing_handler_keeps_the_watcher_running(self):
        seen = queue.Queue()

        def failing(scripthash):
            seen.put(scripthash)
            raise RuntimeError('the handler broke')

        watcher = self.make_watcher(failing)
        watcher.watch({'aa'})
        server = self.connections.next_server()
        server.answer_subscriptions({'aa': 's1'})
        server.notify('aa', 's2')
        server.notify('aa', 's3')

        self.assertEqual([seen.get(timeout=5), seen.get(timeout=5)], ['aa', 'aa'])

    def test_a_refused_subscription_is_not_asked_again(self):
        self.watcher.watch({'aa'})
        server = self.connections.next_server()
        request = server.request()
        server.send({'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': 1, 'message': 'no'}})

        self.watcher.watch({'bb'})
        self.assertEqual(server.answer_subscriptions({'bb': 't1'}), ['bb'])

    def test_too_many_scripthashes_start_over_with_the_newest(self):
        with patch.object(watcher_module, 'MAX_WATCHED', 2):
            self.watcher.watch({'aa', 'bb'})
            server = self.connections.next_server()
            server.answer_subscriptions({'aa': 's1', 'bb': 't1'})

            self.watcher.watch({'cc'})                         # three is too many
            server = self.connections.next_server()
            self.assertEqual(server.answer_subscriptions({'cc': 'u1'}), ['cc'])
