############################################################
#  [*] Etherscan explorer regression tests
#
#  Offline checks of the explorer, in three parts:
#
#    pollution   — a recipient that receives calldata is
#                  seeded as a contract (and the flag only
#                  ever escalates), a fetched history with too
#                  many counterparties is flagged as a public
#                  hub instead of stored, trusted addresses
#                  (the faucet itself) are exempt, and flagged
#                  addresses are never scraped again
#    fetch gates — WHEN Etherscan is reached at all: the
#                  incremental resume point, the
#                  live/historical window rule, the
#                  per-address throttle, and degrading to the
#                  cache when the API is down
#    serving     — the flow aggregation inside the day window
#                  and the day list behind the slider
#
#  Each test runs against its own throwaway SQLite file — no
#  network, no real database.
############################################################


import os
import time
import logging
import tempfile
import sqlite3
import unittest
from unittest.mock import patch

from app.evm_faucet.explorer import (
    EtherscanExplorer,
    HUB_COUNTERPARTY_THRESHOLD,
    REORG_OVERLAP_BLOCKS,
)


# Several tests trip the hub warning or make Etherscan fail ON
# PURPOSE, and the explorer logs both — real warnings and
# tracebacks in a passing run read like something broke.
# Silenced for this module only.
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


TESTCHAIN_CONFIGS = {
    'testchain': {
        'chain_id': 12345,
        'explorer': {'etherscan_api_url': 'http://etherscan.invalid/api'},
    },
}

FAUCET = '0x' + 'fa' * 20
STUDENT = '0x' + '01' * 20
TOKEN = '0x' + '02' * 20


def make_tx(sender, recipient, block, calldata='0x', timestamp='1750000000'):
    return {
        'from': sender,
        'to': recipient,
        'value': '1000000000000000000',
        'hash': f'0xhash{sender[-4:]}{recipient[-4:]}{block}',
        'blockNumber': str(block),
        'timeStamp': timestamp,
        'input': calldata,
    }




############################################################
# ExplorerTestCase
############################################################
#
# The shared fixture: a throwaway SQLite file carrying the two
# Graph_* tables, the explorer's get_db_connection pointed at
# it, and one EtherscanExplorer that trusts the faucet
# address.
#
# Used by:
#   - the three test classes below
############################################################

