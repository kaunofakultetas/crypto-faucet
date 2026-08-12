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


if __name__ == '__main__':
    unittest.main()
