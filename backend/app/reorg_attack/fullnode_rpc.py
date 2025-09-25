############################################################
# Author:           Tomas Vanagas
# Updated:          2025-09-04
# Version:          1.0
# Description:      Full Node RPC client for blockchain 
#                   operations
############################################################


import requests
from requests.auth import HTTPBasicAuth
from typing import List, Dict
from datetime import datetime
from app.database.db import get_db_connection
import scrypt
import math
import json




class FullNodeRPC:
    """
    Full Node RPC client for private blockchain operations
    """


    def __init__(self, rpc_config: Dict):
        """
        Initialize with RPC configuration
        """
        self.rpchost = rpc_config['rpchost']
        self.rpcport = rpc_config['rpcport']
        self.rpcuser = rpc_config['rpcuser']
        self.rpcpass = rpc_config['rpcpassword']
        self.auth = HTTPBasicAuth(self.rpcuser, self.rpcpass)



    def rpc_call(self, method: str, params: List = None) -> Dict:
        """
        Enhanced RPC call with better error handling
        """
        if params is None:
            params = []
            
        payload = {
            "jsonrpc": "1.0",
            "id": "python",
            "method": method,
            "params": params
        }
        
        try:
            response = requests.post(f"http://{self.rpchost}:{self.rpcport}", json=payload, auth=self.auth, timeout=3)
            
            # Get the JSON response even if status is not 200
            try:
                data = response.json()
            except:
                # If we can't parse JSON, raise the HTTP error
                response.raise_for_status()
                raise Exception("No JSON response")
            
            # Check for RPC-level errors first
            if "error" in data and data["error"]:
                raise Exception(f"RPC Error: {data['error']}")
                
            # Only check HTTP status if no RPC error
            if not response.ok:
                response.raise_for_status()
                
            return data["result"]
            
        except requests.exceptions.RequestException as e:
            raise Exception(f"RPC Connection Error: {str(e)}")



    def get_blockchain_info(self) -> Dict:
        """
        Get blockchain information
        """
        return self.rpc_call("getblockchaininfo")



    def get_network_info(self) -> Dict:
        """
        Get network information
        """
        return self.rpc_call("getnetworkinfo")



    def get_block_count(self) -> int:
        """
        Get current block count
        """
        return self.rpc_call("getblockcount")



    def get_block_hash(self, height: int) -> str:
        """
        Get block hash at specific height
        """
        return self.rpc_call("getblockhash", [height])



    def get_block(self, block_hash: str, verbosity: int = 1) -> Dict:
        """
        Get block information
        """
        return self.rpc_call("getblock", [block_hash, verbosity])



    def get_raw_transaction(self, txid: str, verbose: bool = True) -> Dict:
        """
        Get raw transaction
        """
        return self.rpc_call("getrawtransaction", [txid, verbose])



    def send_raw_transaction(self, raw_tx: str) -> str:
        """
        Send raw transaction
        """
        return self.rpc_call("sendrawtransaction", [raw_tx])



    def extract_coinbase_message(self, coinbase_tx: Dict) -> str:
        """
        Extract the ACTUAL coinbase message by properly parsing the script
        """
        try:
            # Get the first input (coinbase input)
            if not coinbase_tx.get('vin') or len(coinbase_tx['vin']) == 0:
                return "No coinbase input"
            
            coinbase_input = coinbase_tx['vin'][0]
            
            # Check if this is actually a coinbase transaction
            if 'coinbase' not in coinbase_input:
                return "Not a coinbase transaction"
            
            # Get the coinbase script
            coinbase_script = coinbase_input['coinbase']
            
            # Parse the coinbase script to extract the actual message
            try:
                # Convert hex to bytes
                script_bytes = bytes.fromhex(coinbase_script)
                
                # Coinbase structure: [height][extranonce][message]
                # Skip the height encoding (usually first 1-5 bytes)
                
                # Find all printable ASCII sequences
                message_parts = []
                current_text = ""
                
                for i, byte in enumerate(script_bytes):
                    if 32 <= byte <= 126:  # Printable ASCII
                        current_text += chr(byte)
                    else:
                        if len(current_text) >= 2:  # Keep sequences of 2+ characters
                            message_parts.append(current_text)
                        current_text = ""
                
                # Add any remaining text
                if len(current_text) >= 2:
                    message_parts.append(current_text)
                
                # Join all readable parts
                if message_parts:
                    full_message = " ".join(message_parts).strip()
                    
                    # Clean up common noise
                    full_message = full_message.replace('\x00', ' ').replace('\x01', ' ')
                    full_message = ' '.join(full_message.split())  # Remove extra whitespace
                    
                    if len(full_message) >= 1:
                        return full_message[:150]  # Return actual message, limited length
                
                # If no readable ASCII found, the coinbase might be binary-only
                # Show a hex representation but indicate it's the actual data
                if len(script_bytes) > 0:
                    return f"Binary coinbase: {coinbase_script[:60]}{'...' if len(coinbase_script) > 60 else ''}"
                else:
                    return "Empty coinbase"
                
            except Exception as e:
                return f"Parse error: {str(e)[:50]}"
                
        except Exception as e:
            return f"Error: {str(e)[:50]}"



    def get_tip_info(self) -> Dict:
        """
        Get blockchain tip information
        """
        blockchain_info = self.get_blockchain_info()
        return {
            'hash': blockchain_info.get('bestblockhash', ''),
            'height': blockchain_info.get('blocks', 0),
            'available': True
        }



    def reverse_hex(self, hex_str: str) -> str:
        """
        Reverse hex string in 2-char chunks

        INPUT:
        +---------------------------------------+
        | 01 | 23 | 45 | 67 | 89 | AB | CD | EF |
        +---------------------------------------+
            
        OUTPUT:
        +---------------------------------------+
        | EF | CD | AB | 89 | 67 | 45 | 23 | 01 |
        +---------------------------------------+
        """
        return ''.join(reversed([hex_str[i:i+2] for i in range(0, len(hex_str), 2)]))



    def get_scrypt_hash(self, block_info: Dict) -> str:
        """
        Get Scrypt hash of the block
        """
        # Step 1: Extract header values and prepare for concatenation
        version_final = self.reverse_hex(block_info['versionHex'])
        prevhash_final = self.reverse_hex(block_info['previousblockhash'])
        merkle_final = self.reverse_hex(block_info['merkleroot'])
        ntime_final = self.reverse_hex(f"{block_info['time']:08x}")
        nbits_final = self.reverse_hex(f"{int(block_info["bits"], 16):08x}")
        nonce_final = self.reverse_hex(f"{block_info['nonce']:08x}")
        
        # Step 2: Concatenate header values and convert to bytes
        header_bytes = bytes.fromhex(version_final + prevhash_final + merkle_final + ntime_final + nbits_final + nonce_final)
        
        # Step 3: Calculate Scrypt hash
        scrypt_hash_hex = scrypt.hash(header_bytes, header_bytes, 1024, 1, 1, 32)[::-1].hex()
        
        return scrypt_hash_hex



    def sync_recent_blocks(self, depth: int = 100) -> bool:
        """
        Sync recent blocks from the full node
        """
        print(f"[*] Syncing recent blocks from full node...")
        try:

            block_count = self.get_block_count()
            start_height = max(1, block_count - depth + 1)

            with get_db_connection() as conn:
                for height in reversed(range(start_height, block_count + 1)):

                    # Step 1: Get block hash and contents
                    block_hash = self.get_block_hash(height)
                    block_info = self.get_block(block_hash)


                    # Step 2: Check if block already exists
                    sqlFetchData = conn.execute(' SELECT Hash FROM Blockchain_Blocks WHERE Hash = ? ', (block_hash,))
                    if sqlFetchData.fetchone():
                        break

                    
                    # Step 3: Extract REAL coinbase message from the coinbase transaction
                    coinbase_message = ""
                    try:
                        if 'tx' in block_info and len(block_info['tx']) > 0:
                            # Get the coinbase transaction (first transaction in block)
                            coinbase_txid = block_info['tx'][0]
                            coinbase_tx = self.get_raw_transaction(coinbase_txid, verbose=True)
                            coinbase_message = self.extract_coinbase_message(coinbase_tx)
                    except Exception:
                        coinbase_message = f"Block #{height}"
                    

                    # Step 4: Convert block timestamp to date and time
                    dt = datetime.fromtimestamp(block_info.get('time', 0))
                    block_date = dt.strftime('%Y-%m-%d')
                    block_time = dt.strftime('%H:%M:%S')


                    # Step 5: Calculate Scrypt hash
                    scrypt_hash_hex = self.get_scrypt_hash(block_info)


                    # Step 6: Calculate chainwork
                    log2_chainwork_value = math.log2(int(block_info['chainwork'], 16))


                    # Step 7: Insert block data into the database
                    conn.execute(' INSERT OR REPLACE INTO Blockchain_Blocks (Height, Hash, PrevHash, CoinbaseMessage, Date, Time, ScryptHash, Chainwork) VALUES (?,?,?,?,?,?,?,?)', 
                        (height, block_hash, block_info.get('previousblockhash', 'genesis'), coinbase_message, block_date, block_time, scrypt_hash_hex, log2_chainwork_value))
                

                # Commit after finishing the loop
                conn.commit()
            return True
        

        except Exception as e:
            print(f"Error syncing blocks: {e}")
        return False

                    
    def sync_tracked_transactions(self, txids: List[str]) -> bool:
        """
        Sync tracked transactions
        """
        print(f"[*] Syncing tracked transactions from full node...")
        for txid in txids:
            found_blocks = []
            
            # Step 1: Get transaction info from private network
            private_tx_info = self.get_raw_transaction(txid)
            if "blockhash" in private_tx_info:
                found_blocks.append(private_tx_info["blockhash"])


            # Step 2: Store transaction data
            with get_db_connection() as conn:
                for block_hash in found_blocks:
                    conn.execute('''
                        INSERT OR IGNORE INTO Blockchain_TxInBlocks (TXID, BlockHash)
                        VALUES (?, ?)
                    ''', (txid, block_hash))
                conn.commit()
        return True



