############################################################
#  [*] Electrum watcher — live change notifications
#
#  Tells the transaction graph the moment an address it shows
#  changes: a new transaction entering the mempool, a block
#  confirming one, a reorg — whatever alters the address'
#  history. Electrum's own way to follow addresses:
#  blockchain.scripthash.subscribe answers with the history's
#  STATUS (a hash of it), and from then on the server pushes a
#  notification with the new status whenever it changes. One
#  subscription costs the server about one history read, once;
#  the notifications are free — unlike re-reading every
#  address every few seconds, which ElectrumX bills per IP and
#  answers by slowing EVERY session from that IP, the faucet's
#  payouts included.
#
#  One watcher per network, with its OWN connection and
#  thread: the faucet's and the explorer's ElectrumClients are
#  strictly request/response and treat a pushed message as a
#  broken session, so notifications never reach them. The
#  thread subscribes whatever watch() was given, reads what
#  the server sends, pings when quiet (ElectrumX drops idle
#  sessions), and reconnects with a growing wait when the
#  connection breaks — resubscribing everything and comparing
#  the statuses with the last ones seen, so a change that
#  happened while it was away still counts. A change is
#  reported through on_change(scripthash); what it means is
#  the explorer's business.
#
#  Used by:
#    - explorer.py — UtxoGraphExplorer, one watcher per
#      network whose live window is on screen
############################################################


import json
import time
import logging
import threading

from .electrum_client import ElectrumClient


# How long one read waits for data before the loop looks for
# new work (addresses to subscribe, a ping due)
READ_TICK_S = 1.0

# A ping after this long without sending anything — ElectrumX
# drops sessions idle for SESSION_TIMEOUT (600 s by default)
PING_EVERY_S = 60

# The wait before reconnecting: from the first, doubling up to
# the cap; back to the first after a session that had lasted
RETRY_FIRST_S = 1
RETRY_MAX_S = 60

# Subscriptions one connection carries at most — past it, the
# watcher starts over with only what was asked for last
MAX_WATCHED = 2000








############################################################
# ElectrumWatcher
############################################################
#
# The subscription connection of one network. Methods in
# groups:
#
#   api     — __init__, watch, close
#   thread  — _run, _session, _send, _handle, _seen, _report
#   connect — _open
#
# Used by:
#   - explorer.py — UtxoGraphExplorer._watch
############################################################

