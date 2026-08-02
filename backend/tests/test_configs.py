############################################################
#  [*] Config invariants
#
#  The poor man's schema validation: every rule the sectioned
#  configs in main.py must obey, so a typo fails a test run
#  instead of surfacing as a weird runtime fallback. This is
#  the ONE test file that imports main (safe: the blueprints
#  only register under __main__).
############################################################


import re
import unittest

from main import EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS, UTXO_NETWORK_CONFIGS




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
                self.assertRegex(faucet['hrp'], r'^[a-z]{2,8}$')
                self.assertRegex(faucet['electrum_server'], r'^[\w.\-]+:\d+$')

    def test_ids_unique(self):
        ids = [c['id'] for c in UTXO_NETWORK_CONFIGS.values()]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == '__main__':
    unittest.main()
