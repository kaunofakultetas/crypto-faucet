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
            to_address = embit_script.p2wpkh(prv.get_public_key()).address({'bech32': ctx.hrp})

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


if __name__ == '__main__':
    unittest.main()
