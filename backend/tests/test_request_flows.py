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
#    - a wallet invoice pasted whole pays the address inside
#      it, under that address' cooldown, the invoice itself
#      never checked
#    - the balance and the coin selection count every coin
#      once, also in the seconds after a block, when ElectrumX
#      lists what the block confirmed twice
#    - every refusal maps to the right HTTP status
#      (400 / 403 / 429 / 500 / 503)
#    - a failure on the chain's side names its cause in the
#      student's answer — the server's, the node's, the
#      contract's — and never a secret
#
#  Everything is offline: Electrum, the Web3 transport and the
#  token contract are faked (tests/helpers.py), but the
#  signature verification is REAL — claims carry genuine
#  signatures from throwaway keys.
############################################################


import io
import copy
import socket
import contextlib
import logging
import unittest

from embit import ec as embit_ec
from embit import base58 as embit_base58
from embit import hashes as embit_hashes
from embit import script as embit_script
from embit.transaction import Transaction

import requests
from web3.exceptions import ContractCustomError, ContractLogicError, Web3RPCError

from app.utxo_faucet.utxo_faucet import _distinct_outpoints, _invoice_address
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

    # The fee the balance gate adds to the chunk: one SegWit input
    # and two outputs at btc4's 10 sat/vB
    FEE_1_IN_2_OUT = (91 + 2 * 31 + 10) * 10

    # A node's broadcast rejections, as the Electrum client raises
    # them (ElectrumX relays the node's reason inside the message)
    CHAIN_TOO_LONG = ("Electrum error: {'code': 1, 'message': 'the transaction was rejected by network rules.\\n\\n"
                      "too-long-mempool-chain, too many unconfirmed ancestors [limit: 25]\\n[0200]'}")
    MISSING_INPUTS = ("Electrum error: {'code': 1, 'message': 'the transaction was rejected by network rules.\\n\\n"
                      "bad-txns-inputs-missingorspent\\n[0200]'}")

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

    def test_happy_path_pays_exactly_one_chunk(self):
        # The config's 0.01 BTC must land on the wire as 1_000_000
        # satoshi, in the first output, to the student — the
        # echoed 'amount' proves nothing about the transaction
        self.faucet.request_crypto('btc4', self.recipient)

        tx = Transaction.from_string(self.captured['raw'])
        self.assertEqual(tx.vout[0].value, 1_000_000)
        self.assertEqual(tx.vout[0].script_pubkey.address({'bech32': 'tb'}), self.recipient)

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

    def test_a_node_refusing_a_too_long_chain_asks_to_wait_for_a_block(self):
        # The node's own too-long-mempool-chain answer — the faucet
        # counts nothing itself — is a 503 telling the student to
        # wait for the next block. The slot is released and the
        # refused payout marks no outputs as spent.
        self.client.request = lambda method, params: (_ for _ in ()).throw(RuntimeError(self.CHAIN_TOO_LONG))

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 503)
        self.assertIn('naujas blokas', data['error'])
        self.assertFalse(self.claimed())
        self.assertFalse(self.faucet._recently_spent.get('btc4'))

    def test_other_node_rejections_are_named_not_called_a_wait(self):
        # Only that one reason means "wait for a block" — any other
        # is translated, with the node's own words in parentheses
        self.client.request = lambda method, params: (_ for _ in ()).throw(RuntimeError(self.MISSING_INPUTS))

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko išsiųsti transakcijos: čiaupo monetos, kurias bandyta išleisti, '
                                        'jau išleistos arba tinklas jų dar nemato (bad-txns-inputs-missingorspent).')
        self.assertFalse(self.claimed())

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

    def test_unknown_network_is_400(self):
        # The caller's mistake, answered like every other family
        data, status = self.faucet.request_crypto('nosuchnet', self.recipient)
        self.assertEqual(status, 400)
        self.assertIn('error', data)

    def test_a_bech32_address_with_a_broken_checksum_is_400(self):
        # One wrong character: refused up front as a bad address, not
        # a 500 from inside the transaction builder
        typo = self.recipient[:-1] + ('q' if self.recipient[-1] != 'q' else 'p')

        data, status = self.faucet.request_crypto('btc4', typo)

        self.assertEqual(status, 400)
        self.assertIn('Neteisingas adresas', data['error'])
        self.assertNotIn('raw', self.captured)
        self.assertFalse(self.claimed(typo))

    def test_the_faucet_key_in_base58_form_is_refused(self):
        # btc4 also accepts legacy recipients, so the faucet key has a
        # p2pkh twin the wallet never watches — coins sent there would
        # be lost, not returned
        pub = self.faucet.faucet_key.get_public_key()
        twin = embit_base58.encode_check(b'\x6f' + embit_hashes.hash160(pub.sec()))

        data, status = self.faucet.request_crypto('btc4', twin)

        self.assertEqual(status, 400)
        self.assertIn('čiaupo adresą', data['error'])
        self.assertNotIn('raw', self.captured)

    def test_a_failed_payout_is_logged(self):
        # The operator gets a server-side record of every failed payout
        self.client.request = lambda method, params: (_ for _ in ()).throw(RuntimeError('electrum down'))

        logging.disable(logging.NOTSET)
        try:
            with self.assertLogs(level='ERROR') as captured:
                self.faucet.request_crypto('btc4', self.recipient)
        finally:
            logging.disable(logging.CRITICAL)

        self.assertIn('electrum down', '\n'.join(captured.output))

    def test_an_unreachable_electrum_server_is_named(self):
        # Told by what the server did, never by its address
        refused = ConnectionRefusedError(111, 'Connection refused')
        self.client.request = lambda method, params: (_ for _ in ()).throw(refused)

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 500)
        self.assertEqual(data, {'error': 'Nepavyko išsiųsti transakcijos: nepavyko prisijungti prie Electrum serverio.'})
        self.assertFalse(self.claimed())

    def test_a_failed_balance_read_in_a_claim_is_named_and_releases_the_slot(self):
        def silent(scripthash):
            raise socket.timeout('timed out')

        self.client.get_balance = silent

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko gauti čiaupo balanso: Electrum serveris neatsakė per 15 s.')
        self.assertNotIn('raw', self.captured)
        self.assertFalse(self.claimed())

    def test_chunk_size_converts_to_satoshis_by_rounding(self):
        # 0.29 * 1e8 is 28999999.999999996 in binary — the wire must
        # carry the 0.29 the message promises
        configs = copy.deepcopy(helpers.UTXO_TEST_CONFIGS)
        configs['btc4']['faucet']['chunk_size'] = 0.29
        faucet = helpers.make_utxo_faucet(configs)
        captured = helpers.fake_electrum(faucet, 'btc4', [{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 100_000_000}])

        data, status = faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 200)
        self.assertEqual(Transaction.from_string(captured['raw']).vout[0].value, 29_000_000)

    def test_a_failed_balance_read_is_not_retried_on_the_next_poll(self):
        # While Electrum is down every 5 s poll from every tab would
        # otherwise repeat the round-trip (timeout, reconnect, retry,
        # all under the client lock) — the failure is remembered
        reads = []

        def down(scripthash):
            reads.append(1)
            raise OSError('electrum down')

        self.client.get_balance = down

        self.assertEqual(self.faucet.get_faucet_balance('btc4')[1], 500)
        self.assertEqual(self.faucet.get_faucet_balance('btc4')[1], 500)
        self.assertEqual(len(reads), 1)

    def test_a_balance_short_of_chunk_plus_fee_is_the_friendly_503(self):
        # Exactly one chunk confirmed, nothing left for the fee: the
        # message that sends the last student to the lecturer, not a
        # 500 from inside the builder
        helpers.fake_electrum(self.faucet, 'btc4', [{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 1_000_000}])
        self.client.get_balance = lambda scripthash: {'confirmed': 0.01, 'unconfirmed': 0.0, 'total': 0.01}

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertFalse(self.claimed())

    def test_a_balance_exactly_at_chunk_plus_fee_pays(self):
        # The gate refuses only BELOW the chunk plus a 1-in/2-out
        # fee — at exactly that much, the last student still gets
        # paid
        balance = 0.01 + self.FEE_1_IN_2_OUT / 1e8
        self.client.get_balance = lambda scripthash: {'confirmed': balance, 'unconfirmed': 0.0, 'total': balance}

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 200, data)

    def test_a_balance_one_satoshi_short_is_refused_before_any_coin_is_picked(self):
        # The confirmed balance decides, whatever the server lists:
        # a spendable coin is there, but the gate still says no
        balance = 0.01 + (self.FEE_1_IN_2_OUT - 1) / 1e8
        self.client.get_balance = lambda scripthash: {'confirmed': balance, 'unconfirmed': 0.0, 'total': balance}

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 503)
        self.assertNotIn('raw', self.captured)
        self.assertFalse(self.claimed())

    def test_a_funded_balance_with_no_free_coin_is_a_503_saying_so(self):
        # The confirmed balance is there, but every coin is tied up
        # in payouts not yet confirmed — not the same as an empty
        # faucet, and the sentence says which
        helpers.fake_electrum(self.faucet, 'btc4', [])

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 503)
        self.assertEqual(data['error'], 'Čiaupas šiuo metu neturi laisvų monetų — visos jos panaudotos dar '
                                        'nepatvirtintose išmokose. Palaukite naujo bloko; jei nepadės, '
                                        'praneškite dėstytojui.')
        self.assertFalse(self.claimed())

    def test_a_just_spent_outpoint_is_not_spent_again_on_the_next_claim(self):
        # The server keeps listing a just-spent outpoint until its
        # next mempool refresh — the claim right behind a payout must
        # spend the CHANGE the first one created, not the same coin.
        # One 0.05 output: the change after a payout still covers the
        # next chunk
        self.captured = helpers.fake_electrum(self.faucet, 'btc4', [{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 5_000_000}])
        self.faucet.request_crypto('btc4', self.recipient)
        first = Transaction.from_string(self.captured['raw'])
        spent = (first.vin[0].txid, 0)

        other = embit_script.p2wpkh(embit_ec.PrivateKey(bytes.fromhex('dd' * 32)).get_public_key()).address({'bech32': 'tb'})
        data, status = self.faucet.request_crypto('btc4', other)

        self.assertEqual(status, 200, data)
        second = Transaction.from_string(self.captured['raw'])
        self.assertNotIn(spent, {(vin.txid, vin.vout) for vin in second.vin})
        self.assertEqual(second.vin[0].txid, first.txid())           # the first payout's change

    def test_get_networks_exports_the_configured_block_explorer(self):
        # The page links the payout's txid there
        configs = copy.deepcopy(helpers.UTXO_TEST_CONFIGS)
        configs['btc4']['explorer'] = {'block_explorer': 'https://mempool.space/testnet4'}
        networks = helpers.make_utxo_faucet(configs).get_networks()['networks']

        self.assertEqual(networks['btc4']['block_explorer'], 'https://mempool.space/testnet4')
        self.assertIsNone(networks['knf']['block_explorer'])

    def test_cooldown_is_per_network(self):
        # A claim on btc4 must not lock the same address out of knf
        self.faucet.request_crypto('btc4', self.recipient)
        self.assertEqual(self.faucet.cooldowns.claim(('knf', self.recipient.lower())), 0)








