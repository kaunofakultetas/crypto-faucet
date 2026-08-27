############################################################
#  [*] Sui GraphQL client regression tests
#
#  The protocol plumbing every MOVE payout rides on, tested
#  against a scripted session — no node, fully deterministic:
#
#    answers  — GraphQL errors arriving with HTTP 200 raise
#               RuntimeError (the node ANSWERED, no retry); a
#               reply without 'data' is a framing failure
#    healing  — a dropped keep-alive retries ONCE, and only
#               a dropped connection does: a second drop and
#               a timeout both propagate
#    queries  — build_transfer sends the requested transfer
#               and refuses a failed simulation; execute
#               returns the digest and raises on failure
#
#  The scripted session records every request body, so the
#  transaction shape the node is asked to build is asserted
#  rather than assumed.
############################################################


import unittest

import requests

from app.move_faucet.graphql_client import SuiGraphqlClient


def scripted(client, *replies):
    # Replaces the client's session.post: each entry answers the
    # NEXT call — a payload dict (HTTP 200) or an Exception to
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


def simulation(status, bcs='YmNz', error=None):
    effects = {'status': status, 'executionError': error, 'transaction': {'transactionBcs': bcs}}
    return {'data': {'simulateTransaction': {'effects': effects}}}


def execution(status, digest='digest1', error=None):
    effects = {'status': status, 'executionError': error, 'digest': digest}
    return {'data': {'executeTransaction': {'effects': effects}}}




############################################################
# SuiGraphqlClientTests
############################################################

class SuiGraphqlClientTests(unittest.TestCase):

    def setUp(self):
        self.client = SuiGraphqlClient('http://node.test/graphql')

    def test_unconfigured_endpoint_raises(self):
        with self.assertRaises(ValueError):
            SuiGraphqlClient('').request('{ chainIdentifier }')

    def test_graphql_errors_with_http_200_raise_runtime_error(self):
        # The node answered — asking again would change nothing
        scripted(self.client, {'errors': [{'message': 'boom'}]})
        with self.assertRaises(RuntimeError):
            self.client.request('{ chainIdentifier }')

    def test_a_reply_without_data_is_a_value_error(self):
        scripted(self.client, {})
        with self.assertRaises(ValueError):
            self.client.request('{ chainIdentifier }')

    def test_a_dropped_keep_alive_retries_once(self):
        sent = scripted(self.client,
                        requests.ConnectionError('keep-alive dropped'),
                        {'data': {'chainIdentifier': 'abc'}})

        self.assertEqual(self.client.get_chain_identifier(), 'abc')
        self.assertEqual(len(sent), 2)

    def test_a_second_dropped_connection_propagates(self):
        # Exactly one retry — a broadcast must never loop
        sent = scripted(self.client,
                        requests.ConnectionError('dropped'),
                        requests.ConnectionError('dropped again'))

        with self.assertRaises(requests.ConnectionError):
            self.client.get_chain_identifier()
        self.assertEqual(len(sent), 2)

    def test_a_connect_timeout_is_not_retried(self):
        # ConnectTimeout is a ConnectionError subclass, but the host
        # never answered — dialling again only burns the timeout twice
        sent = scripted(self.client, requests.ConnectTimeout('no answer'))

        with self.assertRaises(requests.ConnectTimeout):
            self.client.get_chain_identifier()
        self.assertEqual(len(sent), 1)

    def test_a_timeout_is_not_retried(self):
        # The request may have REACHED the node — re-sending a
        # broadcast on a timeout is the caller's decision, not the
        # transport's
        sent = scripted(self.client, requests.ReadTimeout('slow node'))

        with self.assertRaises(requests.ReadTimeout):
            self.client.get_chain_identifier()
        self.assertEqual(len(sent), 1)

    def test_get_balance_reads_null_as_zero(self):
        # An address the chain has never seen answers null
        scripted(self.client, {'data': {'address': None}})
        self.assertEqual(self.client.get_balance('0x' + '11' * 32, '0x2::sui::SUI'), 0)

    def test_build_transfer_asks_for_exactly_the_requested_transfer(self):
        sent = scripted(self.client, simulation('SUCCESS', bcs='bm9kZS1idWlsdA=='))

        bcs = self.client.build_transfer('0x' + 'fa' * 32, 'cmVjaXBpZW50', 'YW1vdW50')

        self.assertEqual(bcs, 'bm9kZS1idWlsdA==')
        tx = sent[0]['variables']['tx']
        self.assertEqual(tx['sender'], '0x' + 'fa' * 32)
        programmable = tx['kind']['programmableTransaction']
        self.assertEqual(programmable['inputs'][0]['pure'], 'YW1vdW50')          # amount first
        self.assertEqual(programmable['inputs'][1]['pure'], 'cmVjaXBpZW50')      # recipient second
        self.assertIn('splitCoins', programmable['commands'][0])
        self.assertIn('transferObjects', programmable['commands'][1])
        self.assertIn('doGasSelection: true', sent[0]['query'])

    def test_build_transfer_refuses_a_failed_simulation(self):
        scripted(self.client, simulation('FAILURE', error={'message': 'InsufficientGas'}))
        with self.assertRaises(RuntimeError) as caught:
            self.client.build_transfer('0x' + 'fa' * 32, 'cmVjaXBpZW50', 'YW1vdW50')
        self.assertIn('InsufficientGas', str(caught.exception))

    def test_execute_returns_the_digest(self):
        scripted(self.client, execution('SUCCESS', digest='D1'))
        self.assertEqual(self.client.execute('YmNz', 'c2ln'), 'D1')

    def test_execute_raises_on_a_failed_execution(self):
        scripted(self.client, execution('FAILURE', error={'message': 'aborted'}))
        with self.assertRaises(RuntimeError):
            self.client.execute('YmNz', 'c2ln')


if __name__ == '__main__':
    unittest.main()
