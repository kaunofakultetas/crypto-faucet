############################################################
#  [*] UTXO transaction graph tests
#
#  Offline checks of the UTXO graph's explorer and endpoints,
#  in six parts:
#
#    dialects — an output script back to its address on every
#               address family (bech32, bech32m, base58), and
#               None where a script has no address
#    helpers  — virtual sizes, and the order the page stacks
#               transactions in
#    crawl    — what a crawl stores and follows: inputs resolved
#               through their parents, fees and sizes, spenders,
#               block times, the hub cap, live vs past windows,
#               re-reading only when due, dropped and reorged
#               transactions, the fetch budget, a refused
#               transaction and a broken connection
#    serve    — the request side: validation, one background
#               crawl per interval and `updating` until the
#               first lands, the day list in the browser's
#               zone, single transactions (fetched and located
#               when missing, coinbases), names
#    watch    — what a live crawl watches, and a notification
#               crawling the window at once
#    routes   — the four endpoints reach the explorer
#
#  Everything runs against a fake ElectrumX serving a small
#  sample chain built with embit (real transactions, real
#  txids) and a throwaway SQLite file — no network, no real
#  database; the watcher is a fake too (its own tests are in
#  test_electrum_watcher.py).
############################################################


import os
import time
import logging
import tempfile
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

from embit import ec, script as embit_script
from embit.script import Witness
from embit.transaction import Transaction, TransactionInput, TransactionOutput

import helpers
from app.database.db import get_db_connection
from app.database.db_init import init_db_tables
from app.utxo_faucet import explorer as explorer_module
from app.utxo_faucet.explorer import UtxoGraphExplorer, _ordered, _vsize, HUB_HISTORY_THRESHOLD
from app.utxo_faucet.utxo_faucet import _electrum_scripthash


# The crawl logs hubs and refused transactions ON PURPOSE —
# silenced for this module, so a passing run reads clean
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


COIN = 100_000_000
CHUNK = 10_000_000
NOW = int(time.time())

# The sample chain's blocks and when they were mined: one days
# ago, one on a past day — 23:30 UTC, already the next day in
# Vilnius — and two inside the last hour (a live window)
TIMES = {
    1000: NOW - 5 * 86400,
    1100: int(datetime(2026, 3, 1, 23, 30, tzinfo=timezone.utc).timestamp()),
    1200: NOW - 1800,
    1201: NOW - 600,
}

# Windows the tests ask for: today (live) and the day of 1100
TODAY = (NOW - 7200, NOW + 3600)
PAST = (TIMES[1100] - 3600, TIMES[1100] + 3600)

# Filler history entries: more than a hub's worth, at heights
# (100..) whose blocks fall in no window the tests ask for
FILLER = [{'tx_hash': f'{i:064x}', 'height': 100 + i} for i in range(HUB_HISTORY_THRESHOLD + 1)]




############################################################
# header
############################################################
#
# An 80-byte block header carrying only what the explorer
# reads: the block time, little-endian, at bytes 68..71.
#
# Used by:
#   - FakeGraphElectrum.request (below)
############################################################

def header(height):
    stamp = TIMES.get(height, NOW - 10 * 86400 + height)
    return bytes(68) + stamp.to_bytes(4, 'little') + bytes(8)




############################################################
# FakeGraphElectrum
############################################################
#
# One network's ElectrumX as the explorer sees it: histories
# by scripthash, raw transactions by txid, a header for any
# height. `refused` txids answer with a server error (a
# RuntimeError, as ElectrumClient raises it), `broken` makes
# every call fail like a dead connection. Every call is
# recorded as (method, params).
#
# Used by:
#   - GraphWorld (below)
############################################################

class FakeGraphElectrum:

    def __init__(self):
        self.histories = {}
        self.raw = {}
        self.refused = set()
        self.broken = False
        self.calls = []

    def request(self, method, params):
        self.calls.append((method, list(params)))
        if self.broken:
            raise OSError('connection reset')
        if method == 'blockchain.scripthash.get_history':
            return [dict(entry) for entry in self.histories.get(params[0], [])]
        if method == 'blockchain.transaction.get':
            if params[0] in self.refused or params[0] not in self.raw:
                raise RuntimeError(f"Electrum error: no such transaction {params[0]}")
            return self.raw[params[0]]
        if method == 'blockchain.block.headers':
            first, count = params
            return {'count': count, 'hex': b''.join(header(h) for h in range(first, first + count)).hex(), 'max': 2016}
        raise AssertionError(f'unexpected call {method}')

    def history_calls(self):
        return [params[0] for method, params in self.calls if method == 'blockchain.scripthash.get_history']

    def header_calls(self):
        return [params for method, params in self.calls if method == 'blockchain.block.headers']




