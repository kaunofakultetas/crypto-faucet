############################################################
#  [*] SVM faucet regression tests
#
#  The Solana-family faucet, offline: the chain registry, the
#  Ed25519 identity (derived from the shared secp256k1 secret
#  as a SEED, so it is deterministic but a DIFFERENT address),
#  real signature verification, the composed public payload,
#  and the full claim flow with the RPC faked.
#
#  Everything here is offline — no Solana node is contacted —
#  but the cryptography is REAL: claims carry genuine Ed25519
#  signatures and payouts are genuinely built and signed.
############################################################


import copy
import json
import logging
import unittest

from app.svm_faucet.chains import chain_params
from tests import helpers


# The claim flow's failure paths log tracebacks on purpose
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)




############################################################
# SvmChainRegistryTests
############################################################
#
# The protocol facts the operator never sees.
############################################################

class SvmChainRegistryTests(unittest.TestCase):

    def test_solana_devnet_params(self):
        params = chain_params('solana', 'devnet')

        self.assertEqual(params['symbol'], 'SOL')
        self.assertEqual(params['decimals'], 9)          # lamports, not wei
        self.assertEqual(params['fee_lamports'], 5000)
        self.assertGreater(params['min_payout_lamports'], 0)

    def test_unknown_chain_names_the_options(self):
        with self.assertRaises(ValueError) as caught:
            chain_params('aptos', 'devnet')
        self.assertIn('solana', str(caught.exception))

    def test_unknown_flavour_names_the_options(self):
        with self.assertRaises(ValueError) as caught:
            chain_params('solana', 'regtest')
        self.assertIn('devnet', str(caught.exception))




############################################################
# SvmIdentityTests
############################################################
#
# The Ed25519 keypair and what it must NOT be.
############################################################

class SvmIdentityTests(unittest.TestCase):

    def test_address_is_deterministic_base58(self):
        first = helpers.make_svm_faucet().FAUCET_ADDRESS
        second = helpers.make_svm_faucet().FAUCET_ADDRESS

        self.assertEqual(first, second)
        self.assertNotIn('0x', first)
        self.assertTrue(32 <= len(first) <= 44)

    def test_address_differs_from_the_evm_one(self):
        # Same secret, different curve -> a DIFFERENT wallet that
        # must be funded separately. Getting this wrong would send
        # payouts into an address nobody controls.
        svm = helpers.make_svm_faucet()
        evm = helpers.make_evm_faucet()

        self.assertNotEqual(svm.FAUCET_ADDRESS.lower(), (evm.FAUCET_ADDRESS or '').lower())

    def test_hex_normalization_matches_the_other_faucets(self):
        # Same identity whether the shared key arrives 0x-prefixed
        # or with a stripped leading zero — zfill on the LEFT, like
        # EVM and UTXO.
        full = helpers.make_svm_faucet().FAUCET_ADDRESS
        prefixed = helpers.make_svm_faucet(private_key='0x' + helpers.TEST_PRIVATE_KEY.replace('0x', '')).FAUCET_ADDRESS

        self.assertEqual(full, prefixed)

    def test_missing_key_degrades_to_none(self):
        faucet = helpers.make_svm_faucet(private_key='')

        self.assertIsNone(faucet.FAUCET_ADDRESS)
        self.assertIsNone(faucet.faucet_keypair)

    def test_long_key_truncates_to_the_first_64_chars(self):
        # Same normalization as EVM and UTXO — an imperfect key
        # still runs the faucet, on the shared identity
        long_key = helpers.make_svm_faucet(private_key=helpers.TEST_PRIVATE_KEY + 'ff').FAUCET_ADDRESS
        self.assertEqual(long_key, helpers.make_svm_faucet().FAUCET_ADDRESS)




############################################################
# SvmSignatureTests
############################################################
#
# The ownership proof — Ed25519 verified against the address
# directly, with no key recovery (unlike the EVM ecrecover).
############################################################

