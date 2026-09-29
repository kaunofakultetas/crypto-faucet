############################################################
#  [*] UTXO Explorer — the UTXO transaction graph's data
#
#  The data source behind the SPA's /graph/utxo/<network>: a
#  cache of the transactions around the faucet on one UTXO
#  chain, read from that network's ElectrumX server and kept in
#  SQLite (the GraphUtxo_* tables), served one window (a day)
#  at a time — the window's blocks, every transaction with its
#  inputs (the address and amount each one spends) and outputs
#  (and which later transaction spent each one), and the names
#  the class gave the addresses (Graph_Addresses, shared with
#  the EVM graph).
#
#  The CRAWL goes breadth-first over addresses, starting at the
#  faucet: read the address' history (every transaction
#  touching it, with heights), fetch and decode the ones inside
#  the window — plus the parents their inputs spend, which is
#  where an input's address and amount live — then follow every
#  other address in them. At most MAX_DEPTH hops and
#  MAX_ADDRESSES_PER_CRAWL addresses; an address with a history
#  longer than HUB_HISTORY_THRESHOLD is a PUBLIC HUB (another
#  faucet, an exchange) — flagged, never stored, never
#  followed. The faucet is exempt: it is the root.
#
#  Crawls run in the BACKGROUND, one per network at a time,
#  started by the graph requests themselves: a live window
#  (touching the last hour — it has a mempool and still grows)
#  is re-crawled at most every CRAWL_INTERVAL_S, a past one at
#  most every HISTORICAL_RECRAWL_S. An address' history is
#  re-read at most every ADDRESS_REFRESH_INTERVAL_S, and a past
#  window reads only addresses never read before. A request
#  never waits on ElectrumX: it answers from SQLite, with
#  `updating` telling the page a crawl is under way. The
#  explorer keeps its OWN Electrum connection per network, so a
#  crawl never holds up a payout on the faucet's.
#
#  What never changes is fetched once — decoded transactions,
#  block times. What moves is re-read: histories. A new block
#  takes a transaction out of the mempool, a reorg moves it to
#  another height, and one replaced or evicted drops out of
#  every history — its rows are gone, and it is no longer shown.
#  Only read-only calls of Electrum protocol 1.4, and no
#  subscriptions: ElectrumClient is strictly request/response
#  and treats an unsolicited notification as a broken session.
#
#  Used by:
#    - utxo_routes.py — the graph endpoints
############################################################


import re
import time
import logging
import threading
from collections import Counter, deque
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from embit.transaction import Transaction

from .electrum_client import ElectrumClient
from .utxo_faucet import _electrum_scripthash
from ..database.db import get_db_connection


# Hops a crawl follows from the faucet — the EVM graph's reach
MAX_DEPTH = 5

# Addresses one crawl (and one served window) takes in at most
MAX_ADDRESSES_PER_CRAWL = 300

# Transactions — new ones and the parents their inputs spend —
# one crawl fetches at most. The first crawl of a busy network is
# the expensive one; the next picks up where it stopped
MAX_TX_FETCHES_PER_CRAWL = 2000

# Fetches one single-transaction request may make (the
# transaction and the parents its inputs spend)
MAX_TX_FETCHES_PER_REQUEST = 50

# A history longer than this is a public hub, not a class wallet
HUB_HISTORY_THRESHOLD = 500

# Seconds between two readings of one address' history
ADDRESS_REFRESH_INTERVAL_S = 60

# Seconds between two crawls of one live window, of a past one
CRAWL_INTERVAL_S = 30
HISTORICAL_RECRAWL_S = 600

# A window reaching into the last hour is live (the EVM rule)
LIVE_WINDOW_S = 3600

# The protocol's cap on one blockchain.block.headers call, and
# the gap between needed heights still worth bridging with one
# ranged call instead of separate ones
MAX_HEADERS_PER_CALL = 2016
HEADER_RANGE_GAP = 50

# The longest name an address can carry (the EVM graph's limit)
MAX_NAME_LENGTH = 64

# A txid: 64 hex characters, compared lowercase
TXID_PATTERN = re.compile(r'^[0-9a-f]{64}$')

# SQLite's bound on host parameters, with room to spare — IN
# lists are sent in chunks of this size
SQL_CHUNK = 500

# The names of UTC itself — answered with Python's own UTC,
# never through the tz database: the compose file mounts the
# host's /etc/localtime, which in the image links to Etc/UTC, so
# the mount lands ON that file and ZoneInfo('UTC') (and every
# alias linked to it) reads the host's zone
UTC_NAMES = frozenset({'UTC', 'Etc/UTC', 'Etc/UCT', 'Etc/Universal', 'Etc/Zulu', 'UCT', 'Universal', 'Zulu'})








############################################################
# _zone_of
############################################################
#
# The tzinfo a day list is bucketed in: the browser's IANA zone
# name ("Europe/Vilnius") through zoneinfo; Python's own UTC for
# UTC itself (UTC_NAMES) and for anything missing or unknown.
#
# Used by:
#   - UtxoGraphExplorer.get_transaction_days
############################################################

