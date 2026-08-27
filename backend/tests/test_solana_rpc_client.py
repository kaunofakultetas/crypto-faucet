############################################################
#  [*] Solana RPC client regression tests
#
#  The protocol plumbing every SVM payout rides on, tested
#  against a scripted session — no node, fully deterministic:
#
#    answers  — an RPC error arriving with HTTP 200 raises
#               RuntimeError (the node ANSWERED, no retry); a
#               reply without 'result' is a framing failure
#    healing  — a dropped keep-alive retries ONCE, and only
#               a dropped connection does: a second drop and
#               a timeout both propagate
#    queries  — the balance, blockhash, broadcast and version
#               calls ask for what the faucet expects
#
#  The scripted session records every request body, so the
#  methods and commitment the node is asked for are asserted
#  rather than assumed.
############################################################


import unittest

import requests

from app.svm_faucet.rpc_client import SolanaRpcClient, SOLANA_COMMITMENT


def scripted(client, *replies):
    # Replaces the client's session.post: each entry answers the
    # NEXT call — a result payload (HTTP 200) or an Exception to
    # raise instead. Returns the list of request bodies sent.
    sent = []
    queue = list(replies)

    class Response:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self.payload

    def post(url, json=None, timeout=None):
        sent.append(json)
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return Response(reply)

    client.session.post = post
    return sent


def result(value):
    return {'jsonrpc': '2.0', 'id': 1, 'result': value}




############################################################
# SolanaRpcClientTests
############################################################

class SolanaRpcClientTests(unittest.TestCase):

    def setUp(self):
        self.client = SolanaRpcClient('http://node.test/rpc')

    def test_unconfigured_endpoint_raises(self):
        with self.assertRaises(ValueError):
            SolanaRpcClient('').request('getVersion')

    def test_an_rpc_error_with_http_200_raises_runtime_error(self):
        # The node answered — asking again would change nothing
        sent = scripted(self.client, {'jsonrpc': '2.0', 'id': 1, 'error': {'code': -32602, 'message': 'bad params'}})
        with self.assertRaises(RuntimeError):
            self.client.request('getVersion')
        self.assertEqual(len(sent), 1)

    def test_a_reply_without_result_is_a_value_error(self):
        scripted(self.client, {'jsonrpc': '2.0', 'id': 1})
        with self.assertRaises(ValueError):
            self.client.request('getVersion')

    def test_a_dropped_keep_alive_retries_once(self):
        sent = scripted(self.client,
                        requests.ConnectionError('keep-alive dropped'),
                        result({'solana-core': '2.0.0'}))

        self.assertEqual(self.client.get_version(), '2.0.0')
        self.assertEqual(len(sent), 2)
        self.assertEqual(sent[0], sent[1])                      # the SAME request, re-sent

    def test_a_second_dropped_connection_propagates(self):
        # Exactly one retry — a broadcast must never loop
        sent = scripted(self.client,
                        requests.ConnectionError('dropped'),
                        requests.ConnectionError('dropped again'))

        with self.assertRaises(requests.ConnectionError):
            self.client.get_version()
        self.assertEqual(len(sent), 2)

    def test_a_timeout_is_not_retried(self):
        # The request may have REACHED the node — re-sending a
        # broadcast on a timeout is the caller's decision, not the
        # transport's
        sent = scripted(self.client, requests.ReadTimeout('slow node'))

        with self.assertRaises(requests.ReadTimeout):
            self.client.get_version()
        self.assertEqual(len(sent), 1)

    def test_get_balance_reads_lamports_at_the_commitment(self):
        sent = scripted(self.client, result({'context': {'slot': 1}, 'value': 1_500_000_000}))

        self.assertEqual(self.client.get_balance('So11111111111111111111111111111111111111112'), 1_500_000_000)
        self.assertEqual(sent[0]['method'], 'getBalance')
        self.assertEqual(sent[0]['params'][1], {'commitment': SOLANA_COMMITMENT})

    def test_get_latest_blockhash(self):
        sent = scripted(self.client, result({'context': {'slot': 1}, 'value': {'blockhash': 'hash1', 'lastValidBlockHeight': 9}}))

        self.assertEqual(self.client.get_latest_blockhash(), 'hash1')
        self.assertEqual(sent[0]['method'], 'getLatestBlockhash')

    def test_send_transaction_broadcasts_base64_with_preflight(self):
        sent = scripted(self.client, result('sig1'))

        self.assertEqual(self.client.send_transaction('c2lnbmVk'), 'sig1')
        self.assertEqual(sent[0]['method'], 'sendTransaction')
        self.assertEqual(sent[0]['params'][0], 'c2lnbmVk')
        self.assertEqual(sent[0]['params'][1]['encoding'], 'base64')
        self.assertEqual(sent[0]['params'][1]['preflightCommitment'], SOLANA_COMMITMENT)
        self.assertNotIn('skipPreflight', sent[0]['params'][1])

    def test_get_version_reads_solana_core(self):
        scripted(self.client, result({'solana-core': '2.1.0', 'feature-set': 1}))
        self.assertEqual(self.client.get_version(), '2.1.0')


if __name__ == '__main__':
    unittest.main()