class ExplorerTestCase(unittest.TestCase):

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE Graph_Addresses (
                    address TEXT NULL, name TEXT NULL,
                    is_contract INTEGER NULL, is_hub INTEGER NULL,
                    UNIQUE (address)
                )
            ''')
            conn.execute('''
                CREATE TABLE Graph_Transactions (
                    id INTEGER PRIMARY KEY,
                    network TEXT NULL, from_address TEXT NULL, to_address TEXT NULL,
                    value REAL NULL, hash TEXT NULL,
                    block_number INTEGER NULL, timestamp INTEGER NULL,
                    UNIQUE (network, hash)
                )
            ''')

        self.db_patch = patch(
            'app.evm_faucet.explorer.get_db_connection',
            side_effect=lambda: sqlite3.connect(self.db_path),
        )
        self.db_patch.start()
        self.explorer = EtherscanExplorer(TESTCHAIN_CONFIGS, trusted_addresses=[FAUCET])

    def tearDown(self):
        self.db_patch.stop()
        os.unlink(self.db_path)

    def address_flags(self, address):
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                'SELECT is_contract, is_hub FROM Graph_Addresses WHERE address = ?',
                [address.lower()]).fetchone()
        return row

    def stored_tx_count(self):
        with sqlite3.connect(self.db_path) as conn:
            return conn.execute('SELECT COUNT(*) FROM Graph_Transactions').fetchone()[0]




############################################################
# ExplorerPollutionTests
############################################################
#
# The cache-pollution defenses: what gets flagged, and what
# never gets scraped.
############################################################

class ExplorerPollutionTests(ExplorerTestCase):

    def test_calldata_recipient_is_seeded_as_contract(self):
        # A token transfer is a tx TO the contract carrying calldata
        self.explorer.store_transactions(
            [make_tx(STUDENT, TOKEN, 100, calldata='0xa9059cbb' + '00' * 64)], 'testchain')
        self.assertEqual(self.address_flags(TOKEN)[0], 1)

    def test_plain_transfer_recipient_stays_user(self):
        self.explorer.store_transactions(
            [make_tx(FAUCET, STUDENT, 100)], 'testchain')
        self.assertEqual(self.address_flags(STUDENT)[0], 0)

    def test_contract_flag_escalates_and_never_downgrades(self):
        # First seen via a plain transfer, later via a call — and a
        # trailing plain transfer must not undo the escalation
        self.explorer.store_transactions([make_tx(STUDENT, TOKEN, 100)], 'testchain')
        self.assertEqual(self.address_flags(TOKEN)[0], 0)
        self.explorer.store_transactions(
            [make_tx(STUDENT, TOKEN, 101, calldata='0xa9059cbb')], 'testchain')
        self.assertEqual(self.address_flags(TOKEN)[0], 1)
        self.explorer.store_transactions([make_tx(STUDENT, TOKEN, 102)], 'testchain')
        self.assertEqual(self.address_flags(TOKEN)[0], 1)

    def test_hub_history_is_flagged_not_stored(self):
        # More distinct counterparties than the threshold -> the
        # whole fetched history is discarded and the address flagged
        hub = '0x' + 'ab' * 20
        history = [make_tx('0x' + f'{i:040x}', hub, 100 + i)
                   for i in range(HUB_COUNTERPARTY_THRESHOLD + 1)]
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan',
                          return_value=history):
            self.explorer._refresh_address('testchain', hub)
        self.assertEqual(self.stored_tx_count(), 0)
        self.assertEqual(self.address_flags(hub)[1], 1)

    def test_trusted_faucet_is_exempt_from_hub_detection(self):
        # The faucet has hundreds of counterparties BY DESIGN — its
        # history must always be stored
        history = [make_tx(FAUCET, '0x' + f'{i:040x}', 100 + i)
                   for i in range(HUB_COUNTERPARTY_THRESHOLD + 1)]
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan',
                          return_value=history):
            self.explorer._refresh_address('testchain', FAUCET)
        self.assertEqual(self.stored_tx_count(), len(history))
        self.assertIsNone(self.address_flags(FAUCET)[1])

    def test_flagged_addresses_are_never_scraped(self):
        # A live-window request for a contract or hub must serve the
        # cache without ever reaching for Etherscan
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO Graph_Addresses VALUES (?, '', 1, 0)", [TOKEN.lower()])
        with patch.object(self.explorer, '_refresh_address',
                          side_effect=AssertionError('must not scrape')) as refresh:
            data, status = self.explorer.get_stored_transactions(
                'testchain', TOKEN, 1750000000, 99999999999)
        self.assertEqual(status, 200)
        refresh.assert_not_called()

    def test_hub_is_never_scraped_either(self):
        # Same rule for is_hub as for is_contract
        hub = '0x' + 'ab' * 20
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO Graph_Addresses VALUES (?, '', 0, 1)", [hub.lower()])
        with patch.object(self.explorer, '_refresh_address') as refresh:
            data, status = self.explorer.get_stored_transactions(
                'testchain', hub, 1750000000, 99999999999)
        self.assertEqual(status, 200)
        refresh.assert_not_called()




############################################################
# ExplorerFetchGateTests
############################################################
#
# WHEN the explorer reaches for Etherscan at all. These gates
# are what keep a classroom of open graph tabs from hammering
# the API into its rate limit, and what makes an outage
# degrade instead of blanking the graph.
############################################################

class ExplorerFetchGateTests(ExplorerTestCase):

    def now(self):
        return int(time.time())

    def fetch_recorder(self, history=None):
        # Stands in for the Etherscan call and records the
        # start_block each refresh resumes from
        calls = []

        def fake_fetch(address, network, start_block=0):
            calls.append({'address': address, 'network': network, 'start_block': start_block})
            return history or []

        return calls, fake_fetch

    def test_never_seen_address_fetches_full_history(self):
        calls, fake_fetch = self.fetch_recorder()
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', fake_fetch):
            self.explorer._refresh_address('testchain', STUDENT)

        self.assertEqual(calls[0]['start_block'], 0)

    def test_refresh_resumes_from_the_last_stored_block(self):
        # The incremental contract: re-fetch only from the tip, minus
        # a small reorg overlap
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 500)], 'testchain')

        calls, fake_fetch = self.fetch_recorder()
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', fake_fetch):
            self.explorer._refresh_address('testchain', STUDENT)

        self.assertEqual(calls[0]['start_block'], 500 - REORG_OVERLAP_BLOCKS)

    def test_resume_point_never_goes_below_zero(self):
        # An address whose only activity is under the overlap width
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 3)], 'testchain')

        calls, fake_fetch = self.fetch_recorder()
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', fake_fetch):
            self.explorer._refresh_address('testchain', STUDENT)

        self.assertEqual(calls[0]['start_block'], 0)

    def test_resume_point_is_per_network(self):
        # Another network's blocks must not move this network's
        # resume point
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 900)], 'othernet')

        calls, fake_fetch = self.fetch_recorder()
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', fake_fetch):
            self.explorer._refresh_address('testchain', STUDENT)

        self.assertEqual(calls[0]['start_block'], 0)

    def test_live_window_refreshes(self):
        # A window touching the last hour is "now" — refresh
        with patch.object(self.explorer, '_refresh_address') as refresh:
            self.explorer.get_stored_transactions('testchain', STUDENT, self.now() - 86400, self.now())
        refresh.assert_called_once()

    def test_historical_window_of_a_known_address_serves_cache(self):
        # Old days cannot change — no Etherscan call at all
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 100)], 'testchain')

        with patch.object(self.explorer, '_refresh_address') as refresh:
            data, status = self.explorer.get_stored_transactions(
                'testchain', STUDENT, self.now() - 172800, self.now() - 86400)

        self.assertEqual(status, 200)
        refresh.assert_not_called()

    def test_historical_window_of_an_unknown_address_fetches_once(self):
        # Never scraped -> its past has to be filled in, even for an
        # old window
        with patch.object(self.explorer, '_refresh_address') as refresh:
            self.explorer.get_stored_transactions(
                'testchain', STUDENT, self.now() - 172800, self.now() - 86400)
        refresh.assert_called_once()

    def test_repeat_requests_are_throttled(self):
        # The graph sweeps every address every few seconds — only the
        # first call inside the interval may reach Etherscan
        with patch.object(self.explorer, '_refresh_address') as refresh:
            for _ in range(5):
                self.explorer.get_stored_transactions(
                    'testchain', STUDENT, self.now() - 86400, self.now())
        self.assertEqual(refresh.call_count, 1)

    def test_throttle_is_per_address_and_network(self):
        other_student = '0x' + '03' * 20
        with patch.object(self.explorer, '_refresh_address') as refresh:
            self.explorer.get_stored_transactions('testchain', STUDENT, self.now() - 86400, self.now())
            self.explorer.get_stored_transactions('testchain', other_student, self.now() - 86400, self.now())
        self.assertEqual(refresh.call_count, 2)

    def test_etherscan_outage_serves_cache_instead_of_failing(self):
        # The graph must keep rendering when the API is down
        self.explorer.store_transactions(
            [make_tx(FAUCET, STUDENT, 100, timestamp=str(self.now() - 60))], 'testchain')

        with patch.object(self.explorer, '_refresh_address', side_effect=RuntimeError('api down')):
            data, status = self.explorer.get_stored_transactions(
                'testchain', STUDENT, self.now() - 86400, self.now() + 60)

        self.assertEqual(status, 200)
        self.assertEqual(len(data['transactions']), 1)

    def test_a_failed_refresh_is_retried_next_time(self):
        # The throttle stamp is only recorded after a SUCCESSFUL
        # refresh — an outage must not buy Etherscan a minute of quiet
        with patch.object(self.explorer, '_refresh_address', side_effect=RuntimeError('api down')) as refresh:
            self.explorer.get_stored_transactions('testchain', STUDENT, self.now() - 86400, self.now())
            self.explorer.get_stored_transactions('testchain', STUDENT, self.now() - 86400, self.now())
        self.assertEqual(refresh.call_count, 2)

    def test_invalid_ranges_are_400(self):
        for from_ts, to_ts in ((None, self.now()), (self.now(), None), (self.now(), self.now() - 1), (5, 5)):
            data, status = self.explorer.get_stored_transactions('testchain', STUDENT, from_ts, to_ts)
            self.assertEqual(status, 400)

    def test_missing_address_and_unknown_network_are_400(self):
        self.assertEqual(self.explorer.get_stored_transactions('testchain', '', 1, 2)[1], 400)
        self.assertEqual(self.explorer.get_stored_transactions('nosuchnet', STUDENT, 1, 2)[1], 400)




############################################################
# ExplorerServeTests
############################################################
#
# What the graph actually renders: flows aggregated inside the
# picked day's [from, to) window, and the day list the slider
# offers.
############################################################

class ExplorerServeTests(ExplorerTestCase):

    DAY = 1750000000        # a fixed point inside the fixture's day

    def store(self, transactions):
        self.explorer.store_transactions(transactions, 'testchain')

    def flows(self, from_ts, to_ts, address=FAUCET):
        # Historical window + already-seen address = no Etherscan
        data, status = self.explorer.get_stored_transactions('testchain', address, from_ts, to_ts)
        self.assertEqual(status, 200)
        return data['transactions']

    def test_repeated_transfers_aggregate_into_one_flow(self):
        # Three payouts to the same student are ONE edge with count 3
        self.store([make_tx(FAUCET, STUDENT, 100 + i, timestamp=str(self.DAY + i)) for i in range(3)])

        flows = self.flows(self.DAY - 10, self.DAY + 10)

        self.assertEqual(len(flows), 1)
        self.assertEqual(flows[0]['count'], 3)
        self.assertEqual(flows[0]['value'], 3.0)
        self.assertEqual(flows[0]['from_address'], FAUCET.lower())
        self.assertEqual(flows[0]['to_address'], STUDENT.lower())

    def test_window_is_half_open(self):
        # [from, to) — the from second is included, the to second is not
        self.store([
            make_tx(FAUCET, STUDENT, 100, timestamp=str(self.DAY)),
            make_tx(FAUCET, TOKEN, 101, timestamp=str(self.DAY + 10)),
        ])

        self.assertEqual(len(self.flows(self.DAY, self.DAY + 10)), 1)
        self.assertEqual(len(self.flows(self.DAY + 10, self.DAY + 20)), 1)
        self.assertEqual(len(self.flows(self.DAY - 5, self.DAY)), 0)

    def test_only_the_queried_address_edges_are_returned(self):
        # A transfer between two strangers must not surface
        stranger = '0x' + '09' * 20
        self.store([
            make_tx(FAUCET, STUDENT, 100, timestamp=str(self.DAY)),
            make_tx(STUDENT, stranger, 101, timestamp=str(self.DAY)),
        ])

        flows = self.flows(self.DAY - 10, self.DAY + 10)
        self.assertEqual(len(flows), 1)
        self.assertEqual(flows[0]['to_address'], STUDENT.lower())

    def test_names_and_flags_ride_along(self):
        # What the graph labels its nodes with
        self.store([make_tx(FAUCET, TOKEN, 100, calldata='0xa9059cbb', timestamp=str(self.DAY))])
        self.explorer.set_address_name(FAUCET, 'KNF Faucet')

        flows = self.flows(self.DAY - 10, self.DAY + 10)

        self.assertEqual(flows[0]['from_name'], 'KNF Faucet')
        self.assertEqual(flows[0]['to_addr_contract'], 1)
        self.assertEqual(flows[0]['from_addr_contract'], 0)

    def test_other_networks_are_not_mixed_in(self):
        self.store([make_tx(FAUCET, STUDENT, 100, timestamp=str(self.DAY))])
        self.explorer.store_transactions(
            [make_tx(FAUCET, TOKEN, 100, timestamp=str(self.DAY))], 'othernet')

        self.assertEqual(len(self.flows(self.DAY - 10, self.DAY + 10)), 1)

    def test_transaction_days_groups_by_local_day(self):
        # A transaction at MIDNIGHT UTC (2025-06-16 00:00:00) lands on
        # a different calendar day depending on the student's zone:
        # Vilnius (+3h) already calls it the 16th, a -14h zone still
        # the 15th. This is the whole reason the slider sends
        # tz_offset — a payout at 01:00 Vilnius time must appear on
        # the day the student actually claimed it.
        midnight_utc = 1750032000
        self.store([make_tx(FAUCET, STUDENT, 100, timestamp=str(midnight_utc))])

        days, status = self.explorer.get_transaction_days('testchain', 3 * 3600, FAUCET)
        self.assertEqual(status, 200)
        self.assertEqual(days['days'], [{'day': '2025-06-16', 'count': 1}])

        days, _ = self.explorer.get_transaction_days('testchain', -14 * 3600, FAUCET)
        self.assertEqual(days['days'][0]['day'], '2025-06-15')

    def test_absurd_timezone_offset_falls_back_to_utc(self):
        # Anything beyond ±14h is not a real zone — a hand-crafted
        # request must not shift the day list by a week
        midnight_utc = 1750032000
        self.store([make_tx(FAUCET, STUDENT, 100, timestamp=str(midnight_utc))])

        days, _ = self.explorer.get_transaction_days('testchain', 99 * 3600, FAUCET)
        self.assertEqual(days['days'], [{'day': '2025-06-16', 'count': 1}])

    def test_days_are_counted_and_sorted(self):
        # The slider renders them in order, with per-day counts
        self.store([
            make_tx(FAUCET, STUDENT, 100, timestamp=str(self.DAY)),
            make_tx(FAUCET, TOKEN, 101, timestamp=str(self.DAY + 60)),
            make_tx(FAUCET, STUDENT, 102, timestamp=str(self.DAY + 86400)),
        ])

        days, _ = self.explorer.get_transaction_days('testchain', 0, FAUCET)

        self.assertEqual([entry['count'] for entry in days['days']], [2, 1])
        self.assertEqual([entry['day'] for entry in days['days']],
                         sorted(entry['day'] for entry in days['days']))

    def test_transaction_days_validates_its_inputs(self):
        self.assertEqual(self.explorer.get_transaction_days('nosuchnet', 0, FAUCET)[1], 400)
        self.assertEqual(self.explorer.get_transaction_days('testchain', 0, '')[1], 400)


if __name__ == '__main__':
    unittest.main()