def _zone_of(tz):
    name = (tz or '').strip()
    if not name or name in UTC_NAMES:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except Exception:
        return timezone.utc








############################################################
# _iso
############################################################
#
# A unix time as the ISO 8601 UTC string the page parses; None
# stays None (a block time not known yet).
#
# Used by:
#   - UtxoGraphExplorer._transaction_payloads
############################################################

def _iso(ts):
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')








############################################################
# _chunks
############################################################
#
# A list in pieces of SQL_CHUNK — each piece one IN (...) list.
#
# Used by:
#   - UtxoGraphExplorer — every query over a set of txids,
#     heights or addresses
############################################################

def _chunks(items):
    items = list(items)
    return [items[i:i + SQL_CHUNK] for i in range(0, len(items), SQL_CHUNK)]








############################################################
# _script_type
############################################################
#
# What kind of script an output locks its coins with — the
# standard forms by their exact byte patterns, 'op_return' for
# data (the coins are burnt), 'nonstandard' for anything else.
# The page labels outputs that have no address by it.
#
# Used by:
#   - UtxoGraphExplorer._store_transaction
############################################################

def _script_type(script: bytes) -> str:
    if script[:1] == b'\x6a':
        return 'op_return'
    if len(script) == 22 and script[:2] == b'\x00\x14':
        return 'p2wpkh'
    if len(script) == 34 and script[:2] == b'\x00\x20':
        return 'p2wsh'
    if len(script) == 34 and script[:2] == b'\x51\x20':
        return 'p2tr'
    if len(script) == 25 and script[:3] == b'\x76\xa9\x14' and script[23:] == b'\x88\xac':
        return 'p2pkh'
    if len(script) == 23 and script[:2] == b'\xa9\x14' and script[22:] == b'\x87':
        return 'p2sh'
    if len(script) in (35, 67) and script[-1:] == b'\xac':
        return 'p2pk'
    return 'nonstandard'








############################################################
# _vsize
############################################################
#
# A transaction's size in virtual bytes — weight / 4, rounded
# up, where weight counts the witness once and everything else
# four times. The fee rate the page shows divides by this.
#
# Used by:
#   - UtxoGraphExplorer._store_transaction
############################################################

def _vsize(raw: bytes, tx) -> int:
    total = len(raw)
    if not tx.is_segwit:
        return total

    witness = 2 + sum(len(inp.witness.serialize()) for inp in tx.vin)   # + marker and flag
    base = total - witness
    return (base * 3 + total + 3) // 4








############################################################
# _is_coinbase
############################################################
#
# A block's reward transaction: one input pointing at no real
# output (a zero txid and index 0xFFFFFFFF) — it mints the
# coins, so it has no sender and no fee.
#
# Used by:
#   - UtxoGraphExplorer._store_transaction
############################################################

def _is_coinbase(tx) -> bool:
    return len(tx.vin) == 1 and tx.vin[0].txid == bytes(32) and tx.vin[0].vout == 0xFFFFFFFF








############################################################
# _ordered
############################################################
#
# The order the page stacks transactions in: by block, the
# mempool last; inside one block, parents before the children
# spending them (the page steps a child right of its parent) and
# the faucet's own transactions first.
#
# Used by:
#   - UtxoGraphExplorer._window_payload
############################################################

def _ordered(transactions, root):

    def group(tx):
        if tx['block'] is not None:
            return (0, tx['block'])
        return (1, 0) if tx['status'] == 'mempool' else (2, 0)

    def faucet_first(tx):
        sent_by_faucet = any(inp['address'] == root for inp in tx['inputs'])
        return (not sent_by_faucet, tx['txid'])


    groups = {}
    for tx in transactions:
        groups.setdefault(group(tx), []).append(tx)


    ordered = []
    for key in sorted(groups):
        pending = sorted(groups[key], key=faucet_first)
        members = {tx['txid'] for tx in pending}
        placed = set()
        while pending:
            ready = next((tx for tx in pending
                          if all(inp['txid'] not in members or inp['txid'] in placed for inp in tx['inputs'])), None)
            if ready is None:
                # A chain never loops — but never spin on bad data
                ordered.extend(pending)
                break
            ordered.append(ready)
            placed.add(ready['txid'])
            pending.remove(ready)

    return ordered








############################################################
# UtxoGraphExplorer
############################################################
#
# One instance serves every configured UTXO network. Methods in
# groups:
#
#   setup  — __init__, is_supported_network
#   serve  — get_graph, get_transaction_days, get_transaction,
#            set_address_name
#   crawl  — _maybe_start_crawl, _crawl, _crawl_window,
#            _refresh_address, _ensure_block_times
#   fetch  — _ensure_decoded, _ensure_parents,
#            _store_transaction, _locate
#   read   — _window_txids, _addresses_in, _window_payload,
#            _transaction_payloads, _names
#
# Used by:
#   - utxo_routes.py — one shared instance for the graph
#     handlers
############################################################

