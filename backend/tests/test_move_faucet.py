############################################################
#  [*] MOVE faucet regression tests
#
#  The Sui-family faucet, offline: the chain registry, the
#  blake2b-derived identity (the shared secret as an Ed25519
#  seed, hashed into a DIFFERENT address than any other
#  family), real personal-message signature verification, the
#  composed public payload, and the full claim flow with the
#  GraphQL client faked.
#
#  Everything here is offline — no Sui node is contacted —
#  but the cryptography is REAL: claims carry genuine Ed25519
#  personal-message signatures and the payout signature is
#  genuinely produced and checked against the faucet's key.
############################################################


import base64
import hashlib
import json
import logging
import unittest

from solders.pubkey import Pubkey
from solders.signature import Signature

from app.move_faucet.chains import chain_params
from tests import helpers


# The claim flow's failure paths log tracebacks on purpose
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)




############################################################
# MoveChainRegistryTests
############################################################
#
# The protocol facts the operator never sees.
############################################################

class MoveChainRegistryTests(unittest.TestCase):

    def test_sui_testnet_params(self):
        params = chain_params('sui', 'testnet')

        self.assertEqual(params['symbol'], 'SUI')
        self.assertEqual(params['decimals'], 9)          # MIST, not wei
        self.assertEqual(params['coin_type'], '0x2::sui::SUI')
        self.assertGreater(params['fee_mist'], 0)

    def test_unknown_chain_names_the_options(self):
        with self.assertRaises(ValueError) as caught:
            chain_params('aptos', 'testnet')
        self.assertIn('sui', str(caught.exception))

    def test_unknown_flavour_names_the_options(self):
        with self.assertRaises(ValueError) as caught:
            chain_params('sui', 'regtest')
        self.assertIn('testnet', str(caught.exception))




############################################################
# MoveIdentityTests
############################################################
#
# The blake2b-hashed Ed25519 identity and what it must NOT be.
############################################################

class MoveIdentityTests(unittest.TestCase):

    def test_address_is_deterministic_hex(self):
        first = helpers.make_move_faucet().FAUCET_ADDRESS
        second = helpers.make_move_faucet().FAUCET_ADDRESS

        self.assertEqual(first, second)
        self.assertRegex(first, r'^0x[0-9a-f]{64}$')

    def test_address_differs_from_the_svm_one(self):
        # Same secret, same curve — but Sui hashes flag+pubkey
        # into the address, so it is yet another wallet that
        # must be funded separately
        move = helpers.make_move_faucet()
        svm = helpers.make_svm_faucet()

        self.assertNotEqual(move.FAUCET_ADDRESS.lower(), (svm.FAUCET_ADDRESS or '').lower())

    def test_long_key_truncates_to_the_first_64_chars(self):
        # Same normalization as every other family — an
        # imperfect key still runs the faucet, on the shared
        # identity
        long_key = helpers.make_move_faucet(private_key=helpers.TEST_PRIVATE_KEY + 'ff').FAUCET_ADDRESS
        self.assertEqual(long_key, helpers.make_move_faucet().FAUCET_ADDRESS)

    def test_missing_key_degrades_to_none(self):
        faucet = helpers.make_move_faucet(private_key='')

        self.assertIsNone(faucet.FAUCET_ADDRESS)
        self.assertIsNone(faucet.faucet_keypair)




############################################################
# MoveSignatureTests
############################################################
#
# The ownership proof — Sui's personal-message scheme: the
# embedded public key must hash back to the claiming address
# AND the Ed25519 signature must verify over the intent
# digest. The scheme was confirmed against the node's own
# verifySignature endpoint.
############################################################

