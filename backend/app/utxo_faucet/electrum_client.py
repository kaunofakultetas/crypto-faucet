############################################################
#  [*] Electrum Client
#
#  A minimal ElectrumX client: one SSL socket, newline-
#  delimited JSON-RPC, plus the two scripthash queries the
#  faucet needs. Knows NOTHING about faucets, configs or
#  networks — it gets an endpoint string and talks protocol.
#  The servers run self-signed certificates, so certificate
#  verification is off.
#
#  Built to stay ALIVE: one instance per network lives for
#  the whole process. The internal lock serializes the strict
#  request/response protocol across threads, and any
#  transport failure (dropped socket, timeout, desynced
#  framing) rebuilds the connection and retries the request
#  ONCE — safe even for a broadcast, because re-sending the
#  same raw transaction is idempotent (same txid).
#
#  Used by:
#    - utxo_faucet.py — one long-lived instance per network,
#      created and connected at startup (UTXOFaucet.__init__
#      + _warm_up_networks)
############################################################


import ssl
import time
import json
import socket
import threading


# Electrum protocol version announced during the server.version
# handshake. Newer ElectrumX releases refuse to serve a session
# that doesn't introduce itself first (see _connect).
ELECTRUM_CLIENT_NAME = 'knf-faucet'
ELECTRUM_PROTOCOL_VERSION = '1.4'

# Socket timeout — a hung server fails the request instead of
# wedging a Flask worker (and this client's lock).
ELECTRUM_TIMEOUT_S = 15








############################################################
# ElectrumClient
############################################################
#
# The client itself; see the file header for the full story.
# Public surface: request(), get_balance(), list_unspent() —
# everything else is connection plumbing.
#
# Used by:
#   - utxo_faucet.py — UTXOFaucet keeps one per network
############################################################

