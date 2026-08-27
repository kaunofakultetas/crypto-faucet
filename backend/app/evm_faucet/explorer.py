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
#  has no graph: get_networks reports has_explorer=false and
#  the SPA hides it — but is_supported_network here still
#  accepts a direct request for it and the fetch fails with a
#  logged traceback (pinned in test_explorer_defects.py).
#
#  Refreshes are INCREMENTAL — each one resumes from the last
#  block already stored for that address instead of re-pulling
#  the whole history — and an Etherscan outage degrades to
#  serving the SQLite cache instead of blanking the graph.
#
#  CONTRACTS and PUBLIC HUBS are never scraped: the moment one
#  class wallet touches a token contract or a community faucet,
#  that address' GLOBAL history would otherwise flood the cache
#  with thousands of unrelated strangers. Contracts are spotted
#  by calldata, hubs by counterparty count — both are flagged
#  in the Graph_Addresses table and served from cache only.
#
#  Used by:
#    - evm_routes.py — the graph endpoints
#      (get-stored-transactions, transaction-days,
#      set-address-name)
############################################################


import os
import re
import time
import json
import logging

import requests

from ..database.db import get_db_connection
from ..env_secrets import remember_secret, install_log_redaction


# One outbound Etherscan call may not hang a worker: a hung
# explorer fails the refresh, and the cached graph is served
ETHERSCAN_TIMEOUT_S = 20

# A graph address is a 20-byte hex EVM address — anything else
# is refused before any network or database work
ADDRESS_PATTERN = re.compile(r'^0x[0-9a-fA-F]{40}$')

# The longest label a node can carry (the dialog caps at the
# same length) — a URL's worth of text is not a label
MAX_NAME_LENGTH = 64


# How many blocks an incremental refresh re-fetches BELOW the
# last stored block — a small overlap so a testnet reorg near
# the tip can't leave a stale row behind (the upsert makes
# re-fetching harmless).
REORG_OVERLAP_BLOCKS = 10


# An address whose history involves MORE distinct counterparties
# than this is a PUBLIC HUB (a community faucet, a donation
# collector, a token contract everyone on the testnet touches),
# not a class wallet — storing its history would flood the cache
# with thousands of strangers' transfers. Class wallets have a
# handful of counterparties; the real hubs found in the wild had
# 1900+.
HUB_COUNTERPARTY_THRESHOLD = 200








