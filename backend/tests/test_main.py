############################################################
#  [*] Entrypoint regression tests
#
#  The one route main.py serves itself, the blockchain
#  simulator's demo chain: blocks come back in height order
#  (physical order is insert order only until a block is
#  deleted and re-seeded) and carry their height, so the page
#  never renders a chain whose links look broken because the
#  rows arrived shuffled. Offline: a throwaway SQLite file
#  built with the REAL schema, main's connection pointed at
#  it, Flask's test client.
############################################################


import os
import json
import tempfile
import unittest
from unittest.mock import patch

from app.database.db import get_db_connection
from app.database.db_init import init_db_tables




############################################################
# ExampleChainTests
############################################################
#
# Used by:
#   - nothing else — the demo chain is main.py's only route
############################################################

class ExampleChainTests(unittest.TestCase):

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        self.connect = lambda: get_db_connection(self.db_path)
        with patch('app.database.db_init.get_db_connection', side_effect=self.connect):
            init_db_tables()

    def tearDown(self):
        os.unlink(self.db_path)

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

    def test_blocks_come_back_in_height_order(self):
        blocks = self.fetch()
        self.assertEqual([block['hash'] for block in blocks], ['hash1', 'hash2', 'hash3'])

    def test_blocks_carry_their_height(self):
        blocks = self.fetch()
        self.assertEqual([str(block['height']) for block in blocks], ['1', '2', '3'])

    def test_every_link_points_at_the_previous_block(self):
        # The page's whole lesson — a shuffled result would break it
        blocks = self.fetch()
        for previous, block in zip(blocks, blocks[1:]):
            self.assertEqual(block['previousHash'], previous['hash'])


if __name__ == '__main__':
    unittest.main()
