############################################################
#  [*] UTXO faucet — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up. Each test states the
#  behaviour the faucet SHOULD have and — all but one, see
#  ConsolidationTests — is marked @unittest.expectedFailure
#  because today it does not.
#  The moment a fix lands, unittest reports the test as an
#  "unexpected success" — which FAILS the run — and that is
#  the cue: drop the decorator and move the test into its
#  home file (test_request_flows.py, test_utxo_engine.py).
#
#  Offline, on the engine tests' fakes (tests/helpers.py):
#  the throwaway key, a canned Electrum client, payouts
#  built and signed for real and captured at broadcast.
#
#  Reviewed and deliberately NOT pinned, because the vision
#  says otherwise: no rate limit beyond the per-address
#  cooldown (a fresh address walks around it — accepted, see
#  app/cooldown.py); the payout stays a GET (the API shape of
#  every family — a change there is a design decision, not a
#  fix); unconfirmed change is spent, up to the node's
#  ancestor limit (accepted, see request_crypto STEP 3);
#  Electrum certificates are not verified (weighed, see
#  electrum_client.py); an over-long FAUCET_PRIVATE_KEY is
#  truncated, not refused (the EVM faucet pins that as its
#  design and the three faucets must derive one identity);
#  the raw exception rides in the payload's 'details' (a
#  documented debugging aid for a lab tool).
############################################################


import logging
import unittest

from embit import ec
from embit import bech32
from embit import script as embit_script
from embit.transaction import Transaction

from tests import helpers


# Several tests make Electrum fail ON PURPOSE. Silenced for this
# module only; PayoutFailureLoggingTests re-enables logging,
# since the log output IS what it checks.
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


# btc4: 0.01 tBTC4 chunk, SegWit fee sizes at 10 sat/vB
CHUNK_SAT = 1_000_000
FEE_1_IN_2_OUT = (91 + 2 * 31 + 10) * 10     # 1630 sat, matches _estimate_fee
DUST_LIMIT = 546

