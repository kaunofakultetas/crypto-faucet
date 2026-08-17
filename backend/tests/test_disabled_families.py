############################################################
#  [*] Disabled-family tests
#
#  An operator disables a whole faucet family by deleting (or
#  emptying) its map in _CONFIG/coins.py — main.py loads a
#  missing map as {} on purpose. These tests pin the backend
#  half of that contract: every faucet must boot over an
#  empty config, serve an EMPTY catalog (the signal the
#  frontend hides the family on), and answer requests with a
#  clean error status instead of crashing.
############################################################


import os
import unittest
from unittest import mock

from app.evm_faucet.evm_faucet import EVMFaucet
from app.erc_faucet.erc20_faucet import ERC20Faucet
from app.utxo_faucet.utxo_faucet import UTXOFaucet
from app.svm_faucet.svm_faucet import SVMFaucet
from app.move_faucet.move_faucet import MoveFaucet

from tests import helpers




############################################################
# DisabledFamilyTests
############################################################
#
# One test per family, all built over {}. The warmups need no
# patching — with no networks configured there is nothing to
# warm up, which is itself part of the contract.
############################################################

class DisabledFamilyTests(unittest.TestCase):

    def setUp(self):
        # A configured key must NOT resurrect a family — being
        # disabled is about the config map, not the wallet
        patcher = mock.patch.dict(os.environ, {'FAUCET_PRIVATE_KEY': helpers.TEST_PRIVATE_KEY})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_evm_family_disabled(self):
        faucet = EVMFaucet({})

        self.assertEqual(faucet.get_networks()['networks'], {})
        self.assertEqual(faucet.get_faucet_balance('sepolia')[1], 400)
        self.assertEqual(faucet.request_eth('sepolia', '0x' + 'ab' * 20, 'sig', '1')[1], 400)

    def test_utxo_family_disabled(self):
        faucet = UTXOFaucet({})

        self.assertEqual(faucet.get_networks()['networks'], {})
        # The UTXO answers are 500, not 400 — the request-flow
        # tests pin that quirk; here only "an error, no crash"
        # matters
        self.assertGreaterEqual(faucet.get_faucet_balance('btc4')[1], 400)
        self.assertGreaterEqual(faucet.request_crypto('btc4', 'tb1qsomeaddress')[1], 400)

    def test_svm_family_disabled(self):
        faucet = SVMFaucet({})

        self.assertEqual(faucet.get_networks()['networks'], {})
        self.assertEqual(faucet.get_faucet_balance('solanaDevnet')[1], 400)
        self.assertEqual(faucet.request_sol('solanaDevnet', 'addr', 'sig', '1')[1], 400)

    def test_move_family_disabled(self):
        faucet = MoveFaucet({})

        self.assertEqual(faucet.get_networks()['networks'], {})
        self.assertEqual(faucet.get_faucet_balance('suiTestnet')[1], 400)
        self.assertEqual(faucet.request_move('suiTestnet', '0x' + 'ab' * 32, 'sig', '1')[1], 400)

    def test_erc20_family_disabled(self):
        faucet = ERC20Faucet(EVMFaucet({}), {})

        catalog, status = faucet.get_token_catalog()
        self.assertEqual(status, 200)
        self.assertEqual(catalog['tokens'], {})
        self.assertIsNone(catalog['default_token'])
        self.assertEqual(faucet.get_token('LINK')[1], 400)

    def test_tokens_without_their_networks_vanish_too(self):
        # A token whose EVERY deployment points at a network the
        # operator removed must drop out of the catalog the same
        # way — the family can end up empty without its map being
        # empty
        faucet = ERC20Faucet(EVMFaucet({}), helpers.ERC20_TEST_CONFIGS)

        catalog, _ = faucet.get_token_catalog()
        self.assertEqual(catalog['tokens'], {})


if __name__ == '__main__':
    unittest.main()