class ElectrumClient:






    ############################################################
    # __init__
    ############################################################
    #
    # endpoint is the config's 'host:port' string; a bare host
    # defaults to 50002, the conventional Electrum SSL port.
    # label only feeds the debug timing line.
    #
    # Used by:
    #   - utxo_faucet.py — UTXOFaucet.__init__, one per
    #     configured network
    ############################################################

    def __init__(self, endpoint: str, debug: bool = False, label: str = ''):
        if ':' in endpoint:
            self.host, port_str = endpoint.split(':', 1)
            self.port = int(port_str)
        else:
            self.host = endpoint
            self.port = 50002

        self.debug = debug
        self.label = label
        self.ssock = None

        # The Electrum protocol is strict request/response over one
        # socket — concurrent threads must take turns.
        self.lock = threading.Lock()






    ############################################################
    # connect
    ############################################################
    #
    # Ensures the connection is open. The faucet's startup
    # warmup calls this so a bad endpoint or a down server
    # shows up in the console immediately — regular requests
    # don't need it, request() connects lazily and self-heals
    # anyway.
    #
    # Used by:
    #   - utxo_faucet.py — UTXOFaucet._warm_up_networks
    ############################################################

    def connect(self):
        with self.lock:
            if not self.ssock:
                self._connect()






    ############################################################
    # _connect
    ############################################################
    #
    # Opens the SSL connection; the caller holds self.lock.
    # The server.version handshake goes out immediately —
    # recent ElectrumX versions close the session
    # ("server.version must be first msg") if any other
    # request arrives before it. The socket timeout keeps a
    # hung server from wedging a Flask worker forever.
    #
    # Used by:
    #   - request (below) — on first use and after a teardown
    ############################################################

    def _connect(self):
        if not self.host or not self.port:
            raise ValueError('Electrum server not configured')

        sock = socket.create_connection((self.host, self.port), timeout=ELECTRUM_TIMEOUT_S)

        # Tiny request/response messages — Nagle's algorithm would
        # only sit on them waiting for more data that never comes
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        self.ssock = context.wrap_socket(sock, server_hostname=self.host)

        self._roundtrip("server.version", [ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION])






    ############################################################
    # _teardown
    ############################################################
    #
    # Drops the socket without ceremony; the caller holds
    # self.lock. Errors while closing an already-broken socket
    # mean nothing — ignored.
    #
    # Used by:
    #   - request (below) — before a reconnect attempt
    ############################################################

    def _teardown(self):
        if self.ssock:
            try:
                self.ssock.close()
            except OSError:
                pass
            self.ssock = None






    ############################################################
    # _roundtrip
    ############################################################
    #
    # One JSON-RPC round-trip over the open socket; the caller
    # holds self.lock. Newline-delimited protocol: send one
    # line, read until the first '\n' comes back. Electrum-side
    # errors raise RuntimeError — those mean the server
    # ANSWERED, so request() never retries them. The timing
    # print only fires with APP_DEBUG on.
    #
    # Used by:
    #   - _connect (above) — the handshake
    #   - request (below)
    ############################################################

    def _roundtrip(self, method: str, params: list):
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }

        start_time = time.time()

        self.ssock.sendall((json.dumps(request) + "\n").encode("utf-8"))

        response_data = b""
        while True:
            chunk = self.ssock.recv(1024)
            if not chunk:
                raise ConnectionError("Connection closed by server")
            response_data += chunk
            if b'\n' in response_data:
                response_line = response_data.split(b'\n', 1)[0]
                break

        elapsed_time = time.time() - start_time
        if self.debug:
            print(f"[DEBUG] Electrum request '{method}' took {elapsed_time:.3f}s (network: {self.label})")

        response = json.loads(response_line.decode('utf-8'))

        if "error" in response and response["error"]:
            raise RuntimeError(f"Electrum error: {response['error']}")

        if "result" not in response:
            raise ValueError("Unexpected Electrum response format")

        return response["result"]






    ############################################################
    # request
    ############################################################
    #
    # The public entry: connect on first use, then one locked
    # round-trip. Any transport failure (dropped socket, TLS
    # hiccup, timeout, garbled framing — OSError/ValueError)
    # tears the connection down and retries ONCE on a fresh
    # socket, which keeps the long-lived connection self-
    # healing across Electrum restarts and idle disconnects.
    # RuntimeError passes straight through: the server
    # answered, reconnecting would not change the answer.
    #
    # Used by:
    #   - get_balance / list_unspent (below)
    #   - utxo_faucet.py — _create_and_broadcast_transaction's
    #     broadcast (retry-safe: same raw tx = same txid)
    ############################################################

    def request(self, method: str, params: list):
        with self.lock:
            try:
                if not self.ssock:
                    self._connect()
                return self._roundtrip(method, params)
            except RuntimeError:
                raise
            except (OSError, ValueError):
                self._teardown()
                self._connect()
                return self._roundtrip(method, params)






    ############################################################
    # get_balance
    ############################################################
    #
    # A scripthash's balance in whole coins (Electrum answers
    # in satoshis), split into confirmed / unconfirmed / total.
    #
    # Used by:
    #   - utxo_faucet.py — UTXOFaucet._faucet_balance
    ############################################################

    def get_balance(self, scripthash: str) -> dict:
        result = self.request("blockchain.scripthash.get_balance", [scripthash])
        confirmed = result.get("confirmed", 0) / 1e8
        unconfirmed = result.get("unconfirmed", 0) / 1e8

        return {
            "confirmed": confirmed,
            "unconfirmed": unconfirmed,
            "total": confirmed + unconfirmed
        }






    ############################################################
    # list_unspent
    ############################################################
    #
    # Used by:
    #   - utxo_faucet.py —
    #     UTXOFaucet._create_and_broadcast_transaction
    ############################################################

    def list_unspent(self, scripthash: str) -> list:
        return self.request("blockchain.scripthash.listunspent", [scripthash])




