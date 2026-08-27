############################################################
#  [*] Explorer + graph backend — pinned defects
#      (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up. Each test states the
#  behaviour the explorer SHOULD have and is marked
#  @unittest.expectedFailure because today it does not.
#  The moment a fix lands, unittest reports the test as an
#  "unexpected success" — which FAILS the run — and that is
#  the cue: drop the decorator and move the test into its
#  home file (test_explorer.py; a new test_prune_tool.py
#  for the admin tool).
#
#  Offline: Etherscan is a scripted requests.get, the
#  database is a throwaway SQLite file built with the REAL
#  schema (app/database/db_init.py) — unlike test_explorer.py's
#  hand-written fixture, which is why some of these bite.
#
#  Reviewed and deliberately NOT pinned: the missing
#  from/to indexes and the whole-history GROUP BY, and the
#  uncapped flows result (projections — the cache holds a
#  thousand rows, revisit when it holds a hundred thousand);
#  wei stored through a float (the graph is a teaching aid,
#  not a ledger — accepted);
#  set_address_name validation (already pinned in
#  test_evm_defects.py).
############################################################


import io
import os
import sys
import time
from datetime import datetime, timezone
import logging
import tempfile
import threading
import unittest
import contextlib
from unittest.mock import patch

import requests

from app.database.db import get_db_connection
from app.database.db_init import init_db_tables
from app.evm_faucet.explorer import EtherscanExplorer, HUB_COUNTERPARTY_THRESHOLD
import tools.prune_unreachable_transactions as prune


# Several tests make Etherscan fail ON PURPOSE. Silenced for this
# module only.
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


CONFIGS = {
    'testchain': {'chain_id': 12345, 'explorer': {'etherscan_api_url': 'http://etherscan.invalid/api'}},
}

FAUCET = '0x' + 'fa' * 20
STUDENT = '0x' + '01' * 20
WALLET_B = '0x' + '02' * 20
DAY = 1750000000                                       # an old, fixed day — a historical window


def make_tx(sender, recipient, block, calldata='0x', timestamp=str(DAY), is_error='0'):
    return {
        'from': sender, 'to': recipient, 'value': '1000000000000000000',
        'hash': f'0xhash{sender[-4:]}{recipient[-4:]}{block}',
        'blockNumber': str(block), 'timeStamp': timestamp, 'input': calldata,
        'isError': is_error, 'txreceipt_status': '0' if is_error == '1' else '1',
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
# ExplorerCase
############################################################
#
# A throwaway SQLite file carrying the PRODUCTION schema
# (init_db_tables), every get_db_connection in reach pointed
# at it, and one explorer that trusts the faucet address.
#
# Used by:
#   - every test class below
############################################################

class ExplorerCase(unittest.TestCase):

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)

        def connect():
            return get_db_connection(self.db_path)

        self.patches = [
            patch('app.evm_faucet.explorer.get_db_connection', side_effect=connect),
            patch('app.database.db_init.get_db_connection', side_effect=connect),
        ]
        for active in self.patches:
            active.start()
        init_db_tables()
        self.explorer = EtherscanExplorer(CONFIGS, trusted_addresses=[FAUCET])

    def tearDown(self):
        for active in self.patches:
            active.stop()
        os.unlink(self.db_path)

    def now(self):
        return int(time.time())

    def flag(self, address, column):
        with get_db_connection(self.db_path) as conn:
            row = conn.execute(f'SELECT {column} FROM Graph_Addresses WHERE address = ?', [address.lower()]).fetchone()
        return row[0] if row else None

    def stored_tx_count(self):
        with get_db_connection(self.db_path) as conn:
            return conn.execute('SELECT COUNT(*) FROM Graph_Transactions').fetchone()[0]

    def flows(self, address, from_ts, to_ts):
        with patch.object(self.explorer, '_refresh_address'):
            data, status = self.explorer.get_stored_transactions('testchain', address, from_ts, to_ts)
        self.assertEqual(status, 200)
        return data['transactions']




