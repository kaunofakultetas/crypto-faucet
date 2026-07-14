# -----------------------------------------------------------
#  [*] EVM Faucet
#
#  A faucet for EVM chains (Sepolia and friends), talking to
#  each network through a Web3 HTTP provider (Infura or any
#  custom RPC URL from the network config).
#
#  How a payout works, end to end:
#
#    1. The student signs a fixed Lithuanian message (with a
#       nonce) in MetaMask; the signature proves they control
#       the address they're asking to fund.
#    2. The faucet checks the address doesn't already hold a
#       full chunk, that the cooldown has passed, and that the
#       faucet wallet itself still has coins.
#    3. A plain value transfer is signed with the faucet key
#       (shared with the UTXO faucet) and broadcast.
#
#  On top of the faucet itself, this class also feeds the
#  transaction explorer: it pulls an address' history from
#  Etherscan, caches it in the local SQLite database and
#  serves aggregated "flows" (grouped from->to transfers)
#  for the graph view on the frontend.
#
#  Used by:
#    - evm_routes.py — the Flask endpoints under /api/evm/*
# -----------------------------------------------------------

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




# -----------------------------------------------------------
# EVMFaucet
# -----------------------------------------------------------

class EVMFaucet:

    def __init__(self, network_configs, default_network=None):
        self.APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == "true"
        self.FAUCET_DEFAULT_NETWORK = default_network or os.getenv('FAUCET_DEFAULT_NETWORK', 'sepolia')
        self.ETHERSCAN_API_KEY = os.getenv('ETHERSCAN_API_KEY', '')

        # Per-network settings (infura_network, chain_id, chunk_size,
        # etherscan_api_url, ...) coming from main.py.
        self.NETWORK_CONFIGS = network_configs

        # One Web3 instance per network, created up front. The config
        # value is either an Infura network name ('sepolia') or a full
        # RPC URL — anything containing 'http' is used as-is.
        self.w3_instances = {}
        for network in self.NETWORK_CONFIGS:
            if 'http' not in self.NETWORK_CONFIGS[network]['infura_network']:
                infura_url = f"https://{self.NETWORK_CONFIGS[network]['infura_network']}.infura.io/v3/{os.getenv('INFURA_PROJECT_ID')}"
            else:
                infura_url = self.NETWORK_CONFIGS[network]['infura_network']

            # 10s timeout so a dead RPC endpoint fails the request
            # instead of hanging the Flask worker.
            request_kwargs = {
                'timeout': 10
            }
            self.w3_instances[network] = Web3(Web3.HTTPProvider(infura_url, request_kwargs=request_kwargs))

        # Same private key as the UTXO faucet, so one funded identity
        # covers every chain the site offers. Normalize to a 0x-prefixed,
        # 66-character hex string (pad with zeros if it came in short).
        self.FAUCET_PRIVATE_KEY = os.getenv('FAUCET_PRIVATE_KEY')
        self.FAUCET_PRIVATE_KEY = "0x" + self.FAUCET_PRIVATE_KEY.replace("0x", "")
        self.FAUCET_PRIVATE_KEY = self.FAUCET_PRIVATE_KEY.ljust(66, '0')

        try:
            self.FAUCET_ADDRESS = Account.from_key(self.FAUCET_PRIVATE_KEY).address if self.FAUCET_PRIVATE_KEY else None
        except Exception:
            self.FAUCET_ADDRESS = None

        # address (lowercased) -> unix time of its last payout,
        # used to enforce the cooldown between requests.
        self.COOLDOWN_PERIOD = 60
        self.last_request = {}




    # -----------------------------------------------------------
    # Network & signature helpers
    # -----------------------------------------------------------

    def is_supported_network(self, network):
        return network in self.NETWORK_CONFIGS


    def verify_signature(self, network, address, message, signature):
        # Recover the signer from an EIP-191 personal_sign signature and
        # check it matches the address asking for coins — proves the
        # requester actually controls that wallet.
        w3 = self.w3_instances[network]
        try:
            message_hash = encode_defunct(text=message)
            signer = w3.eth.account.recover_message(message_hash, signature=signature)
            return signer.lower() == (address or '').lower()
        except Exception:
            return False




    # -----------------------------------------------------------
    # Faucet operations
    # -----------------------------------------------------------

    def request_eth(self, network, to_address, signature, nonce):
        # The actual payout: validate everything, then broadcast one chunk.
        # Returns (payload, http_status); user-facing errors in Lithuanian.
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400

        w3 = self.w3_instances[network]

        amount_to_send = self.NETWORK_CONFIGS[network]['chunk_size']
        amount_to_send_wei = Web3.to_wei(float(amount_to_send), 'ether')

        # --- Input validation ---------------------------------
        if not all([to_address, signature, nonce]):
            return {"error": "Trūksta reikalingų parametrų"}, 400

        try:
            to_address = w3.to_checksum_address(to_address)
        except Exception:
            return {"error": "Neteisingas adresas"}, 400

        if not w3.is_address(to_address):
            return {"error": "Neteisingas adresas"}, 400

        # The exact message the frontend asks MetaMask to sign — any
        # mismatch (different nonce, different wording) fails recovery.
        message = f"Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}"
        if not self.verify_signature(network, to_address, message, signature):
            return {"error": "Kriptografinis parašas kažkodėl neatitinka"}, 403

        # --- Eligibility checks -------------------------------
        # No top-up if the wallet already holds a full chunk.
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

        # --- Send ----------------------------------------------
        # Plain legacy value transfer; the generous gas limit doesn't
        # cost anything extra, unused gas is refunded.
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

        # Start the cooldown only after a successful broadcast.
        self.last_request[addr_key] = int(time.time())

        return {
            "message": "ETH sent successfully",
            "transaction_hash": tx_hash.hex(),
            "amount": float(w3.from_wei(amount_to_send_wei, 'ether'))
        }, 200


    def get_faucet_balance(self, network):
        # Faucet wallet balance, so the UI (and the operator) can see
        # whether the faucet needs a top-up.
        if not self.is_supported_network(network):
            return {"error": f"Unsupported network: {network}"}, 400

        if not self.FAUCET_ADDRESS:
            logging.error("FAUCET_ADDRESS is None or empty")
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        w3 = self.w3_instances[network]

        logging.info(f"Getting balance for network={network}, address={self.FAUCET_ADDRESS}")

        try:
            if not w3.is_connected():
                logging.error(f"Web3 is not connected for network {network}")
                return {"error": "Nepavyko prisijungti prie tinklo"}, 500

            balance = w3.eth.get_balance(self.FAUCET_ADDRESS)
            balance_eth = float(w3.from_wei(balance, 'ether'))

            logging.info(f"Balance retrieved successfully: {balance_eth} ETH (raw: {balance} wei)")

        except Exception as e:
            # Log the real error for debugging; the user gets a generic one.
            logging.error(f"Failed to get faucet balance for network {network}: {type(e).__name__}: {e}")
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500

        return {
            "balance": balance_eth,
            "address": self.FAUCET_ADDRESS.lower(),
            "chunk_size": float(self.NETWORK_CONFIGS[network]['chunk_size'])
        }, 200


    def get_networks(self):
        # Everything the frontend needs to render the network picker.
        return {
            "networks": self.NETWORK_CONFIGS,
            "default_network": self.FAUCET_DEFAULT_NETWORK
        }




    # -----------------------------------------------------------
    # Transaction explorer (Etherscan -> SQLite -> frontend)
    # -----------------------------------------------------------

    def fetch_all_transactions_from_etherscan(self, address, network):
        # Pull the full transaction history of an address from the
        # Etherscan API, 1000 records per page, until a short page
        # signals the end.
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

                # A page shorter than the limit means we've seen everything.
                if len(transactions) < 1000:
                    break

                page += 1

            elif result.get('message') == 'No transactions found':
                break

            else:
                # Dump the raw response so rate limits / bad API keys
                # are easy to spot in the container logs.
                print("+----------------------------------------+")
                print(json.dumps(result, indent=4))
                print("+----------------------------------------+")
                raise Exception(f"Etherscan API error: {result.get('message', 'Unknown error')}")

        return all_transactions


    def store_transactions(self, transactions, network):
        # Cache Etherscan transactions in the local SQLite database.
        # INSERT OR IGNORE + UPDATE makes the whole thing idempotent:
        # re-fetching the same history never duplicates rows.
        with get_db_connection() as conn:

            for tx in transactions:
                # Contract deployments have no 'to' — the recipient is
                # the freshly created contract address.
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

                # Make sure both endpoints of the transfer exist in the
                # addresses table (names are filled in later by the user).
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
        # Data for the frontend's transaction graph: refresh the cache
        # from Etherscan, then aggregate transfers into "flows" — one row
        # per (from, to) pair with the summed value and count, plus the
        # display names and last-seen timestamps of both endpoints.
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

            # GetLatestUpdate: when each address was last seen on either
            # side of a transaction. GetFlows: the aggregated transfers,
            # already packed as JSON objects so the final SELECT can
            # return the whole result as a single JSON array.
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
        # Lets the user label an address in the transaction graph.
        if not address:
            return {"error": "Address is required"}, 400

        with get_db_connection() as conn:
            conn.execute(''' UPDATE addresses SET name = ? WHERE address = ? ''', [name, address])

        return {"status": "OK"}, 200
