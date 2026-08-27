############################################################
#  [*] UTXO engine regression tests
#
#  Pins the embit payout builder to the byte anchors recorded
#  during the bitcoinlib→embit migration (both engines
#  produced the IDENTICAL txid for these inputs). Everything
#  here is offline: Electrum is faked, nothing touches the
#  network, and the key is a throwaway.
#
#  If a test fails after a DELIBERATE change to the builder,
#  re-record the anchor in helpers.py and say so in the
#  commit. If you didn't change the builder — you just caught
#  a payout regression; do not touch the anchor.
############################################################


import unittest
import hashlib

from embit import ec
from embit import bech32
from embit import script as embit_script
from embit.transaction import Transaction

from tests import helpers




############################################################
# UtxoEngineTests
############################################################
#
# One faked-Electrum faucet per test; payouts are built for
# real (selection, fee, signing) and captured at broadcast.
############################################################

class UtxoEngineTests(unittest.TestCase):

    def build_payout(self, network='knf', utxos=None, amount=helpers.ANCHOR_AMOUNT_SAT, to_address=None):
        # Build one payout end to end with faked Electrum and
        # return (parsed tx, ctx).
        faucet = helpers.make_utxo_faucet()
        captured = helpers.fake_electrum(faucet, network, utxos or helpers.ANCHOR_UTXOS)
        ctx = faucet._setup_wallet_for_network(network)

        if to_address is None:
            prv = ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
            to_address = embit_script.p2wpkh(prv.get_public_key()).address({'bech32': ctx.dialect.hrp})

        faucet._create_and_broadcast_transaction(ctx, to_address, amount)
        return Transaction.from_string(captured['raw']), ctx

    def test_faucet_address_anchor(self):
        # Same key must always derive the same knf address
        faucet = helpers.make_utxo_faucet()
        ctx = faucet._setup_wallet_for_network('knf')
        self.assertEqual(ctx.address, helpers.ANCHOR_KNF_ADDRESS)

    def test_litecoin_faucet_address_anchor(self):
        # The Litecoin dialect: same key, 'tltc' HRP — and a
        # Bitcoin-testnet recipient is refused on it
        faucet = helpers.make_utxo_faucet()
        ctx = faucet._setup_wallet_for_network('ltc4')
        self.assertEqual(ctx.dialect.hrp, 'tltc')
        self.assertEqual(ctx.address, helpers.ANCHOR_LTC_ADDRESS)
        self.assertTrue(faucet._validate_address(ctx, helpers.ANCHOR_LTC_RECIPIENT))
        prv = ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
        self.assertFalse(faucet._validate_address(ctx, embit_script.p2wpkh(prv.get_public_key()).address({'bech32': 'tb'})))

    def test_litecoin_payout_pays_the_recipient(self):
        # The whole build on the Litecoin dialect: the payout output
        # decodes back to the tltc recipient
        tx, ctx = self.build_payout(network='ltc4', to_address=helpers.ANCHOR_LTC_RECIPIENT)
        self.assertEqual(tx.vout[0].value, helpers.ANCHOR_AMOUNT_SAT)
        self.assertEqual(tx.vout[0].script_pubkey.address({'bech32': 'tltc'}), helpers.ANCHOR_LTC_RECIPIENT)

    def test_txid_anchor(self):
        # The full non-witness serialization is pinned by the txid
        tx, _ = self.build_payout()
        self.assertTrue(tx.txid().hex().startswith(helpers.ANCHOR_TXID_PREFIX),
                        f'txid drifted: {tx.txid().hex()}')

    def test_build_is_deterministic(self):
        # RFC-6979 signing: two identical builds are byte-identical
        tx1, _ = self.build_payout()
        tx2, _ = self.build_payout()
        self.assertEqual(tx1.serialize(), tx2.serialize())

    def test_signatures_verify(self):
        # Every witness signature must verify against its BIP-143 sighash
        tx, ctx = self.build_payout()
        pub = ctx.key.get_public_key()
        script_code = embit_script.Script(b'\x76\xa9\x14' + ctx.script_pubkey.data[2:] + b'\x88\xac')

        for i, utxo in enumerate(helpers.ANCHOR_UTXOS):
            witness = tx.vin[i].witness.items
            self.assertEqual(witness[1], pub.serialize())
            self.assertEqual(witness[0][-1], 1)  # SIGHASH_ALL byte
            sig = ec.Signature.parse(witness[0][:-1])
            sighash = tx.sighash_segwit(i, script_code, utxo['value'])
            self.assertTrue(pub.verify(sig, sighash), f'bad signature on input {i}')

    def test_change_output_returns_to_faucet(self):
        # 2 outputs: payout + change, and change pays our own script
        tx, ctx = self.build_payout()
        self.assertEqual(len(tx.vout), 2)
        self.assertEqual(tx.vout[1].script_pubkey.data, ctx.script_pubkey.data)

    def test_sub_dust_change_is_dropped(self):
        # total = amount + fee + sub-dust remainder -> single output
        fee = (2 * 91 + 2 * 31 + 10) * 10  # matches _estimate_fee at rate 10
        utxos = [
            {'tx_hash': '33' * 32, 'tx_pos': 0, 'value': 200000},
            {'tx_hash': '44' * 32, 'tx_pos': 1, 'value': 50000 + fee + 100},
        ]
        tx, _ = self.build_payout(utxos=utxos, amount=250000)
        self.assertEqual(len(tx.vout), 1)

    def test_insufficient_funds_raises(self):
        with self.assertRaises(ValueError):
            self.build_payout(utxos=[{'tx_hash': '55' * 32, 'tx_pos': 0, 'value': 1000}])

    def test_wrong_hrp_recipient_raises(self):
        # A tb1... address on the knf network must be rejected
        prv = ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
        tb_address = embit_script.p2wpkh(prv.get_public_key()).address({'bech32': 'tb'})
        with self.assertRaises(ValueError):
            self.build_payout(to_address=tb_address)

    def test_a_witness_version_no_chain_has_activated_is_refused(self):
        # bech32 encodes versions up to 16, but only v0 and v1
        # (taproot) are spendable — anything else is anyone-can-spend
        faucet = helpers.make_utxo_faucet()
        ctx = faucet._setup_wallet_for_network('btc4')
        future = bech32.encode('tb', 2, b'\x00' * 32)

        self.assertFalse(faucet._validate_address(ctx, future))
        with self.assertRaises(ValueError):
            ctx.dialect.recipient_script(future)

    def test_taproot_recipient_script(self):
        # A v1 (bech32m) recipient becomes OP_1 PUSH32 <program>
        prv = ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
        from embit import bech32 as embit_bech32
        taproot_addr = embit_bech32.encode('knf', 1, prv.get_public_key().serialize()[1:33])
        tx, _ = self.build_payout(to_address=taproot_addr)
        self.assertEqual(tx.vout[0].script_pubkey.data[:2], b'\x51\x20')

    def test_scripthash_derivation(self):
        # Electrum scripthash = sha256(script) reversed, same on every chain
        faucet = helpers.make_utxo_faucet()
        ctx_knf = faucet._setup_wallet_for_network('knf')
        ctx_btc = faucet._setup_wallet_for_network('btc4')
        expected = hashlib.sha256(ctx_knf.script_pubkey.data).digest()[::-1].hex()
        self.assertEqual(ctx_knf.scripthash, expected)
        self.assertEqual(ctx_btc.scripthash, expected)
        self.assertNotEqual(ctx_knf.address, ctx_btc.address)

    def test_legacy_recipient_on_segwit_chain(self):
        # btc4 pays an old-wallet base58 recipient: p2pkh output,
        # inputs still witness-signed
        from embit import base58 as embit_base58, hashes as embit_hashes
        prv = ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
        keyhash = embit_hashes.hash160(prv.get_public_key().serialize())
        legacy_addr = embit_base58.encode_check(b'\x6f' + keyhash)

        tx, _ = self.build_payout(network='btc4', to_address=legacy_addr)
        self.assertEqual(tx.vout[0].script_pubkey.data[:3], b'\x76\xa9\x14')
        self.assertEqual(tx.vout[0].script_pubkey.data[3:23], keyhash)
        self.assertTrue(tx.is_segwit)

    def test_segwit_chain_legacy_recipient_validation(self):
        # btc4 accepts its own legacy p2pkh/p2sh recipients, rejects
        # other chains' version bytes; KNF (no prefixes) rejects all
        from embit import base58 as embit_base58
        faucet = helpers.make_utxo_faucet()
        ctx_btc = faucet._setup_wallet_for_network('btc4')
        ctx_knf = faucet._setup_wallet_for_network('knf')

        btc_p2pkh = embit_base58.encode_check(b'\x6f' + b'\x11' * 20)
        btc_p2sh = embit_base58.encode_check(b'\xc4' + b'\x22' * 20)
        self.assertTrue(faucet._validate_address(ctx_btc, btc_p2pkh))
        self.assertTrue(faucet._validate_address(ctx_btc, btc_p2sh))
        # doge testnet p2pkh (0x71) must not pass as btc (0x6f)
        self.assertFalse(faucet._validate_address(ctx_btc, helpers.ANCHOR_DOGE_RECIPIENT))
        self.assertFalse(faucet._validate_address(ctx_knf, btc_p2pkh))




