############################################################
# Author:           Tomas Vanagas
# Updated:          2025-09-04
# Version:          1.0
# Description:      EVM faucet for blockchain 
############################################################




import os
import time
import json
import logging
from datetime import datetime, timedelta

import requests
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct

from ..database.db import get_db_connection


class EVMFaucet:


    def __init__(self, network_configs, default_network=None):
        self.APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == "true"
        self.FAUCET_DEFAULT_NETWORK = default_network or os.getenv('FAUCET_DEFAULT_NETWORK', 'sepolia')
        self.ETHERSCAN_API_KEY = os.getenv('ETHERSCAN_API_KEY', '')

        self.NETWORK_CONFIGS = network_configs

        self.w3_instances = {}
        for network in self.NETWORK_CONFIGS:
            if 'http' not in self.NETWORK_CONFIGS[network]['infura_network']:
                infura_url = f"https://{self.NETWORK_CONFIGS[network]['infura_network']}.infura.io/v3/{os.getenv('INFURA_PROJECT_ID')}"
            else:
                infura_url = self.NETWORK_CONFIGS[network]['infura_network']
            
            # Configure HTTPProvider with proper timeout and connection settings
            request_kwargs = {
                'timeout': 10  # 10 second timeout for all requests
            }
            self.w3_instances[network] = Web3(Web3.HTTPProvider(infura_url, request_kwargs=request_kwargs))



        # Convert private key to 0x prefixed hex string and pad to 66 characters if necessary
        self.FAUCET_PRIVATE_KEY = os.getenv('FAUCET_PRIVATE_KEY')
        self.FAUCET_PRIVATE_KEY = "0x" + self.FAUCET_PRIVATE_KEY.replace("0x", "")
        self.FAUCET_PRIVATE_KEY = self.FAUCET_PRIVATE_KEY.ljust(66, '0')
    

        try:
            self.FAUCET_ADDRESS = Account.from_key(self.FAUCET_PRIVATE_KEY).address if self.FAUCET_PRIVATE_KEY else None
        except Exception:
            self.FAUCET_ADDRESS = None


        self.COOLDOWN_PERIOD = 60
        self.last_request = {}



    def is_supported_network(self, network):
        return network in self.NETWORK_CONFIGS



    def verify_signature(self, network, address, message, signature):
        w3 = self.w3_instances[network]
        try:
            message_hash = encode_defunct(text=message)
            signer = w3.eth.account.recover_message(message_hash, signature=signature)
            return signer.lower() == (address or '').lower()
        except Exception:
            return False



    def request_eth(self, network, to_address, signature, nonce):
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400

        w3 = self.w3_instances[network]

        amount_to_send = self.NETWORK_CONFIGS[network]['chunk_size']
        amount_to_send_wei = Web3.to_wei(float(amount_to_send), 'ether')

        if not all([to_address, signature, nonce]):
            return {"error": "Trūksta reikalingų parametrų"}, 400

        try:
            to_address = w3.to_checksum_address(to_address)
        except Exception:
            return {"error": "Neteisingas adresas"}, 400

        if not w3.is_address(to_address):
            return {"error": "Neteisingas adresas"}, 400

        message = f"Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}"
        if not self.verify_signature(network, to_address, message, signature):
            return {"error": "Kriptografinis parašas kažkodėl neatitinka"}, 403

        try:
            user_balance = w3.eth.get_balance(to_address)
        except Exception:
            return {"error": "Nepavyko gauti naudotojo balanso"}, 500

        if user_balance >= amount_to_send_wei:
            return {"error": f"Jūsų piniginėje jau yra pakankamai {self.NETWORK_CONFIGS[network]['short_name']}."}, 400

        addr_key = to_address.lower()
        if addr_key in self.last_request:
            time_since = int(time.time()) - self.last_request[addr_key]
            if time_since < self.COOLDOWN_PERIOD:
                return {"error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {self.COOLDOWN_PERIOD - time_since} sek."}, 429

        faucet_balance = w3.eth.get_balance(self.FAUCET_ADDRESS)
        if faucet_balance < amount_to_send_wei:
            return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503

        nonce_tx = w3.eth.get_transaction_count(self.FAUCET_ADDRESS)
        tx = {
            'nonce': nonce_tx,
            'to': to_address,
            'value': int(amount_to_send_wei),
            'gas': 210000,
            'gasPrice': w3.eth.gas_price,
            'chainId': self.NETWORK_CONFIGS[network]['chain_id']
        }

        signed_tx = w3.eth.account.sign_transaction(tx, self.FAUCET_PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)

        self.last_request[addr_key] = int(time.time())

        return {
            "message": "ETH sent successfully",
            "transaction_hash": tx_hash.hex(),
            "amount": float(w3.from_wei(amount_to_send_wei, 'ether'))
        }, 200



    def get_faucet_balance(self, network):
        if not self.is_supported_network(network):
            return {"error": f"Unsupported network: {network}"}, 400

        # Check if faucet address is valid
        if not self.FAUCET_ADDRESS:
            logging.error("FAUCET_ADDRESS is None or empty")
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        w3 = self.w3_instances[network]
        
        # Log the request details
        logging.info(f"Getting balance for network={network}, address={self.FAUCET_ADDRESS}")
        
        try:
            # Check if web3 is connected
            if not w3.is_connected():
                logging.error(f"Web3 is not connected for network {network}")
                return {"error": "Nepavyko prisijungti prie tinklo"}, 500
            
            balance = w3.eth.get_balance(self.FAUCET_ADDRESS)
            balance_eth = float(w3.from_wei(balance, 'ether'))
            
            # Log the successful response
            logging.info(f"Balance retrieved successfully: {balance_eth} ETH (raw: {balance} wei)")
            
        except Exception as e:
            # Log the actual error for debugging while returning user-friendly message
            logging.error(f"Failed to get faucet balance for network {network}: {type(e).__name__}: {e}")
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500

        return {
            "balance": balance_eth,
            "address": self.FAUCET_ADDRESS.lower(),
            "chunk_size": float(self.NETWORK_CONFIGS[network]['chunk_size'])
        }, 200



    def get_networks(self):
        return {
            "networks": self.NETWORK_CONFIGS,
            "default_network": self.FAUCET_DEFAULT_NETWORK
        }



    def fetch_all_transactions_from_etherscan(self, address, network):
        if not self.is_supported_network(network):
            raise ValueError(f"Unsupported network: {network}")

        url = self.NETWORK_CONFIGS[network]['etherscan_api_url']
        all_transactions = []
        page = 1

        while True:
            params = {
                'module': 'account',
                'action': 'txlist',
                'address': address,
                'startblock': 0,
                'endblock': 99999999,
                'page': page,
                'offset': 1000,
                'sort': 'asc',
                'chainid': self.NETWORK_CONFIGS[network]['chain_id'],
                'apikey': self.ETHERSCAN_API_KEY
            }
            response = requests.get(url, params=params)
            response.raise_for_status()
            result = response.json()

            if result.get('status') == '1':
                transactions = result['result']
                all_transactions.extend(transactions)

                if len(transactions) < 1000:
                    break

                page += 1
            elif result.get('message') == 'No transactions found':
                break
            else:
                print("+----------------------------------------+")
                print(json.dumps(result, indent=4))
                print("+----------------------------------------+")
                raise Exception(f"Etherscan API error: {result.get('message', 'Unknown error')}")

        return all_transactions



    def store_transactions(self, transactions, network):
        with get_db_connection() as conn:

            # # Debugging: print the fetched transactions
            # print("----------------------------------------")
            # print("Fetched transactions:")
            # print(json.dumps(transactions, indent=4))
            # print("----------------------------------------")

            for tx in transactions:
                is_contract = 0
                recipient = tx.get('to', '')
                if recipient == '' or recipient == None:
                    is_contract = 1
                    recipient = tx.get('contractAddress', '')

                conn.execute('''
                    INSERT OR IGNORE INTO transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (network.lower(), tx['from'].lower(), recipient.lower(), float(tx['value']) / 10**18, tx['hash'],
                    int(tx['blockNumber']), int(tx['timeStamp'])
                ))

                conn.execute(''' 
                    UPDATE transactions SET from_address = ?, to_address = ?, value = ?, block_number = ?, timestamp = ?
                        WHERE LOWER(network) = ? AND hash = ?''',
                (tx['from'].lower(), recipient.lower(), float(tx['value']) / 10**18, int(tx['blockNumber']),
                    int(tx['timeStamp']), network.lower(), tx['hash']
                ))

                conn.execute('''      
                    INSERT OR IGNORE INTO addresses (address, name, is_contract)
                    VALUES (?, ?, ?) ''',
                    (tx['from'].lower(), "", 0))

                conn.execute('''   
                    INSERT OR IGNORE INTO addresses (address, name, is_contract)
                    VALUES (?, ?, ?) ''',
                    (recipient.lower(), "", is_contract))



    def fetch_and_store_transactions(self, network, address):
        transactions = self.fetch_all_transactions_from_etherscan(address, network)
        self.store_transactions(transactions, network)
        return {
            "address": address,
            "network": network,
            "total_transactions": len(transactions),
            "message": "Transactions fetched and stored successfully"
        }



    def get_stored_transactions(self, network, address, hours=24):
        if not address:
            return {"error": "Address is required"}, 400
        if not self.is_supported_network(network):
            return {"error": f"Unsupported network: {network}"}, 400

        try:
            self.fetch_and_store_transactions(network, address)
        except Exception:
            logging.exception("Error fetching/storing transactions")
            return {"error": "Failed to refresh transactions"}, 500

        with get_db_connection() as conn:
            threshold_time = int((datetime.utcnow() - timedelta(hours=hours)).timestamp())

            sqlQueryResult = conn.execute('''
                WITH GetLatestUpdate AS (
                    SELECT
                        address,
                        MAX(timestamp) as timestamp
                    FROM
                    (
                        SELECT
                            from_address AS address,
                            MAX(timestamp) as timestamp
                        FROM
                            transactions
                        GROUP BY from_address
                        
                        UNION ALL
                        SELECT
                            to_address AS address,
                            MAX(timestamp)
                        FROM
                            transactions
                        GROUP BY to_address
                    )
                    GROUP BY address
                ),
                    
                GetFlows AS (
                    SELECT
                        json_object(
                            'from_address',         transactions.from_address,
                            'from_name',            addr_from.name,
                            'from_timestamp',       latest_update_from.timestamp,
                        
                            'to_address',           transactions.to_address,
                            'to_name',              addr_to.name,
                            'to_timestamp',         latest_update_to.timestamp,
                            'to_addr_contract',     addr_to.is_contract,

                            'value',                SUM(transactions.value),
                            'count',                COUNT(*)
                        ) as JSON
                    FROM 
                        transactions
                    
                    LEFT JOIN addresses AS addr_from
                        ON addr_from.address = transactions.from_address
                    LEFT JOIN addresses AS addr_to
                        ON addr_to.address = transactions.to_address
                    
                    LEFT JOIN GetLatestUpdate AS latest_update_from
                        ON latest_update_from.address = transactions.from_address
                    LEFT JOIN GetLatestUpdate AS latest_update_to
                        ON latest_update_to.address = transactions.to_address
        
                    WHERE 
                        LOWER(network) = ? AND 
                        (LOWER(from_address) = ? OR LOWER(to_address) = ?) AND
                        transactions.timestamp >= ?
                    GROUP BY transactions.from_address, transactions.to_address
                )

                SELECT
                    json_group_array(
                        JSON(
                            JSON
                        )
                    )
                FROM
                    GetFlows
            ''', [network.lower(), address.lower(), address.lower(), threshold_time])

            result = sqlQueryResult.fetchone()
            transactions_json = result[0] if result else '[]'

            return {"transactions": json.loads(transactions_json)}, 200



    def set_address_name(self, address, name):
        if not address:
            return {"error": "Address is required"}, 400

        with get_db_connection() as conn:
            conn.execute(''' UPDATE addresses SET name = ? WHERE address = ? ''', [name, address])

        return {"status": "OK"}, 200