############################################################
# p2wpkh / make_tx
############################################################
#
# The sample chain's building blocks: a p2wpkh script from a
# one-byte seed, and an unsigned transaction (a coinbase, or
# spending the given outpoints; a dummy witness on request, for
# the SegWit size rules).
#
# Used by:
#   - GraphWorld, DialectTests, HelperTests (below)
############################################################

def p2wpkh(seed):
    return embit_script.p2wpkh(ec.PrivateKey(bytes([seed]) * 32).get_public_key())


def make_tx(inputs, outputs, coinbase=False, witness=False):
    if coinbase:
        vin = [TransactionInput(bytes(32), 0xFFFFFFFF, script_sig=embit_script.Script(b'\x03\x01\x02\x03'))]
    else:
        vin = [TransactionInput(bytes.fromhex(txid), vout) for txid, vout in inputs]
    tx = Transaction(version=2, vin=vin, vout=[TransactionOutput(value, script) for script, value in outputs], locktime=0)
    if witness:
        for inp in tx.vin:
            inp.witness = Witness([b'\x30' * 71, b'\x02' * 33])
    return tx




############################################################
# GraphWorld
############################################################
#
# The sample chain on btc4 around the test faucet, and the fake
# server serving it:
#
#   t0  1000  coinbase           → lecturer 50
#   t1  1100  lecturer           → faucet 10, lecturer change
#   t2  1200  faucet             → jonas 0.1, faucet change,
#                                  an OP_RETURN (witness-signed)
#   t3  1200  faucet (t2 change) → eglė 0.1, faucet change
#   t4  pool  jonas (t2)         → eglė 0.05, jonas change
#   t5  pool  eglė (t3)          → hub 0.05, eglė change
#
# The hub's history is longer than HUB_HISTORY_THRESHOLD.
#
# Used by:
#   - ExplorerTestCase (below)
############################################################

