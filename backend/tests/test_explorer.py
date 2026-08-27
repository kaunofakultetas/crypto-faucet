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
import unittest
import threading
import contextlib
from datetime import datetime, timezone
from unittest.mock import patch

import requests

from app.database.db import get_db_connection
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


def make_tx(sender, recipient, block, calldata='0x', timestamp='1750000000', is_error='0'):
    return {
        'from': sender,
        'to': recipient,
        'value': '1000000000000000000',
        'hash': f'0xhash{sender[-4:]}{recipient[-4:]}{block}',
        'blockNumber': str(block),
        'timeStamp': timestamp,
        'input': calldata,
        'isError': is_error,
        'txreceipt_status': '0' if is_error == '1' else '1',
    }


class FakeResponse:
    # One Etherscan HTTP answer: a JSON body, or an HTTP error on
    # raise_for_status
    def __init__(self, payload, error=None):
        self.payload = payload
        self.error = error

    def raise_for_status(self):
        if self.error:
            raise self.error

    def json(self):
        return self.payload


def scripted(replies, calls=None):
    # A requests.get stand-in: each entry answers the NEXT call — a
    # FakeResponse, or an Exception to raise instead
    queue = list(replies)

    def get(url, params=None, **kwargs):
        if calls is not None:
            calls.append(dict(params or {}))
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    return get




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
        with get_db_connection(self.db_path) as conn:
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
            side_effect=lambda: get_db_connection(self.db_path),
        )
        self.db_patch.start()
        self.explorer = EtherscanExplorer(TESTCHAIN_CONFIGS, trusted_addresses=[FAUCET])

    def tearDown(self):
        self.db_patch.stop()
        os.unlink(self.db_path)

    def address_flags(self, address):
        with get_db_connection(self.db_path) as conn:
            row = conn.execute(
                'SELECT is_contract, is_hub FROM Graph_Addresses WHERE address = ?',
                [address.lower()]).fetchone()
        return row

    def stored_tx_count(self):
        with get_db_connection(self.db_path) as conn:
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
        with get_db_connection(self.db_path) as conn:
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
        with get_db_connection(self.db_path) as conn:
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

    def test_a_failed_refresh_is_retried_next_interval(self):
        # A failed refresh spends its interval like a successful one
        # (every sweep of every tab retrying would park a thread per
        # timeout) — the NEXT interval retries
        with patch.object(self.explorer, '_refresh_address', side_effect=RuntimeError('api down')) as refresh:
            self.explorer.get_stored_transactions('testchain', STUDENT, self.now() - 86400, self.now())
            with patch('app.evm_faucet.explorer.time.time', return_value=time.time() + 61):
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





############################################################
# ExplorerInputTests
############################################################
#
# What is refused BEFORE any network or database work: a
# malformed address, a network without an explorer section —
# plus the two boundaries of the one outbound call: it
# carries a timeout, and a failure never logs the API key
# that rides in its query string.
############################################################

class ExplorerInputTests(ExplorerTestCase):

    def test_a_malformed_address_is_400_without_a_fetch(self):
        with patch.object(self.explorer, '_refresh_address') as refresh:
            data, status = self.explorer.get_stored_transactions(
                'testchain', 'not-an-address', 1750000000, 1750086400)

        self.assertEqual(status, 400)
        refresh.assert_not_called()

    def test_transaction_days_refuse_a_malformed_address(self):
        data, status = self.explorer.get_transaction_days('testchain', 0, 'not-an-address')
        self.assertEqual(status, 400)

    def test_a_network_without_an_explorer_is_unsupported(self):
        # Configured for the faucet, but nothing to scrape — an
        # honest 400, not a fetch that fails deep inside
        explorer = EtherscanExplorer({'bare': {'chain_id': 12346}}, trusted_addresses=[FAUCET])

        self.assertFalse(explorer.is_supported_network('bare'))
        data, status = explorer.get_stored_transactions('bare', STUDENT, 1750000000, 1750086400)
        self.assertEqual(status, 400)

    def test_explorer_requests_carry_a_timeout(self):
        seen = {}

        class Answer:
            def raise_for_status(self):
                pass

            def json(self):
                return {'status': '0', 'message': 'No transactions found'}

        def get(url, params=None, **kwargs):
            seen.update(kwargs)
            return Answer()

        with patch('app.evm_faucet.explorer.requests.get', get):
            self.explorer.fetch_all_transactions_from_etherscan(STUDENT, 'testchain')

        self.assertTrue(seen.get('timeout'))

    def test_a_refresh_failure_never_logs_the_api_key(self):
        key = 'sekretas-etherscan'
        with patch.dict(os.environ, {'ETHERSCAN_API_KEY': key}):
            explorer = EtherscanExplorer(TESTCHAIN_CONFIGS, trusted_addresses=[FAUCET])
        error = requests.HTTPError(
            f"429 Client Error: Too Many Requests for url: http://etherscan.invalid/api?module=account&apikey={key}")

        class Failing:
            def raise_for_status(self):
                raise error

        logging.disable(logging.NOTSET)
        try:
            with patch('app.evm_faucet.explorer.requests.get', lambda *a, **k: Failing()):
                with self.assertLogs(level='ERROR') as captured:
                    explorer.get_stored_transactions('testchain', STUDENT, int(time.time()) - 60, int(time.time()) + 60)
        finally:
            logging.disable(logging.CRITICAL)

        self.assertNotIn(key, '\n'.join(captured.output))