############################################################
# ThrottleTests
############################################################
#
# The refresh stamp is written AFTER a successful refresh,
# so it is read and written across a multi-second network
# call: concurrent requests for one address (a lecture hall
# opening the graph in the same minute) all pass the gate
# and all scrape, and a failed refresh is retried by the
# very next request. The slot must be claimed FIRST, under a
# lock: one attempt per address per interval, success or
# failure. NOTE: this overrides test_explorer.py's
# "a failed refresh is retried next time" — with a real
# timeout, retrying on every sweep of every tab parks a
# thread for the whole timeout each time; the fix should
# make that test advance the clock instead.
############################################################

class ThrottleTests(ExplorerCase):

    @unittest.expectedFailure
    def test_a_failed_refresh_still_spends_the_interval(self):
        with patch.object(self.explorer, '_refresh_address', side_effect=RuntimeError('api down')) as refresh:
            self.explorer.get_stored_transactions('testchain', STUDENT, self.now() - 86400, self.now())
            self.explorer.get_stored_transactions('testchain', STUDENT, self.now() - 86400, self.now())

        self.assertEqual(refresh.call_count, 1)

    @unittest.expectedFailure
    def test_concurrent_requests_for_one_address_fetch_once(self):
        def slow_refresh(network, address):
            time.sleep(0.3)

        with patch.object(self.explorer, '_refresh_address', side_effect=slow_refresh) as refresh:
            threads = [
                threading.Thread(target=self.explorer.get_stored_transactions,
                                 args=('testchain', STUDENT, self.now() - 86400, self.now()))
                for _ in range(4)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

        self.assertEqual(refresh.call_count, 1)




############################################################
# ContractHeuristicTests
############################################################
#
# "A recipient that receives calldata is a contract" — but
# nothing stops a transaction to a plain wallet from carrying
# calldata, the flag only ever escalates, and the graph's
# ROOT has no exemption: one {to: faucet, data: '0x00'}
# brands the faucet a contract forever, and the graph stops
# discovering new payouts for the whole class. A trusted
# address is never a contract; nor is any address that has
# ORIGINATED a transaction (only a wallet can).
############################################################

class ContractHeuristicTests(ExplorerCase):

    @unittest.expectedFailure
    def test_calldata_to_the_faucet_never_brands_it_a_contract(self):
        self.explorer.store_transactions([make_tx(STUDENT, FAUCET, 100, calldata='0x00')], 'testchain')
        self.assertEqual(self.flag(FAUCET, 'is_contract'), 0)

    @unittest.expectedFailure
    def test_an_address_that_sent_a_transaction_is_never_a_contract(self):
        self.explorer.store_transactions([
            make_tx(WALLET_B, STUDENT, 100),                          # WALLET_B originates: a wallet
            make_tx(STUDENT, WALLET_B, 101, calldata='0x00'),         # …and later receives calldata
        ], 'testchain')
        self.assertEqual(self.flag(WALLET_B, 'is_contract'), 0)




############################################################
# HubGrowthTests
############################################################
#
# Public-hub detection counts the counterparties of the
# INCREMENTAL batch, so an address first indexed while small
# and refreshed twenty transactions at a time never trips
# the threshold, and its growing global history is stored
# batch by batch — the exact contamination the module header
# promises to keep out. Count the degree against the cache.
############################################################

class HubGrowthTests(ExplorerCase):

    @unittest.expectedFailure
    def test_an_address_that_grows_into_a_hub_is_flagged(self):
        hub = '0x' + 'ab' * 20
        strangers = ['0x' + f'{i:040x}' for i in range(1, HUB_COUNTERPARTY_THRESHOLD + 60)]
        first = [make_tx(s, hub, 100 + i) for i, s in enumerate(strangers[:150])]
        later = [make_tx(s, hub, 100 + i) for i, s in enumerate(strangers[150:], start=150)]

        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', return_value=first):
            self.explorer._refresh_address('testchain', hub)
        with patch.object(self.explorer, 'fetch_all_transactions_from_etherscan', return_value=later):
            self.explorer._refresh_address('testchain', hub)

        self.assertEqual(self.flag(hub, 'is_hub'), 1)




############################################################
# RevertedTransactionTests
############################################################
#
# Etherscan's txlist returns every MINED transaction, failed
# ones included, with the value the sender ATTEMPTED to
# move. The explorer never looks at isError, stores them and
# sums them — the graph shows flows that never happened, on
# a tool whose point is showing where the coins went. A
# reverted transfer moves nothing.
############################################################

class RevertedTransactionTests(ExplorerCase):

    @unittest.expectedFailure
    def test_a_reverted_transfer_moves_no_value(self):
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 100, is_error='1')], 'testchain')

        flows = self.flows(FAUCET, DAY - 10, DAY + 10)

        self.assertEqual(sum(flow['value'] for flow in flows), 0)




