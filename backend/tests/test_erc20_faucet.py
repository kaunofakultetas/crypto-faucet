############################################################
#  [*] ERC-20 faucet regression tests
#
#  Offline checks of the token-first logic: deployment
#  filtering, the catalog payload, the gas threshold (half
#  the native chunk) and unknown-token handling. No RPC —
#  the composed EVMFaucet is warmup-free and never called.
############################################################


import json
import unittest

from tests import helpers




############################################################
# Erc20FaucetTests
############################################################

class Erc20FaucetTests(unittest.TestCase):

    def test_deployments_drop_unknown_networks(self):
        # 'ghostchain' is not a configured EVM network — hidden, not fatal
        faucet = helpers.make_erc20_faucet()
        deployments = faucet.deployments_of('TST')
        self.assertEqual(deployments, [('testchain', '0x' + '11' * 20)])

    def test_is_supported(self):
        faucet = helpers.make_erc20_faucet()
        self.assertTrue(faucet.is_supported('testchain', 'TST'))
        self.assertFalse(faucet.is_supported('ghostchain', 'TST'))
        self.assertFalse(faucet.is_supported('testchain', 'NOPE'))

    def test_catalog_shape(self):
        # What the navbar picker renders — no RPC calls behind it
        faucet = helpers.make_erc20_faucet()
        data, status = faucet.get_token_catalog()
        self.assertEqual(status, 200)
        self.assertEqual(data['default_token'], 'TST')
        token = data['tokens']['TST']
        self.assertEqual(token['networks'], ['testchain'])
        self.assertIsInstance(token['chunk_size'], float)

    def test_min_native_wei_is_half_the_native_chunk(self):
        # testchain native chunk is 0.05 -> threshold 0.025 ETH in wei
        faucet = helpers.make_erc20_faucet()
        self.assertEqual(faucet._min_native_wei('testchain'), 25_000_000_000_000_000)

    def test_unknown_token_answers_400(self):
        faucet = helpers.make_erc20_faucet()
        data, status = faucet.get_token('NOPE')
        self.assertEqual(status, 400)
        self.assertIn('error', data)

    def test_token_payload_never_leaks_the_backend_rpc(self):
        # The per-deployment network metadata is composed from the
        # same configs as the EVM payload — the resolved RPC secret
        # must not ride along
        faucet = helpers.make_erc20_faucet()
        payload = json.dumps(faucet.get_token('TST')[0])
        self.assertNotIn('sekretas-iš-env', payload)
        self.assertNotIn('rpc_url"', payload)

    def test_shares_the_evm_send_locks(self):
        # Same wallet, same chain -> the SAME lock object as the native faucet
        evm = helpers.make_evm_faucet()
        erc20 = helpers.make_erc20_faucet(evm_faucet=evm)
        self.assertIs(erc20.evm_faucet.send_lock_for('testchain'), evm.send_lock_for('testchain'))


if __name__ == '__main__':
    unittest.main()
