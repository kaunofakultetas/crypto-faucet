############################################################
#  [*] Prune tool regression tests
#
#  tools/prune_unreachable_transactions.py run for real, on
#  the PRODUCTION schema (init_db_tables) in a temp file, with
#  its DB_PATH and argv patched: its default path is the
#  app's, the walk is per network from the named wallets, it
#  refuses an empty root set, --apply deletes exactly the
#  unreachable rows, and the flagged contract/hub rows the
#  explorer depends on survive the orphan cleanup.
############################################################


import io
import os
import sys
import inspect
import tempfile
import unittest
import contextlib
from unittest.mock import patch

from app.database.db import get_db_connection
from app.database.db_init import init_db_tables
import tools.prune_unreachable_transactions as prune


DAY = 1750000000




############################################################
# PruneToolTests
############################################################

class PruneToolTests(unittest.TestCase):

    ROOT = '0x' + 'aa' * 20
    A = '0x' + 'a1' * 20
    X = '0x' + 'ee' * 20
    Y = '0x' + 'ef' * 20

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        with patch('app.database.db_init.get_db_connection', side_effect=lambda: get_db_connection(self.db_path)):
            init_db_tables()

    def tearDown(self):
        os.unlink(self.db_path)

    def insert(self, network, sender, recipient, block):
        with get_db_connection(self.db_path) as conn:
            conn.execute('''
                INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                VALUES (?, ?, ?, 1.0, ?, ?, ?)
            ''', [network, sender, recipient, f'0x{network}{block}', block, DAY])

    def name(self, address, name='Named wallet'):
        with get_db_connection(self.db_path) as conn:
            conn.execute('INSERT INTO Graph_Addresses (address, name, is_contract, is_hub) VALUES (?, ?, 0, 0)', [address, name])

    def flag(self, address, column):
        with get_db_connection(self.db_path) as conn:
            row = conn.execute(f'SELECT {column} FROM Graph_Addresses WHERE address = ?', [address]).fetchone()
        return row[0] if row else None

    def run_tool(self, apply=True):
        argv = ['prune', '--apply'] if apply else ['prune']
        with patch.object(prune, 'DB_PATH', self.db_path):
            with patch.object(sys, 'argv', argv):
                with contextlib.redirect_stdout(io.StringIO()) as out:
                    prune.main()
        return out.getvalue()

    def remaining(self):
        with get_db_connection(self.db_path) as conn:
            return [tuple(row) for row in conn.execute(
                'SELECT network, from_address, to_address FROM Graph_Transactions ORDER BY rowid')]

    def test_default_db_path_matches_the_app(self):
        app_default = inspect.signature(get_db_connection).parameters['filename'].default
        self.assertEqual(prune.DB_PATH, app_default)

    def test_apply_removes_the_unreachable_rows(self):
        self.name(self.ROOT)
        self.insert('net', self.ROOT, self.A, 1)        # reachable from the named root
        self.insert('net', self.X, self.Y, 2)           # strangers

        self.run_tool()

        self.assertEqual(self.remaining(), [('net', self.ROOT, self.A)])

    def test_a_dry_run_deletes_nothing(self):
        self.name(self.ROOT)
        self.insert('net', self.ROOT, self.A, 1)
        self.insert('net', self.X, self.Y, 2)

        out = self.run_tool(apply=False)

        self.assertIn('Dry run', out)
        self.assertEqual(len(self.remaining()), 2)

    def test_the_walk_is_per_network(self):
        self.name(self.ROOT)
        self.insert('net1', self.ROOT, self.X, 1)       # X is one hop from the root — on net1
        self.insert('net2', self.X, self.Y, 2)          # X's net2 traffic is NOT reachable there

        self.run_tool()

        self.assertEqual(self.remaining(), [('net1', self.ROOT, self.X)])

    def test_a_contract_is_reached_but_never_expanded(self):
        self.name(self.ROOT)
        contract = '0x' + 'cc' * 20
        with get_db_connection(self.db_path) as conn:
            conn.execute("INSERT INTO Graph_Addresses (address, name, is_contract, is_hub) VALUES (?, '', 1, 0)", [contract])
        self.insert('net', self.ROOT, contract, 1)      # the root's own call: kept
        self.insert('net', self.X, contract, 2)         # a stranger's call to the same contract: dropped

        self.run_tool()

        self.assertEqual(self.remaining(), [('net', self.ROOT, contract)])

    def test_refuses_to_run_without_any_root(self):
        self.insert('net', self.X, self.Y, 1)           # nothing is named: every row would go

        with self.assertRaises(SystemExit):
            self.run_tool()
        self.assertEqual(len(self.remaining()), 1)

    def test_flagged_addresses_survive_the_orphan_cleanup(self):
        self.name(self.ROOT)
        self.insert('net', self.ROOT, self.A, 1)
        hub = '0x' + 'ab' * 20
        with get_db_connection(self.db_path) as conn:
            conn.execute("INSERT INTO Graph_Addresses (address, name, is_contract, is_hub) VALUES (?, '', 0, 1)", [hub])

        self.run_tool()

        self.assertEqual(self.flag(hub, 'is_hub'), 1)


if __name__ == '__main__':
    unittest.main()