class UtxoGraphExplorer:






    ############################################################
    # __init__
    ############################################################
    #
    # `faucet` is the UTXOFaucet: the explorer takes the network
    # configs, each network's address dialect and the faucet's
    # address from it, and opens its own Electrum connections
    # (lazily — the first crawl connects).
    #
    # Used by:
    #   - utxo_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, faucet):
        self.faucet = faucet
        self.network_configs = faucet.network_configs
        self._clients = {
            key: ElectrumClient(config.get('faucet', {}).get('electrum_server', ''), label=f'{key}-graph')
            for key, config in self.network_configs.items()
        }

        # Guards the two crawl records below: which networks are
        # crawling right now, and when each (network, window) was
        # last crawled
        self._lock = threading.Lock()
        self._crawling = set()
        self._last_crawl = {}

        # txids the server answered with something embit cannot
        # decode (a Litecoin MWEB transaction, say) — not asked
        # for again by this process
        self._undecodable = set()






    ############################################################
    # is_supported_network
    ############################################################
    #
    # A network the graph can serve: configured, with a faucet
    # address (the faucet key is set) to grow the graph from.
    #
    # Used by:
    #   - the four serve methods (below)
    ############################################################

    def is_supported_network(self, network):
        return network in self.network_configs and self.faucet.faucet_address_for(network) is not None






    ############################################################
    # get_graph
    ############################################################
    #
    # One window of the graph — [from_ts, to_ts), unix seconds,
    # computed by the page from the student's local day. Starts
    # a background crawl when one is due, then answers from
    # SQLite right away: the faucet's address, whether the window
    # is live, whether a crawl is running (`updating`), the
    # window's blocks and transactions, how many of them cannot
    # be shown yet (`missing`), and the names.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/<network>/graph
    ############################################################

    def get_graph(self, network, from_ts, to_ts):
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400
        if from_ts is None or to_ts is None or from_ts >= to_ts:
            return {"error": "Reikalingas teisingas laiko intervalas (from < to)"}, 400

        live = to_ts > int(time.time()) - LIVE_WINDOW_S
        self._maybe_start_crawl(network, from_ts, to_ts, live)

        with get_db_connection() as conn:
            payload = self._window_payload(conn, network, from_ts, to_ts, live)

        with self._lock:
            payload['updating'] = network in self._crawling
        return payload, 200






    ############################################################
    # get_transaction_days
    ############################################################
    #
    # Every day (as 'YYYY-MM-DD') the faucet's address has a
    # mined transaction on, with that day's count — the page's
    # day slider lists exactly these, plus today. `tz` is the
    # browser's IANA zone: each block time is bucketed in it,
    # daylight saving included, so the list matches the windows
    # the page computes. Read from the cache only — the days
    # appear once a crawl has read the faucet's history.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/<network>/transaction-days
    ############################################################

    def get_transaction_days(self, network, tz):
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400

        root = self.faucet.faucet_address_for(network)
        zone = _zone_of(tz)
        with get_db_connection() as conn:
            rows = conn.execute('''
                SELECT DISTINCT h.txid, b.time
                FROM GraphUtxo_History h
                JOIN GraphUtxo_Blocks b ON b.network = h.network AND b.height = h.height
                WHERE h.network = ? AND h.address = ? AND h.height > 0
            ''', [network, root]).fetchall()

        counts = Counter(
            datetime.fromtimestamp(row['time'], timezone.utc).astimezone(zone).strftime('%Y-%m-%d')
            for row in rows
        )
        return {"days": [{"day": day, "count": counts[day]} for day in sorted(counts)]}, 200






    ############################################################
    # get_transaction
    ############################################################
    #
    # One transaction by txid, in the same shape as the graph's —
    # for the page's dialog, whose links walk the chain past the
    # day on screen. A transaction the cache lacks is fetched
    # right here (with its parents, and its status from one of
    # its addresses' histories): a handful of Electrum calls,
    # bounded by MAX_TX_FETCHES_PER_REQUEST.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/<network>/transaction/<txid>
    ############################################################

    def get_transaction(self, network, txid):
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400
        txid = (txid or '').strip().lower()
        if not TXID_PATTERN.match(txid):
            return {"error": "Neteisingas transakcijos ID"}, 400


        # STEP 1: make sure it is decoded, its inputs resolved and
        # its status known — failures fall through to the cache
        # =========================================================
        budget = {'fetches': MAX_TX_FETCHES_PER_REQUEST}
        try:
            if self._ensure_decoded(network, txid, budget):
                self._ensure_parents(network, txid, budget)
                self._locate(network, txid)
        except Exception:
            logging.exception(f"[UTXO graph] fetching {txid} on {network} failed; serving what the cache has")


        # STEP 2: answer from the cache
        # =============================
        with get_db_connection() as conn:
            payloads = self._transaction_payloads(conn, network, [txid])
            if not payloads:
                return {"error": "Transakcija nerasta"}, 404
            addresses = {coin['address'] for coin in payloads[0]['inputs'] + payloads[0]['outputs'] if coin['address']}
            names = self._names(conn, addresses)

        return {"transaction": payloads[0], "names": names}, 200






    ############################################################
    # set_address_name
    ############################################################
    #
    # Names an address — who controls it — for both graphs: an
    # upsert into Graph_Addresses, the EVM graph's store. The
    # address must be valid on THIS network (its dialect checks
    # it, checksum included) and is stored exactly as given —
    # base58 is case-sensitive. The name is cut to
    # MAX_NAME_LENGTH; an empty one clears it.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/<network>/set-address-name
    ############################################################

    def set_address_name(self, network, address, name):
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400
        address = (address or '').strip()
        if not address:
            return {"error": "Trūksta adreso"}, 400
        if not self.faucet.network_dialect(network).validate_address(address):
            return {"error": "Neteisingas adresas"}, 400

        label = (name or '').strip()[:MAX_NAME_LENGTH]
        with get_db_connection() as conn:
            conn.execute('''
                INSERT INTO Graph_Addresses (address, name, is_contract, is_hub)
                VALUES (?, ?, 0, 0)
                ON CONFLICT(address) DO UPDATE SET name = excluded.name
            ''', [address, label])

        return {"status": "OK"}, 200






    ############################################################
    # _maybe_start_crawl
    ############################################################
    #
    # Start a background crawl of the window when one is due: no
    # crawl of this network is running, and this window was not
    # crawled within CRAWL_INTERVAL_S (live) or
    # HISTORICAL_RECRAWL_S (past). Both records are claimed under
    # the lock BEFORE the thread starts, so a lecture hall opening
    # the page at once starts one crawl.
    #
    # Used by:
    #   - get_graph (above)
    ############################################################

    def _maybe_start_crawl(self, network, from_ts, to_ts, live):
        key = (network, from_ts, to_ts)
        interval = CRAWL_INTERVAL_S if live else HISTORICAL_RECRAWL_S
        now = time.time()

        with self._lock:
            if network in self._crawling or now - self._last_crawl.get(key, 0) < interval:
                return
            self._crawling.add(network)
            self._last_crawl[key] = now

        threading.Thread(
            target=self._crawl,
            args=(network, from_ts, to_ts, live),
            name=f'utxo-graph-{network}',
            daemon=True,
        ).start()






    ############################################################
    # _crawl
    ############################################################
    #
    # The crawl thread's body: the crawl itself, a failure logged
    # (the cache keeps serving, the next due request retries),
    # and the network released for the next crawl whatever
    # happened.
    #
    # Used by:
    #   - _maybe_start_crawl (above) — as the thread target
    ############################################################

    def _crawl(self, network, from_ts, to_ts, live):
        try:
            self._crawl_window(network, from_ts, to_ts, live)
        except Exception:
            logging.exception(f"[UTXO graph] {network} crawl failed; the cache keeps serving")
        finally:
            with self._lock:
                self._crawling.discard(network)






    ############################################################
    # _crawl_window
    ############################################################
    #
    # The breadth-first crawl itself (see the file header):
    # addresses in the order they are met, each one's history
    # brought up to date, its window transactions fetched with
    # their parents, and — within MAX_DEPTH — every other address
    # in them queued. Stops early when the fetch budget runs out;
    # the next crawl continues where this one stopped.
    #
    # Used by:
    #   - _crawl (above)
    ############################################################

    def _crawl_window(self, network, from_ts, to_ts, live):
        root = self.faucet.faucet_address_for(network)
        budget = {'fetches': MAX_TX_FETCHES_PER_CRAWL}
        queue = deque([(root, 0)])
        seen = {root}

        while queue:
            address, depth = queue.popleft()


            # STEP 1: the address' history, re-read when due — a hub
            # or an address this network cannot read ends here
            # ========================================================
            if not self._refresh_address(network, address, live, trusted=address == root):
                continue


            # STEP 2: its transactions inside the window, decoded,
            # with the parents their inputs spend
            # =====================================================
            with get_db_connection() as conn:
                txids = self._window_txids(conn, network, address, from_ts, to_ts, live)
            for txid in txids:
                if not self._ensure_decoded(network, txid, budget):
                    return
                if not self._ensure_parents(network, txid, budget):
                    return


            # STEP 3: every other address in them, one hop further
            # ====================================================
            if depth >= MAX_DEPTH:
                continue
            with get_db_connection() as conn:
                others = self._addresses_in(conn, network, txids)
            for other in sorted(others - seen):
                if len(seen) >= MAX_ADDRESSES_PER_CRAWL:
                    break
                seen.add(other)
                queue.append((other, depth + 1))






    ############################################################
    # _refresh_address
    ############################################################
    #
    # Bring one address' history up to date when it is due — a
    # live window re-reads it every ADDRESS_REFRESH_INTERVAL_S, a
    # past one only if it was never read. The server's list
    # REPLACES the stored one (a transaction it no longer lists
    # was dropped), and the block times of its heights are
    # fetched. A history longer than HUB_HISTORY_THRESHOLD marks
    # a public hub instead — nothing stored — unless `trusted`
    # (the faucet). True when the address may be followed.
    #
    # Used by:
    #   - _crawl_window (above)
    #   - _locate (below) — force=True, one address at a time
    ############################################################

    def _refresh_address(self, network, address, live, trusted=False, force=False):
        now = int(time.time())
        with get_db_connection() as conn:
            row = conn.execute('''
                SELECT last_refresh, is_hub FROM GraphUtxo_Addresses
                WHERE network = ? AND address = ?
            ''', [network, address]).fetchone()

        if row and row['is_hub'] and not trusted:
            return False
        never_read = row is None or row['last_refresh'] is None
        if not (force or never_read or (live and now - row['last_refresh'] >= ADDRESS_REFRESH_INTERVAL_S)):
            return True


        # STEP 1: the history, from the server — by the address'
        # scripthash, so the dialect must be able to read it
        # ======================================================
        try:
            script = self.faucet.network_dialect(network).recipient_script(address)
        except ValueError:
            return False
        history = self._clients[network].request('blockchain.scripthash.get_history', [_electrum_scripthash(script)])


        # STEP 2: too long — a public hub: flagged, nothing kept
        # ======================================================
        if len(history) > HUB_HISTORY_THRESHOLD and not trusted:
            logging.warning(f"[UTXO graph] {address} on {network} looks like a public hub "
                            f"({len(history)} transactions) — flagged, history not stored")
            with get_db_connection() as conn:
                conn.execute('DELETE FROM GraphUtxo_History WHERE network = ? AND address = ?', [network, address])
                conn.execute('''
                    INSERT INTO GraphUtxo_Addresses (network, address, last_refresh, history_size, is_hub)
                    VALUES (?, ?, ?, ?, 1)
                    ON CONFLICT(network, address) DO UPDATE SET
                        last_refresh = excluded.last_refresh,
                        history_size = excluded.history_size,
                        is_hub = 1
                ''', [network, address, now, len(history)])
            return False


        # STEP 3: the server's list replaces the stored one
        # =================================================
        with get_db_connection() as conn:
            conn.execute('DELETE FROM GraphUtxo_History WHERE network = ? AND address = ?', [network, address])
            conn.executemany('''
                INSERT OR REPLACE INTO GraphUtxo_History (network, address, txid, height)
                VALUES (?, ?, ?, ?)
            ''', [(network, address, entry['tx_hash'], int(entry['height'])) for entry in history])
            conn.execute('''
                INSERT INTO GraphUtxo_Addresses (network, address, last_refresh, history_size, is_hub)
                VALUES (?, ?, ?, ?, 0)
                ON CONFLICT(network, address) DO UPDATE SET
                    last_refresh = excluded.last_refresh,
                    history_size = excluded.history_size,
                    is_hub = 0
            ''', [network, address, now, len(history)])


        # STEP 4: the times of the blocks it lives in
        # ===========================================
        self._ensure_block_times(network, {int(entry['height']) for entry in history if int(entry['height']) > 0})
        return True






    ############################################################
    # _ensure_block_times
    ############################################################
    #
    # Fetch the block headers of heights not cached yet and keep
    # each block's time (the header's bytes 68..71, little
    # endian). Heights close together are fetched with ONE
    # blockchain.block.headers call — the whole run between them,
    # up to MAX_HEADERS_PER_CALL — and every header of the run is
    # kept; the header size is read from the answer, not assumed.
    #
    # Used by:
    #   - _refresh_address (above)
    ############################################################

    def _ensure_block_times(self, network, heights):
        if not heights:
            return


        # STEP 1: which heights are still missing
        # =======================================
        with get_db_connection() as conn:
            known = set()
            for chunk in _chunks(sorted(heights)):
                known.update(row['height'] for row in conn.execute(f'''
                    SELECT height FROM GraphUtxo_Blocks
                    WHERE network = ? AND height IN ({','.join('?' * len(chunk))})
                ''', [network, *chunk]))
        missing = sorted(heights - known)


        # STEP 2: group them into runs, one call per run
        # ==============================================
        runs = []
        for height in missing:
            if runs and height - runs[-1][1] < HEADER_RANGE_GAP and height - runs[-1][0] < MAX_HEADERS_PER_CALL:
                runs[-1][1] = height
            else:
                runs.append([height, height])

        rows = []
        for first, last in runs:
            reply = self._clients[network].request('blockchain.block.headers', [first, last - first + 1])
            raw = bytes.fromhex(reply['hex'])
            count = int(reply['count'])
            if not count:
                continue
            size = len(raw) // count
            for i in range(count):
                header = raw[i * size:(i + 1) * size]
                rows.append((network, first + i, int.from_bytes(header[68:72], 'little')))


        # STEP 3: keep them
        # =================
        with get_db_connection() as conn:
            conn.executemany('''
                INSERT OR REPLACE INTO GraphUtxo_Blocks (network, height, time)
                VALUES (?, ?, ?)
            ''', rows)






    ############################################################
    # _ensure_decoded
    ############################################################
    #
    # Make sure a transaction is fetched and decoded — spending
    # one fetch of the budget when it is not. False only when the
    # budget is spent (the caller stops). A transaction the server
    # refuses (an error ANSWER — a broken connection raises on) or
    # sends in a form embit cannot decode is logged, remembered
    # in _undecodable and skipped: one bad transaction must not
    # stop the crawl.
    #
    # Used by:
    #   - _crawl_window, _ensure_parents, get_transaction
    ############################################################

    def _ensure_decoded(self, network, txid, budget):
        with get_db_connection() as conn:
            stored = conn.execute('''
                SELECT 1 FROM GraphUtxo_Transactions WHERE network = ? AND txid = ?
            ''', [network, txid]).fetchone()
        if stored or (network, txid) in self._undecodable:
            return True
        if budget['fetches'] <= 0:
            return False

        budget['fetches'] -= 1
        try:
            raw_hex = self._clients[network].request('blockchain.transaction.get', [txid])
        except RuntimeError as error:
            # The server's answer says it all (a node without
            # -txindex refuses every mined transaction) — no traceback
            logging.warning(f"[UTXO graph] the server refused {txid} on {network} — skipped: {error}")
            self._undecodable.add((network, txid))
            return True
        try:
            self._store_transaction(network, txid, raw_hex)
        except Exception:
            logging.warning(f"[UTXO graph] {txid} on {network} could not be decoded — skipped", exc_info=True)
            self._undecodable.add((network, txid))
        return True






    ############################################################
    # _ensure_parents
    ############################################################
    #
    # Decode the transactions a decoded one's inputs spend — an
    # input names only an outpoint, its address and amount live
    # in the parent's output. False when the budget ran out.
    #
    # Used by:
    #   - _crawl_window, get_transaction
    ############################################################

    def _ensure_parents(self, network, txid, budget):
        with get_db_connection() as conn:
            parents = [row['prev_txid'] for row in conn.execute('''
                SELECT DISTINCT prev_txid FROM GraphUtxo_Inputs WHERE network = ? AND txid = ?
            ''', [network, txid])]

        for parent in parents:
            if not self._ensure_decoded(network, parent, budget):
                return False
        return True






    ############################################################
    # _store_transaction
    ############################################################
    #
    # Decode a raw transaction with embit and store it: its
    # vsize and whether it is a coinbase, every output (address
    # through the network's dialect — None when the script has no
    # address form — script type, amount in satoshis) and every
    # input's outpoint (a coinbase stores none). An answer whose
    # txid is not the one asked for is refused.
    #
    # Used by:
    #   - _ensure_decoded (above)
    ############################################################

    def _store_transaction(self, network, txid, raw_hex):
        raw = bytes.fromhex(raw_hex)
        tx = Transaction.parse(raw)
        if tx.txid().hex() != txid:
            raise ValueError(f"the server answered {txid} with {tx.txid().hex()}")

        dialect = self.faucet.network_dialect(network)
        coinbase = _is_coinbase(tx)
        outputs = [
            (network, txid, vout, dialect.address_of(out.script_pubkey.data), _script_type(out.script_pubkey.data), int(out.value))
            for vout, out in enumerate(tx.vout)
        ]
        inputs = [] if coinbase else [
            (network, txid, vin, inp.txid.hex(), inp.vout)
            for vin, inp in enumerate(tx.vin)
        ]

        with get_db_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO GraphUtxo_Transactions (network, txid, vsize, is_coinbase, fetched_at)
                VALUES (?, ?, ?, ?, ?)
            ''', [network, txid, _vsize(raw, tx), int(coinbase), int(time.time())])
            conn.executemany('''
                INSERT OR REPLACE INTO GraphUtxo_Outputs (network, txid, vout, address, script_type, value)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', outputs)
            conn.executemany('''
                INSERT OR REPLACE INTO GraphUtxo_Inputs (network, txid, vin, prev_txid, prev_vout)
                VALUES (?, ?, ?, ?, ?)
            ''', inputs)






    ############################################################
    # _locate
    ############################################################
    #
    # Give a transaction no history lists yet a status: read the
    # full history of its first output address (then of its
    # inputs' addresses) — whichever lists it tells its height.
    # A transaction nobody's history lists stays 'unknown'. The
    # faucet is read trusted, as in the crawl — a long history
    # must not flag it a hub (which would wipe its history).
    #
    # Used by:
    #   - get_transaction (above)
    ############################################################

    def _locate(self, network, txid):
        with get_db_connection() as conn:
            listed = conn.execute('''
                SELECT 1 FROM GraphUtxo_History WHERE network = ? AND txid = ? LIMIT 1
            ''', [network, txid]).fetchone()
            if listed:
                return
            candidates = [row['address'] for row in conn.execute('''
                SELECT address FROM GraphUtxo_Outputs
                WHERE network = ? AND txid = ? AND address IS NOT NULL
                ORDER BY vout
            ''', [network, txid])]
            candidates += sorted(self._addresses_in(conn, network, [txid]) - set(candidates))

        root = self.faucet.faucet_address_for(network)
        for address in candidates[:3]:
            self._refresh_address(network, address, live=True, trusted=address == root, force=True)
            with get_db_connection() as conn:
                if conn.execute('''
                    SELECT 1 FROM GraphUtxo_History WHERE network = ? AND txid = ? LIMIT 1
                ''', [network, txid]).fetchone():
                    return






    ############################################################
    # _window_txids
    ############################################################
    #
    # An address' transactions inside [from_ts, to_ts) by its
    # stored history: mined in a block whose time falls in the
    # window, or — when the window is live — waiting in the
    # mempool. `decoded_only` keeps to the ones already fetched
    # (the serving side cannot show a transaction it has not
    # decoded).
    #
    # Used by:
    #   - _crawl_window (above), _window_payload (below)
    ############################################################

    def _window_txids(self, conn, network, address, from_ts, to_ts, live, decoded_only=False):
        rows = conn.execute(f'''
            SELECT h.txid
            FROM GraphUtxo_History h
            LEFT JOIN GraphUtxo_Blocks b ON b.network = h.network AND b.height = h.height
            {'JOIN GraphUtxo_Transactions t ON t.network = h.network AND t.txid = h.txid' if decoded_only else ''}
            WHERE h.network = ? AND h.address = ?
              AND ((h.height > 0 AND b.time >= ? AND b.time < ?) OR (h.height <= 0 AND ?))
            ORDER BY h.height, h.txid
        ''', [network, address, from_ts, to_ts, 1 if live else 0]).fetchall()
        return [row['txid'] for row in rows]






    ############################################################
    # _addresses_in
    ############################################################
    #
    # Every address a set of decoded transactions touches: their
    # outputs' addresses, and their inputs' (the addresses of the
    # parent outputs they spend).
    #
    # Used by:
    #   - _crawl_window, _locate (above), _window_payload (below)
    ############################################################

    def _addresses_in(self, conn, network, txids):
        addresses = set()
        for chunk in _chunks(txids):
            marks = ','.join('?' * len(chunk))
            addresses.update(row['address'] for row in conn.execute(f'''
                SELECT DISTINCT address FROM GraphUtxo_Outputs
                WHERE network = ? AND txid IN ({marks}) AND address IS NOT NULL
            ''', [network, *chunk]))
            addresses.update(row['address'] for row in conn.execute(f'''
                SELECT DISTINCT o.address
                FROM GraphUtxo_Inputs i
                JOIN GraphUtxo_Outputs o ON o.network = i.network AND o.txid = i.prev_txid AND o.vout = i.prev_vout
                WHERE i.network = ? AND i.txid IN ({marks}) AND o.address IS NOT NULL
            ''', [network, *chunk]))
        return addresses






    ############################################################
    # _window_payload
    ############################################################
    #
    # The graph of one window from the cache alone: the same
    # breadth-first walk as the crawl — from the faucet, through
    # the window's decoded transactions, never into a hub, at
    # most MAX_DEPTH hops and MAX_ADDRESSES_PER_CRAWL addresses —
    # then every transaction found in the page's shape, the
    # blocks they sit in and the names of every address shown.
    # `missing` counts the window's transactions the walk met in
    # a history but cannot show, not decoded: still to fetch
    # while a crawl runs — or refused by the server (a node
    # without -txindex serves no mined transaction), which the
    # page must say rather than look like a quiet day.
    #
    # Used by:
    #   - get_graph (above)
    ############################################################

    def _window_payload(self, conn, network, from_ts, to_ts, live):
        root = self.faucet.faucet_address_for(network)
        hubs = {row['address'] for row in conn.execute('''
            SELECT address FROM GraphUtxo_Addresses WHERE network = ? AND is_hub = 1
        ''', [network])}


        # STEP 1: walk the window from the faucet
        # =======================================
        chosen = []
        taken = set()
        missing = set()
        queue = deque([(root, 0)])
        seen = {root}
        while queue:
            address, depth = queue.popleft()
            if address in hubs and address != root:
                continue
            txids = self._window_txids(conn, network, address, from_ts, to_ts, live, decoded_only=True)
            missing.update(set(self._window_txids(conn, network, address, from_ts, to_ts, live)) - set(txids))
            for txid in txids:
                if txid not in taken:
                    taken.add(txid)
                    chosen.append(txid)
            if depth >= MAX_DEPTH:
                continue
            for other in sorted(self._addresses_in(conn, network, txids) - seen):
                if len(seen) >= MAX_ADDRESSES_PER_CRAWL:
                    break
                seen.add(other)
                queue.append((other, depth + 1))


        # STEP 2: the transactions, their blocks and the names
        # ====================================================
        transactions = _ordered(self._transaction_payloads(conn, network, chosen), root)
        blocks = sorted({(tx['block'], tx['time']) for tx in transactions if tx['block'] is not None})
        addresses = {root}
        for tx in transactions:
            addresses.update(coin['address'] for coin in tx['inputs'] + tx['outputs'] if coin['address'])

        return {
            "faucet_address": root,
            "live": live,
            "blocks": [{"height": height, "time": block_time} for height, block_time in blocks],
            "transactions": transactions,
            "missing": len(missing),
            "names": self._names(conn, addresses),
        }






    ############################################################
    # _transaction_payloads
    ############################################################
    #
    # Decoded transactions in the page's shape:
    #
    #   { txid, status ('confirmed' | 'mempool' | 'unknown'),
    #     block (height or None), time (ISO or None), vsize,
    #     fee (None when an input is unresolved, or a coinbase),
    #     coinbase,
    #     inputs:  [{ txid, vout, address, value }] — address and
    #              value None while the parent is not decoded,
    #     outputs: [{ address, script_type, value,
    #                 spent_by: { txid, vin } | None,
    #                 spent_known }] }
    #
    # The status is the highest height any stored history gives
    # it. spent_by is the input that spends the output among the
    # transactions some history still lists (a dropped one spends
    # nothing); spent_known says None there is FINAL — the
    # output's address history is read (so its spender would be
    # stored), or the output is OP_RETURN data nobody can spend.
    #
    # Used by:
    #   - _window_payload, get_transaction (above)
    ############################################################

    def _transaction_payloads(self, conn, network, txids):
        payloads = []
        for txid in txids:
            meta = conn.execute('''
                SELECT vsize, is_coinbase FROM GraphUtxo_Transactions WHERE network = ? AND txid = ?
            ''', [network, txid]).fetchone()
            if meta is None:
                continue


            # STEP 1: status — from the stored histories
            # ==========================================
            height = conn.execute('''
                SELECT MAX(height) AS height FROM GraphUtxo_History WHERE network = ? AND txid = ?
            ''', [network, txid]).fetchone()['height']
            block, block_time, status = None, None, 'unknown'
            if height is not None and height > 0:
                block, status = height, 'confirmed'
                found = conn.execute('''
                    SELECT time FROM GraphUtxo_Blocks WHERE network = ? AND height = ?
                ''', [network, height]).fetchone()
                block_time = found['time'] if found else None
            elif height is not None:
                status = 'mempool'


            # STEP 2: inputs — each resolved through its parent
            # =================================================
            inputs = [
                {"txid": row['prev_txid'], "vout": row['prev_vout'], "address": row['address'], "value": row['value']}
                for row in conn.execute('''
                    SELECT i.prev_txid, i.prev_vout, o.address, o.value
                    FROM GraphUtxo_Inputs i
                    LEFT JOIN GraphUtxo_Outputs o
                        ON o.network = i.network AND o.txid = i.prev_txid AND o.vout = i.prev_vout
                    WHERE i.network = ? AND i.txid = ?
                    ORDER BY i.vin
                ''', [network, txid])
            ]


            # STEP 3: outputs — each with its spender, if known
            # =================================================
            outputs = []
            for row in conn.execute('''
                SELECT vout, address, script_type, value FROM GraphUtxo_Outputs
                WHERE network = ? AND txid = ?
                ORDER BY vout
            ''', [network, txid]).fetchall():
                spender = conn.execute('''
                    SELECT i.txid, i.vin FROM GraphUtxo_Inputs i
                    WHERE i.network = ? AND i.prev_txid = ? AND i.prev_vout = ?
                      AND EXISTS (SELECT 1 FROM GraphUtxo_History h WHERE h.network = i.network AND h.txid = i.txid)
                    LIMIT 1
                ''', [network, txid, row['vout']]).fetchone()
                read = row['address'] is not None and conn.execute('''
                    SELECT 1 FROM GraphUtxo_Addresses
                    WHERE network = ? AND address = ? AND last_refresh IS NOT NULL AND is_hub = 0
                ''', [network, row['address']]).fetchone() is not None
                outputs.append({
                    "address": row['address'],
                    "script_type": row['script_type'],
                    "value": row['value'],
                    "spent_by": {"txid": spender['txid'], "vin": spender['vin']} if spender else None,
                    "spent_known": bool(spender) or read or row['script_type'] == 'op_return',
                })


            # STEP 4: the fee — inputs minus outputs, when every
            # input's amount is known
            # ==================================================
            fee = None
            if not meta['is_coinbase'] and inputs and all(inp['value'] is not None for inp in inputs):
                fee = sum(inp['value'] for inp in inputs) - sum(out['value'] for out in outputs)

            payloads.append({
                "txid": txid,
                "status": status,
                "block": block,
                "time": _iso(block_time),
                "vsize": meta['vsize'],
                "fee": fee,
                "coinbase": bool(meta['is_coinbase']),
                "inputs": inputs,
                "outputs": outputs,
            })

        return payloads






    ############################################################
    # _names
    ############################################################
    #
    # address → name for the given addresses that have one, from
    # Graph_Addresses — the store both graphs share.
    #
    # Used by:
    #   - _window_payload, get_transaction (above)
    ############################################################

    def _names(self, conn, addresses):
        names = {}
        for chunk in _chunks(sorted(addresses)):
            for row in conn.execute(f'''
                SELECT address, name FROM Graph_Addresses
                WHERE address IN ({','.join('?' * len(chunk))}) AND name IS NOT NULL AND name != ''
            ''', chunk):
                names[row['address']] = row['name']
        return names