############################################################
# PastedInvoiceTests
############################################################
#
# request_crypto given a wallet invoice instead of a bare
# address — what students copy out of Electrum and the KNF
# wallet. Only the address inside it counts: it is validated,
# keys the cooldown and gets paid, while the invoice around it
# is never checked, so a wallet that changes how it writes
# invoices never breaks the faucet.
############################################################

class PastedInvoiceTests(unittest.TestCase):

    # The invoices exactly as students pasted them — the KNF
    # wallet writes its own under Litecoin's name
    LTC_ADDRESS = 'tltc1qnjzjrwg5mhraxqyljwjdmr3s4g8lxt237xlq7q'
    KNF_ADDRESS = 'knf1qqlyk4qjhny45mpn5hsdga48z3e3mf9syurgy4g'
    LTC_INVOICE = f'litecoin:{LTC_ADDRESS}?time=1792950812&exp=86400'
    KNF_INVOICE = f'litecoin:{KNF_ADDRESS}?time=1792950785&exp=86400'

    # Enough for ltc4's and knf's 1000-coin chunk plus its fee
    UTXOS = [{'tx_hash': 'bb' * 32, 'tx_pos': 0, 'value': 200_000_000_000}]

    def setUp(self):
        self.faucet = helpers.make_utxo_faucet()

    def pay(self, network, text):
        # One claim against a funded fake Electrum server; the
        # captured raw transaction comes back with the answer
        captured = helpers.fake_electrum(self.faucet, network, self.UTXOS)
        self.faucet._electrum_clients[network].get_balance = \
            lambda scripthash: {'confirmed': 5000.0, 'unconfirmed': 0.0, 'total': 5000.0}
        data, status = self.faucet.request_crypto(network, text)
        return data, status, captured

    def paid_to(self, network, captured, address):
        # Does the payout output go to this address' script?
        tx = Transaction.from_string(captured['raw'])
        return tx.vout[0].script_pubkey.data == self.faucet.network_dialect(network).recipient_script(address).data

    def claimed(self, network, address):
        return (network, address.lower()) in self.faucet.cooldowns._last_claim

    def test_the_invoices_students_paste_pay_the_address_inside_them(self):
        for network, invoice, address in (('ltc4', self.LTC_INVOICE, self.LTC_ADDRESS),
                                          ('knf', self.KNF_INVOICE, self.KNF_ADDRESS)):
            with self.subTest(network=network):
                data, status, captured = self.pay(network, invoice)

                self.assertEqual(status, 200, data)
                self.assertTrue(self.paid_to(network, captured, address))
                self.assertTrue(self.claimed(network, address))

    def test_a_fresh_invoice_for_an_address_just_paid_is_inside_its_cooldown(self):
        # A new invoice carries a new time — the cooldown is the
        # address', so asking again through one changes nothing
        self.pay('ltc4', self.LTC_INVOICE)
        data, status, captured = self.pay('ltc4', f'litecoin:{self.LTC_ADDRESS}?time=1792950999&exp=86400')

        self.assertEqual(status, 429)
        self.assertNotIn('raw', captured)

    def test_the_invoice_around_the_address_is_never_checked(self):
        # Any coin's name in any case, slashes after it, any
        # parameters or none, stray whitespace — all paid
        for text in (f'knfcoin:{self.LTC_ADDRESS}?time=1',
                     f'LITECOIN:{self.LTC_ADDRESS}?exp=86400',
                     f'litecoin://{self.LTC_ADDRESS}?amount=abc&&label=x=y',
                     f'litecoin:{self.LTC_ADDRESS}',
                     f'  litecoin:{self.LTC_ADDRESS}?time=1  ',
                     f' {self.LTC_ADDRESS} '):
            with self.subTest(text=text):
                self.faucet = helpers.make_utxo_faucet()
                data, status, captured = self.pay('ltc4', text)

                self.assertEqual(status, 200, data)
                self.assertTrue(self.paid_to('ltc4', captured, self.LTC_ADDRESS))

    def test_an_invoice_around_a_bad_address_is_400_and_claims_no_slot(self):
        # The address inside still has to be a real one — validated
        # before the cooldown, like a bare address
        for text in (f'litecoin:{self.LTC_ADDRESS[:-1]}p?time=1', 'litecoin:?time=1', 'litecoin:'):
            with self.subTest(text=text):
                data, status, captured = self.pay('ltc4', text)

                self.assertEqual(status, 400)
                self.assertEqual(data['error'], 'Neteisingas adresas')
                self.assertNotIn('raw', captured)
                self.assertFalse(self.faucet.cooldowns._last_claim)

    def test_a_bare_address_is_left_as_it_is(self):
        # No address format the faucet speaks has a colon or a
        # question mark — only the surrounding whitespace goes
        for address in (self.LTC_ADDRESS, self.KNF_ADDRESS, helpers.ANCHOR_DOGE_RECIPIENT):
            with self.subTest(address=address):
                self.assertEqual(_invoice_address(f'  {address}\n'), address)








