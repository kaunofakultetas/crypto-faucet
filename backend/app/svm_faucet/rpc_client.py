############################################################
#  [*] Solana RPC Client
#
#  A minimal SVM JSON-RPC client: the handful of methods a
#  faucet needs, spoken over plain HTTPS. Knows NOTHING about
#  faucets, configs or chains — it gets an endpoint URL and
#  talks protocol.
#
#  Solana RPC is stateless HTTP: every call is an independent
#  request, there is no connection to keep alive and a dropped
#  one costs nothing but a retry by the caller. One instance
#  per network, a timeout so a hung endpoint can't wedge a
#  Flask worker, and RPC-level errors raised as RuntimeError.
#
#  Some providers (and the Cloudflare instances in front of
#  them) reject the bare python-requests user agent, so one is
#  set explicitly.
#
#  Used by:
#    - svm_faucet.py — one long-lived instance per network,
#      created at startup (SVMFaucet.__init__)
############################################################


import time
import logging

import requests


# HTTP timeout — a hung endpoint fails the request instead of
# wedging a Flask worker
SOLANA_TIMEOUT_S = 20

# Some RPC providers filter the default python-requests agent
SOLANA_USER_AGENT = 'knf-faucet'

# Commitment level for every read and for the broadcast's
# PRE-FLIGHT simulation — nothing here waits for a
# confirmation; a payout is reported on acceptance, like in
# every faucet family. 'confirmed' is the classroom sweet
# spot — ~1 slot of latency, and effectively final on
# devnet. 'finalized' would add ~13 s to every balance poll.
SOLANA_COMMITMENT = 'confirmed'








############################################################
# SolanaRpcClient
############################################################
#
# The client itself; see the file header for the full story.
# Public surface: request(), get_balance(), get_latest_
# blockhash(), send_transaction(), get_version().
#
# Used by:
#   - svm_faucet.py — SVMFaucet keeps one per network
############################################################

class SolanaRpcClient:






    ############################################################
    # __init__
    ############################################################
    #
    # endpoint is the config's rpc_url (already resolved from
    # its <ENV_NAME> template). label only feeds the debug
    # timing line.
    #
    # Used by:
    #   - svm_faucet.py — SVMFaucet.__init__, one per
    #     configured network
    ############################################################

    def __init__(self, endpoint: str, debug: bool = False, label: str = ''):
        self.endpoint = endpoint
        self.debug = debug
        self.label = label

        # One pooled HTTPS session per network — TLS handshakes
        # are the expensive part of an otherwise tiny request
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': SOLANA_USER_AGENT,
        })






    ############################################################
    # request
    ############################################################
    #
    # One JSON-RPC call. The node ANSWERING with an error is a
    # RuntimeError (a retry would only ask the same question
    # again). A CONNECTION failure retries once — a pooled
    # keep-alive the server dropped while idle fails exactly
    # one send, and the pool dials fresh for the retry; safe
    # even for a broadcast, because re-sending the same signed
    # transaction is idempotent (same signature). A CONNECT
    # TIMEOUT is not that: the host never answered, and a second
    # dial would only burn the timeout twice. Every other
    # transport failure propagates as the requests exception
    # it already is, so the caller can decide. The timing
    # print only fires with APP_DEBUG on.
    #
    # Used by:
    #   - every query method below
    ############################################################

    def request(self, method: str, params: list = None):
        if not self.endpoint:
            raise ValueError('Solana RPC endpoint not configured')

        payload = {'jsonrpc': '2.0', 'id': 1, 'method': method}
        if params is not None:
            payload['params'] = params

        start_time = time.time()
        try:
            response = self.session.post(self.endpoint, json=payload, timeout=SOLANA_TIMEOUT_S)
        except requests.ConnectTimeout:
            raise
        except requests.ConnectionError:
            response = self.session.post(self.endpoint, json=payload, timeout=SOLANA_TIMEOUT_S)
        response.raise_for_status()
        answer = response.json()

        elapsed_time = time.time() - start_time
        if self.debug:
            print(f"[DEBUG] Solana request '{method}' took {elapsed_time:.3f}s (network: {self.label})")

        if 'error' in answer and answer['error']:
            raise RuntimeError(f"Solana RPC error: {answer['error']}")

        if 'result' not in answer:
            raise ValueError('Unexpected Solana RPC response format')

        return answer['result']






    ############################################################
    # get_balance
    ############################################################
    #
    # One address' balance in LAMPORTS (the caller converts —
    # the decimals are a chain fact, see chains/).
    #
    # Used by:
    #   - svm_faucet.py — the faucet's own balance and the
    #     student's eligibility check
    ############################################################

    def get_balance(self, address: str) -> int:
        result = self.request('getBalance', [address, {'commitment': SOLANA_COMMITMENT}])
        return int(result.get('value', 0))






    ############################################################
    # get_latest_blockhash
    ############################################################
    #
    # The recent blockhash every transaction must carry —
    # Solana's replay protection, and the reason a payout can
    # never be built ahead of time: it expires after ~150
    # slots (about a minute).
    #
    # Used by:
    #   - svm_faucet.py — building a payout
    ############################################################

    def get_latest_blockhash(self) -> str:
        result = self.request('getLatestBlockhash', [{'commitment': SOLANA_COMMITMENT}])
        return result['value']['blockhash']






    ############################################################
    # send_transaction
    ############################################################
    #
    # Broadcasts a base64-encoded signed transaction and
    # returns its signature (which IS the transaction id on
    # SVM chains). preflight stays ON: it catches an
    # underfunded or malformed payout at submit time instead
    # of letting it fail silently on chain.
    #
    # Used by:
    #   - svm_faucet.py — the payout broadcast
    ############################################################

    def send_transaction(self, signed_base64: str) -> str:
        return self.request('sendTransaction', [
            signed_base64,
            {'encoding': 'base64', 'preflightCommitment': SOLANA_COMMITMENT},
        ])






    ############################################################
    # get_version
    ############################################################
    #
    # The node's solana-core version — used as the startup
    # health probe, so a dead endpoint screams in the console
    # before the first student arrives.
    #
    # Used by:
    #   - svm_faucet.py — _warm_up_networks
    ############################################################

    def get_version(self) -> str:
        return self.request('getVersion').get('solana-core', 'unknown')







    ############################################################
    # get_genesis_hash
    ############################################################
    #
    # The cluster's genesis hash — the one fact that tells
    # mainnet, devnet and testnet apart over RPC (getVersion
    # answers the same everywhere).
    #
    # Used by:
    #   - svm_faucet.py — _verify_cluster
    ############################################################

    def get_genesis_hash(self) -> str:
        return self.request('getGenesisHash')