class GraphWorld:

    def __init__(self, faucet):
        faucet_script = faucet.network_dialect('btc4').faucet_script(faucet.faucet_key.get_public_key())
        lecturer, jonas, egle, hub = p2wpkh(0x11), p2wpkh(0x21), p2wpkh(0x22), p2wpkh(0x30)

        self.faucet = faucet.faucet_address_for('btc4')
        self.lecturer, self.jonas, self.egle, self.hub = (
            script.address({'bech32': 'tb'}) for script in (lecturer, jonas, egle, hub)
        )

        t0 = make_tx(None, [(lecturer, 50 * COIN)], coinbase=True)
        t1 = make_tx([(t0.txid().hex(), 0)], [(faucet_script, 10 * COIN), (lecturer, 40 * COIN - 1000)])
        t2 = make_tx([(t1.txid().hex(), 0)],
                     [(jonas, CHUNK), (faucet_script, 10 * COIN - CHUNK - 1400),
                      (embit_script.Script(b'\x6a\x04test'), 0)], witness=True)
        t3 = make_tx([(t2.txid().hex(), 1)], [(egle, CHUNK), (faucet_script, 10 * COIN - 2 * CHUNK - 2800)])
        t4 = make_tx([(t2.txid().hex(), 0)], [(egle, CHUNK // 2), (jonas, CHUNK // 2 - 900)])
        t5 = make_tx([(t3.txid().hex(), 0)], [(hub, CHUNK // 2), (egle, CHUNK // 2 - 900)])
        self.tx = {'t0': t0, 't1': t1, 't2': t2, 't3': t3, 't4': t4, 't5': t5}
        self.id = {name: tx.txid().hex() for name, tx in self.tx.items()}
        self.script = {'lecturer': lecturer, 'faucet': faucet_script, 'jonas': jonas, 'egle': egle, 'hub': hub}


        self.electrum = FakeGraphElectrum()
        self.electrum.raw = {self.id[name]: tx.serialize().hex() for name, tx in self.tx.items()}
        self.hash = {
            'lecturer': _electrum_scripthash(lecturer),
            'faucet': _electrum_scripthash(faucet_script),
            'jonas': _electrum_scripthash(jonas),
            'egle': _electrum_scripthash(egle),
            'hub': _electrum_scripthash(hub),
        }
        entry = lambda name, height: {'tx_hash': self.id[name], 'height': height}
        self.electrum.histories = {
            self.hash['lecturer']: [entry('t0', 1000), entry('t1', 1100)],
            self.hash['faucet']: [entry('t1', 1100), entry('t2', 1200), entry('t3', 1200)],
            self.hash['jonas']: [entry('t2', 1200), entry('t4', 0)],
            self.hash['egle']: [entry('t3', 1200), entry('t4', 0), entry('t5', -1)],
            self.hash['hub']: [entry('t5', 0)] + [dict(filler) for filler in FILLER],
        }

    def history(self, name):
        return self.electrum.histories[self.hash[name]]




############################################################
# FakeWatcher
############################################################
#
# Stands in for ElectrumWatcher in the explorer tests: keeps
# what it was asked to watch and the explorer's on_change, so
# a test can play a notification — no connection, no thread.
#
# Used by:
#   - ExplorerTestCase (below)
############################################################

class FakeWatcher:

    def __init__(self, endpoint, on_change, label=''):
        self.endpoint = endpoint
        self.on_change = on_change
        self.watched = set()

    def watch(self, scripthashes):
        self.watched |= set(scripthashes)




############################################################
# RecordingThread
############################################################
#
# Stands in for threading.Thread where a test needs to see
# which crawls would start without starting them: every
# start() is recorded with its args in `started`.
#
# Used by:
#   - ServeTests, WatchTests (below)
############################################################

def recording_threads(started):

    class RecordingThread:
        def __init__(self, target, args, name, daemon):
            self.args = args

        def start(self):
            started.append(self.args)

    return SimpleNamespace(Thread=RecordingThread)




############################################################
# ExplorerTestCase
############################################################
#
# The shared fixture: a throwaway SQLite file with the full
# schema, the explorer's database pointed at it, a UTXOFaucet
# with the test key, the explorer's btc4 connection replaced
# by the sample chain's fake server, and its watchers by
# FakeWatcher.
#
# Used by:
#   - CrawlTests, ServeTests, WatchTests (below)
############################################################

class ExplorerTestCase(unittest.TestCase):

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        with patch('app.database.db_init.get_db_connection', lambda: get_db_connection(self.db_path)):
            init_db_tables()
        self.db_patch = patch.object(explorer_module, 'get_db_connection', lambda: get_db_connection(self.db_path))
        self.db_patch.start()
        self.watcher_patch = patch.object(explorer_module, 'ElectrumWatcher', FakeWatcher)
        self.watcher_patch.start()

        self.faucet = helpers.make_utxo_faucet()
        self.explorer = UtxoGraphExplorer(self.faucet)
        self.world = GraphWorld(self.faucet)
        self.explorer._clients['btc4'] = self.world.electrum

    def tearDown(self):
        self.watcher_patch.stop()
        self.db_patch.stop()
        for suffix in ('', '-wal', '-shm'):
            if os.path.exists(self.db_path + suffix):
                os.remove(self.db_path + suffix)

    def crawl(self, window=TODAY, live=True):
        self.explorer._crawl_window('btc4', *window, live)

    def graph(self, window=TODAY):
        with patch.object(self.explorer, '_maybe_start_crawl', lambda *args: None):
            payload, status = self.explorer.get_graph('btc4', *window)
        self.assertEqual(status, 200, payload)
        return payload

    def by_id(self, payload):
        return {tx['txid']: tx for tx in payload['transactions']}

    def address_row(self, address):
        with get_db_connection(self.db_path) as conn:
            return conn.execute('SELECT * FROM GraphUtxo_Addresses WHERE address = ?', [address]).fetchone()

    def age_reads(self, seconds):
        # Every address read `seconds` longer ago — so a live
        # crawl finds them due again
        with get_db_connection(self.db_path) as conn:
            conn.execute('UPDATE GraphUtxo_Addresses SET last_refresh = last_refresh - ?', [seconds])




############################################################
# DialectTests
############################################################
#
# address_of, the reverse of recipient_script, on every
# address family the faucet's coins use.
############################################################

class DialectTests(unittest.TestCase):

    def setUp(self):
        self.faucet = helpers.make_utxo_faucet()
        self.key = ec.PrivateKey(b'\x05' * 32).get_public_key()

    def round_trip(self, network, script):
        dialect = self.faucet.network_dialect(network)
        address = dialect.address_of(script.data)
        self.assertIsNotNone(address)
        self.assertEqual(dialect.recipient_script(address).data, script.data)
        return address

    def test_witness_programs_become_bech32_and_bech32m(self):
        self.assertTrue(self.round_trip('btc4', embit_script.p2wpkh(self.key)).startswith('tb1q'))
        self.assertTrue(self.round_trip('btc4', embit_script.p2wsh(embit_script.p2pkh(self.key))).startswith('tb1q'))
        self.assertTrue(self.round_trip('btc4', embit_script.Script(b'\x51\x20' + b'\x07' * 32)).startswith('tb1p'))
        self.assertTrue(self.round_trip('ltc4', embit_script.p2wpkh(self.key)).startswith('tltc1q'))

    def test_base58_scripts_use_the_coins_prefixes(self):
        self.assertIn(self.round_trip('btc4', embit_script.p2pkh(self.key))[0], 'mn')
        self.assertTrue(self.round_trip('btc4', embit_script.p2sh(embit_script.p2wpkh(self.key))).startswith('2'))
        self.assertTrue(self.round_trip('doge3', embit_script.p2pkh(self.key)).startswith('n'))

    def test_knf_has_bech32_only(self):
        self.assertTrue(self.round_trip('knf', embit_script.p2wpkh(self.key)).startswith('knf1q'))
        self.assertIsNone(self.faucet.network_dialect('knf').address_of(embit_script.p2pkh(self.key).data))

    def test_scripts_without_an_address_form_give_none(self):
        # OP_RETURN data, a bare pubkey, a v0 program of a length
        # no address can carry
        for network in ('btc4', 'knf', 'doge3'):
            dialect = self.faucet.network_dialect(network)
            self.assertIsNone(dialect.address_of(b'\x6a\x04test'))
            self.assertIsNone(dialect.address_of(b'\x21' + b'\x02' * 33 + b'\xac'))
            self.assertIsNone(dialect.address_of(b'\x00\x1e' + b'\x01' * 30))
        self.assertIsNone(self.faucet.network_dialect('doge3').address_of(p2wpkh(0x05).data))




############################################################
# HelperTests
############################################################
#
# The explorer's pure helpers: a transaction's virtual size,
# and the order the page stacks transactions in.
############################################################

class HelperTests(unittest.TestCase):

    def tx(self, txid, block=None, status='confirmed', spends=(), sender='someone'):
        return {'txid': txid, 'block': block, 'status': status,
                'inputs': [{'txid': parent, 'address': sender} for parent in spends]}

    def order(self, *transactions):
        return [tx['txid'] for tx in _ordered(list(transactions), 'faucet')]

    def test_a_legacy_transaction_weighs_its_bytes(self):
        raw = make_tx([('11' * 32, 0)], [(p2wpkh(0x01), 1000)]).serialize()
        self.assertEqual(_vsize(raw, Transaction.parse(raw)), len(raw))

    def test_a_witness_counts_a_quarter(self):
        # weight = stripped size * 3 + full size; vsize = weight / 4,
        # rounded up
        stripped = make_tx([('11' * 32, 0)], [(p2wpkh(0x01), 1000)]).serialize()
        raw = make_tx([('11' * 32, 0)], [(p2wpkh(0x01), 1000)], witness=True).serialize()
        self.assertEqual(_vsize(raw, Transaction.parse(raw)), (len(stripped) * 3 + len(raw) + 3) // 4)

    def test_blocks_by_height_then_the_mempool_then_the_unknown(self):
        self.assertEqual(
            self.order(self.tx('a', status='unknown'), self.tx('b', status='mempool'), self.tx('c', 7), self.tx('d', 5)),
            ['d', 'c', 'b', 'a'],
        )

    def test_a_parent_goes_before_its_child_in_one_block(self):
        # 'a' sorts first, but spends 'b'
        self.assertEqual(self.order(self.tx('a', 5, spends=['b']), self.tx('b', 5)), ['b', 'a'])

    def test_the_faucets_own_transactions_go_first(self):
        self.assertEqual(self.order(self.tx('a', 5, spends=['x']), self.tx('b', 5, spends=['y'], sender='faucet')), ['b', 'a'])

    def test_a_loop_in_bad_data_does_not_hang(self):
        self.assertEqual(sorted(self.order(self.tx('a', 5, spends=['b']), self.tx('b', 5, spends=['a']))), ['a', 'b'])

    def test_utc_never_goes_through_the_tz_database(self):
        # In the container Etc/UTC holds the host's zone — played
        # here by a tz database that answers Vilnius for anything
        with patch.object(explorer_module, 'ZoneInfo', lambda name: ZoneInfo('Europe/Vilnius')):
            for name in ('UTC', 'Etc/UTC', ' Etc/Zulu '):
                self.assertIs(explorer_module._zone_of(name), timezone.utc)
            self.assertEqual(str(explorer_module._zone_of('Europe/Vilnius')), 'Europe/Vilnius')




############################################################
# CrawlTests
############################################################
#
# What a crawl reads, stores and follows — checked through the
# graph it then serves.
############################################################

class CrawlTests(ExplorerTestCase):

    def test_a_crawl_serves_the_window_blocks_first(self):
        # Block 1200 (t2 before the t3 spending its change), then
        # the mempool; t0 and t1 are other days
        self.crawl()
        payload = self.graph()
        order = [tx['txid'] for tx in payload['transactions']]
        ids = self.world.id

        self.assertEqual(order[:2], [ids['t2'], ids['t3']])
        self.assertEqual(set(order[2:]), {ids['t4'], ids['t5']})
        self.assertEqual(payload['blocks'], [{'height': 1200, 'time': explorer_module._iso(TIMES[1200])}])
        self.assertTrue(payload['live'])
        self.assertEqual(payload['missing'], 0)
        self.assertEqual(payload['faucet_address'], self.world.faucet)

    def test_inputs_are_resolved_through_their_parents(self):
        self.crawl()
        t2 = self.by_id(self.graph())[self.world.id['t2']]

        self.assertEqual(t2['inputs'], [{'txid': self.world.id['t1'], 'vout': 0, 'address': self.world.faucet, 'value': 10 * COIN}])
        self.assertEqual(t2['fee'], 1400)
        self.assertEqual((t2['status'], t2['block'], t2['coinbase']), ('confirmed', 1200, False))
        self.assertLess(t2['vsize'], len(self.world.tx['t2'].serialize()))

    def test_mempool_transactions_have_no_block(self):
        self.crawl()
        t5 = self.by_id(self.graph())[self.world.id['t5']]

        self.assertEqual((t5['status'], t5['block'], t5['time']), ('mempool', None, None))
        self.assertEqual(t5['fee'], 900)

    def test_outputs_know_their_spenders(self):
        self.crawl()
        txs = self.by_id(self.graph())
        t2, t3, t5 = (txs[self.world.id[name]] for name in ('t2', 't3', 't5'))

        self.assertEqual(t2['outputs'][0]['spent_by'], {'txid': self.world.id['t4'], 'vin': 0})
        self.assertEqual(t3['outputs'][0]['spent_by'], {'txid': self.world.id['t5'], 'vin': 0})
        # The faucet's change is unspent — and that is final: its
        # history was read
        self.assertIsNone(t3['outputs'][1]['spent_by'])
        self.assertTrue(t3['outputs'][1]['spent_known'])
        # Paid to the hub, whose history is never kept — unknown
        self.assertIsNone(t5['outputs'][0]['spent_by'])
        self.assertFalse(t5['outputs'][0]['spent_known'])

    def test_an_op_return_output_has_no_address(self):
        self.crawl()
        data = self.by_id(self.graph())[self.world.id['t2']]['outputs'][2]

        self.assertEqual((data['address'], data['script_type'], data['value']), (None, 'op_return', 0))
        self.assertTrue(data['spent_known'])

    def test_nearby_blocks_share_one_header_call(self):
        # 1000..1049 in one ranged call (every header of the run
        # kept), 1200 on its own; a second ask costs nothing
        self.explorer._ensure_block_times('btc4', {1000, 1010, 1049, 1200})
        self.explorer._ensure_block_times('btc4', {1010, 1200})

        self.assertEqual(self.world.electrum.header_calls(), [[1000, 50], [1200, 1]])
        with get_db_connection(self.db_path) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM GraphUtxo_Blocks').fetchone()[0], 51)
            self.assertEqual(conn.execute('SELECT time FROM GraphUtxo_Blocks WHERE height = 1200').fetchone()[0], TIMES[1200])

    def test_a_public_hub_is_flagged_and_not_followed(self):
        self.crawl()
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute('SELECT COUNT(*) FROM GraphUtxo_History WHERE address = ?', [self.world.hub]).fetchone()[0]

        self.assertEqual(self.address_row(self.world.hub)['is_hub'], 1)
        self.assertEqual(rows, 0)
        self.age_reads(explorer_module.ADDRESS_REFRESH_INTERVAL_S)
        self.crawl()
        self.assertEqual(self.world.electrum.history_calls().count(self.world.hash['hub']), 1)

    def test_the_faucet_is_never_a_hub(self):
        self.world.history('faucet').extend(dict(filler) for filler in FILLER)
        self.crawl()

        self.assertEqual(self.address_row(self.world.faucet)['is_hub'], 0)
        self.assertEqual(len(self.graph()['transactions']), 4)

    def test_a_past_window_has_no_mempool(self):
        self.crawl(PAST, live=False)
        payload = self.graph(PAST)

        self.assertFalse(payload['live'])
        self.assertEqual([tx['txid'] for tx in payload['transactions']], [self.world.id['t1']])

    def test_a_past_window_reads_only_addresses_never_read(self):
        self.crawl()
        before = len(self.world.electrum.history_calls())
        self.crawl(PAST, live=False)

        # Only the lecturer is new (the faucet, the students and
        # the hub were read today)
        self.assertEqual(self.world.electrum.history_calls()[before:], [self.world.hash['lecturer']])

    def test_a_live_window_rereads_an_address_only_when_due(self):
        self.crawl()
        before = len(self.world.electrum.history_calls())
        self.crawl()
        self.assertEqual(len(self.world.electrum.history_calls()), before)

        self.age_reads(explorer_module.ADDRESS_REFRESH_INTERVAL_S)
        self.crawl()
        self.assertGreater(len(self.world.electrum.history_calls()), before)

    def test_a_dropped_mempool_transaction_disappears(self):
        # t4 replaced or evicted: no history lists it any more —
        # gone from the graph, and the coin it spent unspent again
        self.crawl()
        for name in ('jonas', 'egle'):
            self.world.history(name)[:] = [entry for entry in self.world.history(name) if entry['tx_hash'] != self.world.id['t4']]
        self.age_reads(explorer_module.ADDRESS_REFRESH_INTERVAL_S)
        self.crawl()
        txs = self.by_id(self.graph())

        self.assertNotIn(self.world.id['t4'], txs)
        jonas_coin = txs[self.world.id['t2']]['outputs'][0]
        self.assertIsNone(jonas_coin['spent_by'])
        self.assertTrue(jonas_coin['spent_known'])

    def test_a_reorg_moves_a_transaction_to_its_new_block(self):
        self.crawl()
        for name in ('faucet', 'egle'):
            for entry in self.world.history(name):
                if entry['tx_hash'] == self.world.id['t3']:
                    entry['height'] = 1201
        self.age_reads(explorer_module.ADDRESS_REFRESH_INTERVAL_S)
        self.crawl()
        payload = self.graph()

        self.assertEqual(self.by_id(payload)[self.world.id['t3']]['block'], 1201)
        self.assertEqual([block['height'] for block in payload['blocks']], [1200, 1201])

    def test_the_fetch_budget_stops_a_crawl_and_the_next_continues(self):
        # Five transactions to fetch, two per crawl
        with patch.object(explorer_module, 'MAX_TX_FETCHES_PER_CRAWL', 2):
            self.crawl()
            first = len(self.graph()['transactions'])
            self.crawl()
            self.crawl()

        self.assertLess(first, 4)
        self.assertEqual(len(self.graph()['transactions']), 4)

    def test_a_refused_transaction_is_skipped(self):
        # t1 — the parent t2 spends — cannot be had: t2 still
        # shows, its input unresolved, and the crawl goes on
        self.world.electrum.refused.add(self.world.id['t1'])
        self.crawl()
        txs = self.by_id(self.graph())

        t2 = txs[self.world.id['t2']]
        self.assertEqual((t2['inputs'][0]['address'], t2['inputs'][0]['value'], t2['fee']), (None, None, None))
        self.assertIn(self.world.id['t5'], txs)

    def test_window_transactions_the_server_refuses_are_counted_as_missing(self):
        # A node without -txindex serves no mined transaction —
        # the page must learn the day is not empty, just unseen
        self.world.electrum.refused.update([self.world.id['t2'], self.world.id['t3']])
        self.crawl()
        payload = self.graph()

        self.assertEqual(payload['transactions'], [])
        self.assertEqual(payload['missing'], 2)

    def test_a_broken_connection_ends_the_crawl_but_not_the_service(self):
        self.world.electrum.broken = True
        self.explorer._crawling.add('btc4')
        self.explorer._crawl('btc4', *TODAY, True)

        self.assertNotIn('btc4', self.explorer._crawling)
        self.assertEqual(self.graph()['transactions'], [])




############################################################
# ServeTests
############################################################
#
# The request side: what the four serve methods accept and
# answer.
############################################################

class ServeTests(ExplorerTestCase):

    def test_bad_requests_are_400(self):
        self.assertEqual(self.explorer.get_graph('nope', *TODAY)[1], 400)
        self.assertEqual(self.explorer.get_graph('btc4', None, 10)[1], 400)
        self.assertEqual(self.explorer.get_graph('btc4', 20, 10)[1], 400)
        self.assertEqual(self.explorer.get_transaction_days('nope', 'UTC')[1], 400)
        self.assertEqual(self.explorer.get_transaction('btc4', 'xyz')[1], 400)
        self.assertEqual(self.explorer.set_address_name('nope', self.world.jonas, 'Jonas')[1], 400)
        self.assertEqual(self.explorer.set_address_name('btc4', '', 'Jonas')[1], 400)

    def test_one_background_crawl_per_interval_updating_until_the_first_lands(self):
        started = []
        with patch.object(explorer_module, 'threading', recording_threads(started)):
            self.assertTrue(self.explorer.get_graph('btc4', *TODAY)[0]['updating'])
            self.assertTrue(self.explorer.get_graph('btc4', *TODAY)[0]['updating'])   # still crawling
            self.explorer._crawl(*started[0])                                          # it lands
            payload = self.explorer.get_graph('btc4', *TODAY)[0]                      # crawled just now

        self.assertEqual(started, [('btc4', *TODAY, True)])
        self.assertFalse(payload['updating'])
        self.assertEqual(len(payload['transactions']), 4)

    def test_a_failed_first_crawl_still_ends_updating(self):
        # The page must not poll fast forever over a dead server
        self.world.electrum.broken = True
        started = []
        with patch.object(explorer_module, 'threading', recording_threads(started)):
            self.explorer.get_graph('btc4', *TODAY)
            self.explorer._crawl(*started[0])
            self.assertFalse(self.explorer.get_graph('btc4', *TODAY)[0]['updating'])

    def test_days_are_bucketed_in_the_browsers_zone(self):
        # t1's block: 23:30 UTC on March 1st, 01:30 in Vilnius
        self.crawl()
        utc = {day['day']: day['count'] for day in self.explorer.get_transaction_days('btc4', 'UTC')[0]['days']}
        vilnius = {day['day']: day['count'] for day in self.explorer.get_transaction_days('btc4', 'Europe/Vilnius')[0]['days']}
        today = datetime.fromtimestamp(TIMES[1200], ZoneInfo('Europe/Vilnius')).strftime('%Y-%m-%d')

        self.assertEqual(utc['2026-03-01'], 1)
        self.assertNotIn('2026-03-02', utc)
        self.assertEqual(vilnius['2026-03-02'], 1)
        self.assertEqual(vilnius[today], 2)

    def test_an_unknown_zone_falls_back_to_utc(self):
        self.crawl()
        days = self.explorer.get_transaction_days('btc4', 'Mars/Olympus')[0]['days']
        self.assertIn('2026-03-01', {day['day'] for day in days})

    def test_a_missing_transaction_is_fetched_and_located(self):
        payload, status = self.explorer.get_transaction('btc4', self.world.id['t1'].upper())

        self.assertEqual(status, 200)
        tx = payload['transaction']
        self.assertEqual((tx['status'], tx['block']), ('confirmed', 1100))
        self.assertEqual(tx['time'], explorer_module._iso(TIMES[1100]))
        self.assertEqual(tx['inputs'][0]['address'], self.world.lecturer)
        self.assertEqual(tx['fee'], 1000)

    def test_opening_a_faucet_transaction_never_flags_the_faucet(self):
        # A busy faucet's history is as long as a hub's — the
        # lookup reads it trusted, as the crawl does
        self.world.history('faucet').extend(dict(filler) for filler in FILLER)
        self.explorer.get_transaction('btc4', self.world.id['t1'])

        self.assertEqual(self.address_row(self.world.faucet)['is_hub'], 0)
        self.assertEqual(self.address_row(self.world.faucet)['history_size'], 3 + len(FILLER))

    def test_a_coinbase_has_no_inputs_and_no_fee(self):
        tx = self.explorer.get_transaction('btc4', self.world.id['t0'])[0]['transaction']

        self.assertTrue(tx['coinbase'])
        self.assertEqual((tx['inputs'], tx['fee'], tx['block']), ([], None, 1000))

    def test_a_transaction_the_server_cannot_give_is_404(self):
        self.world.electrum.refused.add(self.world.id['t3'])
        self.assertEqual(self.explorer.get_transaction('btc4', self.world.id['t3'])[1], 404)

    def test_names_are_validated_per_network_and_served(self):
        self.assertEqual(self.explorer.set_address_name('btc4', self.world.jonas, '  Jonas  ')[1], 200)
        self.assertEqual(self.explorer.set_address_name('btc4', self.world.egle, 'E' * 100)[1], 200)
        self.assertEqual(self.explorer.set_address_name('btc4', '0x' + 'ab' * 20, 'EVM')[1], 400)
        self.assertEqual(self.explorer.set_address_name('knf', self.world.jonas, 'Jonas')[1], 400)
        self.crawl()
        names = self.graph()['names']

        self.assertEqual(names[self.world.jonas], 'Jonas')
        self.assertEqual(names[self.world.egle], 'E' * explorer_module.MAX_NAME_LENGTH)

        # An empty name clears it
        self.explorer.set_address_name('btc4', self.world.jonas, '')
        self.assertNotIn(self.world.jonas, self.graph()['names'])




############################################################
# WatchTests
############################################################
#
# Watching a live window: what a crawl hands the watcher, and
# what a notification does — the address due, the window
# crawled at once, the news in the graph without waiting out
# the refresh interval.
############################################################

class WatchTests(ExplorerTestCase):

    def first_live_crawl(self, started):
        # A request (the live window is on screen), then its crawl
        with patch.object(explorer_module, 'threading', recording_threads(started)):
            self.explorer.get_graph('btc4', *TODAY)
        self.explorer._crawl(*started[0])
        return self.explorer._watchers['btc4']

    def test_a_live_crawl_watches_what_it_followed_but_no_hub(self):
        watcher = self.first_live_crawl([])
        self.assertEqual(watcher.watched, {self.world.hash[name] for name in ('faucet', 'jonas', 'egle')})
        self.assertEqual(watcher.endpoint, '127.0.0.1:9999')

    def test_a_past_crawl_watches_nothing(self):
        self.explorer._crawl('btc4', *PAST, False)
        self.assertEqual(self.explorer._watchers, {})

    def test_a_change_crawls_the_live_window_at_once(self):
        started = []
        watcher = self.first_live_crawl(started)
        with patch.object(explorer_module, 'threading', recording_threads(started)):
            self.explorer.get_graph('btc4', *TODAY)                   # inside the interval: no crawl
            watcher.on_change(self.world.hash['jonas'])               # a change: at once

        self.assertEqual(started, [('btc4', *TODAY, True)] * 2)
        self.assertEqual(self.address_row(self.world.jonas)['last_refresh'], 0)

    def test_a_change_nobody_is_looking_at_waits(self):
        started = []
        watcher = self.first_live_crawl(started)
        self.explorer._live['btc4'] = (*TODAY, time.time() - explorer_module.KICK_VIEWED_S)
        with patch.object(explorer_module, 'threading', recording_threads(started)):
            watcher.on_change(self.world.hash['jonas'])

        self.assertEqual(len(started), 1)
        self.assertIn('btc4', self.explorer._nudged)

    def test_a_watched_change_reaches_the_graph_without_waiting_for_the_interval(self):
        # Jonas pays Petras from the change t4 left him
        started = []
        watcher = self.first_live_crawl(started)
        petras = p2wpkh(0x23)
        t6 = make_tx([(self.world.id['t4'], 1)], [(petras, CHUNK // 4), (self.world.script['jonas'], CHUNK // 4 - 1800)])
        t6_id = t6.txid().hex()
        self.world.electrum.raw[t6_id] = t6.serialize().hex()
        self.world.history('jonas').append({'tx_hash': t6_id, 'height': 0})
        self.world.electrum.histories[_electrum_scripthash(petras)] = [{'tx_hash': t6_id, 'height': 0}]

        # A routine crawl reads nobody again within the interval
        self.explorer._crawl('btc4', *TODAY, True)
        self.assertNotIn(t6_id, self.by_id(self.graph()))

        with patch.object(explorer_module, 'threading', recording_threads(started)):
            watcher.on_change(self.world.hash['jonas'])
        self.explorer._crawl(*started[-1])
        payload = self.graph()

        self.assertIn(t6_id, self.by_id(payload))
        self.assertEqual(self.by_id(payload)[self.world.id['t4']]['outputs'][1]['spent_by'], {'txid': t6_id, 'vin': 0})
        self.assertIn(_electrum_scripthash(petras), watcher.watched)

    def test_a_change_during_a_crawl_crawls_again_when_it_ends(self):
        started = []
        watcher = self.first_live_crawl(started)
        with patch.object(explorer_module, 'threading', recording_threads(started)):
            self.explorer._crawling.add('btc4')                       # a crawl is running
            watcher.on_change(self.world.hash['egle'])
            self.assertEqual(len(started), 1)
            self.explorer._crawl('btc4', *TODAY, True)                # it ends
        self.assertEqual(len(started), 2)




############################################################
# RouteTests
############################################################
#
# The four endpoints hand their arguments to the explorer and
# its answer back — the explorer itself mocked.
############################################################

class RouteTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        handle, cls.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        cls.main = helpers.import_main(cls.db_path)
        from app.utxo_faucet import utxo_routes
        cls.routes = utxo_routes

    @classmethod
    def tearDownClass(cls):
        for suffix in ('', '-wal', '-shm'):
            if os.path.exists(cls.db_path + suffix):
                os.remove(cls.db_path + suffix)

    def get(self, url, method, reply):
        with patch.object(self.routes.utxo_explorer, method, return_value=(reply, 200)) as called:
            response = self.main.app.test_client().get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), reply)
        return called

    def test_graph_passes_the_window(self):
        self.get('/api/utxo/btc4/graph?from=10&to=20', 'get_graph', {'transactions': []}).assert_called_once_with('btc4', 10, 20)

    def test_a_window_bound_that_is_not_a_number_arrives_as_none(self):
        self.get('/api/utxo/btc4/graph?from=abc&to=20', 'get_graph', {}).assert_called_once_with('btc4', None, 20)

    def test_transaction_days_passes_the_zone(self):
        called = self.get('/api/utxo/btc4/transaction-days?tz=Europe/Vilnius', 'get_transaction_days', {'days': []})
        called.assert_called_once_with('btc4', 'Europe/Vilnius')

    def test_transaction_passes_the_txid(self):
        self.get('/api/utxo/btc4/transaction/' + 'ab' * 32, 'get_transaction', {'transaction': {}}).assert_called_once_with('btc4', 'ab' * 32)

    def test_set_address_name_passes_address_and_name(self):
        called = self.get('/api/utxo/btc4/set-address-name?address=tb1qx&name=Jonas', 'set_address_name', {'status': 'OK'})
        called.assert_called_once_with('btc4', 'tb1qx', 'Jonas')
