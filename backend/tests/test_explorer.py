############################################################
#  [*] Etherscan explorer regression tests
#
#  Offline checks of the explorer's pollution defenses: a
#  recipient that receives calldata is seeded as a contract
#  (and the flag only ever escalates), a fetched history with
#  too many counterparties is flagged as a public hub instead
#  of stored, trusted addresses (the faucet itself) are exempt,
#  and flagged addresses are never scraped again. Each test
#  runs against its own throwaway SQLite file — no network, no
#  real database.
############################################################


import os
import tempfile
import sqlite3
import unittest
from unittest.mock import patch

from app.evm_faucet.explorer import EtherscanExplorer, HUB_COUNTERPARTY_THRESHOLD


TESTCHAIN_CONFIGS = {
    'testchain': {
        'chain_id': 12345,
        'explorer': {'etherscan_api_url': 'http://etherscan.invalid/api'},
    },
}

FAUCET = '0x' + 'fa' * 20
STUDENT = '0x' + '01' * 20
TOKEN = '0x' + '02' * 20


def make_tx(sender, recipient, block, calldata='0x'):
    return {
        'from': sender,
        'to': recipient,
        'value': '1000000000000000000',
        'hash': f'0xhash{sender[-4:]}{recipient[-4:]}{block}',
        'blockNumber': str(block),
        'timeStamp': '1750000000',
        'input': calldata,
    }




############################################################
# ExplorerPollutionTests
############################################################

class ExplorerPollutionTests(unittest.TestCase):

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE addresses (
                    address TEXT NULL, name TEXT NULL,
                    is_contract INTEGER NULL, is_hub INTEGER NULL,
                    UNIQUE (address)
                )
            ''')
            conn.execute('''
                CREATE TABLE transactions (
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
                'SELECT is_contract, is_hub FROM addresses WHERE address = ?',
                [address.lower()]).fetchone()
        return row

    def stored_tx_count(self):
        with sqlite3.connect(self.db_path) as conn:
            return conn.execute('SELECT COUNT(*) FROM transactions').fetchone()[0]

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
            conn.execute("INSERT INTO addresses VALUES (?, '', 1, 0)", [TOKEN.lower()])
        with patch.object(self.explorer, '_refresh_address',
                          side_effect=AssertionError('must not scrape')) as refresh:
            data, status = self.explorer.get_stored_transactions(
                'testchain', TOKEN, 1750000000, 99999999999)
        self.assertEqual(status, 200)
        refresh.assert_not_called()


if __name__ == '__main__':
    unittest.main()
