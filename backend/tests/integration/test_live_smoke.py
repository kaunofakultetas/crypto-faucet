############################################################
#  [*] Live smoke tests (opt-in: RUN_LIVE=1)
#
#  Hits the RUNNING backend on localhost:8000 — every public
#  read endpoint answers, with the right shape, and the
#  public payloads leak no backend config. Run from inside
#  the backend container:
#
#    docker exec -w /app -e RUN_LIVE=1 faucet-backend \
#        python -m unittest discover -s tests -v
#
#  No claims are made here — payouts spend real testnet coins
#  and need a signature, so claim testing stays manual.
############################################################


import os
import json
import time
import unittest
import urllib.error
import urllib.request

BASE = 'http://localhost:8000'


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as response:
        return json.load(response)




############################################################
# LiveSmokeTests
############################################################

@unittest.skipUnless(os.getenv('RUN_LIVE'), 'live smoke is opt-in: set RUN_LIVE=1')
class LiveSmokeTests(unittest.TestCase):

    def test_evm_networks(self):
        data = get('/api/evm/networks')
        self.assertIn('sepolia', data['networks'])
        self.assertIn(data['default_network'], data['networks'])
        # the public payload must not leak backend-only config
        payload = json.dumps(data)
        self.assertNotIn('infura', payload.lower())
        self.assertNotIn('etherscan_api', payload)

    def test_evm_faucet_balance(self):
        data = get('/api/evm/sepolia/faucet-balance')
        self.assertGreaterEqual(data['balance'], 0)
        self.assertRegex(data['address'], r'^0x[0-9a-f]{40}$')

    def test_evm_request_validates_params(self):
        # the renamed route answers 400 (missing params), not 404
        with self.assertRaises(urllib.error.HTTPError) as caught:
            get('/api/evm/sepolia/request')
        self.assertEqual(caught.exception.code, 400)

    def test_old_request_eth_route_is_gone(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            get('/api/evm/sepolia/request-eth')
        self.assertEqual(caught.exception.code, 404)

    def test_erc20_catalog_and_token(self):
        catalog = get('/api/erc20/tokens')
        self.assertTrue(catalog['tokens'])
        symbol = catalog['default_token']
        token = get(f'/api/erc20/token/{symbol}')
        for deployment in token['deployments']:
            self.assertIn('min_native_wei', deployment)
            self.assertIn('chain_name', deployment)

    def test_utxo_networks_and_balance(self):
        data = get('/api/utxo/networks')
        self.assertIn('btc4', data['networks'])
        balance = get('/api/utxo/btc4/faucet-balance')
        self.assertTrue(balance['address'].startswith('tb1'))

    def test_graph_flows_in_day_window(self):
        # the date slider's contract: a [from, to) unix window
        address = get('/api/evm/sepolia/faucet-balance')['address']
        now = int(time.time())
        data = get(f'/api/evm/sepolia/get-stored-transactions'
                   f'?address={address}&from={now - 86400}&to={now + 3600}')
        self.assertIsInstance(data['transactions'], list)

    def test_graph_transaction_days(self):
        # the slider's day list: the root address's days, each
        # with a positive count, sorted ascending
        address = get('/api/evm/sepolia/faucet-balance')['address']
        data = get(f'/api/evm/sepolia/transaction-days?address={address}&tz_offset=10800')
        self.assertIsInstance(data['days'], list)
        for entry in data['days']:
            self.assertRegex(entry['day'], r'^\d{4}-\d{2}-\d{2}$')
            self.assertGreater(entry['count'], 0)
        days = [entry['day'] for entry in data['days']]
        self.assertEqual(days, sorted(days))

    def test_graph_flows_require_a_range(self):
        address = get('/api/evm/sepolia/faucet-balance')['address']
        with self.assertRaises(urllib.error.HTTPError) as caught:
            get(f'/api/evm/sepolia/get-stored-transactions?address={address}')
        self.assertEqual(caught.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
