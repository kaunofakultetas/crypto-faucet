############################################################
#  [*] Sui GraphQL Client
#
#  A minimal Sui client speaking the network's GraphQL RPC —
#  the ONLY public API left on Sui fullnodes (JSON-RPC was
#  removed in 2026). Knows NOTHING about faucets or configs —
#  it gets an endpoint URL and talks protocol.
#
#  The payout trick that keeps this dependency-free: the node
#  itself BUILDS the transaction. simulateTransaction accepts
#  a JSON transaction with doGasSelection enabled, resolves
#  gas coins, price and budget, and answers with the fully
#  built TransactionData BCS — the caller only signs those
#  bytes and hands them to executeTransaction. No client-side
#  BCS serialization anywhere.
#
#  GraphQL is stateless HTTP: every call is an independent
#  request, one instance per network, a timeout so a hung
#  endpoint can't wedge a Flask worker, and GraphQL-level
#  errors raised as RuntimeError.
#
#  Used by:
#    - move_faucet.py — one long-lived instance per network,
#      created at startup (MoveFaucet.__init__)
############################################################


import time
import logging

import requests


# HTTP timeout — a hung endpoint fails the request instead of
# wedging a Flask worker
SUI_TIMEOUT_S = 20

# Some RPC providers filter the default python-requests agent
SUI_USER_AGENT = 'knf-faucet'








############################################################
# SuiGraphqlClient
############################################################
#
# The client itself; see the file header for the full story.
# Public surface: request(), get_chain_identifier(),
# get_balance(), build_transfer(), execute().
#
# Used by:
#   - move_faucet.py — MoveFaucet keeps one per network
############################################################

class SuiGraphqlClient:






    ############################################################
    # __init__
    ############################################################
    #
    # endpoint is the config's rpc_url (already resolved from
    # its <ENV_NAME> template). label only feeds the debug
    # timing line.
    #
    # Used by:
    #   - move_faucet.py — MoveFaucet.__init__, one per
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
            'User-Agent': SUI_USER_AGENT,
        })






    ############################################################
    # request
    ############################################################
    #
    # One GraphQL request. The node ANSWERING with errors is a
    # RuntimeError (a retry would only ask the same question
    # again). A CONNECTION failure retries once — a pooled
    # keep-alive the server dropped while idle fails exactly
    # one send, and the pool dials fresh for the retry; safe
    # even for a broadcast, because re-executing the same
    # signed transaction bytes is idempotent (same digest).
    # Every other transport failure propagates as the requests
    # exception it already is, so the caller can decide. The
    # timing print only fires with APP_DEBUG on.
    #
    # Used by:
    #   - every query method below
    ############################################################

    def request(self, query: str, variables: dict = None):
        if not self.endpoint:
            raise ValueError('Sui GraphQL endpoint not configured')

        start_time = time.time()
        try:
            response = self.session.post(
                self.endpoint,
                json={'query': query, 'variables': variables or {}},
                timeout=SUI_TIMEOUT_S,
            )
        except requests.ConnectionError:
            response = self.session.post(
                self.endpoint,
                json={'query': query, 'variables': variables or {}},
                timeout=SUI_TIMEOUT_S,
            )
        response.raise_for_status()
        answer = response.json()

        elapsed_time = time.time() - start_time
        if self.debug:
            print(f"[DEBUG] Sui GraphQL request took {elapsed_time:.3f}s (network: {self.label})")

        if answer.get('errors'):
            raise RuntimeError(f"Sui GraphQL error: {answer['errors']}")

        if 'data' not in answer:
            raise ValueError('Unexpected Sui GraphQL response format')

        return answer['data']






    ############################################################
    # get_chain_identifier
    ############################################################
    #
    # The chain's genesis-derived identifier — used as the
    # startup health probe, so a dead endpoint screams in the
    # console before the first student arrives.
    #
    # Used by:
    #   - move_faucet.py — _warm_up_networks
    ############################################################

    def get_chain_identifier(self) -> str:
        data = self.request('{ chainIdentifier }')
        return data['chainIdentifier']






    ############################################################
    # get_balance
    ############################################################
    #
    # One address' balance in MIST (the caller converts — the
    # decimals are a chain fact, see chains/). An address the
    # chain has never seen answers null, which reads as 0.
    #
    # Used by:
    #   - move_faucet.py — the faucet's own balance and the
    #     student's eligibility check
    ############################################################

    def get_balance(self, address: str, coin_type: str) -> int:
        data = self.request(
            'query($a: SuiAddress!, $t: String!) {'
            '  address(address: $a) { balance(coinType: $t) { totalBalance } } }',
            {'a': address, 't': coin_type},
        )
        balance = (data.get('address') or {}).get('balance') or {}
        return int(balance.get('totalBalance') or 0)






    ############################################################
    # build_transfer
    ############################################################
    #
    # Ask the NODE to build one chunk-sized transfer: a JSON
    # ProgrammableTransaction (SplitCoins from the gas coin +
    # TransferObjects to the recipient — the same shape Sui's
    # own faucet uses) goes into simulateTransaction with
    # doGasSelection, and the resolved, ready-to-sign
    # TransactionData BCS comes back base64-encoded. A payout
    # is therefore always built fresh at claim time, against
    # the gas coins the node picked that second.
    #
    # Used by:
    #   - move_faucet.py — request_move, inside the send lock
    ############################################################

    def build_transfer(self, sender: str, recipient_bytes_b64: str, amount_b64: str) -> str:
        transaction = {
            'kind': {'kind': 'PROGRAMMABLE_TRANSACTION', 'programmableTransaction': {
                'inputs': [
                    {'kind': 'PURE', 'pure': amount_b64},
                    {'kind': 'PURE', 'pure': recipient_bytes_b64},
                ],
                'commands': [
                    {'splitCoins': {'coin': {'kind': 'GAS'},
                                    'amounts': [{'kind': 'INPUT', 'input': 0}]}},
                    {'transferObjects': {'objects': [{'kind': 'RESULT', 'result': 0, 'subresult': 0}],
                                         'address': {'kind': 'INPUT', 'input': 1}}},
                ],
            }},
            'sender': sender,
            'expiration': {'kind': 'NONE'},
        }

        data = self.request(
            'query($tx: JSON!) { simulateTransaction(transaction: $tx, doGasSelection: true) {'
            '  effects { status executionError { message } transaction { transactionBcs } } } }',
            {'tx': transaction},
        )
        effects = data['simulateTransaction']['effects']
        if effects['status'] != 'SUCCESS':
            error = (effects.get('executionError') or {}).get('message', 'unknown')
            raise RuntimeError(f"Sui transaction simulation failed: {error}")

        return effects['transaction']['transactionBcs']






    ############################################################
    # execute
    ############################################################
    #
    # Broadcasts the signed transaction and returns its digest
    # (which IS the transaction id on Sui). A non-SUCCESS
    # execution raises with the chain's own error message.
    #
    # Used by:
    #   - move_faucet.py — the payout broadcast
    ############################################################

    def execute(self, tx_bcs_b64: str, signature_b64: str) -> str:
        data = self.request(
            'mutation($bcs: Base64!, $sigs: [Base64!]!) {'
            '  executeTransaction(transactionDataBcs: $bcs, signatures: $sigs) {'
            '    effects { status executionError { message } digest } } }',
            {'bcs': tx_bcs_b64, 'sigs': [signature_b64]},
        )
        effects = data['executeTransaction']['effects']
        if effects['status'] != 'SUCCESS':
            error = (effects.get('executionError') or {}).get('message', 'unknown')
            raise RuntimeError(f"Sui transaction failed: {error}")

        return effects['digest']
