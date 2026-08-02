############################################################
#  [*] Etherscan Explorer
#
#  The data source behind the transaction-flow graph
#  (/graph/<network>): pulls an address' full history from
#  each network's Etherscan-style API, caches it in the local
#  SQLite database and serves aggregated "flows" (grouped
#  from->to transfers with sums and counts).
#
#  Deliberately independent of the faucet and of web3: it
#  talks plain HTTPS to the explorer APIs (the config's
#  'explorer' section names the endpoint, chain_id rides
#  along as the API's chainid parameter) and never touches
#  the chain itself. A network without an 'explorer' section
#  simply has no graph.
#
#  Used by:
#    - evm_routes.py — the graph endpoints
#      (get-stored-transactions, set-address-name)
############################################################


import os
import time
import json
import logging
from datetime import datetime, timedelta, timezone

import requests

from ..database.db import get_db_connection








############################################################
# EtherscanExplorer
############################################################
#
# One instance serves every configured network. Methods in
# groups:
#
#   setup — __init__, is_supported_network
#   fetch — fetch_all_transactions_from_etherscan,
#           fetch_and_store_transactions
#   store — store_transactions
#   serve — get_stored_transactions, set_address_name
#
# Used by:
#   - evm_routes.py — one shared instance for the graph
#     handlers
############################################################

class EtherscanExplorer:






    ############################################################
    # __init__
    ############################################################
    #
    # network_configs is main.py's EVM_NETWORK_CONFIGS — this
    # class only reads each entry's chain_id and 'explorer'
    # section.
    #
    # Used by:
    #   - evm_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, network_configs):
        self.NETWORK_CONFIGS = network_configs
        self.ETHERSCAN_API_KEY = os.getenv('ETHERSCAN_API_KEY', '')

        # (network, address) -> unix time of the last Etherscan
        # refresh. get_stored_transactions serves straight from SQLite
        # while the cache is younger than this window — the graph
        # frontend sweeps every address every few seconds, which would
        # otherwise hammer Etherscan into its rate limit.
        self.ETHERSCAN_REFRESH_INTERVAL = 60
        self.last_etherscan_fetch = {}






    ############################################################
    # is_supported_network
    ############################################################
    #
    # Used by:
    #   - fetch_all_transactions_from_etherscan (below)
    #   - get_stored_transactions (below)
    ############################################################

    def is_supported_network(self, network):
        return network in self.NETWORK_CONFIGS






    ############################################################
    # fetch_all_transactions_from_etherscan
    ############################################################
    #
    # Pulls the full transaction history of an address from
    # the Etherscan API, 1000 records per page, until a short
    # page signals the end. An unknown API answer dumps the
    # raw response into the container log (rate limits and bad
    # API keys are the usual suspects) and raises.
    #
    # Used by:
    #   - fetch_and_store_transactions (below)
    ############################################################

    def fetch_all_transactions_from_etherscan(self, address, network):
        if not self.is_supported_network(network):
            raise ValueError(f"Unsupported network: {network}")

        url = self.NETWORK_CONFIGS[network].get('explorer', {}).get('etherscan_api_url')
        if not url:
            raise ValueError(f"No explorer API configured for network: {network}")
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
                print("+----------------------------------------+")
                print(json.dumps(result, indent=4))
                print("+----------------------------------------+")
                raise Exception(f"Etherscan API error: {result.get('message', 'Unknown error')}")

        return all_transactions






    ############################################################
    # store_transactions
    ############################################################
    #
    # Caches Etherscan transactions in the local SQLite
    # database. INSERT OR IGNORE + UPDATE keeps the whole
    # thing idempotent: re-fetching the same history never
    # duplicates rows and refreshes what's already there.
    # Both endpoints of every transfer are also seeded into
    # the addresses table, where the user can name them later.
    #
    # Used by:
    #   - fetch_and_store_transactions (below)
    ############################################################

    def store_transactions(self, transactions, network):
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

                conn.execute('''
                    INSERT OR IGNORE INTO addresses (address, name, is_contract)
                    VALUES (?, ?, ?) ''',
                    (tx['from'].lower(), "", 0))

                conn.execute('''
                    INSERT OR IGNORE INTO addresses (address, name, is_contract)
                    VALUES (?, ?, ?) ''',
                    (recipient.lower(), "", is_contract))






    ############################################################
    # fetch_and_store_transactions
    ############################################################
    #
    # Etherscan -> SQLite in one call. The summary payload it
    # returns is ignored by its only caller today.
    #
    # Used by:
    #   - get_stored_transactions (below)
    ############################################################

    def fetch_and_store_transactions(self, network, address):
        transactions = self.fetch_all_transactions_from_etherscan(address, network)
        self.store_transactions(transactions, network)
        return {
            "address": address,
            "network": network,
            "total_transactions": len(transactions),
            "message": "Transactions fetched and stored successfully"
        }






    ############################################################
    # get_stored_transactions
    ############################################################
    #
    # Data for the frontend's transaction graph: refresh the
    # cache from Etherscan (at most once a minute per address —
    # the graph sweeps aggressively), then aggregate transfers
    # into "flows" — one row per (from, to) pair with the
    # summed value and count, plus the display names and
    # last-seen timestamps of both endpoints.
    #
    # Used by:
    #   - evm_routes.py —
    #     GET /api/evm/<network>/get-stored-transactions
    ############################################################

    def get_stored_transactions(self, network, address, hours=24):
        if not address:
            return {"error": "Address is required"}, 400
        if not self.is_supported_network(network):
            return {"error": f"Unsupported network: {network}"}, 400

        # STEP 1: refresh the local cache from Etherscan, but at most
        # once per ETHERSCAN_REFRESH_INTERVAL per address — inside the
        # window the data comes straight from SQLite, which keeps the
        # graph's sweeps well under Etherscan's rate limit.
        fetch_key = (network, address.lower())
        if int(time.time()) - self.last_etherscan_fetch.get(fetch_key, 0) >= self.ETHERSCAN_REFRESH_INTERVAL:
            try:
                self.fetch_and_store_transactions(network, address)
                self.last_etherscan_fetch[fetch_key] = int(time.time())
            except Exception:
                logging.exception("Error fetching/storing transactions")
                return {"error": "Failed to refresh transactions"}, 500

        # STEP 2: aggregate. GetLatestUpdate: when each address was
        # last seen on either side of a transaction. GetFlows: the
        # aggregated transfers, already packed as JSON objects so the
        # final SELECT can return the whole result as a single JSON
        # array.
        with get_db_connection() as conn:
            # Timezone-aware on purpose: naive utcnow().timestamp()
            # would shift by the container's TZ offset if it ever ran
            # outside UTC.
            threshold_time = int((datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp())

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






    ############################################################
    # set_address_name
    ############################################################
    #
    # Lets the user label an address shown in the transaction
    # graph. Matches the address exactly as sent — the graph
    # always sends lowercase, which is how store_transactions
    # writes the rows.
    #
    # Used by:
    #   - evm_routes.py — GET /api/evm/set-address-name
    ############################################################

    def set_address_name(self, address, name):
        if not address:
            return {"error": "Address is required"}, 400

        with get_db_connection() as conn:
            conn.execute(''' UPDATE addresses SET name = ? WHERE address = ? ''', [name, address])

        return {"status": "OK"}, 200
