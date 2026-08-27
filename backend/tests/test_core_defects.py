############################################################
#  [*] Backend core — pinned defects (expected failures)
#
#  Regression tests written BEFORE the fix, one class per
#  defect a code review turned up in the plumbing every
#  faucet family sits on: the entrypoint, the SQLite helper
#  and schema, the cooldown table, the config loader. Each
#  test states the behaviour the code SHOULD have and is
#  marked @unittest.expectedFailure because today it does
#  not. The moment a fix lands, unittest reports the test as
#  an "unexpected success" — which FAILS the run — and that
#  is the cue: drop the decorator and move the test into its
#  home file (test_cooldown.py, test_config_models.py, a new
#  test_database.py / test_main.py).
#
#  Reviewed and deliberately NOT pinned: the forwarded-IP
#  headers (correct for the two-hop ingress, and nothing
#  reads remote_addr); release() dropping a NEWER claim
#  after a stalled payout (accepted — see app/cooldown.py);
#  the unpinned pydantic/werkzeug versions and the icon
#  Cache-Control clash with the ingress (build and Caddyfile
#  matters, not runtime behaviour); the cooldown table's
#  growth and the prune tool's path (pinned elsewhere).
############################################################


import os
import copy
import json
import tempfile
import unittest
import importlib
from unittest.mock import patch

from app.cooldown import CooldownTable
from app.config_models import validate_configs
from app.database.db import get_db_connection
from app.database.db_init import init_db_tables
from app.evm_faucet.evm_faucet import EVMFaucet
from app.erc_faucet.erc20_faucet import ERC20Faucet
from app.utxo_faucet.utxo_faucet import UTXOFaucet
from app.svm_faucet.svm_faucet import SVMFaucet
from app.move_faucet.move_faucet import MoveFaucet
from tests import helpers




############################################################
# TempDbCase
############################################################
#
# A throwaway SQLite file carrying the PRODUCTION schema
# (init_db_tables), with db_init's connection pointed at it.
#
# Used by:
#   - SchemaTests, ConnectionTests, ExampleChainTests
############################################################

class TempDbCase(unittest.TestCase):

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        self.connect = lambda: get_db_connection(self.db_path)
        with patch('app.database.db_init.get_db_connection', side_effect=self.connect):
            init_db_tables()

    def tearDown(self):
        for suffix in ('', '-wal', '-shm'):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass




############################################################
# WsgiTargetTests
############################################################
#
# main.py is script and module at once: the route modules
# import main back for their config maps, so under
# `python main.py` the file executes TWICE (once as __main__,
# once as `main`), and everything that turns `app` into a
# faucet — init_db, ProxyFix, the seven blueprints — sits
# inside the __main__ guard. So `main:app`, the WSGI target
# app/cooldown.py itself recommends ("run gunicorn with one
# worker"), carries one route and no schema. Bounded threads
# (a real WSGI server instead of Werkzeug's unbounded
# thread-per-connection dev server) need this first.
#
# The test reloads main with every warmup patched out and
# the database redirected — a fix that registers the
# blueprints at import time must keep working under those
# patches, which is what a real WSGI import looks like.
############################################################

class WsgiTargetTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_importing_main_yields_the_full_app(self):
        import main

        handle, db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        patches = [
            patch.object(EVMFaucet, '_warm_up_networks', lambda self: None),
            patch.object(ERC20Faucet, '_warm_up_tokens', lambda self: None),
            patch.object(UTXOFaucet, '_warm_up_networks', lambda self: None),
            patch.object(SVMFaucet, '_warm_up_networks', lambda self: None),
            patch.object(MoveFaucet, '_warm_up_networks', lambda self: None),
            patch('app.database.db_init.get_db_connection', side_effect=lambda: get_db_connection(db_path)),
        ]
        try:
            for active in patches:
                active.start()
            module = importlib.reload(main)
        finally:
            for active in patches:
                active.stop()
            os.unlink(db_path)

        rules = {rule.rule for rule in module.app.url_map.iter_rules()}
        self.assertIn('/api/faucet/catalog', rules)
        self.assertIn('/api/evm/<network>/request', rules)




############################################################
# SchemaTests
############################################################
#
# The production DDL declares [id] INTEGER AUTO_INCREMENT —
# MySQL spelling, absorbed by SQLite into the column's TYPE
# NAME, so the column is not the rowid alias and is never
# populated: every Graph_Transactions row has id = NULL on a
# fresh volume, and "DELETE … WHERE id = ?" matches nothing.
# The live database was created by an older, correct DDL,
# which is why nobody noticed. A row must get a real id.
############################################################