############################################################
# PagingTests
############################################################
#
# The page loop is all-or-nothing: a failure on page N (a
# rate limit mid-sequence is routine on a free key shared by
# the class) discards pages 1..N-1, nothing is stored, the
# resume point never moves, and the next request replays
# the same doomed fetch — the faucet root, exempt from the
# hub cap, can be locked out of the cache for good. Pages
# fetched before a failure must be kept, and a server that
# never sends a short page must be cut off.
############################################################

class PagingTests(ExplorerCase):

    def full_page(self):
        return [make_tx(FAUCET, '0x' + f'{i:040x}', 100 + i) for i in range(1, 1001)]

    @unittest.expectedFailure
    def test_pages_fetched_before_a_failure_are_kept(self):
        replies = [FakeResponse({'status': '1', 'result': self.full_page()}),
                   requests.ConnectionError('rate limited')]

        with patch('app.evm_faucet.explorer.requests.get', scripted(replies)):
            with contextlib.suppress(Exception):
                self.explorer._refresh_address('testchain', FAUCET)

        self.assertEqual(self.stored_tx_count(), 1000)

    @unittest.expectedFailure
    def test_a_server_that_never_sends_a_short_page_is_cut_off(self):
        calls = []
        page = FakeResponse({'status': '1', 'result': self.full_page()})
        replies = [page] * 50 + [RuntimeError('runaway')]

        with patch('app.evm_faucet.explorer.requests.get', scripted(replies, calls)):
            with contextlib.suppress(Exception):
                self.explorer._refresh_address('testchain', FAUCET)

        self.assertLessEqual(len(calls), 20)




############################################################
# DayBucketTests
############################################################
#
# get_transaction_days files every row under a day using ONE
# offset — the browser's offset at the moment of the request
# — while the page's rangeOfDay() turns the picked day back
# into a window with that date's TRUE offset. For every day
# in the other DST regime the two disagree by an hour: a
# winter evening viewed in summer is listed under the next
# day, whose window then excludes it (an empty graph on a day
# the slider offered), and its real day may never be listed.
# Wanted: the endpoint takes the browser's IANA zone name
# (Intl.DateTimeFormat().resolvedOptions().timeZone) and
# buckets each row in that zone, so the list matches
# rangeOfDay whatever the season.
############################################################

class DayBucketTests(ExplorerCase):

    def one_transaction_at(self, *utc_time):
        moment = int(datetime(*utc_time, tzinfo=timezone.utc).timestamp())
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 100, timestamp=str(moment))], 'testchain')

    @unittest.expectedFailure
    def test_a_winter_evening_is_filed_under_its_own_local_day(self):
        self.one_transaction_at(2026, 1, 15, 21, 30)          # 23:30 EET on the 15th

        days, status = self.explorer.get_transaction_days('testchain', 'Europe/Vilnius', FAUCET)

        self.assertEqual(status, 200)
        self.assertEqual(days['days'], [{'day': '2026-01-15', 'count': 1}])

    @unittest.expectedFailure
    def test_a_summer_night_is_filed_under_the_day_it_became(self):
        self.one_transaction_at(2026, 7, 15, 21, 30)          # 00:30 EEST on the 16th

        days, status = self.explorer.get_transaction_days('testchain', 'Europe/Vilnius', FAUCET)

        self.assertEqual(status, 200)
        self.assertEqual(days['days'], [{'day': '2026-07-16', 'count': 1}])




############################################################
# NodeFreshnessTests
############################################################
#
# The flows query windows the EDGES to [from, to) but takes
# each node's "last seen" timestamp from a CTE over the whole
# network history — so a graph of a past day labels the
# faucet "Atnaujinta: prieš 4 min." because it paid someone
# today. The node ages must describe the day on screen.
############################################################

