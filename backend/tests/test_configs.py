############################################################
#  [*] Config invariants
#
#  The poor man's schema validation: every rule the sectioned
#  configs in main.py must obey, so a typo fails a test run
#  instead of surfacing as a weird runtime fallback. Imports
#  main for the REAL maps (safe: the blueprints only register
#  under __main__) — all five families.
############################################################


import re
import unittest
from urllib.parse import urlparse

from main import (
    EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS, UTXO_NETWORK_CONFIGS,
    SVM_NETWORK_CONFIGS, MOVE_NETWORK_CONFIGS,
)
from app.svm_faucet.chains import solana as solana_chain
from app.move_faucet.chains import sui as sui_chain




############################################################
# EvmConfigTests
############################################################

class EvmConfigTests(unittest.TestCase):

    def test_required_sections_and_fields(self):
        for key, config in EVM_NETWORK_CONFIGS.items():
            with self.subTest(network=key):
                self.assertIsInstance(config['id'], int)
                self.assertIsInstance(config['chain_id'], int)

                faucet = config['faucet']
                self.assertTrue(faucet['rpc_url'].startswith('http'))
                self.assertGreater(float(faucet['chunk_size']), 0)
                self.assertTrue(faucet['short_name'] and faucet['full_name'])

                metamask = config['metamask']
                self.assertTrue(metamask['chain_name'])
                self.assertIsInstance(metamask['rpc_urls'], list)      # EIP-3085 wants arrays
                self.assertTrue(metamask['rpc_urls'])
                self.assertEqual(metamask['native_currency']['decimals'], 18)

    def test_explorer_section_shape_when_present(self):
        for key, config in EVM_NETWORK_CONFIGS.items():
            if 'explorer' in config:
                with self.subTest(network=key):
                    self.assertTrue(config['explorer']['etherscan_api_url'].startswith('http'))

    def test_every_network_hands_metamask_a_browser_explorer(self):
        # block_explorer_urls is what MetaMask stores for "View on
        # block explorer" — a student-facing site, never the graph
        # scraper's API host, and never missing (the entry is
        # sticky in the wallet, so a wrong one is awkward to undo)
        for key, config in EVM_NETWORK_CONFIGS.items():
            with self.subTest(network=key):
                urls = config['metamask'].get('block_explorer_urls')
                self.assertTrue(urls, 'no block_explorer_urls')
                for url in urls:
                    self.assertTrue(url.startswith('https://'))
                    api_url = config.get('explorer', {}).get('etherscan_api_url')
                    if api_url:
                        self.assertNotEqual(urlparse(url).hostname, urlparse(api_url).hostname)

    def test_ids_and_chain_ids_unique(self):
        ids = [c['id'] for c in EVM_NETWORK_CONFIGS.values()]
        chain_ids = [c['chain_id'] for c in EVM_NETWORK_CONFIGS.values()]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(chain_ids), len(set(chain_ids)))




############################################################
# Erc20ConfigTests
############################################################

class Erc20ConfigTests(unittest.TestCase):

    def test_tokens_reference_existing_networks(self):
        for symbol, config in ERC20_TOKEN_CONFIGS.items():
            for network in config['deployments']:
                with self.subTest(token=symbol, network=network):
                    self.assertIn(network, EVM_NETWORK_CONFIGS)

    def test_token_fields(self):
        for symbol, config in ERC20_TOKEN_CONFIGS.items():
            with self.subTest(token=symbol):
                self.assertEqual(symbol, symbol.upper())
                self.assertIsInstance(config['decimals'], int)
                self.assertGreater(float(config['chunk_size']), 0)
                for address in config['deployments'].values():
                    self.assertRegex(address, r'^0x[0-9a-fA-F]{40}$')




############################################################
# UtxoConfigTests
############################################################

class UtxoConfigTests(unittest.TestCase):

    def test_required_sections_and_fields(self):
        for key, config in UTXO_NETWORK_CONFIGS.items():
            with self.subTest(network=key):
                self.assertIsInstance(config['id'], int)
                self.assertTrue(config['short_name'] and config['full_name'])

                faucet = config['faucet']
                self.assertGreater(float(faucet['chunk_size']), 0)
                self.assertIn(faucet['network'], ('mainnet', 'testnet', 'regtest'))
                self.assertRegex(faucet['electrum_server'], r'^[\w.\-]+:\d+$')

                # The coin + flavour must resolve in the registry to a
                # spendable dialect: an hrp (SegWit — may ALSO carry
                # base58 prefixes for legacy recipients) or, without
                # one, a p2pkh_prefix (legacy chain)
                from app.utxo_faucet.coins import coin_params
                params = coin_params(faucet['coin'], faucet['network'])
                self.assertTrue('hrp' in params or 'p2pkh_prefix' in params)
                self.assertGreater(params['fee_rate'], 0)
                self.assertGreater(params['dust_limit'], 0)

    def test_ids_unique(self):
        ids = [c['id'] for c in UTXO_NETWORK_CONFIGS.values()]
        self.assertEqual(len(ids), len(set(ids)))




############################################################
# SvmConfigTests
############################################################

class SvmConfigTests(unittest.TestCase):

    def test_required_sections_and_fields(self):
        for key, config in SVM_NETWORK_CONFIGS.items():
            with self.subTest(network=key):
                self.assertIsInstance(config['id'], int)

                faucet = config['faucet']
                self.assertEqual(faucet['chain'], 'solana')
                self.assertIn(faucet['network'], solana_chain.NETWORKS)
                self.assertNotEqual(faucet['network'], 'mainnet')      # a lab faucet pays testnet coins
                self.assertTrue(faucet['rpc_url'].startswith('http'))
                self.assertGreater(float(faucet['chunk_size']), 0)
                self.assertTrue(faucet['short_name'] and faucet['full_name'])

                # The cluster RPC the PAGE reads the student's balance from
                self.assertIsInstance(config['wallet']['rpc_urls'], list)
                self.assertTrue(config['wallet']['rpc_urls'])

    def test_ids_unique(self):
        ids = [c['id'] for c in SVM_NETWORK_CONFIGS.values()]
        self.assertEqual(len(ids), len(set(ids)))




############################################################
# MoveConfigTests
############################################################

class MoveConfigTests(unittest.TestCase):

    def test_required_sections_and_fields(self):
        for key, config in MOVE_NETWORK_CONFIGS.items():
            with self.subTest(network=key):
                self.assertIsInstance(config['id'], int)

                faucet = config['faucet']
                self.assertEqual(faucet['chain'], 'sui')
                self.assertIn(faucet['network'], sui_chain.NETWORKS)
                self.assertNotEqual(faucet['network'], 'mainnet')      # a lab faucet pays testnet coins
                self.assertTrue(faucet['rpc_url'].startswith('http'))
                self.assertGreater(float(faucet['chunk_size']), 0)
                self.assertTrue(faucet['short_name'] and faucet['full_name'])

                self.assertIsInstance(config['wallet']['rpc_urls'], list)
                self.assertTrue(config['wallet']['rpc_urls'])

    def test_ids_unique(self):
        ids = [c['id'] for c in MOVE_NETWORK_CONFIGS.values()]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == '__main__':
    unittest.main()