############################################################
# BlockWindowTests
############################################################
#
# The faucet's balance and coin selection on btc4 across a
# block, answered the way ElectrumX 1.18 answers: for up to
# five seconds after a block its mempool view still holds the
# transactions the block confirmed, so its balance answer
# counts them twice (confirmed AND unconfirmed) and its UTXO
# list names their outputs twice. The page must read the same
# total before, during and after that window, and a claim in
# it must spend each coin once.
############################################################

class BlockWindowTests(unittest.TestCase):

    # 0.25 sent back to the faucet, which also holds 1.0
    HELD = {'tx_hash': 'aa' * 32, 'tx_pos': 0, 'height': 100, 'value': 100_000_000}
    RETURNED = {'tx_hash': 'bb' * 32, 'tx_pos': 1, 'value': 25_000_000}

    # The faucet's own payout confirming: the 0.05 coin it spent
    # and the 0.0398 change it created
    CHANGE = {'tx_hash': 'cc' * 32, 'tx_pos': 1, 'value': 3_980_000}

    def setUp(self):
        self.faucet = helpers.make_utxo_faucet()
        self.captured = helpers.fake_electrum(self.faucet, 'btc4', [])
        self.client = self.faucet._electrum_clients['btc4']

        prv = embit_ec.PrivateKey(bytes.fromhex(helpers.RECIPIENT_PRIVATE_KEY))
        self.recipient = embit_script.p2wpkh(prv.get_public_key()).address({'bech32': 'tb'})

    def answer(self, client, confirmed, unconfirmed, listed):
        # The server's two answers at one moment — the balance in
        # whole coins, the list in satoshis
        client.get_balance = lambda scripthash: {'confirmed': confirmed, 'unconfirmed': unconfirmed,
                                                 'total': confirmed + unconfirmed}
        client.list_unspent = lambda scripthash: [dict(u) for u in listed]

    def balance(self):
        # What the page polls, past the balance cache
        self.faucet._balance_cache.clear()
        data, status = self.faucet.get_faucet_balance('btc4')
        self.assertEqual(status, 200, data)
        return data

    def test_coins_sent_back_read_the_same_total_before_during_and_after_the_block(self):
        returned_unconfirmed = dict(self.RETURNED, height=0)
        returned_confirmed = dict(self.RETURNED, height=101)

        self.answer(self.client, 1.0, 0.25, [self.HELD, returned_unconfirmed])
        before = self.balance()
        # The block is in the database, the mempool view not yet
        # refreshed: 0.25 in both parts, its coin listed twice
        self.answer(self.client, 1.25, 0.25, [self.HELD, returned_confirmed, returned_unconfirmed])
        during = self.balance()
        self.answer(self.client, 1.25, 0.0, [self.HELD, returned_confirmed])
        after = self.balance()

        self.assertEqual([before['balance'], during['balance'], after['balance']], [1.25, 1.25, 1.25])
        self.assertEqual((during['balance_confirmed'], during['balance_unconfirmed']), (1.25, 0.0))

    def test_the_faucets_own_payout_confirming_does_not_dip_the_balance(self):
        # The stale view still nets the spent 0.05 against the change:
        # the server's own sum would read 0.0296 for those seconds
        self.answer(self.client, 0.0398, -0.0102, [dict(self.CHANGE, height=101), dict(self.CHANGE, height=0)])

        during = self.balance()

        self.assertEqual(during['balance'], 0.0398)
        self.assertEqual(during['balance_unconfirmed'], 0.0)

    def test_a_claim_in_the_window_spends_a_coin_listed_twice_only_once(self):
        # A payout naming one coin twice is refused by the node
        coin = {'tx_hash': 'dd' * 32, 'tx_pos': 0, 'value': 5_000_000}
        self.answer(self.client, 0.05, 0.05, [dict(coin, height=101), dict(coin, height=0)])

        data, status = self.faucet.request_crypto('btc4', self.recipient)

        self.assertEqual(status, 200, data)
        inputs = [(vin.txid.hex(), vin.vout) for vin in Transaction.from_string(self.captured['raw']).vin]
        self.assertEqual(inputs, [(coin['tx_hash'], 0)])

    def test_the_warm_up_caches_the_same_reading(self):
        # The first page load is answered from what the warm-up read
        for client in self.faucet._electrum_clients.values():
            client.connect = lambda: None
            self.answer(client, 1.25, 0.25, [self.HELD, dict(self.RETURNED, height=101), dict(self.RETURNED, height=0)])

        with contextlib.redirect_stdout(io.StringIO()):
            self.faucet._warm_up_networks()

        self.assertEqual(self.faucet._balance_cache['btc4'][1]['total'], 1.25)

    def test_each_coin_is_kept_once_the_first_copy_in_the_servers_order(self):
        listed = [dict(self.HELD), dict(self.RETURNED, height=101), dict(self.RETURNED, height=0),
                  dict(self.RETURNED, tx_pos=2, height=0)]

        distinct = _distinct_outpoints(listed)

        self.assertEqual([(u['tx_hash'][:2], u['tx_pos'], u['height']) for u in distinct],
                         [('aa', 0, 100), ('bb', 1, 101), ('bb', 2, 0)])








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

    def test_missing_parameters_are_400_without_touching_the_rpc(self):
        # Local checks first: a typo must not cost a round-trip (or
        # a 10 s wait while the RPC is down) to be called a typo
        eth = helpers.unreachable_web3(self.faucet, 'testchain')
        data, status = self.faucet.request_eth('testchain', self.address, '', self.nonce)

        self.assertEqual(status, 400)
        self.assertEqual(eth.probes, 0)

    def test_bad_address_is_400_without_touching_the_rpc(self):
        eth = helpers.unreachable_web3(self.faucet, 'testchain')
        data, status = self.faucet.request_eth('testchain', 'not-an-address', self.signature, self.nonce)

        self.assertEqual(status, 400)
        self.assertEqual(eth.probes, 0)

    def test_an_unreachable_rpc_is_named_in_the_refusal(self):
        helpers.unreachable_web3(self.faucet, 'testchain')
        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertEqual(data['error'], 'Tinklas nepasiekiamas: nepavyko prisijungti prie tinklo RPC serverio. '
                                        'Bandykite vėliau.')

    def test_unreachable_chain_id_probe_is_not_repeated_per_claim(self):
        # An outage costs one probe (and its timeout), not one per
        # claim — the failure is remembered for the cache TTL
        eth = helpers.unreachable_web3(self.faucet, 'testchain')

        self.assertEqual(self.claim()[1], 503)
        self.assertEqual(self.claim()[1], 503)
        self.assertEqual(eth.probes, 1)

    def test_failed_balance_read_is_not_retried_on_the_next_poll(self):
        # Same rule for the balance the page polls every 3 s
        eth = self.fake(balance_error='rpc down')
        reads = []
        real_get_balance = eth.get_balance
        eth.get_balance = lambda *args, **kwargs: (reads.append(1), real_get_balance(*args, **kwargs))[1]

        self.assertEqual(self.faucet.get_faucet_balance('testchain')[1], 500)
        self.assertEqual(self.faucet.get_faucet_balance('testchain')[1], 500)
        self.assertEqual(len(reads), 1)

    def test_gas_price_is_quoted_outside_the_send_lock(self):
        # The lock is for nonce + broadcast; a slow price quote must
        # not hold the whole chain's payouts
        eth = helpers.lock_watching_web3(
            self.faucet, 'testchain', {self.address: 0, self.faucet.FAUCET_ADDRESS: 10 ** 20})

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertIs(eth.quoted_under_lock, False)

    def test_wallet_that_cannot_cover_value_plus_gas_is_503(self):
        # The node reserves value + gas_limit × gasPrice up front:
        # one wei short of that is "faucet empty", not a broadcast the
        # node bounces as a retryable 500 forever
        gas_price = 20_000_000_000                          # 20 gwei
        reservation = 210_000 * gas_price
        eth = self.fake(faucet_balance=self.CHUNK_WEI + reservation - 1, gas_price=gas_price)
        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertEqual(eth.sent, [])
        self.assertFalse(self.claimed())

        eth = self.fake(faucet_balance=self.CHUNK_WEI + reservation, gas_price=gas_price)
        self.assertEqual(self.claim()[1], 200)

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

    def test_a_broadcast_the_node_refuses_names_its_reason(self):
        # The node's reason translated, its own words in parentheses
        # — what the lecturer reads off the student's screen
        refusal = Web3RPCError('refused', rpc_response={'error': {
            'code': -32000, 'message': 'insufficient funds for gas * price + value'}})
        self.fake(broadcast_error=refusal)
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko išsiųsti transakcijos: čiaupo piniginėje nepakanka lėšų sumai ir '
                                        'tinklo mokesčiui padengti (insufficient funds for gas * price + value).')
        self.assertFalse(self.claimed())

    def test_a_failure_never_shows_the_rpc_secret(self):
        # requests puts the full RPC URL into its errors — the value
        # <TEST_RPC_SECRET> resolved to must never reach the student
        self.fake(broadcast_error=RuntimeError('POST http://127.0.0.1:9/sekretas-iš-env failed'))
        data, _ = self.claim()

        self.assertNotIn('sekretas-iš-env', data['error'])
        self.assertIn('<redacted>', data['error'])

    def test_a_failed_faucet_balance_read_releases_the_cooldown(self):
        # The slot is claimed before the faucet reads its own
        # balance — one RPC hiccup there must not lock the student
        # out for the whole cooldown
        eth = self.fake(balance_errors={self.faucet.FAUCET_ADDRESS: requests.ConnectionError('refused')})
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko gauti čiaupo balanso: nepavyko prisijungti prie tinklo RPC serverio.')
        self.assertEqual(eth.sent, [])
        self.assertFalse(self.claimed())

        self.fake()
        self.assertEqual(self.claim()[1], 200)

    def test_a_failed_student_balance_read_is_500_without_claiming(self):
        self.fake(balance_errors={self.address: requests.ReadTimeout('read timed out')})
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko gauti jūsų piniginės balanso: tinklo RPC serveris neatsakė per 10 s.')
        self.assertFalse(self.claimed())

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

    def test_wrong_chain_id_is_500_without_claiming(self):
        # The RPC answers another chain than the config says — no
        # payout over a misconfigured endpoint, and no slot taken
        eth = self.fake(chain_id=999)
        data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Tinklo konfigūracijos klaida: RPC serveris priklauso kitam tinklui '
                                        '(jo grandinės ID 999, o turi būti 12345). Praneškite dėstytojui.')
        self.assertEqual(eth.sent, [])
        self.assertFalse(self.claimed())

    def test_chain_id_check_is_cached_after_the_first_success(self):
        # One good answer settles the gate for the process — a later
        # bad one is never asked for, so the cooldown refusal wins
        eth = self.fake()
        self.claim()
        eth.chain_id = 999

        data, status = self.claim()
        self.assertEqual(status, 429)








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
        self.TOKENS = {self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}

    def fake(self, native_balance=None, faucet_native_balance=10 ** 20, **kwargs):
        return helpers.fake_web3(
            self.evm, 'testchain',
            balances={
                self.address: self.ENOUGH_GAS if native_balance is None else native_balance,
                self.evm.FAUCET_ADDRESS: faucet_native_balance,
            },
            **kwargs,
        )

    def claim(self):
        return self.faucet.request_tokens('testchain', 'TST', self.address, self.signature, self.nonce)

    def claimed(self):
        return ('testchain', 'TST', self.address.lower()) in self.faucet.cooldowns._last_claim

    def word(self, address):
        # An address as one 32-byte ABI word, the way revert data
        # carries a custom error's arguments
        return address.lower().removeprefix('0x').rjust(64, '0')

    def test_missing_parameters_are_400_without_touching_the_rpc(self):
        # Same rule as the native flow: local checks before any RPC
        eth = helpers.unreachable_web3(self.evm, 'testchain')
        data, status = self.faucet.request_tokens('testchain', 'TST', self.address, '', self.nonce)

        self.assertEqual(status, 400)
        self.assertEqual(eth.probes, 0)

    def test_a_transfer_the_node_says_reverts_is_not_broadcast(self):
        # estimate_gas EXECUTES the transfer: a ContractLogicError is
        # the node's verdict that it fails — refuse and release the
        # slot instead of broadcasting a transfer that burns gas
        self.fake()
        with helpers.fake_token_contract(self.TOKENS, estimate_error=ContractLogicError('execution reverted')) as contract:
            data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertEqual(data['error'], 'Nepavyko išsiųsti TST: žetono sutartis atmetė pervedimą, nenurodžiusi '
                                        'priežasties. Praneškite dėstytojui.')
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())

    def test_a_token_with_locked_transfers_is_named_not_called_empty(self):
        # FOLD's answer on Sepolia before its token generation event:
        # the custom error TransferRestricted(from, to). The faucet
        # holds the tokens — "the faucet is empty" would be a lie.
        locked = ContractCustomError('0xcede7487', data='0xcede7487' + self.word(self.evm.FAUCET_ADDRESS)
                                     + self.word(self.address))
        self.fake()
        with helpers.fake_token_contract(self.TOKENS, estimate_error=locked) as contract:
            data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertEqual(data['error'], 'Nepavyko išsiųsti TST: žetono sutartis kol kas neleidžia pervedimų '
                                        '(TransferRestricted). Praneškite dėstytojui.')
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())

    def test_gas_price_is_quoted_outside_the_send_lock(self):
        eth = helpers.lock_watching_web3(
            self.evm, 'testchain', {self.address: self.ENOUGH_GAS, self.evm.FAUCET_ADDRESS: 10 ** 20})

        with helpers.fake_token_contract(self.TOKENS):
            data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertIs(eth.quoted_under_lock, False)

    def test_token_payout_from_a_gasless_faucet_wallet_is_503(self):
        # No native coin on the faucet wallet — transfer() can't be
        # paid for, so the answer is "tell the lecturer", not a 200
        # for a transfer that never broadcasts
        self.fake(faucet_native_balance=0)
        with helpers.fake_token_contract(self.TOKENS) as contract:
            data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertIn('mokesčiams', data['error'])
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())

    def test_a_faucet_wallet_one_wei_short_of_the_gas_is_503(self):
        # The transfer costs its 90 000 gas limit times the gas
        # price: one wei short of that is "tell the lecturer", at
        # exactly that much the payout goes out
        gas_price = 20_000_000_000                          # 20 gwei
        gas_cost = 90_000 * gas_price

        self.fake(faucet_native_balance=gas_cost - 1, gas_price=gas_price)
        with helpers.fake_token_contract(self.TOKENS) as contract:
            data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertIn('mokesčiams', data['error'])
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())

        self.fake(faucet_native_balance=gas_cost, gas_price=gas_price)
        with helpers.fake_token_contract(self.TOKENS):
            self.assertEqual(self.claim()[1], 200)

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

    def test_a_failed_faucet_token_balance_read_releases_the_cooldown(self):
        # Claimed first, then the faucet's token balance is read —
        # a hiccup there must not cost the student their slot
        self.fake()
        failing = {self.evm.FAUCET_ADDRESS: requests.ReadTimeout('read timed out')}
        with helpers.fake_token_contract(self.TOKENS, balance_errors=failing) as contract:
            data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko gauti čiaupo TST balanso: tinklo RPC serveris neatsakė per 10 s.')
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())

    def test_a_failed_faucet_gas_balance_read_releases_the_cooldown(self):
        # The faucet's own native coin is read last, to pay the gas
        self.fake(balance_errors={self.evm.FAUCET_ADDRESS: requests.ConnectionError('refused')})
        with helpers.fake_token_contract(self.TOKENS) as contract:
            data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko gauti čiaupo balanso tinklo mokesčiams: nepavyko prisijungti '
                                        'prie tinklo RPC serverio.')
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())

    def test_a_failed_student_balance_read_is_500_without_claiming(self):
        self.fake(balance_errors={self.address: requests.ReadTimeout('read timed out')})
        with helpers.fake_token_contract(self.TOKENS):
            data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(data['error'], 'Nepavyko gauti jūsų piniginės balanso: tinklo RPC serveris neatsakė per 10 s.')
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

    def test_wrong_chain_id_is_500_without_claiming(self):
        # The native faucet's config-sanity gate guards token payouts too
        self.fake(chain_id=999)
        with helpers.fake_token_contract({self.evm.FAUCET_ADDRESS: 100 * 10 ** 18}) as contract:
            data, status = self.claim()

        self.assertEqual(status, 500)
        self.assertEqual(contract.transfers, [])
        self.assertFalse(self.claimed())


if __name__ == '__main__':
    unittest.main()
