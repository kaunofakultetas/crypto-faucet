############################################################
#  [*] Request-flow tests — the three claim paths end to end
#
#  The engines are pinned elsewhere (test_utxo_engine.py's
#  byte anchors, test_cooldown.py's claim semantics); THIS
#  file pins the ORCHESTRATION around them — the part where a
#  regression means double payouts or locked-out students:
#
#    - the order of the gates (validation before the cooldown
#      is claimed, so a typo never costs a student their slot)
#    - the cooldown is KEPT on success and RELEASED on every
#      failure after the claim
#    - the balance cache is dropped after a payout
#    - every refusal maps to the right HTTP status
#      (400 / 403 / 429 / 500 / 503)
#
#  Everything is offline: Electrum, the Web3 transport and the
#  token contract are faked (tests/helpers.py), but the
#  signature verification is REAL — claims carry genuine
#  signatures from throwaway keys.
############################################################


import logging
import unittest

from embit import ec as embit_ec
from embit import script as embit_script

from tests import helpers


# Half these tests make the transport fail ON PURPOSE, and the
# faucets log those with logging.exception — real tracebacks in
# a passing run read like something broke. Silenced for this
# module only.
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)




############################################################
# UtxoRequestFlowTests
############################################################
#
# request_crypto on btc4: the address gates, the cooldown
# lifecycle and the payout bookkeeping.
############################################################

class UtxoRequestFlowTests(unittest.TestCase):

    # Enough to cover the 0.01 BTC chunk plus fees
    UTXOS = [{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 2_000_000}]

    def setUp(self):
        self.faucet = helpers.make_utxo_faucet()
        self.captured = helpers.fake_electrum(self.faucet, 'btc4', self.UTXOS)
        self.client = self.faucet._electrum_clients['btc4']

        prv = embit_ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
        self.recipient = embit_script.p2wpkh(prv.get_public_key()).address({'bech32': 'tb'})

    def claimed(self, address=None):
        # Is the cooldown slot for this address taken?
        return ('btc4', (address or self.recipient).lower()) in self.faucet.cooldowns._last_claim

    def test_happy_path_pays_and_keeps_the_cooldown(self):
        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 200)
        self.assertEqual(data['transaction_id'], 'txid-ok')
        self.assertEqual(data['amount'], 0.01)
        self.assertEqual(data['network'], 'btc4')
        self.assertTrue(self.captured['raw'])
        self.assertTrue(self.claimed())

    def test_payout_drops_the_cached_balance(self):
        # The page polls the cache — a stale hit would hide the payout
        self.faucet._balance_cache['btc4'] = (9999999999, {'confirmed': 1.0, 'unconfirmed': 0.0, 'total': 1.0})
        self.faucet.request_crypto('btc4', self.recipient)
        self.assertNotIn('btc4', self.faucet._balance_cache)

    def test_second_claim_inside_the_window_is_429(self):
        self.faucet.request_crypto('btc4', self.recipient)
        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 429)
        self.assertIn('sek', data['error'])

    def test_broadcast_failure_releases_the_cooldown(self):
        # A failed payout must not cost the student their slot
        self.client.request = lambda method, params: (_ for _ in ()).throw(RuntimeError('electrum down'))

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 500)
        self.assertFalse(self.claimed())

    def test_retry_after_a_failure_succeeds(self):
        # The released slot must be immediately reusable
        self.client.request = lambda method, params: (_ for _ in ()).throw(RuntimeError('electrum down'))
        self.faucet.request_crypto('btc4', self.recipient)

        helpers.fake_electrum(self.faucet, 'btc4', self.UTXOS)
        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 200)

    def test_empty_faucet_is_503_and_releases_the_cooldown(self):
        self.client.get_balance = lambda scripthash: {'confirmed': 0.0, 'unconfirmed': 0.0, 'total': 0.0}

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertFalse(self.claimed())

    def test_invalid_address_never_claims_a_slot(self):
        # Validation runs BEFORE the cooldown — a typo must not lock
        # the student out for a minute
        data, status = self.faucet.request_crypto('btc4', helpers.ANCHOR_DOGE_RECIPIENT)

        self.assertEqual(status, 400)
        self.assertFalse(self.claimed(helpers.ANCHOR_DOGE_RECIPIENT))

    def test_missing_address_is_400(self):
        data, status = self.faucet.request_crypto('btc4', '')
        self.assertEqual(status, 400)

    def test_paying_the_faucet_itself_is_refused(self):
        ctx = self.faucet._setup_wallet_for_network('btc4')
        data, status = self.faucet.request_crypto('btc4', ctx.address)

        self.assertEqual(status, 400)
        self.assertIn('čiaupo adresą', data['error'])

    def test_unknown_network_is_500_not_a_crash(self):
        data, status = self.faucet.request_crypto('nosuchnet', self.recipient)
        self.assertEqual(status, 500)
        self.assertIn('error', data)

    def test_cooldown_is_per_network(self):
        # A claim on btc4 must not lock the same address out of knf
        self.faucet.request_crypto('btc4', self.recipient)
        self.assertEqual(self.faucet.cooldowns.claim(('knf', self.recipient.lower())), 0)