BIG_UTXO = {'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 2_000_000}


def p2wpkh_address(private_key_hex, hrp='tb'):
    prv = ec.PrivateKey(bytes.fromhex(private_key_hex))
    return embit_script.p2wpkh(prv.get_public_key()).address({'bech32': hrp})




############################################################
# UtxoClaimCase
############################################################
#
# The btc4 claim fixture of test_request_flows.py, repeated
# here so this file stays standalone: a warmup-free faucet,
# a recipient from the throwaway key, and the fake / claim /
# claimed / last_tx shorthands.
#
# Used by:
#   - the test classes below
############################################################

class UtxoClaimCase(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_utxo_faucet()
        self.recipient = p2wpkh_address(helpers.RECIPIENT_PRIVATE_KEY)

    def fake(self, utxos, network='btc4'):
        return helpers.fake_electrum(self.faucet, network, utxos)

    def claim(self, address=None, network='btc4'):
        return self.faucet.request_crypto(network, address or self.recipient)

    def claimed(self, address=None, network='btc4'):
        return (network, (address or self.recipient).lower()) in self.faucet.cooldowns._last_claim

    def last_tx(self, captured):
        return Transaction.from_string(captured['raw'])




############################################################
# ConsolidationTests
############################################################
#
# Coin selection appends every UTXO the server lists, in
# arrival order, until the target is met — no cap, and it
# stops at ONE input whenever the first output covers the
# chunk. Two problems, one fix. The faucet PUBLISHES its
# address and asks students to send leftovers back, so
# sub-fee outputs accumulate on it, and every later payout
# sweeps them ALL in — burning the balance to fees and
# eventually building a transaction too large to relay.
# And ordinary outputs are never folded together, so the
# wallet fragments instead of tidying itself.
#
# The wanted behaviour: every payout carries the input(s) it
# needs plus A FEW extra outputs of the wallet — dust and
# real coins alike, their cost coming out of the change — so
# the payout stays small and fixed in size, and over
# successive payouts the wallet converges to ONE output.
#
# The one PLAIN test here guards the cleanup half of that:
# it passes today (everything is swept at once) and must
# keep passing once the sweep is bounded — a fix that merely
# filtered dust out would leave the junk there forever.
############################################################

MARGINAL_INPUT_FEE = 91 * 10        # what one more SegWit input adds at 10 sat/vB
MAX_INPUTS_PER_PAYOUT = 5           # "a few": the payout's own input plus a handful of extras


class FollowingElectrum:
    # A canned server whose UTXO set FOLLOWS the payouts: a
    # broadcast removes the inputs it spends and adds the change
    # output it creates, like the real server after a refresh

    def __init__(self, faucet, network, utxos):
        self.utxos = [dict(u) for u in utxos]
        self.faucet_script = faucet._setup_wallet_for_network(network).script_pubkey.data
        client = faucet._electrum_clients[network]
        client.list_unspent = lambda scripthash: [dict(u) for u in self.utxos]
        client.get_balance = lambda scripthash: {'confirmed': 1.0, 'unconfirmed': 0.0, 'total': 1.0}
        client.request = self.broadcast

    def broadcast(self, method, params):
        tx = Transaction.from_string(params[0])
        spent = {(vin.txid[::-1].hex(), vin.vout) for vin in tx.vin}
        self.utxos = [u for u in self.utxos if (u['tx_hash'], u['tx_pos']) not in spent]
        for pos, out in enumerate(tx.vout):
            if out.script_pubkey.data == self.faucet_script:
                self.utxos.append({'tx_hash': tx.txid().hex(), 'tx_pos': pos, 'value': out.value})
        return tx.txid().hex()

    def dust_count(self):
        return sum(1 for u in self.utxos if u['value'] < MARGINAL_INPUT_FEE)


class ConsolidationTests(UtxoClaimCase):

    def dust(self, count):
        return [{'tx_hash': f'{i:02x}' * 32, 'tx_pos': 0, 'value': 500} for i in range(1, count + 1)]

    def students(self, count):
        return [p2wpkh_address(f'{i:02x}' * 32) for i in range(1, count + 1)]

    @unittest.expectedFailure
    def test_a_payout_from_a_cluttered_wallet_carries_only_a_few_inputs(self):
        # 200 × 500 sat returns listed ahead of one real output: the
        # payout takes some of them along, never all of them
        captured = self.fake(self.dust(200) + [BIG_UTXO])

        data, status = self.claim()

        self.assertEqual(status, 200)
        inputs = len(self.last_tx(captured).vin)
        self.assertGreaterEqual(inputs, 2)
        self.assertLessEqual(inputs, MAX_INPUTS_PER_PAYOUT)

    @unittest.expectedFailure
    def test_a_second_output_is_folded_in_even_when_the_first_one_suffices(self):
        # The 0.02 output alone covers the chunk — the payout still
        # brings the 20 000 sat one along, so the wallet tidies itself
        captured = self.fake([BIG_UTXO, {'tx_hash': 'bb' * 32, 'tx_pos': 0, 'value': 20_000}])

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(len(self.last_tx(captured).vin), 2)

    @unittest.expectedFailure
    def test_the_wallet_converges_to_one_output_over_successive_payouts(self):
        # Ten 0.05 outputs, ten students: a few extras per payout
        # fold the wallet down to a single change output
        outputs = [{'tx_hash': f'{i:02x}' * 32, 'tx_pos': 0, 'value': 5_000_000} for i in range(1, 11)]
        server = FollowingElectrum(self.faucet, 'btc4', outputs)

        for student in self.students(10):
            data, status = self.claim(address=student)
            self.assertEqual(status, 200, data)

        self.assertEqual(len(server.utxos), 1)

    def test_dust_is_cleaned_up_over_successive_payouts(self):
        # 30 dust outputs, 30 students: every payout sweeps at least
        # one along, so the address is clean by the last claim
        server = FollowingElectrum(self.faucet, 'btc4', self.dust(30) + [{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': 100_000_000}])

        for student in self.students(30):
            data, status = self.claim(address=student)
            self.assertEqual(status, 200, data)
            if not server.dust_count():
                break

        self.assertEqual(server.dust_count(), 0)




############################################################
# SpentOutpointMemoryTests
############################################################
#
# Selection state lives and dies inside one call. The
# Electrum server keeps listing a just-spent outpoint until
# its next mempool refresh (a few seconds), so the claim
# right behind a payout re-selects the same outpoint, builds
# a conflicting transaction and gets the node's rejection as
# a 500 — two students clicking at once, and one of them
# fails for no reason. This process must remember what it
# just spent.
############################################################

class SpentOutpointMemoryTests(UtxoClaimCase):

    @unittest.expectedFailure
    def test_a_just_spent_outpoint_is_not_spent_again_on_the_next_claim(self):
        captured = self.fake([BIG_UTXO])
        self.claim()
        spent = (self.last_tx(captured).vin[0].txid, 0)

        # A second student, before the server has noticed the first payout
        data, status = self.claim(address=p2wpkh_address('dd' * 32))

        if status == 200:
            outpoints = {(vin.txid, vin.vout) for vin in self.last_tx(captured).vin}
            self.assertNotIn(spent, outpoints)




############################################################
# BalanceGateTests
############################################################
#
# The "faucet is empty" gate compares the balance against
# the chunk alone; the payout needs chunk + fee. A balance
# inside that window passes the gate and fails inside the
# builder, whose ValueError becomes a 500 — the last student
# to drain the faucet gets a server error instead of the
# message that exists to send them to the lecturer. A funded
# balance with nothing spendable listed takes the same road.
############################################################

class BalanceGateTests(UtxoClaimCase):

    @unittest.expectedFailure
    def test_a_balance_short_of_chunk_plus_fee_is_the_friendly_503(self):
        # Exactly one chunk confirmed, nothing left for the fee
        self.fake([{'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': CHUNK_SAT}])
        self.faucet._electrum_clients['btc4'].get_balance = \
            lambda scripthash: {'confirmed': 0.01, 'unconfirmed': 0.0, 'total': 0.01}

        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertFalse(self.claimed())

    @unittest.expectedFailure
    def test_a_funded_balance_with_nothing_spendable_is_the_friendly_503(self):
        self.fake([])

        data, status = self.claim()

        self.assertEqual(status, 503)
        self.assertIn('Čiaupas nebeturi', data['error'])
        self.assertFalse(self.claimed())




############################################################
# FailedBalanceReadRememberedTests
############################################################
#
# Only successful balance reads are cached. While an
# Electrum server is down, every poll from every open tab
# (one per 5 s) repeats the full round-trip — 15 s timeout,
# reconnect, retry, all under the client's lock — instead of
# answering from the remembered failure. Same shape as the
# EVM faucet's pinned test.
############################################################

class FailedBalanceReadRememberedTests(UtxoClaimCase):

    @unittest.expectedFailure
    def test_a_failed_balance_read_is_not_retried_on_the_next_poll(self):
        reads = []

        def down(scripthash):
            reads.append(1)
            raise OSError('electrum down')

        self.faucet._electrum_clients['btc4'].get_balance = down

        self.faucet.get_faucet_balance('btc4')
        self.faucet.get_faucet_balance('btc4')

        self.assertEqual(len(reads), 1)




############################################################
# DustBoundaryChangeTests
############################################################
#
# "Sub-dust change is left to the miners" — but the guard is
# `change > dust_limit`, so change EQUAL to the limit is
# burned too. Relay policy calls an output dust when it is
# BELOW the threshold; 546 sat is a standard output.
############################################################

class DustBoundaryChangeTests(UtxoClaimCase):

    @unittest.expectedFailure
    def test_change_exactly_at_the_dust_limit_is_returned(self):
        exact = {'tx_hash': 'aa' * 32, 'tx_pos': 0, 'value': CHUNK_SAT + FEE_1_IN_2_OUT + DUST_LIMIT}
        captured = self.fake([exact])

        data, status = self.claim()

        self.assertEqual(status, 200)
        self.assertEqual(len(self.last_tx(captured).vout), 2)




if __name__ == '__main__':
    unittest.main()