class SchemaTests(TempDbCase):

    @unittest.expectedFailure
    def test_graph_transactions_rows_get_a_real_id(self):
        with self.connect() as conn:
            conn.execute('''
                INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                VALUES ('net', '0xaa', '0xbb', 1.0, '0xhash', 1, 1)
            ''')
            row = conn.execute('SELECT id FROM Graph_Transactions').fetchone()

        self.assertIsNotNone(row[0])




############################################################
# ConnectionTests
############################################################
#
# get_db_connection takes every SQLite default: the rollback
# journal (a committing writer blocks every reader and vice
# versa) and a 5-second busy timeout. The workload has both
# shapes — the explorer commits whole scraped histories
# while other threads aggregate — and dbgate holds locks on
# the same file from another container. WAL lets readers
# and the writer coexist; a longer busy timeout turns a
# collision into a wait instead of "database is locked".
############################################################

class ConnectionTests(TempDbCase):

    @unittest.expectedFailure
    def test_connections_use_write_ahead_logging(self):
        conn = get_db_connection(self.db_path)
        try:
            self.assertEqual(conn.execute('PRAGMA journal_mode').fetchone()[0].lower(), 'wal')
        finally:
            conn.close()

    @unittest.expectedFailure
    def test_connections_wait_out_a_lock_longer_than_the_default(self):
        conn = get_db_connection(self.db_path)
        try:
            self.assertGreaterEqual(conn.execute('PRAGMA busy_timeout').fetchone()[0], 10_000)
        finally:
            conn.close()




############################################################
# ClockTests
############################################################
#
# The cooldown measures elapsed time with the wall clock,
# which the host may step (an NTP correction, a snapshot
# restore). A backwards step turns "now - last" negative,
# the refusal branch is taken, and the student is told to
# wait 60 + the step — minutes instead of one. Elapsed time
# is what the monotonic clock is for; and the wait must
# never exceed the window either way.
############################################################

class ClockTests(unittest.TestCase):

    def at(self, moment):
        # Both clocks, so the pin holds whichever one the table reads
        return (patch('app.cooldown.time.time', return_value=moment),
                patch('app.cooldown.time.monotonic', return_value=moment))

    @unittest.expectedFailure
    def test_a_backwards_clock_step_never_inflates_the_wait(self):
        table = CooldownTable(seconds=60)
        wall, mono = self.at(1000)
        with wall, mono:
            table.claim(('net', 'addr'))

        wall, mono = self.at(700)                    # the host clock stepped back five minutes
        with wall, mono:
            remaining = table.claim(('net', 'addr'))

        self.assertLessEqual(remaining, 60)




############################################################
# ExampleChainTests
############################################################
#
# /api/get-example-blockchain packs the simulator's demo
# chain with no ORDER BY and without its Height — the rows
# come back in physical order, which is insert order only
# until a block is deleted and re-seeded, after which every
# link from that point renders as broken on the page whose
# purpose is to show valid links. Order by height, and
# expose it so the page could sort defensively.
############################################################

class ExampleChainTests(TempDbCase):

    def seed_out_of_order(self):
        with self.connect() as conn:
            for height in ('2', '1', '3'):
                conn.execute('''
                    INSERT INTO BlockchainSimulator_Blocks (Height, BlockHash, PrevBlock, Nonce, Transactions)
                    VALUES (?, ?, ?, '0', '[]')
                ''', [height, f'hash{height}', f'hash{int(height) - 1}'])

    def fetch(self):
        import main
        self.seed_out_of_order()
        with patch('main.get_db_connection', side_effect=self.connect):
            response = main.app.test_client().get('/api/get-example-blockchain')
        self.assertEqual(response.status_code, 200)
        return json.loads(response.data)

    @unittest.expectedFailure
    def test_blocks_come_back_in_height_order(self):
        blocks = self.fetch()
        self.assertEqual([block['hash'] for block in blocks], ['hash1', 'hash2', 'hash3'])

    @unittest.expectedFailure
    def test_blocks_carry_their_height(self):
        blocks = self.fetch()
        self.assertEqual([str(block.get('height')) for block in blocks], ['1', '2', '3'])




############################################################
# ConfigKeyTests
############################################################
#
# validate_configs runs every config VALUE through a strict
# model, but the map keys — which become URL segments, page
# paths and icon filenames — pass through untouched. A key
# with a slash or a space boots green and produces an
# unreachable page and a broken icon. The layer exists to
# turn config mistakes into loud boot failures; keys are
# part of the config.
############################################################

class ConfigKeyTests(unittest.TestCase):

    @unittest.expectedFailure
    def test_a_key_that_is_not_url_safe_fails_the_boot(self):
        configs = {'my/chain': copy.deepcopy(helpers.EVM_TEST_CONFIGS['testchain'])}
        with self.assertRaises(ValueError):
            validate_configs(configs, {}, {}, {}, {})


if __name__ == '__main__':
    unittest.main()