############################################################
# EvmRequestFlowTests
############################################################
#
# request_eth on the test chain: real signature verification,
# the eligibility gates and the cooldown lifecycle. The chain
# pays 0.05 tETH per claim.
############################################################

class EvmRequestFlowTests(unittest.TestCase):

    CHUNK_WEI = 50_000_000_000_000_000     # 0.05 ETH

    def setUp(self):
        self.faucet = helpers.make_evm_faucet()
        self.address, self.signature, self.nonce = helpers.sign_claim()

    def fake(self, user_balance=0, faucet_balance=10 ** 20, **kwargs):
        return helpers.fake_web3(
            self.faucet, 'testchain',
            balances={self.address: user_balance, self.faucet.FAUCET_ADDRESS: faucet_balance},
            **kwargs,
        )

    def claim(self):
        return self.faucet.request_eth('testchain', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testchain', self.address.lower()) in self.faucet.cooldowns._last_claim

    def test_happy_path_broadcasts_the_chunk(self):
        eth = self.fake()
        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(data['amount'], 0.05)
        self.assertEqual(len(eth.sent), 1)
        self.assertEqual(eth.sent[0]['to'], self.address)
        self.assertEqual(eth.sent[0]['value'], self.CHUNK_WEI)
        self.assertEqual(eth.sent[0]['from'], self.faucet.FAUCET_ADDRESS)
        self.assertTrue(self.claimed())

    def test_payout_drops_the_cached_balance(self):
        self.fake()
        self.faucet._balance_cache['testchain'] = (9999999999, {'balance': 1})
        self.claim()
        self.assertNotIn('testchain', self.faucet._balance_cache)

    def test_wrong_signer_is_403(self):
        # Signature made by a DIFFERENT key than the address claimed
        self.fake()
        address, signature, nonce = helpers.sign_claim(signer_key=helpers.TEST_PRIVATE_KEY)
        data, status = self.faucet.request_eth('testchain', address, signature, nonce)

        self.assertEqual(status, 403)
        self.assertFalse(('testchain', address.lower()) in self.faucet.cooldowns._last_claim)

    def test_tampered_nonce_is_403(self):
        # The signature covers the nonce — replaying it under another
        # nonce must fail recovery
        self.fake()
        data, status = self.faucet.request_eth('testchain', self.address, self.signature, '999')
        self.assertEqual(status, 403)

    def test_garbage_signature_is_403(self):
        self.fake()
        data, status = self.faucet.request_eth('testchain', self.address, '0xdeadbeef', self.nonce)
        self.assertEqual(status, 403)

    def test_wallet_already_funded_is_400_without_claiming(self):
        self.fake(user_balance=self.CHUNK_WEI)
        data, status = self.claim()

        self.assertEqual(status, 400)
        self.assertIn('jau yra pakankamai', data['error'])
        self.assertFalse(self.claimed())

    def test_second_claim_is_429(self):
        self.fake()
        self.claim()
        data, status = self.claim()

        self.assertEqual(status, 429)
        self.assertIn('sek', data['error'])

    def test_empty_faucet_is_503_and_releases_the_cooldown(self):
        self.fake(faucet_balance=1)
        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertFalse(self.claimed())

    def test_broadcast_failure_releases_the_cooldown(self):
        self.fake(broadcast_error='rpc exploded')
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertFalse(self.claimed())
        # and the student can retry immediately
        self.fake()
        self.assertEqual(self.claim()[1], 200)

    def test_broadcast_failure_never_leaks_the_raw_error(self):
        self.fake(broadcast_error='insufficient funds for gas * price + value')
        data, _ = self.claim()
        self.assertNotIn('gas * price', str(data))

    def test_unsupported_network_is_400(self):
        data, status = self.faucet.request_eth('nosuchnet', self.address, self.signature, self.nonce)
        self.assertEqual(status, 400)

    def test_missing_parameters_are_400(self):
        self.fake()
        for args in (('', self.signature, self.nonce),
                     (self.address, '', self.nonce),
                     (self.address, self.signature, '')):
            data, status = self.faucet.request_eth('testchain', *args)
            self.assertEqual(status, 400)




############################################################
# Erc20RequestFlowTests
############################################################
#
# request_tokens on the test chain: the gas gate (half the
# native chunk), the token-balance gates and the cooldown
# lifecycle. The token pays 4 TST (18 decimals) per claim.
############################################################

class Erc20RequestFlowTests(unittest.TestCase):

    CHUNK = 4 * 10 ** 18                   # 4 TST
    ENOUGH_GAS = 30_000_000_000_000_000    # 0.03 ETH > the 0.025 threshold

    def setUp(self):
        self.evm = helpers.make_evm_faucet()
        self.faucet = helpers.make_erc20_faucet(evm_faucet=self.evm)
        self.address, self.signature, self.nonce = helpers.sign_claim()

    def fake(self, native_balance=None, **kwargs):
        return helpers.fake_web3(
            self.evm, 'testchain',
            balances={self.address: self.ENOUGH_GAS if native_balance is None else native_balance},
            **kwargs,
        )

    def claim(self):
        return self.faucet.request_tokens('testchain', 'TST', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testchain', 'TST', self.address.lower()) in self.faucet.cooldowns._last_claim

    def test_happy_path_transfers_the_chunk(self):
        self.fake()
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}) as contract:
            data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(data['token'], 'TST')
        self.assertEqual(data['amount'], 4.0)
        self.assertEqual(len(contract.transfers), 1)
        to_address, amount, tx = contract.transfers[0]
        self.assertEqual(to_address, self.address)
        self.assertEqual(amount, self.CHUNK)
        self.assertEqual(tx['gas'], 90000)  # the 60000 estimate * 1.5
        self.assertTrue(self.claimed())

    def test_payout_drops_the_cached_balance(self):
        self.fake()
        self.faucet._balance_cache[('TST', 'testchain')] = (9999999999, 1.0)
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}):
            self.claim()
        self.assertNotIn(('TST', 'testchain'), self.faucet._balance_cache)

    def test_gasless_wallet_is_400_and_points_at_the_native_faucet(self):
        # Below half the native chunk — tokens would be unusable
        self.fake(native_balance=1)
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}):
            data, status = self.claim()

        self.assertEqual(status, 400)
        self.assertIn('tinklo mokesčiams', data['error'])
        self.assertIn('Test Chain', data['error'])
        self.assertFalse(self.claimed())

    def test_gas_exactly_at_the_threshold_passes(self):
        # The gate is "below the threshold", not "at or below"
        self.fake(native_balance=25_000_000_000_000_000)
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}):
            data, status = self.claim()

        self.assertEqual(status, 200)

    def test_wallet_already_holding_a_chunk_is_400_without_claiming(self):
        self.fake()
        balances = {self.evm.FAUCET_ADDRESS: 100 * 10 ** 18, self.address: self.CHUNK}
        with helpers.fake_token_contract(balances):
            data, status = self.claim()

        self.assertEqual(status, 400)
        self.assertIn('jau yra pakankamai', data['error'])
        self.assertFalse(self.claimed())

    def test_second_claim_is_429(self):
        self.fake()
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}):
            self.claim()
            data, status = self.claim()

        self.assertEqual(status, 429)

    def test_empty_faucet_is_503_and_releases_the_cooldown(self):
        self.fake()
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 0}):
            data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertFalse(self.claimed())

    def test_transfer_failure_releases_the_cooldown(self):
        self.fake()
        balances = {self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}
        with helpers.fake_token_contract(balances, transfer_error='reverted'):
            data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertFalse(self.claimed())

    def test_gas_estimate_failure_falls_back_to_a_fixed_limit(self):
        # zkSync-style chains reject estimation — the payout must
        # still go out, with the 100000 fallback
        self.fake()
        balances = {self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}
        with helpers.fake_token_contract(balances, estimate_error='not supported') as contract:
            data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(contract.transfers[0][2]['gas'], 100000)

    def test_wrong_signer_is_403(self):
        self.fake()
        address, signature, nonce = helpers.sign_claim(signer_key=helpers.TEST_PRIVATE_KEY)
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}):
            data, status = self.faucet.request_tokens('testchain', 'TST', address, signature, nonce)

        self.assertEqual(status, 403)

    def test_unknown_token_is_400(self):
        data, status = self.faucet.request_tokens('testchain', 'NOPE', self.address, self.signature, self.nonce)
        self.assertEqual(status, 400)

    def test_token_not_deployed_on_that_network_is_400(self):
        # TST lists ghostchain, but that network isn't configured
        data, status = self.faucet.request_tokens('ghostchain', 'TST', self.address, self.signature, self.nonce)
        self.assertEqual(status, 400)

    def test_missing_parameters_are_400(self):
        self.fake()
        data, status = self.faucet.request_tokens('testchain', 'TST', self.address, '', self.nonce)
        self.assertEqual(status, 400)


if __name__ == '__main__':
    unittest.main()
