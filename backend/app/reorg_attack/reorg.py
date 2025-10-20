############################################################
# Author:           Tomas Vanagas
# Updated:          2025-09-04
# Version:          1.0
# Description:      Reorg attack manager for blockchain 
############################################################


from datetime import datetime
import json
from typing import Dict
from app.database.db import get_db_connection
from .fullnode_rpc import FullNodeRPC, FullNodeConnections




class ReorgDatabase:
    """
    Database operations for reorg attack system
    """


    @staticmethod
    def get_existing_block_hashes(date=None) -> set:
        """
        Get a set of existing block hashes for efficient duplicate checking
        """
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
            



    @staticmethod
    def get_all_tracked_transactions():
        """
        Get all tracked transactions with their associated blocks
        """
        with get_db_connection() as conn:            
            sqlFetchData = conn.execute('''
                SELECT DISTINCT t.TXID, t.Inputs, t.Outputs, t.Color
                FROM Blockchain_Transactions t
            ''')
            
            transactions = []
            for row in sqlFetchData.fetchall():
                txid = row[0]
                color = row[3] if row[3] else 'blue'  # Use stored color or default to blue
                
                # Get blocks associated with this transaction
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
            



    @staticmethod
    def get_blocks_summary():
        """
        Get a summary of blocks in the database
        """
        with get_db_connection() as conn:            
            # Get overall summary
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
            
            # Get summary by coinbase message patterns (to distinguish networks)
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
            




class ReorgAttackManager:
    """
    Main manager for reorg attack operations
    """
    
    def __init__(self, config: Dict):
        self.config = config
        self.depth_per_sync = 100
        
        # Initialize RPC clients
        self.public_rpc = FullNodeRPC(self.config['publicside'])
        self.private_rpc = FullNodeRPC(self.config['privateside'])
        self.fullnode_connections = FullNodeConnections(self.private_rpc)




    def get_blockchain_data(self, date) -> Dict:
        """
        Get blockchain visualization data with improved efficiency
        """
        dateNow = datetime.now().strftime("%Y-%m-%d")
        target_date = date or dateNow

        # Step 1: Sync recent data before returning
        self.private_rpc.sync_recent_blocks(self.depth_per_sync)
        self.public_rpc.sync_recent_blocks(self.depth_per_sync)



        # Step 2: Get blocks from database
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



        # Step 3: Sync tracked transactions
        all_tracked_txids = []
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT TXID FROM Blockchain_Transactions
            ''')
            all_tracked_txids = [row[0] for row in sqlFetchData.fetchall()]
        self.public_rpc.sync_tracked_transactions(all_tracked_txids)
        self.private_rpc.sync_tracked_transactions(all_tracked_txids)



        # Step 4: Get tracked transactions
        tracked_transactions = ReorgDatabase.get_all_tracked_transactions()



        # Step 5: Get tips
        public_tip = self.public_rpc.get_tip_info()
        private_tip = self.private_rpc.get_tip_info()



        # Step 6: Return data
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



    def get_network_status(self) -> Dict:
        """
        Get comprehensive network status including tips
        """
        # Get connection status from full node
        connection_status = self.fullnode_connections.get_connection_status()
        
        # Get public tip with better error handling
        public_tip = self.public_rpc.get_tip_info()
        
        # Get database summary
        blocks_summary = ReorgDatabase.get_blocks_summary()
        
        # Merge the data
        if connection_status['success']:
            connection_status['status']['publicTip'] = public_tip
            connection_status['status']['blocksSummary'] = blocks_summary
            
        return connection_status
        


    def send_raw_transaction(self, raw_tx: str, color: str = 'blue') -> Dict:
        """
        Send raw transaction to private network and automatically track it
        """
        try:
            txid = self.private_rpc.send_raw_transaction(raw_tx)
            
            # Automatically track the transaction with the specified color
            try:
                self.track_transaction(txid, color)
            except Exception as track_err:
                # Log tracking error but don't fail the transaction send
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



    def track_transaction(self, txid: str, color: str = 'blue') -> Dict:
        """
        Track a transaction
        """
        
        inputs_json = None
        outputs_json = None
        found_blocks = []


        # Step 1: Get transaction info from private network
        try:
            private_tx_info = self.private_rpc.get_raw_transaction(txid)
            if(inputs_json is None and outputs_json is None):
                inputs_json = json.dumps(private_tx_info.get("vin", []))
                outputs_json = json.dumps(private_tx_info.get("vout", []))
            if "blockhash" in private_tx_info:
                found_blocks.append(private_tx_info["blockhash"])
        except Exception as e:
            print(f"Note: Could not get transaction from private network: {str(e)}")



        # Step 2: Get transaction info from public network
        try:
            public_tx_info = self.public_rpc.get_raw_transaction(txid)
            if(inputs_json is None and outputs_json is None):
                inputs_json = json.dumps(public_tx_info.get("vin", []))
                outputs_json = json.dumps(public_tx_info.get("vout", []))
            if "blockhash" in public_tx_info:
                found_blocks.append(public_tx_info["blockhash"])
        except Exception as e:
            print(f"Note: Could not get transaction from public network: {str(e)}")
                    
        

        # Step 3: Store transaction data (even if it's not in a block yet)
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





    def remove_transaction_tracking(self, txid: str) -> Dict:
        """
        Remove a transaction from tracking
        """
        with get_db_connection() as conn:
            conn.execute('DELETE FROM Blockchain_TxInBlocks WHERE TXID = ?', (txid,))
            conn.execute('DELETE FROM Blockchain_Transactions WHERE TXID = ?', (txid,))
            conn.commit()
        
        return {
            'success': True,
            'message': 'Transaction tracking removed successfully'
        }