class MoveSignatureTests(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_move_faucet()
        self.address, self.signature, self.nonce = helpers.sign_move_claim()
        self.message = helpers.CLAIM_MESSAGE.format(nonce=self.nonce)

    def test_valid_signature_is_accepted(self):
        self.assertTrue(self.faucet.verify_signature(self.address, self.message, self.signature))

    def test_signature_from_another_wallet_is_rejected(self):
        # The embedded pubkey hashes to the SIGNER's address,
        # not the claimed one — the address check must catch it
        address, signature, nonce = helpers.sign_move_claim(signer_seed=bytes(range(1, 33)))
        message = helpers.CLAIM_MESSAGE.format(nonce=nonce)

        self.assertFalse(self.faucet.verify_signature(address, message, signature))

    def test_different_message_is_rejected(self):
        other = helpers.CLAIM_MESSAGE.format(nonce='999')
        self.assertFalse(self.faucet.verify_signature(self.address, other, self.signature))

    def test_malformed_input_returns_false_and_never_raises(self):
        for bad in ('', '0x', 'not-base64!!', None):
            self.assertFalse(self.faucet.verify_signature(self.address, self.message, bad))
            self.assertFalse(self.faucet.verify_signature(bad, self.message, self.signature))




############################################################
# MoveNetworksPayloadTests
############################################################

class MoveNetworksPayloadTests(unittest.TestCase):

    def test_payload_shape(self):
        entry = helpers.make_move_faucet().get_networks()['networks']['testmove']

        self.assertEqual(entry['symbol'], 'SUI')
        self.assertEqual(entry['decimals'], 9)
        self.assertEqual(entry['network'], 'testnet')
        self.assertEqual(entry['chunk_size'], 0.5)
        self.assertIsInstance(entry['rpc_urls'], list)

    def test_default_network_is_always_a_configured_key(self):
        # DEFAULT_NETWORK ('suiTestnet') is not in this fixture,
        # so the payload must fall back to the lowest picker id
        # rather than naming a network the frontend cannot find
        payload = helpers.make_move_faucet().get_networks()

        self.assertIn(payload['default_network'], payload['networks'])

    def test_never_leaks_the_backend_rpc(self):
        payload = json.dumps(helpers.make_move_faucet().get_networks())

        self.assertNotIn('rpc_url"', payload)
        self.assertNotIn('TEST_RPC_SECRET', payload)
        self.assertNotIn('sekretas-iš-env', payload)




############################################################
# MoveRequestFlowTests
############################################################
#
# The claim path end to end: the gates, their order, and the
# cooldown lifecycle — the same contract every other family
# is held to.
############################################################

class MoveRequestFlowTests(unittest.TestCase):

    CHUNK_MIST = 500_000_000            # 0.5 SUI
    FUNDED = 10_000_000_000             # 10 SUI

    def setUp(self):
        self.faucet = helpers.make_move_faucet()
        self.address, self.signature, self.nonce = helpers.sign_move_claim()

    def fake(self, user_mist=0, faucet_mist=None, **kwargs):
        balances = {
            self.address: user_mist,
            self.faucet.FAUCET_ADDRESS: self.FUNDED if faucet_mist is None else faucet_mist,
        }
        return helpers.fake_sui_graphql(self.faucet, 'testmove', balances=balances, **kwargs)

    def claim(self):
        return self.faucet.request_move('testmove', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testmove', self.address) in self.faucet.cooldowns._last_claim

    def test_happy_path_executes_and_keeps_the_cooldown(self):
        client = self.fake()
        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(data['amount'], 0.5)
        self.assertEqual(data['network'], 'testmove')
        self.assertTrue(data['transaction_id'])
        self.assertEqual(len(client.executed), 1)
        self.assertTrue(self.claimed())

    def test_payout_signature_is_genuinely_the_faucets(self):
        # The signature handed to execute() must be the Sui
        # transaction-intent scheme over the node-built BCS,
        # verifiable against the faucet's own key
        client = self.fake()
        self.claim()

        raw = base64.b64decode(client.executed[0]['signature'])
        self.assertEqual(raw[0], 0)                     # Ed25519 flag
        sig, pubkey = raw[1:65], raw[65:97]

        derived = '0x' + hashlib.blake2b(bytes([0]) + pubkey, digest_size=32).hexdigest()
        self.assertEqual(derived, self.faucet.FAUCET_ADDRESS)

        tx_bcs = base64.b64decode(client.executed[0]['tx_bcs'])
        digest = hashlib.blake2b(bytes([0, 0, 0]) + tx_bcs, digest_size=32).digest()
        self.assertTrue(Signature.from_bytes(sig).verify(Pubkey.from_bytes(pubkey), digest))

    def test_payout_drops_the_cached_balance(self):
        self.fake()
        self.faucet._balance_cache['testmove'] = (9999999999, 42.0)
        self.claim()

        self.assertNotIn('testmove', self.faucet._balance_cache)

    def test_wrong_signer_is_403(self):
        self.fake()
        address, signature, nonce = helpers.sign_move_claim(signer_seed=bytes(range(1, 33)))
        data, status = self.faucet.request_move('testmove', address, signature, nonce)

        self.assertEqual(status, 403)
        self.assertFalse(('testmove', address) in self.faucet.cooldowns._last_claim)

    def test_wallet_already_funded_is_400_without_claiming(self):
        self.fake(user_mist=self.CHUNK_MIST)
        data, status = self.claim()

        self.assertEqual(status, 400)
        self.assertIn('jau yra pakankamai', data['error'])
        self.assertFalse(self.claimed())

    def test_second_claim_is_429(self):
        self.fake()
        self.claim()
        data, status = self.claim()

        self.assertEqual(status, 429)

    def test_empty_faucet_is_503_and_releases_the_cooldown(self):
        self.fake(faucet_mist=1000)
        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertFalse(self.claimed())

    def test_faucet_must_cover_the_gas_margin_too(self):
        # Exactly the chunk is NOT enough — gas costs extra
        self.fake(faucet_mist=self.CHUNK_MIST)
        self.assertEqual(self.claim()[1], 503)

        self.fake(faucet_mist=self.CHUNK_MIST + 10_000_000)
        self.assertEqual(self.claim()[1], 200)

    def test_build_failure_releases_the_cooldown(self):
        self.fake(build_error='simulation failed')
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertFalse(self.claimed())
        self.assertNotIn('simulation', str(data))       # no raw RPC text to students

        self.fake()
        self.assertEqual(self.claim()[1], 200)          # retry works immediately

    def test_execute_failure_releases_the_cooldown(self):
        self.fake(execute_error='node rejected')
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertFalse(self.claimed())

    def test_invalid_address_never_claims_a_slot(self):
        self.fake()
        for bad in ('0x' + 'ab' * 20, 'not-an-address', self.address[:-2], self.address + 'ff'):
            data, status = self.faucet.request_move('testmove', bad, self.signature, self.nonce)
            self.assertEqual(status, 400)
            self.assertFalse((('testmove', bad) in self.faucet.cooldowns._last_claim))

    def test_paying_the_faucet_itself_is_refused(self):
        self.fake()
        data, status = self.faucet.request_move(
            'testmove', self.faucet.FAUCET_ADDRESS, self.signature, self.nonce)

        self.assertEqual(status, 400)
        self.assertIn('čiaupo adresą', data['error'])

    def test_unsupported_network_is_400(self):
        data, status = self.faucet.request_move('nosuchnet', self.address, self.signature, self.nonce)
        self.assertEqual(status, 400)

    def test_missing_parameters_are_400(self):
        self.fake()
        for args in (('', self.signature, self.nonce),
                     (self.address, '', self.nonce),
                     (self.address, self.signature, '')):
            self.assertEqual(self.faucet.request_move('testmove', *args)[1], 400)


if __name__ == '__main__':
    unittest.main()
