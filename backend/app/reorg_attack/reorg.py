############################################################
#  [*] Reorg attack — manager & database helpers
#
#  The backend half of the 51% attack tool: ReorgDatabase
#  wraps the Blockchain_* tables (blocks mirrored from the
#  fullnodes, tracked transactions and the blocks they were
#  sighted in), ReorgAttackManager drives the attack view —
#  one FullNodeRPC client per side (the PUBLIC network node
#  and the student-controlled PRIVATE one, fullnode_rpc.py)
#  plus the peer-connection switch that splits and heals the
#  two networks.
#
#  Used by:
#    - routes.py — the Flask endpoints under /api/reorg/*
############################################################


from datetime import datetime
import json
from typing import Dict
from app.database.db import get_db_connection
from .fullnode_rpc import FullNodeRPC, FullNodeConnections








############################################################
# ReorgDatabase
############################################################
#
# Static read helpers over the Blockchain_* tables — no
# state, no RPC; every method opens its own connection.
#
# Used by:
#   - ReorgAttackManager (below) and routes.py
############################################################

class ReorgDatabase:






    ############################################################
    # get_existing_block_hashes
    ############################################################
    #
    # The stored block hashes of one 'YYYY-MM-DD' date
    # (default: today), as a plain list — meant as a cheap
    # duplicate check before inserting synced blocks.
    #
    # Used by:
    #   - nothing calls this at the moment — the sync path in
    #     fullnode_rpc.py checks duplicates its own way
    ############################################################

    @staticmethod
    def get_existing_block_hashes(date=None) -> set:
        dateNow = datetime.now().strftime("%Y-%m-%d")
        target_date = date or dateNow

        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT 
                    json_group_array(Hash)
                FROM Blockchain_Blocks 
                WHERE Date = ? 
                ORDER BY Height DESC
            ''', [target_date])
            results = sqlFetchData.fetchone()[0]
            return json.loads(results)






    ############################################################
    # get_all_tracked_transactions
    ############################################################
    #
    # Every tracked transaction as {txid, color, blocks}: the
    # student-assigned color (empty column falls back to
    # 'blue') and the hashes of every block the tx was sighted
    # in — one extra query per transaction, fine for the
    # handful a class tracks.
    #
    # Used by:
    #   - ReorgAttackManager.get_blockchain_data (below)
    #   - routes.py — the transaction list endpoint
    ############################################################

    @staticmethod
    def get_all_tracked_transactions():
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT DISTINCT t.TXID, t.Inputs, t.Outputs, t.Color
                FROM Blockchain_Transactions t
            ''')

            transactions = []
            for row in sqlFetchData.fetchall():
                txid = row[0]
                color = row[3] if row[3] else 'blue'

                sqlFetchData = conn.execute('''
                    SELECT BlockHash FROM Blockchain_TxInBlocks WHERE TXID = ?
                ''', (txid,))

                blocks = [block[0] for block in sqlFetchData.fetchall()]

                transactions.append({
                    'txid': txid,
                    'color': color,
                    'blocks': blocks
                })

            return transactions






    ############################################################
    # get_blocks_summary
    ############################################################
    #
    # Two views of the stored blocks: the overall count /
    # height range / date range, and the same broken down by
    # coinbase message — the coinbase is what distinguishes
    # which network (public vs the students' private chain)
    # mined a block.
    #
    # Used by:
    #   - ReorgAttackManager.get_network_status (below)
    ############################################################

    @staticmethod
    def get_blocks_summary():
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT 
                    COUNT(*) as total_count,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height,
                    MIN(Date) as earliest_date,
                    MAX(Date) as latest_date
                FROM Blockchain_Blocks
            ''')

            overall = sqlFetchData.fetchone()

            sqlFetchData = conn.execute('''
                SELECT 
                    CoinbaseMessage,
                    COUNT(*) as count,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height
                FROM Blockchain_Blocks 
                GROUP BY CoinbaseMessage
                ORDER BY count DESC
            ''')

            by_coinbase = sqlFetchData.fetchall()

            summary = {
                'total': {
                    'count': overall[0] if overall else 0,
                    'height_range': f"{overall[1]}-{overall[2]}" if overall and overall[1] else "N/A",
                    'date_range': f"{overall[3]} to {overall[4]}" if overall and overall[3] else "N/A"
                },
                'by_coinbase': {}
            }

            for row in by_coinbase:
                summary['by_coinbase'][row[0]] = {
                    'count': row[1],
                    'height_range': f"{row[2]}-{row[3]}"
                }

            return summary








############################################################
# ReorgAttackManager
############################################################
#
# The attack orchestrator: one FullNodeRPC per side (public /
# private, from the config's connection settings) plus the
# FullNodeConnections switch on the private node. Methods:
#
#   view     — get_blockchain_data, get_network_status
#   actions  — send_raw_transaction, track_transaction,
#              remove_transaction_tracking
#
# Used by:
#   - routes.py — the single shared instance
############################################################

class ReorgAttackManager:






    ############################################################
    # __init__
    ############################################################
    #
    # Builds both RPC clients from the config dict
    # ('publicside' / 'privateside' connection settings) and
    # the peer-connection switch on the private node.
    # depth_per_sync caps how many recent blocks each view
    # refresh pulls from each node.
    #
    # Used by:
    #   - routes.py — at import time, the single instance
    ############################################################

    def __init__(self, config: Dict):
        self.config = config
        self.depth_per_sync = 100

        self.public_rpc = FullNodeRPC(self.config['publicside'])
        self.private_rpc = FullNodeRPC(self.config['privateside'])
        self.fullnode_connections = FullNodeConnections(self.private_rpc)






    ############################################################
    # get_blockchain_data
    ############################################################
    #
    # The attack view in one payload: syncs the recent blocks
    # of BOTH nodes into the database, serves the picked
    # date's blocks (default today), refreshes every tracked
    # transaction's block sightings on both sides, and returns
    # blocks + the two chain tips + the tracked transactions.
    #
    # Used by:
    #   - routes.py — the visualization's poll endpoint
    ############################################################

    def get_blockchain_data(self, date) -> Dict:
        dateNow = datetime.now().strftime("%Y-%m-%d")
        target_date = date or dateNow


        # STEP 1: pull each node's newest blocks into the DB, so
        # the view below reads fresh data.
        # ======================================================
        self.private_rpc.sync_recent_blocks(self.depth_per_sync)
        self.public_rpc.sync_recent_blocks(self.depth_per_sync)


        # STEP 2: the picked date's blocks. A date with fewer than
        # 100 stored blocks (fresh install, quiet day) falls back
        # to the newest 100 overall, so the view never renders
        # near-empty.
        # ========================================================
        all_blocks = []
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT
                    json_group_array(
                        json_object(
                            'height', Height,
                            'hash', Hash,
                            'prevHash', PrevHash,
                            'coinbase', CoinbaseMessage,
                            'date', Date,
                            'time', Time,
                            'scryptHash', ScryptHash,
                            'chainWork', ChainWork
                        )
                    )
                FROM Blockchain_Blocks 
                WHERE Date = ?
                ORDER BY Height ASC
            ''', [target_date])
            all_blocks = json.loads(sqlFetchData.fetchone()[0])

            if len(all_blocks) < 100:
                sqlFetchData = conn.execute('''
                    SELECT
                        json_group_array(
                            json_object(
                                'height', Height,
                                'hash', Hash,
                                'prevHash', PrevHash,
                                'coinbase', CoinbaseMessage,
                                'date', Date,
                                'time', Time,
                                'scryptHash', ScryptHash,
                                'chainWork', ChainWork
                            )
                        )
                    FROM (
                        SELECT * FROM Blockchain_Blocks
                        ORDER BY Height DESC
                        LIMIT 100
                    )
                    ORDER BY Height ASC
                ''')
                all_blocks = json.loads(sqlFetchData.fetchone()[0])


        # STEP 3: refresh every tracked transaction's block
        # sightings on both networks.
        # =================================================
        all_tracked_txids = []
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT TXID FROM Blockchain_Transactions
            ''')
            all_tracked_txids = [row[0] for row in sqlFetchData.fetchall()]
        self.public_rpc.sync_tracked_transactions(all_tracked_txids)
        self.private_rpc.sync_tracked_transactions(all_tracked_txids)


        # STEP 4: assemble — tracked transactions, both tips, the
        # blocks.
        # =======================================================
        tracked_transactions = ReorgDatabase.get_all_tracked_transactions()

        public_tip = self.public_rpc.get_tip_info()
        private_tip = self.private_rpc.get_tip_info()

        return {
            'success': True,
            'data': {
                'chainBlocks': all_blocks,
                'chainTips': {
                    'public': public_tip.get('hash') if public_tip else None,
                    'private': private_tip.get('hash') if private_tip else None
                },
                'transactions': tracked_transactions
            }
        }






    ############################################################
    # get_network_status
    ############################################################
    #
    # The private node's peer-connection status, enriched —
    # when that call succeeded — with the public tip and the
    # stored-blocks summary.
    #
    # Used by:
    #   - routes.py — the network status endpoint
    ############################################################

    def get_network_status(self) -> Dict:
        connection_status = self.fullnode_connections.get_connection_status()

        public_tip = self.public_rpc.get_tip_info()

        blocks_summary = ReorgDatabase.get_blocks_summary()

        if connection_status['success']:
            connection_status['status']['publicTip'] = public_tip
            connection_status['status']['blocksSummary'] = blocks_summary

        return connection_status






    ############################################################
    # send_raw_transaction
    ############################################################
    #
    # Broadcasts a raw transaction to the PRIVATE node and
    # auto-tracks it under the given color. Tracking is
    # best-effort: the broadcast already happened, so a
    # tracking failure only warns instead of failing the
    # request.
    #
    # Used by:
    #   - routes.py — the send endpoint
    ############################################################

    def send_raw_transaction(self, raw_tx: str, color: str = 'blue') -> Dict:
        try:
            txid = self.private_rpc.send_raw_transaction(raw_tx)

            # Log tracking errors but don't fail the transaction send
            try:
                self.track_transaction(txid, color)
            except Exception as track_err:
                print(f"Warning: Failed to track transaction {txid}: {str(track_err)}")

            return {
                'success': True,
                'message': 'Transaction sent successfully',
                'txid': txid
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'Failed to send transaction: {str(e)}'
            }






    ############################################################
    # track_transaction
    ############################################################
    #
    # Starts (or refreshes) tracking one transaction: asks
    # BOTH networks about it — the first answer supplies the
    # inputs/outputs, every answer may add a block sighting —
    # and upserts the result. A tx in no block yet is stored
    # anyway (INSERT OR REPLACE also refreshes the color on
    # re-track).
    #
    # Used by:
    #   - send_raw_transaction (above) — auto-track
    #   - routes.py — the manual track endpoint
    ############################################################

    def track_transaction(self, txid: str, color: str = 'blue') -> Dict:

        inputs_json = None
        outputs_json = None
        found_blocks = []


        # STEP 1: the private network's view of the tx.
        # =============================================
        try:
            private_tx_info = self.private_rpc.get_raw_transaction(txid)
            if(inputs_json is None and outputs_json is None):
                inputs_json = json.dumps(private_tx_info.get("vin", []))
                outputs_json = json.dumps(private_tx_info.get("vout", []))
            if "blockhash" in private_tx_info:
                found_blocks.append(private_tx_info["blockhash"])
        except Exception as e:
            print(f"Note: Could not get transaction from private network: {str(e)}")


        # STEP 2: the public network's view.
        # ==================================
        try:
            public_tx_info = self.public_rpc.get_raw_transaction(txid)
            if(inputs_json is None and outputs_json is None):
                inputs_json = json.dumps(public_tx_info.get("vin", []))
                outputs_json = json.dumps(public_tx_info.get("vout", []))
            if "blockhash" in public_tx_info:
                found_blocks.append(public_tx_info["blockhash"])
        except Exception as e:
            print(f"Note: Could not get transaction from public network: {str(e)}")


        # STEP 3: store the tx (even when it's in no block yet)
        # and each block sighting.
        # =====================================================
        with get_db_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO Blockchain_Transactions (TXID, Inputs, Outputs, Color)
                VALUES (?, ?, ?, ?)
            ''', (txid, inputs_json, outputs_json, color))

            for block_hash in found_blocks:
                conn.execute('''
                    INSERT OR IGNORE INTO Blockchain_TxInBlocks (TXID, BlockHash)
                    VALUES (?, ?)
                ''', (txid, block_hash))
            conn.commit()

        return {
            'success': True,
            'transaction': {
                'txid': txid,
                'color': color,
                'blocks': found_blocks
            }
        }






    ############################################################
    # remove_transaction_tracking
    ############################################################
    #
    # Stops tracking one transaction: its block sightings and
    # the transaction row itself.
    #
    # Used by:
    #   - routes.py — the untrack endpoint
    ############################################################

    def remove_transaction_tracking(self, txid: str) -> Dict:
        with get_db_connection() as conn:
            conn.execute('DELETE FROM Blockchain_TxInBlocks WHERE TXID = ?', (txid,))
            conn.execute('DELETE FROM Blockchain_Transactions WHERE TXID = ?', (txid,))
            conn.commit()

        return {
            'success': True,
            'message': 'Transaction tracking removed successfully'
        }