############################################################
# UtxoLegacyDialectTests
############################################################
#
# The legacy (pre-SegWit, base58/p2pkh) dialect on the doge3
# test network: address derivation and validation, the p2pkh
# payout build (scriptSig unlocking, no witnesses, legacy
# wire format) and the legacy sighash signatures.
############################################################

class UtxoLegacyDialectTests(unittest.TestCase):

    def build_payout(self, utxos=None, amount=helpers.ANCHOR_DOGE_AMOUNT_SAT, to_address=None):
        faucet = helpers.make_utxo_faucet()
        captured = helpers.fake_electrum(faucet, 'doge3', utxos or helpers.ANCHOR_DOGE_UTXOS)
        ctx = faucet._setup_wallet_for_network('doge3')

        faucet._create_and_broadcast_transaction(
            ctx, to_address or helpers.ANCHOR_DOGE_RECIPIENT, amount)
        return Transaction.from_string(captured['raw']), ctx

    def test_legacy_faucet_address_anchor(self):
        # Same key must always derive the same base58 doge address
        from app.utxo_faucet.dialects import LegacyDialect
        faucet = helpers.make_utxo_faucet()
        ctx = faucet._setup_wallet_for_network('doge3')
        self.assertIsInstance(ctx.dialect, LegacyDialect)
        self.assertEqual(ctx.address, helpers.ANCHOR_DOGE_ADDRESS)

    def test_legacy_scripthash_differs_from_segwit(self):
        # p2pkh and p2wpkh identities are different Electrum scripthashes
        faucet = helpers.make_utxo_faucet()
        ctx_doge = faucet._setup_wallet_for_network('doge3')
        ctx_knf = faucet._setup_wallet_for_network('knf')
        expected = hashlib.sha256(ctx_doge.script_pubkey.data).digest()[::-1].hex()
        self.assertEqual(ctx_doge.scripthash, expected)
        self.assertNotEqual(ctx_doge.scripthash, ctx_knf.scripthash)

    def test_legacy_payout_wire_format(self):
        # No witnesses, non-empty scriptSigs, version 1, and the
        # payout output is the recipient's p2pkh script
        tx, _ = self.build_payout()
        self.assertFalse(tx.is_segwit)
        self.assertEqual(tx.version, 1)
        for vin in tx.vin:
            self.assertTrue(len(vin.script_sig.data) > 0)
            self.assertEqual(len(vin.witness.items), 0)
        self.assertEqual(tx.vout[0].script_pubkey.data[:3], b'\x76\xa9\x14')
        self.assertEqual(tx.vout[0].script_pubkey.data[-2:], b'\x88\xac')

    def test_legacy_signatures_verify(self):
        # Every scriptSig is <DER sig + SIGHASH_ALL> <pubkey> and the
        # signature verifies against the legacy sighash
        tx, ctx = self.build_payout()
        pub = ctx.key.get_public_key()

        for i in range(len(tx.vin)):
            data = tx.vin[i].script_sig.data
            sig_len = data[0]
            der_sig, rest = data[1:1 + sig_len], data[1 + sig_len:]
            self.assertEqual(rest[0], len(rest) - 1)  # pubkey push
            self.assertEqual(rest[1:], pub.serialize())
            self.assertEqual(der_sig[-1], 1)  # SIGHASH_ALL byte

            unsigned = Transaction(version=tx.version, vin=[
                type(vin)(vin.txid, vin.vout) for vin in tx.vin
            ], vout=tx.vout, locktime=tx.locktime)
            sighash = unsigned.sighash_legacy(i, ctx.script_pubkey)
            sig = ec.Signature.parse(der_sig[:-1])
            self.assertTrue(pub.verify(sig, sighash), f'bad signature on input {i}')

    def test_legacy_change_returns_to_faucet_p2pkh(self):
        tx, ctx = self.build_payout()
        self.assertEqual(len(tx.vout), 2)
        self.assertEqual(tx.vout[1].script_pubkey.data, ctx.script_pubkey.data)

    def test_legacy_address_validation(self):
        faucet = helpers.make_utxo_faucet()
        ctx = faucet._setup_wallet_for_network('doge3')

        self.assertTrue(faucet._validate_address(ctx, helpers.ANCHOR_DOGE_RECIPIENT))
        # bech32 addresses do not exist on a legacy chain
        self.assertFalse(faucet._validate_address(ctx, 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'))
        # right alphabet, wrong version byte (Bitcoin mainnet P2PKH)
        from embit import base58 as embit_base58
        btc_style = embit_base58.encode_check(b'\x00' + b'\x11' * 20)
        self.assertFalse(faucet._validate_address(ctx, btc_style))
        # corrupted checksum
        self.assertFalse(faucet._validate_address(ctx, helpers.ANCHOR_DOGE_RECIPIENT[:-1] + 'x'))
        # p2sh recipient accepted (p2sh_prefix configured)
        p2sh_style = embit_base58.encode_check(b'\xc4' + b'\x22' * 20)
        self.assertTrue(faucet._validate_address(ctx, p2sh_style))

    def test_segwit_networks_reject_legacy_addresses(self):
        faucet = helpers.make_utxo_faucet()
        ctx = faucet._setup_wallet_for_network('knf')
        self.assertFalse(faucet._validate_address(ctx, helpers.ANCHOR_DOGE_RECIPIENT))





############################################################
# UtxoConsolidationTests
############################################################
#
# Coin selection on btc4 (0.01 chunk, SegWit sizes at
# 10 sat/vB): largest first for the chunk, then a few of the
# smallest outputs folded in — dust and real coins alike — so
# a payout stays small and fixed in size while the wallet
# tidies itself towards one output. The faucet publishes its
# address and asks for leftovers back, so junk outputs are a
# fact of life. Change exactly AT the dust limit is a standard
# output and comes back.
############################################################

CHUNK_SAT = 1_000_000
FEE_1_IN_2_OUT = (91 + 2 * 31 + 10) * 10     # 1630 sat, matches _estimate_fee
MARGINAL_INPUT_FEE = 91 * 10                 # what one more SegWit input adds
DUST_LIMIT = 546
MAX_INPUTS_PER_PAYOUT = 5
BIG_UTXO = {'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 2_000_000}


def p2wpkh_address(private_key_hex, hrp='tb'):
    prv = ec.PrivateKey(bytes.fromhex(private_key_hex))
    return embit_script.p2wpkh(prv.get_public_key()).address({'bech32': hrp})


class UtxoConsolidationTests(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_utxo_faucet()
        self.recipient = p2wpkh_address(helpers.RECIPIENT_PRIVATE_KEY)

    def claim(self, address=None):
        return self.faucet.request_crypto('btc4', address or self.recipient)

    def last_tx(self, captured):
        return Transaction.from_string(captured['raw'])

    def dust(self, count):
        return [{'tx_hash': f'{i:02x}' * 32, 'tx_pos': 0, 'value': 500} for i in range(1, count + 1)]

    def students(self, count):
        return [p2wpkh_address(f'{i:02x}' * 32) for i in range(1, count + 1)]

    def dust_count(self, server):
        return sum(1 for u in server.utxos if u['value'] < MARGINAL_INPUT_FEE)

    def test_a_payout_from_a_cluttered_wallet_carries_only_a_few_inputs(self):
        # 200 × 500 sat returns listed ahead of one real output: the
        # payout takes some of them along, never all of them
        captured = helpers.fake_electrum(self.faucet, 'btc4', self.dust(200) + [BIG_UTXO])

        data, status = self.claim()

        self.assertEqual(status, 200)
        inputs = len(self.last_tx(captured).vin)
        self.assertGreaterEqual(inputs, 2)
        self.assertLessEqual(inputs, MAX_INPUTS_PER_PAYOUT)

    def test_the_chunk_comes_from_the_largest_output(self):
        captured = helpers.fake_electrum(self.faucet, 'btc4', self.dust(200) + [BIG_UTXO])
        self.claim()
        tx = self.last_tx(captured)
        self.assertEqual(tx.vin[0].txid[::-1].hex(), BIG_UTXO['tx_hash'])
        self.assertEqual(tx.vout[0].value, CHUNK_SAT)

    def test_a_second_output_is_folded_in_even_when_the_first_one_suffices(self):
        # The 0.02 output alone covers the chunk — the payout still
        # brings the 20 000 sat one along, so the wallet tidies itself
        captured = helpers.fake_electrum(self.faucet, 'btc4', [BIG_UTXO, {'tx_hash': 'bb' * 32, 'tx_pos': 0, 'value': 20_000}])

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(len(self.last_tx(captured).vin), 2)

    def test_an_extra_that_would_push_the_change_negative_is_left(self):
        # Exactly the chunk plus its 1-in/2-out fee: no room to pay for
        # a second input, so the dust stays for a richer payout
        exact = {'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': CHUNK_SAT + FEE_1_IN_2_OUT}
        captured = helpers.fake_electrum(self.faucet, 'btc4', [exact] + self.dust(3))

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(len(self.last_tx(captured).vin), 1)

    def test_the_wallet_converges_to_one_output_over_successive_payouts(self):
        # Ten 0.05 outputs, ten students: a few extras per payout
        # fold the wallet down to a single change output
        outputs = [{'tx_hash': f'{i:02x}' * 32, 'tx_pos': 0, 'value': 5_000_000} for i in range(1, 11)]
        server = helpers.FollowingElectrum(self.faucet, 'btc4', outputs)

        for student in self.students(10):
            data, status = self.claim(address=student)
            self.assertEqual(status, 200, data)

        self.assertEqual(len(server.utxos), 1)

    def test_dust_is_cleaned_up_over_successive_payouts(self):
        # 30 dust outputs, 30 students: every payout sweeps a few
        # along, so the address is clean well before the last claim
        server = helpers.FollowingElectrum(
            self.faucet, 'btc4', self.dust(30) + [{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 100_000_000}])

        payouts = 0
        for student in self.students(30):
            data, status = self.claim(address=student)
            self.assertEqual(status, 200, data)
            payouts += 1
            if not self.dust_count(server):
                break

        self.assertEqual(self.dust_count(server), 0)
        self.assertLessEqual(payouts, 8)

    def test_change_exactly_at_the_dust_limit_is_returned(self):
        exact = {'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': CHUNK_SAT + FEE_1_IN_2_OUT + DUST_LIMIT}
        captured = helpers.fake_electrum(self.faucet, 'btc4', [exact])

        data, status = self.claim()

        self.assertEqual(status, 200)
        tx = self.last_tx(captured)
        self.assertEqual(len(tx.vout), 2)
        self.assertEqual(tx.vout[1].value, DUST_LIMIT)

    def test_change_one_below_the_dust_limit_goes_to_the_miners(self):
        exact = {'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': CHUNK_SAT + FEE_1_IN_2_OUT + DUST_LIMIT - 1}
        captured = helpers.fake_electrum(self.faucet, 'btc4', [exact])

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(len(self.last_tx(captured).vout), 1)


if __name__ == '__main__':
    unittest.main()