class ElectrumWatcher:






    ############################################################
    # __init__
    ############################################################
    #
    # endpoint is the network's Electrum server (host:port, as
    # the faucet config names it); on_change(scripthash) is
    # called from the watcher's thread for every change seen.
    # `opener` returns a connected, handshaken socket — the
    # default goes through ElectrumClient; tests pass their
    # own. Nothing connects until the first watch().
    #
    # Used by:
    #   - explorer.py — UtxoGraphExplorer._watch
    ############################################################

    def __init__(self, endpoint, on_change, label='', opener=None):
        self.endpoint = endpoint
        self.on_change = on_change
        self.label = label
        self._opener = opener or self._open

        # Guards the wanted set and the restart / close flags, all
        # handed from other threads (a crawl's, close's caller)
        # to the watcher's
        self._lock = threading.Lock()
        self._wanted = set()
        self._restart = False
        self._closed = False
        self._thread = None

        # scripthash → the last status seen, kept across
        # reconnects (the watcher's thread only)
        self._statuses = {}






    ############################################################
    # watch
    ############################################################
    #
    # Adds scripthashes to follow — the open connection
    # subscribes them within a read tick — and starts the
    # thread on first use. Past MAX_WATCHED the old set is
    # dropped for this one, and the connection starts over to
    # shed the old subscriptions.
    #
    # Used by:
    #   - explorer.py — UtxoGraphExplorer._watch, after every
    #     live crawl
    ############################################################

    def watch(self, scripthashes):
        scripthashes = set(scripthashes)
        with self._lock:
            if len(self._wanted | scripthashes) > MAX_WATCHED:
                self._wanted = scripthashes
                self._restart = True
            else:
                self._wanted |= scripthashes

            if self._thread is None and not self._closed:
                self._thread = threading.Thread(target=self._run, name=f'electrum-watch-{self.label}', daemon=True)
                self._thread.start()






    ############################################################
    # close
    ############################################################
    #
    # Stops the thread — within a read tick, or once a retry
    # wait is over — and waits for it to end. Nothing in the
    # app closes a watcher: it lives as long as the process.
    #
    # Used by:
    #   - tests/test_electrum_watcher.py — every test's cleanup
    ############################################################

    def close(self):
        with self._lock:
            self._closed = True
            thread = self._thread
        if thread is not None:
            thread.join(timeout=RETRY_MAX_S)






    ############################################################
    # _run
    ############################################################
    #
    # The thread's body: sessions one after another until
    # closed. A session that ends on purpose (a restart)
    # reconnects at once; a broken one after RETRY_FIRST_S,
    # doubling up to RETRY_MAX_S while the server stays away.
    #
    # Used by:
    #   - watch (above) — as the thread target
    ############################################################

    def _run(self):
        delay = RETRY_FIRST_S
        while not self._closed:
            started = time.time()
            try:
                self._session()
                continue
            except Exception as error:
                if self._closed:
                    return
                logging.warning(f"[UTXO graph] {self.label} watcher lost its connection ({error}) — "
                                f"reconnecting in {delay} s")

            if time.time() - started > RETRY_MAX_S:
                delay = RETRY_FIRST_S
            time.sleep(delay)
            delay = min(delay * 2, RETRY_MAX_S)






    ############################################################
    # _session
    ############################################################
    #
    # One connection's life: subscribe what is wanted and not
    # subscribed yet, ping when quiet, and hand every complete
    # line the server sends to _handle. Returns only for a
    # restart or a close; a connection the server closed or
    # broke raises.
    #
    # Used by:
    #   - _run (above)
    ############################################################

    def _session(self):
        sock = self._opener()
        try:
            sock.settimeout(READ_TICK_S)
            pending = {}          # request id → the scripthash it subscribes
            subscribed = set()
            next_id = 1000        # clear of the handshake's id
            last_sent = time.time()
            buffer = b''

            while True:


                # STEP 1: a restart or close asked for, or new
                # addresses to follow
                # ============================================
                with self._lock:
                    if self._restart or self._closed:
                        self._restart = False
                        return
                    todo = sorted(self._wanted - subscribed - set(pending.values()))
                for scripthash in todo:
                    self._send(sock, next_id, 'blockchain.scripthash.subscribe', [scripthash])
                    pending[next_id] = scripthash
                    next_id += 1
                    last_sent = time.time()


                # STEP 2: keep the session alive
                # ==============================
                if time.time() - last_sent >= PING_EVERY_S:
                    self._send(sock, next_id, 'server.ping', [])
                    next_id += 1
                    last_sent = time.time()


                # STEP 3: read what came, line by line
                # ====================================
                try:
                    chunk = sock.recv(65536)
                except TimeoutError:
                    continue
                if not chunk:
                    raise ConnectionError('closed by the server')
                buffer += chunk
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    if line.strip():
                        self._handle(json.loads(line), pending, subscribed)
        finally:
            sock.close()






    ############################################################
    # _send
    ############################################################
    #
    # One JSON-RPC request as one line.
    #
    # Used by:
    #   - _session (above) — subscriptions and pings
    ############################################################

    def _send(self, sock, request_id, method, params):
        request = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        sock.sendall((json.dumps(request) + "\n").encode("utf-8"))






    ############################################################
    # _handle
    ############################################################
    #
    # One message from the server: a notification (a status
    # changed — always a change), the answer to a subscription
    # (the status now — a change only if one was seen before
    # and it differs), or anything else (a ping's answer),
    # ignored. A subscription the server refuses is logged and
    # counted as subscribed, so it is not asked again and again.
    #
    # Used by:
    #   - _session (above)
    ############################################################

    def _handle(self, message, pending, subscribed):
        if message.get('method') == 'blockchain.scripthash.subscribe':
            scripthash, status = message['params']
            self._statuses[scripthash] = status
            self._report(scripthash)
            return

        scripthash = pending.pop(message.get('id'), None)
        if scripthash is None:
            return
        subscribed.add(scripthash)
        if message.get('error'):
            logging.warning(f"[UTXO graph] {self.label} watcher could not subscribe {scripthash}: {message['error']}")
            return
        self._seen(scripthash, message.get('result'))






    ############################################################
    # _seen
    ############################################################
    #
    # A subscription's answer: the status now. First sight is
    # only remembered — the explorer has just read the address;
    # a status that differs from the last one seen means the
    # history changed while the watcher was away.
    #
    # Used by:
    #   - _handle (above)
    ############################################################

    def _seen(self, scripthash, status):
        known = scripthash in self._statuses
        before = self._statuses.get(scripthash)
        self._statuses[scripthash] = status
        if known and before != status:
            self._report(scripthash)






    ############################################################
    # _report
    ############################################################
    #
    # on_change, never allowed to take the thread down with it.
    #
    # Used by:
    #   - _handle / _seen (above)
    ############################################################

    def _report(self, scripthash):
        try:
            self.on_change(scripthash)
        except Exception:
            logging.exception(f"[UTXO graph] {self.label} watcher: handling a change of {scripthash} failed")






    ############################################################
    # _open
    ############################################################
    #
    # The default opener: an ElectrumClient's TLS connection and
    # server.version handshake, the same as every other session
    # of the faucet — then the socket is the watcher's alone.
    #
    # Used by:
    #   - _session (above) — through self._opener
    ############################################################

    def _open(self):
        client = ElectrumClient(self.endpoint, label=self.label)
        client.connect()
        return client.ssock