############################################################
# EtherscanExplorer
############################################################
#
# One instance serves every configured network. Methods in
# groups:
#
#   setup — __init__, is_supported_network
#   fetch — fetch_all_transactions_from_etherscan,
#           _refresh_address
#   store — store_transactions
#   serve — get_stored_transactions, get_transaction_days,
#           set_address_name
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
    # section. trusted_addresses (the faucet's own address) are
    # exempt from the public-hub detection: the faucet IS a
    # high-degree hub by design, yet it's the graph's root and
    # must always be scrapable.
    #
    # Used by:
    #   - evm_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, network_configs, trusted_addresses=None):
        self.NETWORK_CONFIGS = network_configs
        self.ETHERSCAN_API_KEY = os.getenv('ETHERSCAN_API_KEY', '')
        # The key rides in the query string, so a failed request's
        # exception text carries it — scrubbed from the log
        remember_secret(self.ETHERSCAN_API_KEY)
        install_log_redaction()
        self.TRUSTED_ADDRESSES = {a.lower() for a in (trusted_addresses or []) if a}

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
    # A network the GRAPH can serve: configured AND carrying an
    # explorer section with the API to scrape. A configured
    # network without one (arbitrumSepolia) is a faucet, not a
    # graph — the page hides the feature (has_explorer=false)
    # and a direct request is an honest 400 instead of a fetch
    # that fails deep inside and logs a traceback per sweep.
    #
    # Used by:
    #   - fetch_all_transactions_from_etherscan (below)
    #   - get_stored_transactions / get_transaction_days (below)
    ############################################################

    def is_supported_network(self, network):
        config = self.NETWORK_CONFIGS.get(network)
        return bool(config and config.get('explorer', {}).get('etherscan_api_url'))






    ############################################################
    # fetch_all_transactions_from_etherscan
    ############################################################
    #
    # Pulls an address' transactions from the Etherscan API
    # starting at start_block, 1000 records per page, until a
    # short page signals the end. An unknown API answer logs
    # the raw response (rate limits and bad API keys are the
    # usual suspects) and raises.
    #
    # Used by:
    #   - _refresh_address (below)
    ############################################################

    def fetch_all_transactions_from_etherscan(self, address, network, start_block=0):
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
                'startblock': start_block,
                'endblock': 99999999,
                'page': page,
                'offset': 1000,
                'sort': 'asc',
                'chainid': self.NETWORK_CONFIGS[network]['chain_id'],
                'apikey': self.ETHERSCAN_API_KEY
            }
            response = requests.get(url, params=params, timeout=ETHERSCAN_TIMEOUT_S)
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
                logging.error(f"Unexpected Etherscan answer for {address} on {network}: {json.dumps(result)[:500]}")
                raise Exception(f"Etherscan API error: {result.get('message', 'Unknown error')}")

        return all_transactions






    ############################################################
    # store_transactions
    ############################################################
    #
    # Caches Etherscan transactions in the local SQLite
    # database with ONE upsert per row (ON CONFLICT of the
    # (network, hash) unique key refreshes the row in place),
    # batched through executemany — idempotent, so re-fetching
    # overlapping history never duplicates or drifts. Both
    # endpoints of every transfer are also seeded into the
    # addresses table, where the user can name them later.
    #
    # Used by:
    #   - _refresh_address (above)
    ############################################################

    def store_transactions(self, transactions, network):
        if not transactions:
            return

        tx_rows = []
        address_rows = set()

        for tx in transactions:
            # Contract deployments have no 'to' — the recipient is
            # the freshly created contract address. A recipient that
            # receives CALLDATA is a contract too (token transfers,
            # approvals, …) — without this, a token contract like
            # LINK gets seeded as a "user", the graph sweeps it like
            # a wallet, and its GLOBAL history drags every stranger
            # on the testnet into our cache.
            recipient = tx.get('to', '')
            if recipient == '' or recipient == None:
                is_contract = 1
                recipient = tx.get('contractAddress', '')
            else:
                calldata = tx.get('input') or '0x'
                is_contract = 1 if calldata not in ('', '0x') else 0

            tx_rows.append((
                network.lower(), tx['from'].lower(), recipient.lower(),
                float(tx['value']) / 10**18, tx['hash'],
                int(tx['blockNumber']), int(tx['timeStamp']),
            ))
            address_rows.add((tx['from'].lower(), "", 0))
            address_rows.add((recipient.lower(), "", is_contract))

        with get_db_connection() as conn:
            conn.executemany('''
                INSERT INTO Graph_Transactions (network, from_address, to_address, value, hash, block_number, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(network, hash) DO UPDATE SET
                    from_address = excluded.from_address,
                    to_address = excluded.to_address,
                    value = excluded.value,
                    block_number = excluded.block_number,
                    timestamp = excluded.timestamp
            ''', tx_rows)

            # Escalation-only upsert: an address once recognized as a
            # contract STAYS a contract, even if it was first seen as
            # a plain recipient — never the other way around.
            conn.executemany('''
                INSERT INTO Graph_Addresses (address, name, is_contract)
                VALUES (?, ?, ?)
                ON CONFLICT(address) DO UPDATE SET
                    is_contract = MAX(COALESCE(Graph_Addresses.is_contract, 0), excluded.is_contract)
            ''', sorted(address_rows))






    ############################################################
    # _refresh_address
    ############################################################
    #
    # One INCREMENTAL Etherscan -> SQLite refresh: resume from
    # the last block already stored for this address (minus the
    # small reorg overlap) instead of re-pulling the entire
    # history — the common live refresh fetches zero or a
    # handful of rows instead of thousands. A never-seen
    # address naturally starts from block 0 and gets its full
    # past.
    #
    # A fetched history that turns out to belong to a PUBLIC
    # HUB (more distinct counterparties than
    # HUB_COUNTERPARTY_THRESHOLD) is thrown away instead of
    # stored, and the address is flagged is_hub so it is never
    # scraped again — one class wallet donating to a community
    # faucet must not drag 2000 strangers into the graph.
    #
    # Used by:
    #   - get_stored_transactions (below)
    ############################################################

    def _refresh_address(self, network, address):
        with get_db_connection() as conn:
            row = conn.execute('''
                SELECT MAX(block_number) FROM Graph_Transactions
                WHERE network = ?
                  AND (from_address = ? OR to_address = ?)
            ''', [network.lower(), address.lower(), address.lower()]).fetchone()

        last_block = row[0] if row and row[0] else 0
        start_block = max(0, last_block - REORG_OVERLAP_BLOCKS)

        transactions = self.fetch_all_transactions_from_etherscan(address, network, start_block)

        if address.lower() not in self.TRUSTED_ADDRESSES:
            counterparties = set()
            for tx in transactions:
                counterparties.add(tx['from'].lower())
                counterparties.add((tx.get('to') or '').lower())
            counterparties.discard(address.lower())
            counterparties.discard('')

            if len(counterparties) > HUB_COUNTERPARTY_THRESHOLD:
                logging.warning(
                    f"{address} on {network} looks like a public hub "
                    f"({len(counterparties)} counterparties) — flagged as is_hub, history not stored"
                )
                with get_db_connection() as conn:
                    conn.execute('''
                        INSERT INTO Graph_Addresses (address, name, is_contract, is_hub)
                        VALUES (?, '', 0, 1)
                        ON CONFLICT(address) DO UPDATE SET is_hub = 1
                    ''', [address.lower()])
                return

        self.store_transactions(transactions, network)






    ############################################################
    # get_stored_transactions
    ############################################################
    #
    # Data for the frontend's transaction graph: refresh the
    # cache from Etherscan (at most once a minute per address —
    # the graph sweeps aggressively), then aggregate the
    # transfers inside the [from_ts, to_ts) unix window into
    # "flows" — one row per (from, to) pair with the summed
    # value and count, plus the display names and last-seen
    # timestamps of both endpoints. The window comes from the
    # page's date slider; its boundaries are computed in the
    # student's BROWSER, so "today" means their local midnight,
    # not the server's.
    #
    # Used by:
    #   - evm_routes.py —
    #     GET /api/evm/<network>/get-stored-transactions
    ############################################################

    def get_stored_transactions(self, network, address, from_ts, to_ts):
        if not address:
            return {"error": "Trūksta adreso"}, 400
        if not ADDRESS_PATTERN.match(address):
            return {"error": "Neteisingas adresas"}, 400
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400
        if from_ts is None or to_ts is None or from_ts >= to_ts:
            return {"error": "Reikalingas teisingas laiko intervalas (from < to)"}, 400


        # STEP 1: refresh from Etherscan — but only when it can
        # matter. A LIVE window (touching the last hour) refreshes as
        # before, throttled to once per ETHERSCAN_REFRESH_INTERVAL
        # per address. A HISTORICAL window serves straight from
        # SQLite: the full-history scrape captured old days long ago
        # and they cannot change — unless this address was NEVER
        # scraped at all, in which case one fetch fills in its past.
        # A known CONTRACT or PUBLIC HUB is never scraped at
        # all: a global contract's history (a token like LINK)
        # or a community faucet's is the whole testnet's
        # traffic, not this graph's neighborhood — its cached
        # faucet-related rows are served, nothing more.
        # =============================================================
        fetch_key = (network, address.lower())
        is_live_window = to_ts > int(time.time()) - 3600

        with get_db_connection() as conn:
            row = conn.execute(
                'SELECT is_contract, is_hub FROM Graph_Addresses WHERE address = ?', [address.lower()]
            ).fetchone()
            never_scrape = bool(row and (row[0] or row[1]))

            needs_first_fetch = False
            if not is_live_window:
                seen = conn.execute('''
                    SELECT 1 FROM Graph_Transactions
                    WHERE network = ?
                      AND (from_address = ? OR to_address = ?)
                    LIMIT 1
                ''', [network.lower(), address.lower(), address.lower()]).fetchone()
                needs_first_fetch = seen is None

        should_refresh = (is_live_window or needs_first_fetch) and not never_scrape
        if should_refresh and int(time.time()) - self.last_etherscan_fetch.get(fetch_key, 0) >= self.ETHERSCAN_REFRESH_INTERVAL:
            try:
                self._refresh_address(network, address)
                self.last_etherscan_fetch[fetch_key] = int(time.time())
            except Exception:
                # Etherscan being down must not blank the graph — log
                # it and serve whatever SQLite already has; the next
                # sweep retries anyway.
                logging.exception(f"Etherscan refresh failed for {address} on {network}; serving cached data")


        # STEP 2: aggregate the window. GetLatestUpdate: when each
        # address was last seen on either side of a transaction —
        # scoped to THIS network, so the cost never grows with the
        # other networks' history. GetFlows: the aggregated
        # transfers, already packed as JSON objects so the final
        # SELECT can return the whole result as a single JSON array.
        # The range predicate rides on the (network, timestamp)
        # index — no date column needed, the timestamp already IS
        # the date.
        # ============================================================
        with get_db_connection() as conn:
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
                            Graph_Transactions
                        WHERE network = ?
                        GROUP BY from_address

                        UNION ALL
                        SELECT
                            to_address AS address,
                            MAX(timestamp)
                        FROM
                            Graph_Transactions
                        WHERE network = ?
                        GROUP BY to_address
                    )
                    GROUP BY address
                ),

                GetFlows AS (
                    SELECT
                        json_object(
                            'from_address',         Graph_Transactions.from_address,
                            'from_name',            addr_from.name,
                            'from_timestamp',       latest_update_from.timestamp,

                            'to_address',           Graph_Transactions.to_address,
                            'to_name',              addr_to.name,
                            'to_timestamp',         latest_update_to.timestamp,
                            'from_addr_contract',   addr_from.is_contract,
                            'to_addr_contract',     addr_to.is_contract,
                            'from_addr_hub',        addr_from.is_hub,
                            'to_addr_hub',          addr_to.is_hub,

                            'value',                SUM(Graph_Transactions.value),
                            'count',                COUNT(*)
                        ) as JSON
                    FROM
                        Graph_Transactions

                    LEFT JOIN Graph_Addresses AS addr_from
                        ON addr_from.address = Graph_Transactions.from_address
                    LEFT JOIN Graph_Addresses AS addr_to
                        ON addr_to.address = Graph_Transactions.to_address

                    LEFT JOIN GetLatestUpdate AS latest_update_from
                        ON latest_update_from.address = Graph_Transactions.from_address
                    LEFT JOIN GetLatestUpdate AS latest_update_to
                        ON latest_update_to.address = Graph_Transactions.to_address

                    WHERE
                        network = ? AND
                        (from_address = ? OR to_address = ?) AND
                        Graph_Transactions.timestamp >= ? AND
                        Graph_Transactions.timestamp < ?
                    GROUP BY Graph_Transactions.from_address, Graph_Transactions.to_address
                )

                SELECT
                    json_group_array(
                        JSON(
                            JSON
                        )
                    )
                FROM
                    GetFlows
            ''', [network.lower(), network.lower(), network.lower(), address.lower(), address.lower(), from_ts, to_ts])

            result = sqlQueryResult.fetchone()
            transactions_json = result[0] if result else '[]'

            return {"transactions": json.loads(transactions_json)}, 200






    ############################################################
    # get_transaction_days
    ############################################################
    #
    # Every day (as 'YYYY-MM-DD') on which the given ROOT
    # address itself transacted, with that day's transaction
    # count — the page's date slider lists exactly these. Days
    # where only unrelated addresses moved are deliberately
    # absent: the graph grows breadth-first from the root, so
    # such a day would render one lonely faucet node. tz_offset
    # is the BROWSER'S offset from UTC in seconds AT THE MOMENT
    # OF THE REQUEST, clamped to the real-world ±14 h range, and
    # applied to EVERY row regardless of that row's own date.
    #
    # KNOWN GAP (pinned in test_explorer_defects.py): the page's
    # rangeOfDay() turns a picked day back into a window using
    # that date's TRUE offset, so for every day in the other
    # DST regime (all of winter, viewed in summer, and vice
    # versa) the bucket here sits an hour off the window the
    # page will ask for — one hour of transactions is filed
    # under the neighbouring day, and a day offered here can
    # come back as an empty graph. The fix is bucketing each
    # row in its own zone (a zone NAME from the browser +
    # zoneinfo in Python); rangeOfDay is the correct half and
    # must not change. Do not touch one side without the other.
    #
    # Used by:
    #   - evm_routes.py —
    #     GET /api/evm/<network>/transaction-days
    ############################################################

    def get_transaction_days(self, network, tz_offset, address):
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400
        if not address:
            return {"error": "Trūksta adreso"}, 400
        if not ADDRESS_PATTERN.match(address):
            return {"error": "Neteisingas adresas"}, 400

        offset = int(tz_offset or 0)
        if abs(offset) > 14 * 3600:
            offset = 0

        with get_db_connection() as conn:
            rows = conn.execute('''
                SELECT date(timestamp + ?, 'unixepoch') AS day, COUNT(*) AS tx_count
                FROM Graph_Transactions
                WHERE network = ?
                  AND (from_address = ? OR to_address = ?)
                GROUP BY day
                ORDER BY day
            ''', [offset, network.lower(), address.lower(), address.lower()]).fetchall()

        return {"days": [{"day": row[0], "count": row[1]} for row in rows]}, 200







    ############################################################
    # set_address_name
    ############################################################
    #
    # Lets the user label an address shown in the transaction
    # graph. An upsert, not an UPDATE: naming an address the
    # cache hasn't seen yet must create the row, not silently
    # do nothing — the label then survives until the address
    # shows up in a transaction. The one user-written INSERT in
    # the app: the address must be a real one, and the label is
    # cut to MAX_NAME_LENGTH (the dialog already stops there).
    #
    # Used by:
    #   - evm_routes.py — GET /api/evm/set-address-name
    ############################################################

    def set_address_name(self, address, name):
        if not address:
            return {"error": "Trūksta adreso"}, 400
        if not ADDRESS_PATTERN.match(address):
            return {"error": "Neteisingas adresas"}, 400

        label = (name or '').strip()[:MAX_NAME_LENGTH]
        with get_db_connection() as conn:
            conn.execute('''
                INSERT INTO Graph_Addresses (address, name, is_contract)
                VALUES (?, ?, 0)
                ON CONFLICT(address) DO UPDATE SET name = excluded.name
            ''', [address.lower(), label])

        return {"status": "OK"}, 200