class FullNodeConnections:
    """
    Manages network connections for the full node
    """


    def __init__(self, rpc_client: FullNodeRPC):
        self.rpc = rpc_client



    def get_peer_info(self, show_dummy: bool = False) -> List[Dict]:
        """
        Get peer info from the full node
        """
        peer_info = []
        if not show_dummy:
            peer_info = self.rpc.rpc_call("getpeerinfo")
            peer_info = [peer for peer in peer_info if peer['addr'] != "faucet-litecoind-dummy:19335"]
        else:
            peer_info = self.rpc.rpc_call("getpeerinfo")
        return peer_info



    def connect(self) -> Dict:
        """
        Enable network activity
        """
        self.rpc.rpc_call("addnode", ["faucet-litecoind-public:19335", "onetry"])

        return {
            'success': True,
            'message': 'Network activity enabled',
            'result': True
        }
       


    def disconnect(self) -> Dict:
        """
        Disable network activity and disconnect all peers
        """
        # First disconnect all current peers
        try:
            self.rpc.rpc_call("disconnectnode", ["faucet-litecoind-public:19335"])
        except Exception as e:
            pass
        
        return {
            'success': True,
            'message': 'Network activity disabled and peers disconnected'
        }
     


    def get_connection_status(self) -> Dict:
        """
        Get current connection status
        """
        peer_info = self.get_peer_info()
        blockchain_info = self.rpc.get_blockchain_info()
        
        is_connected = len(peer_info) > 0
        
        return {
            'success': True,
            'status': {
                'isConnectedToPublic': is_connected,
                'connection': {
                    'peers': peer_info
                },
                'privateTip': {
                    'hash': blockchain_info.get('bestblockhash', ''),
                    'height': blockchain_info.get('blocks', 0),
                    'available': True
                }
            }
        }