class NodeFreshnessTests(ExplorerCase):

    @unittest.expectedFailure
    def test_node_timestamps_are_scoped_to_the_viewed_window(self):
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 100, timestamp=str(DAY))], 'testchain')
        self.explorer.store_transactions([make_tx(FAUCET, STUDENT, 200, timestamp=str(DAY + 30 * 86400))], 'testchain')

        flows = self.flows(FAUCET, DAY - 10, DAY + 86400)

        self.assertEqual(len(flows), 1)
        self.assertEqual(flows[0]['from_timestamp'], DAY)
        self.assertEqual(flows[0]['to_timestamp'], DAY)




############################################################
# PruneToolTests
############################################################
#
# The documented cache-cleaning tool cannot clean anything:
# its default database path is not the app's, and the
# production schema declares [id] INTEGER AUTO_INCREMENT —
# not SQLite's rowid alias — so every row's id is NULL and
# "DELETE … WHERE id = ?" matches nothing while the tool
# reports "Deleted N". Three more once deletes work: the
# reachability walk merges every network into one graph
# (the graph itself is strictly per network); an empty root
# set (nothing names addresses automatically) drops the
# whole cache; and the orphan cleanup deletes the
# is_contract / is_hub rows the explorer's classification
# depends on. Everything here runs the tool for real, on the
# production schema, in a temp file.
############################################################

class PruneToolTests(ExplorerCase):

    ROOT = '0x' + 'aa' * 20
    A = '0x' + 'a1' * 20
    X = '0x' + 'ee' * 20
    Y = '0x' + 'ef' * 20

    def insert(self, network, sender, recipient, block):
        with get_db_connection(self.db_path) as conn:
            conn.execute('''
                INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                VALUES (?, ?, ?, 1.0, ?, ?, ?)
            ''', [network, sender, recipient, f'0x{network}{block}', block, DAY])

    def name(self, address, name='Named wallet'):
        with get_db_connection(self.db_path) as conn:
            conn.execute('INSERT INTO Graph_Addresses (address, name, is_contract, is_hub) VALUES (?, ?, 0, 0)', [address, name])

    def apply(self):
        with patch.object(prune, 'DB_PATH', self.db_path):
            with patch.object(sys, 'argv', ['prune', '--apply']):
                with contextlib.redirect_stdout(io.StringIO()):
                    prune.main()

    def remaining(self):
        with get_db_connection(self.db_path) as conn:
            return conn.execute('SELECT network, from_address, to_address FROM Graph_Transactions').fetchall()

    @unittest.expectedFailure
    def test_default_db_path_matches_the_app(self):
        import inspect
        app_default = inspect.signature(get_db_connection).parameters['filename'].default
        self.assertEqual(prune.DB_PATH, app_default)

    @unittest.expectedFailure
    def test_apply_removes_the_unreachable_rows(self):
        self.name(self.ROOT)
        self.insert('net', self.ROOT, self.A, 1)        # reachable from the named root
        self.insert('net', self.X, self.Y, 2)           # strangers

        self.apply()

        self.assertEqual(self.remaining(), [('net', self.ROOT, self.A)])

    @unittest.expectedFailure
    def test_the_walk_is_per_network(self):
        self.name(self.ROOT)
        self.insert('net1', self.ROOT, self.X, 1)       # X is one hop from the root — on net1
        self.insert('net2', self.X, self.Y, 2)          # X's net2 traffic is NOT reachable there

        self.apply()

        self.assertEqual(self.remaining(), [('net1', self.ROOT, self.X)])

    @unittest.expectedFailure
    def test_refuses_to_run_without_any_root(self):
        self.insert('net', self.X, self.Y, 1)           # nothing is named: every row would go

        with self.assertRaises(SystemExit):
            self.apply()

    @unittest.expectedFailure
    def test_flagged_addresses_survive_the_orphan_cleanup(self):
        self.name(self.ROOT)
        self.insert('net', self.ROOT, self.A, 1)
        hub = '0x' + 'ab' * 20
        with get_db_connection(self.db_path) as conn:
            conn.execute("INSERT INTO Graph_Addresses (address, name, is_contract, is_hub) VALUES (?, '', 0, 1)", [hub])

        self.apply()

        self.assertEqual(self.flag(hub, 'is_hub'), 1)


if __name__ == '__main__':
    unittest.main()