############################################################
# AddressNameTests
############################################################
#
# The one user-written INSERT in the app: the address must be
# a real one, and the label is cut to the dialog's limit —
# never stored verbatim from a URL.
############################################################

class AddressNameTests(ExplorerTestCase):

    def stored_name(self, address):
        with get_db_connection(self.db_path) as conn:
            row = conn.execute('SELECT name FROM Graph_Addresses WHERE address = ?', [address.lower()]).fetchone()
        return row[0] if row else None

    def row_count(self):
        with get_db_connection(self.db_path) as conn:
            return conn.execute('SELECT COUNT(*) FROM Graph_Addresses').fetchone()[0]

    def test_a_non_address_is_400_and_stores_nothing(self):
        data, status = self.explorer.set_address_name('not-an-address', 'graffiti')

        self.assertEqual(status, 400)
        self.assertEqual(self.row_count(), 0)

    def test_a_name_is_stored_trimmed(self):
        self.explorer.set_address_name(FAUCET, '  Čiaupas  ')
        self.assertEqual(self.stored_name(FAUCET), 'Čiaupas')

    def test_an_overlong_name_is_cut_to_the_dialogs_limit(self):
        self.explorer.set_address_name(FAUCET, 'x' * 4096)
        self.assertEqual(len(self.stored_name(FAUCET)), 64)

    def test_naming_again_replaces_the_label(self):
        self.explorer.set_address_name(FAUCET, 'first')
        self.explorer.set_address_name(FAUCET, 'second')
        self.assertEqual(self.stored_name(FAUCET), 'second')
        self.assertEqual(self.row_count(), 1)





############################################################
# ExplorerRefreshTests
############################################################
#
# How a refresh behaves under trouble: the slot is claimed
# BEFORE the fetch (concurrent requests fetch once, a failed
# refresh spends its interval), pages fetched before a
# failure are kept, a runaway server is cut off, and an
# address that grows into a hub across batches is flagged.
############################################################

class ExplorerRefreshTests(ExplorerTestCase):

    DAY = 1750000000

    def full_page(self):
        return [make_tx(FAUCET, '0x' + f'{i:040x}', 100 + i) for i in range(1, 1001)]

    def test_a_failed_refresh_still_spends_the_interval(self):
        now = int(time.time())
        with patch.object(self.explorer, '_refresh_address', side_effect=RuntimeError('api down')) as refresh:
            self.explorer.get_stored_transactions('testchain', STUDENT, now - 86400, now)
            self.explorer.get_stored_transactions('testchain', STUDENT, now - 86400, now)

        self.assertEqual(refresh.call_count, 1)

    def test_concurrent_requests_for_one_address_fetch_once(self):
        now = int(time.time())

        def slow_refresh(network, address):
            time.sleep(0.3)

        with patch.object(self.explorer, '_refresh_address', side_effect=slow_refresh) as refresh:
            threads = [
                threading.Thread(target=self.explorer.get_stored_transactions,
                                 args=('testchain', STUDENT, now - 86400, now))
                for _ in range(4)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

        self.assertEqual(refresh.call_count, 1)

    def test_pages_fetched_before_a_failure_are_kept(self):
        replies = [FakeResponse({'status': '1', 'result': self.full_page()}),
                   requests.ConnectionError('rate limited')]

        with patch('app.evm_faucet.explorer.requests.get', scripted(replies)):
            self.explorer._refresh_address('testchain', FAUCET)

        self.assertEqual(self.stored_tx_count(), 1000)

    def test_a_failure_on_the_first_page_still_raises(self):
        with patch('app.evm_faucet.explorer.requests.get', scripted([requests.ConnectionError('down')])):
            with self.assertRaises(requests.ConnectionError):
                self.explorer._refresh_address('testchain', FAUCET)

    def test_a_server_that_never_sends_a_short_page_is_cut_off(self):
        calls = []
        page = FakeResponse({'status': '1', 'result': self.full_page()})
        replies = [page] * 50 + [RuntimeError('runaway')]

        with patch('app.evm_faucet.explorer.requests.get', scripted(replies, calls)):
            with contextlib.suppress(Exception):
                self.explorer._refresh_address('testchain', FAUCET)

        self.assertLessEqual(len(calls), 20)

    def test_an_address_that_grows_into_a_hub_is_flagged(self):
        # The degree is counted against the cache, not the batch
        hub = '0x' + 'ab' * 20
        strangers = ['0x' + f'{i:040x}' for i in range(1, HUB_COUNTERPARTY_THRESHOLD + 60)]
        first = [make_tx(s, hub, 100 + i) for i, s in enumerate(strangers[:150])]
        later = [make_tx(s, hub, 100 + i) for i, s in enumerate(strangers[150:], start=150)]

        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', return_value=first):
            self.explorer._refresh_address('testchain', hub)
        self.assertNotEqual(self.address_flags(hub)[1], 1)        # not a hub yet (NULL or 0)
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', return_value=later):
            self.explorer._refresh_address('testchain', hub)

        self.assertEqual(self.address_flags(hub)[1], 1)




############################################################
# ExplorerClassificationTests
############################################################
#
# What a stored row says about its endpoints: calldata to a
# trusted root or to a proven wallet (it sent a transaction)
# never brands it a contract, and a reverted transfer moves
# nothing.
############################################################

class ExplorerClassificationTests(ExplorerTestCase):

    DAY = 1750000000

    def flows(self, address, from_ts, to_ts):
        with patch.object(self.explorer, '_refresh_address'):
            data, status = self.explorer.get_stored_transactions('testchain', address, from_ts, to_ts)
        self.assertEqual(status, 200)
        return data['transactions']

    def test_calldata_to_the_faucet_never_brands_it_a_contract(self):
        self.explorer.store_transactions([make_tx(STUDENT, FAUCET, 100, calldata='0x00')], 'testchain')
        self.assertEqual(self.address_flags(FAUCET)[0], 0)

    def test_an_address_that_sent_a_transaction_is_never_a_contract(self):
        wallet_b = '0x' + '02' * 20
        self.explorer.store_transactions([
            make_tx(wallet_b, STUDENT, 100),                          # wallet_b originates: a wallet
            make_tx(STUDENT, wallet_b, 101, calldata='0x00'),         # …and later receives calldata
        ], 'testchain')
        self.assertEqual(self.address_flags(wallet_b)[0], 0)

    def test_a_later_batch_unbrands_a_wallet_that_sent(self):
        wallet_b = '0x' + '02' * 20
        self.explorer.store_transactions([make_tx(STUDENT, wallet_b, 100, calldata='0x00')], 'testchain')
        self.assertEqual(self.address_flags(wallet_b)[0], 1)
        self.explorer.store_transactions([make_tx(wallet_b, STUDENT, 101)], 'testchain')
        self.assertEqual(self.address_flags(wallet_b)[0], 0)

    def test_a_reverted_transfer_moves_no_value(self):
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 100, timestamp=str(self.DAY), is_error='1')], 'testchain')

        flows = self.flows(FAUCET, self.DAY - 10, self.DAY + 10)

        self.assertEqual(sum(flow['value'] for flow in flows), 0)




