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

    def test_long_key_truncates_to_the_first_64_chars(self):
        # An over-long key must not kill the faucet — all three
        # faucets truncate identically, so the stack still runs on
        # ONE consistent identity
        faucet = helpers.make_evm_faucet(private_key=helpers.TEST_PRIVATE_KEY + 'ff')
        self.assertEqual(faucet.FAUCET_ADDRESS, helpers.make_evm_faucet().FAUCET_ADDRESS)

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
        self.assertTrue(entry['has_explorer'])

    def test_send_lock_is_per_network(self):
        # Same network -> same lock object; different -> different
        faucet = helpers.make_evm_faucet()
        self.assertIs(faucet.send_lock_for('testchain'), faucet.send_lock_for('testchain'))
        self.assertIsNot(faucet.send_lock_for('testchain'), faucet.send_lock_for('other'))




############################################################
# SignatureVerificationTests
############################################################
#
# verify_signature is the ONLY thing standing between a
# student and claiming to another wallet's address — the EVM
# and ERC-20 payouts both gate on it. The flows in
# test_request_flows.py cover it end to end; these pin the
# method itself, including the edges a request can't reach.
############################################################

class SignatureVerificationTests(unittest.TestCase):

    # None is a VALUE under test here, so the "keep the default"
    # sentinel has to be something else
    UNSET = object()

    def setUp(self):
        self.faucet = helpers.make_evm_faucet()
        self.address, self.signature, self.nonce = helpers.sign_claim()
        self.message = helpers.CLAIM_MESSAGE.format(nonce=self.nonce)

    def verify(self, address=UNSET, message=UNSET, signature=UNSET):
        return self.faucet.verify_signature(
            'testchain',
            self.address if address is self.UNSET else address,
            self.message if message is self.UNSET else message,
            self.signature if signature is self.UNSET else signature,
        )

    def test_valid_signature_is_accepted(self):
        self.assertTrue(self.verify())

    def test_address_comparison_is_case_insensitive(self):
        # MetaMask sends lowercase, the backend checksums — both must
        # recover to the same wallet
        self.assertTrue(self.verify(address=self.address.lower()))
        self.assertTrue(self.verify(address=self.address.upper().replace('0X', '0x')))

    def test_signature_from_another_wallet_is_rejected(self):
        # The whole point: signing with key A must not prove ownership
        # of address B
        other = Account.from_key(bytes.fromhex(helpers.TEST_PRIVATE_KEY)).address
        self.assertFalse(self.verify(address=other))

    def test_different_message_is_rejected(self):
        # The signature commits to the nonce — replaying it under a
        # different one must fail recovery
        self.assertFalse(self.verify(message=helpers.CLAIM_MESSAGE.format(nonce='999')))
        self.assertFalse(self.verify(message='Something else entirely'))

    def test_malformed_input_returns_false_and_never_raises(self):
        # A student pasting junk gets a clean 403, not a 500
        for bad_signature in ('', '0x', '0xdeadbeef', 'not-hex', None):
            self.assertFalse(self.verify(signature=bad_signature))

    def test_missing_address_returns_false(self):
        for bad_address in ('', None):
            self.assertFalse(self.verify(address=bad_address))

    def test_unknown_network_raises_so_callers_must_gate_first(self):
        # Documents a real contract, not a wish: the w3 lookup sits
        # OUTSIDE the try, so both payout paths check
        # is_supported_network / is_supported before calling this
        with self.assertRaises(KeyError):
            self.faucet.verify_signature('nosuchnet', self.address, self.message, self.signature)


if __name__ == '__main__':
    unittest.main()
