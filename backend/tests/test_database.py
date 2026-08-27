############################################################
#  [*] Database helper and schema regression tests
#
#  What every SQL statement in the app rides on: connections
#  in write-ahead-logging mode with a long busy timeout (the
#  explorer commits scraped histories while other threads
#  aggregate the graph, and dbgate holds the same file from
#  another container), and a Graph_Transactions schema whose
#  id is a real rowid alias. Offline, on throwaway files
#  built with the REAL schema.
############################################################


import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app.database.db import get_db_connection
from app.database.db_init import init_db_tables




############################################################
# TempDbCase
############################################################
#
# A throwaway SQLite file carrying the PRODUCTION schema.
#
# Used by:
#   - the test classes below
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
# SchemaTests
############################################################

class SchemaTests(TempDbCase):

    def test_graph_transactions_rows_get_a_real_id(self):
        # [id] INTEGER PRIMARY KEY is the rowid alias — MySQL's
        # AUTO_INCREMENT spelling once made it a plain nullable column
        with self.connect() as conn:
            conn.execute('''
                INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                VALUES ('net', '0xaa', '0xbb', 1.0, '0xhash', 1, 1)
            ''')
            row = conn.execute('SELECT id FROM Graph_Transactions').fetchone()

        self.assertIsNotNone(row[0])
        self.assertEqual(row[0], 1)

    def test_ids_keep_growing_after_a_delete(self):
        with self.connect() as conn:
            for i in range(3):
                conn.execute('''
                    INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                    VALUES ('net', '0xaa', '0xbb', 1.0, ?, 1, 1)
                ''', [f'0xhash{i}'])
            conn.execute("DELETE FROM Graph_Transactions WHERE hash = '0xhash2'")
            conn.execute('''
                INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                VALUES ('net', '0xaa', '0xbb', 1.0, '0xhash3', 1, 1)
            ''')
            ids = [row[0] for row in conn.execute('SELECT id FROM Graph_Transactions ORDER BY id')]

        self.assertEqual(ids, [1, 2, 4])                    # AUTOINCREMENT never reuses an id




############################################################
# ConnectionTests
############################################################

class ConnectionTests(TempDbCase):

    def test_connections_use_write_ahead_logging(self):
        with self.connect() as conn:
            self.assertEqual(conn.execute('PRAGMA journal_mode').fetchone()[0].lower(), 'wal')

    def test_the_mode_sticks_to_the_file(self):
        # WAL is a property of the database file — a plain sqlite3
        # connection (dbgate's, say) finds it already set
        with self.connect():
            pass
        plain = sqlite3.connect(self.db_path)
        try:
            self.assertEqual(plain.execute('PRAGMA journal_mode').fetchone()[0].lower(), 'wal')
        finally:
            plain.close()

    def test_connections_wait_out_a_lock_longer_than_the_default(self):
        with self.connect() as conn:
            self.assertGreaterEqual(conn.execute('PRAGMA busy_timeout').fetchone()[0], 10_000)

    def test_a_reader_is_not_blocked_by_an_open_write(self):
        # The whole point of WAL: the explorer's commit in one thread
        # never blocks the graph query in another
        writer = self.connect()
        writer.execute('''
            INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
            VALUES ('net', '0xaa', '0xbb', 1.0, '0xhash', 1, 1)
        ''')                                               # uncommitted — the write lock is held
        try:
            with self.connect() as reader:
                self.assertEqual(reader.execute('SELECT COUNT(*) FROM Graph_Transactions').fetchone()[0], 0)
        finally:
            writer.rollback()
            writer.close()


if __name__ == '__main__':
    unittest.main()