class SvmSignatureTests(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_svm_faucet()
        self.address, self.signature, self.nonce = helpers.sign_svm_claim()
        self.message = helpers.CLAIM_MESSAGE.format(nonce=self.nonce)

    def test_valid_signature_is_accepted(self):
        self.assertTrue(self.faucet.verify_signature(self.address, self.message, self.signature))

    def test_signature_from_another_wallet_is_rejected(self):
        address, signature, nonce = helpers.sign_svm_claim(signer_seed=bytes(range(1, 33)))
        message = helpers.CLAIM_MESSAGE.format(nonce=nonce)

        self.assertFalse(self.faucet.verify_signature(address, message, signature))

    def test_different_message_is_rejected(self):
        other = helpers.CLAIM_MESSAGE.format(nonce='999')
        self.assertFalse(self.faucet.verify_signature(self.address, other, self.signature))

    def test_malformed_input_returns_false_and_never_raises(self):
        for bad in ('', '0x', 'not-base58!!', None):
            self.assertFalse(self.faucet.verify_signature(self.address, self.message, bad))
            self.assertFalse(self.faucet.verify_signature(bad, self.message, self.signature))




############################################################
# SvmNetworksPayloadTests
############################################################

class SvmNetworksPayloadTests(unittest.TestCase):

    def test_payload_shape(self):
        entry = helpers.make_svm_faucet().get_networks()['networks']['testsvm']

        self.assertEqual(entry['symbol'], 'SOL')
        self.assertEqual(entry['decimals'], 9)
        self.assertEqual(entry['cluster'], 'devnet')
        self.assertEqual(entry['chunk_size'], 0.5)
        self.assertIsInstance(entry['rpc_urls'], list)

    def test_default_network_is_always_a_configured_key(self):
        # DEFAULT_NETWORK ('solanaDevnet') is not in this fixture,
        # so the payload must fall back to the lowest picker id
        # rather than naming a network the frontend cannot find
        payload = helpers.make_svm_faucet().get_networks()

        self.assertIn(payload['default_network'], payload['networks'])

    def test_never_leaks_the_backend_rpc(self):
        payload = json.dumps(helpers.make_svm_faucet().get_networks())

        self.assertNotIn('rpc_url"', payload)
        self.assertNotIn('TEST_RPC_SECRET', payload)
        self.assertNotIn('sekretas-iš-env', payload)




############################################################
# SvmRequestFlowTests
############################################################
#
# The claim path end to end: the gates, their order, and the
# cooldown lifecycle — the same contract the other two
# faucets are held to in test_request_flows.py.
############################################################

class SvmRequestFlowTests(unittest.TestCase):

    CHUNK_LAMPORTS = 500_000_000        # 0.5 SOL
    FUNDED = 10_000_000_000             # 10 SOL

    def setUp(self):
        self.faucet = helpers.make_svm_faucet()
        self.address, self.signature, self.nonce = helpers.sign_svm_claim()

    def fake(self, user_lamports=0, faucet_lamports=None, **kwargs):
        balances = {
            self.address: user_lamports,
            self.faucet.FAUCET_ADDRESS: self.FUNDED if faucet_lamports is None else faucet_lamports,
        }
        return helpers.fake_solana_rpc(self.faucet, 'testsvm', balances=balances, **kwargs)

    def claim(self):
        return self.faucet.request_sol('testsvm', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testsvm', self.address) in self.faucet.cooldowns._last_claim

    def test_happy_path_broadcasts_and_keeps_the_cooldown(self):
        client = self.fake()
        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(data['amount'], 0.5)
        self.assertEqual(data['network'], 'testsvm')
        self.assertTrue(data['transaction_id'])
        self.assertEqual(len(client.sent), 1)
        self.assertTrue(self.claimed())

    def test_broadcast_is_a_real_signed_transaction(self):
        # The payout is genuinely built and signed — only the
        # transport is faked
        import base64
        from solders.transaction import Transaction

        client = self.fake()
        self.claim()

        tx = Transaction.from_bytes(base64.b64decode(client.sent[0]))
        self.assertEqual(str(tx.message.account_keys[0]), self.faucet.FAUCET_ADDRESS)
        self.assertIn(self.address, [str(k) for k in tx.message.account_keys])

    def test_payout_drops_the_cached_balance(self):
        self.fake()
        self.faucet._balance_cache['testsvm'] = (9999999999, 42.0)
        self.claim()

        self.assertNotIn('testsvm', self.faucet._balance_cache)

    def test_wrong_signer_is_403(self):
        self.fake()
        address, signature, nonce = helpers.sign_svm_claim(signer_seed=bytes(range(1, 33)))
        data, status = self.faucet.request_sol('testsvm', address, signature, nonce)

        self.assertEqual(status, 403)
        self.assertFalse(('testsvm', address) in self.faucet.cooldowns._last_claim)

    def test_wallet_already_funded_is_400_without_claiming(self):
        self.fake(user_lamports=self.CHUNK_LAMPORTS)
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
        self.fake(faucet_lamports=1000)
        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertFalse(self.claimed())

    def test_faucet_must_cover_the_fee_and_its_own_rent_too(self):
        # Exactly the chunk is NOT enough — the signature costs 5000
        # lamports, and the faucet account must keep its rent-exempt
        # minimum (890 880) after paying or the node rejects the
        # transfer. One lamport short of that is the friendly 503.
        reserve = 5000 + 890880
        self.fake(faucet_lamports=self.CHUNK_LAMPORTS)
        self.assertEqual(self.claim()[1], 503)

        client = self.fake(faucet_lamports=self.CHUNK_LAMPORTS + reserve - 1)
        data, status = self.claim()
        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertEqual(client.sent, [])
        self.assertFalse(self.claimed())

        self.fake(faucet_lamports=self.CHUNK_LAMPORTS + reserve)
        self.assertEqual(self.claim()[1], 200)

    def test_an_unset_placeholder_fails_the_boot(self):
        configs = copy.deepcopy(helpers.SVM_TEST_CONFIGS)
        configs['testsvm']['faucet']['rpc_url'] = 'https://<NOT_SET_ANYWHERE>/rpc'

        with self.assertRaises(ValueError) as caught:
            helpers.make_svm_faucet(configs)
        self.assertIn('NOT_SET_ANYWHERE', str(caught.exception))

    def test_transport_error_traceback_is_scrubbed(self):
        # The resolved <TEST_RPC_SECRET> must never reach the log,
        # whatever the transport puts in its exception text
        secret = 'sekretas-iš-env'
        self.fake(balance_error=f"HTTPSConnectionPool(host='127.0.0.1', port=9): Max retries exceeded with url: /{secret}")

        logging.disable(logging.NOTSET)
        try:
            with self.assertLogs(level='ERROR') as captured:
                self.faucet.get_faucet_balance('testsvm')
        finally:
            logging.disable(logging.CRITICAL)

        self.assertNotIn(secret, '\n'.join(captured.output))

    def test_broadcast_failure_releases_the_cooldown(self):
        self.fake(broadcast_error='blockhash not found')
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertFalse(self.claimed())
        self.assertNotIn('blockhash', str(data))       # no raw RPC text to students

        self.fake()
        self.assertEqual(self.claim()[1], 200)          # retry works immediately

    def test_invalid_address_never_claims_a_slot(self):
        self.fake()
        for bad in ('0x' + 'ab' * 20, 'not-an-address', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'):
            data, status = self.faucet.request_sol('testsvm', bad, self.signature, self.nonce)
            self.assertEqual(status, 400)
            self.assertFalse((('testsvm', bad) in self.faucet.cooldowns._last_claim))

    def test_paying_the_faucet_itself_is_refused(self):
        self.fake()
        data, status = self.faucet.request_sol(
            'testsvm', self.faucet.FAUCET_ADDRESS, self.signature, self.nonce)

        self.assertEqual(status, 400)
        self.assertIn('čiaupo adresą', data['error'])

    def test_unsupported_network_is_400(self):
        data, status = self.faucet.request_sol('nosuchnet', self.address, self.signature, self.nonce)
        self.assertEqual(status, 400)

    def test_missing_parameters_are_400(self):
        self.fake()
        for args in (('', self.signature, self.nonce),
                     (self.address, '', self.nonce),
                     (self.address, self.signature, '')):
            self.assertEqual(self.faucet.request_sol('testsvm', *args)[1], 400)


if __name__ == '__main__':
    unittest.main()
