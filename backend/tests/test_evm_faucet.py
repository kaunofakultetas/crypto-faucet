############################################################
#  [*] EVM faucet regression tests
#
#  Offline checks of everything EVMFaucet decides without an
#  RPC: key normalization, the <NAME> template substitution
#  in rpc_url, the composed public payload (which must never
#  leak backend-only config), and the per-network send locks.
############################################################


import json
import unittest

from eth_account import Account

from tests import helpers




############################################################
# EvmFaucetTests
############################################################

class EvmFaucetTests(unittest.TestCase):

    def test_short_key_pads_left(self):
        # zfill pads on the LEFT — the right would be a different wallet
        faucet = helpers.make_evm_faucet(private_key='0xabc')
        expected = Account.from_key('0x' + 'abc'.zfill(64)).address
        self.assertEqual(faucet.FAUCET_ADDRESS, expected)

    def test_missing_key_degrades_to_none(self):
        # No key -> no address, but construction must not raise
        faucet = helpers.make_evm_faucet(private_key='')
        self.assertIsNone(faucet.FAUCET_ADDRESS)
        self.assertIsNone(faucet.FAUCET_ACCOUNT)

    def test_rpc_url_template_resolves_from_env(self):
        # <TEST_RPC_SECRET> must be replaced with the env value
        faucet = helpers.make_evm_faucet()
        endpoint = faucet.w3_instances['testchain'].provider.endpoint_uri
        self.assertIn('sekretas-iš-env', endpoint)
        self.assertNotIn('<', endpoint)

    def test_get_networks_never_leaks_backend_config(self):
        # The public payload: identity + metamask section ONLY
        faucet = helpers.make_evm_faucet()
        payload = json.dumps(faucet.get_networks())
        self.assertNotIn('rpc_url"', payload)          # backend RPC (template)
        self.assertNotIn('TEST_RPC_SECRET', payload)
        self.assertNotIn('etherscan', payload)
        self.assertNotIn('chunk_size', payload)

    def test_get_networks_payload_shape(self):
        # Exactly the fields the frontend and MetaMask consume
        faucet = helpers.make_evm_faucet()
        entry = faucet.get_networks()['networks']['testchain']
        self.assertEqual(entry['chain_id'], 12345)
        self.assertEqual(entry['full_name'], 'Test Chain')
        self.assertEqual(entry['chain_name'], 'Test Chain')
        self.assertIsInstance(entry['rpc_urls'], list)
        self.assertIsInstance(entry['block_explorer_urls'], list)
        self.assertEqual(entry['native_currency']['decimals'], 18)

    def test_send_lock_is_per_network(self):
        # Same network -> same lock object; different -> different
        faucet = helpers.make_evm_faucet()
        self.assertIs(faucet.send_lock_for('testchain'), faucet.send_lock_for('testchain'))
        self.assertIsNot(faucet.send_lock_for('testchain'), faucet.send_lock_for('other'))


if __name__ == '__main__':
    unittest.main()