############################################################
# ExplorerWindowTests
############################################################
#
# The day pipeline end to end: rows are bucketed in the
# browser's IANA zone with each date's own offset (a winter
# evening viewed in summer stays on its own day), a numeric
# offset is still accepted, and a node's "last seen" is
# scoped to the window on screen, not to all history.
############################################################

class ExplorerWindowTests(ExplorerTestCase):

    DAY = 1750000000

    def one_transaction_at(self, *utc_time):
        moment = int(datetime(*utc_time, tzinfo=timezone.utc).timestamp())
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 100, timestamp=str(moment))], 'testchain')

    def test_a_winter_evening_is_filed_under_its_own_local_day(self):
        self.one_transaction_at(2026, 1, 15, 21, 30)          # 23:30 EET on the 15th

        days, status = self.explorer.get_transaction_days('testchain', 'Europe/Vilnius', FAUCET)

        self.assertEqual(status, 200)
        self.assertEqual(days['days'], [{'day': '2026-01-15', 'count': 1}])

    def test_a_summer_night_is_filed_under_the_day_it_became(self):
        self.one_transaction_at(2026, 7, 15, 21, 30)          # 00:30 EEST on the 16th

        days, status = self.explorer.get_transaction_days('testchain', 'Europe/Vilnius', FAUCET)

        self.assertEqual(status, 200)
        self.assertEqual(days['days'], [{'day': '2026-07-16', 'count': 1}])

    def test_an_unknown_zone_falls_back_to_utc(self):
        self.one_transaction_at(2026, 1, 15, 23, 30)

        days, _ = self.explorer.get_transaction_days('testchain', 'Mars/Olympus_Mons', FAUCET)

        self.assertEqual(days['days'][0]['day'], '2026-01-15')

    def test_node_timestamps_are_scoped_to_the_viewed_window(self):
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 100, timestamp=str(self.DAY))], 'testchain')
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 200, timestamp=str(self.DAY + 30 * 86400))], 'testchain')

        with patch.object(self.explorer, '_refresh_address'):
            data, _ = self.explorer.get_stored_transactions('testchain', FAUCET, self.DAY - 10, self.DAY + 86400)
        flows = data['transactions']

        self.assertEqual(len(flows), 1)
        self.assertEqual(flows[0]['from_timestamp'], self.DAY)
        self.assertEqual(flows[0]['to_timestamp'], self.DAY)


if __name__ == '__main__':
    unittest.main()
