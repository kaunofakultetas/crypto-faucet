############################################################
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
#    3. A plain value transfer is handed to web3's sign-and-
#       send middleware, which fills the pending nonce and
#       chain id, signs with the faucet key (shared with the
#       UTXO faucet) and broadcasts.
#
#  Built for classroom load: the polled faucet balance is
#  cached for a few seconds, payouts are serialized per
#  network (nonces are per chain — different chains never
#  contend), and every chain is warmed up at startup with a
#  console report — including a chain-id check that catches a
#  wrong RPC URL before the frontend and the faucet drift
#  onto different chains.
#
#  The transaction-graph scraper that used to live here is
#  explorer.py's EtherscanExplorer — a separate feature, a
#  separate class.
#
#  Used by:
#    - evm_routes.py — the Flask endpoints under /api/evm/*
#    - erc20_faucet.py — borrows the connections, signature
#      check and per-network send locks
############################################################


import os
import re
import time
import logging
import threading

from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct

from ..cooldown import CooldownTable
from ..icons import icon_url

# web3 v7 renamed this middleware — accept either name so an
# image upgrade doesn't break payouts
try:
    from web3.middleware import construct_sign_and_send_raw_middleware
except ImportError:
    from web3.middleware import SignAndSendRawMiddlewareBuilder
    construct_sign_and_send_raw_middleware = SignAndSendRawMiddlewareBuilder.build


# How long a polled faucet balance is served from cache. The page
# polls every few seconds per open browser tab; payouts drop the
# cached entry, so a claim shows up immediately regardless.
BALANCE_CACHE_TTL = 10

# Seconds one address must wait between payouts on one network
COOLDOWN_SECONDS = 60

# The network the picker preselects. A key of _CONFIG/coins.py's
# EVM map — when the operator drops that network, get_networks
# falls back to the lowest picker id instead.
DEFAULT_NETWORK = 'sepolia'








############################################################
# EVMFaucet
############################################################
#
# One instance serves every configured network. Methods in
# groups:
#
#   setup   — __init__, _warm_up_networks
#   locks   — send_lock_for
#   queries — _faucet_balance
#   faucet  — is_supported_network, verify_signature,
#             request_eth, get_faucet_balance, get_networks
#
# The transaction-graph scraper that used to live here is
# explorer.py's EtherscanExplorer now.
#
# Used by:
#   - evm_routes.py — one shared instance for all handlers
#   - erc20_faucet.py — the ERC-20 faucet is composed with
#     this instance
############################################################

class EVMFaucet:






    ############################################################
    # __init__
    ############################################################
    #
    # Wires one faucet for every configured network: a Web3
    # instance per network from the config's faucet.rpc_url —
    # each carrying the sign-and-send middleware, so a payout
    # is one w3.eth.send_transaction call — the shared faucet
    # key normalized to 0x + 64 hex characters, and the
    # in-memory cooldown table. network_configs is main.py's
    # EVM_NETWORK_CONFIGS — sectioned into top-level identity
    # plus 'faucet', 'metamask' and 'explorer' parts.
    #
    # Used by:
    #   - evm_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, network_configs):
        self.APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == "true"

        self.NETWORK_CONFIGS = network_configs

        # Same private key as the UTXO faucet, so one funded identity
        # covers every chain the site offers. Normalize to a 0x-prefixed,
        # 66-character hex string — zfill pads on the LEFT, because a
        # short key means stripped leading zeros; padding the right
        # would silently become a different wallet. A missing key
        # leaves the account as None and every payout path answers
        # with a configuration error instead of crashing the import.
        self.FAUCET_PRIVATE_KEY = os.getenv('FAUCET_PRIVATE_KEY')
        if self.FAUCET_PRIVATE_KEY:
            self.FAUCET_PRIVATE_KEY = "0x" + self.FAUCET_PRIVATE_KEY.replace("0x", "").zfill(64)

        try:
            self.FAUCET_ACCOUNT = Account.from_key(self.FAUCET_PRIVATE_KEY) if self.FAUCET_PRIVATE_KEY else None
        except Exception:
            self.FAUCET_ACCOUNT = None
        self.FAUCET_ADDRESS = self.FAUCET_ACCOUNT.address if self.FAUCET_ACCOUNT else None

        # One Web3 instance per network, created up front from the
        # config's faucet.rpc_url. <NAME> placeholders in the URL are
        # environment variable references, resolved here and only
        # here — the config file itself never holds the Infura key.
        # The sign-and-send middleware turns every
        # eth_sendTransaction from the faucet address into: fill the
        # PENDING nonce and chain id, sign locally, broadcast raw —
        # no payout path builds or signs transactions by hand.
        self.w3_instances = {}
        for network in self.NETWORK_CONFIGS:
            rpc_url_template = self.NETWORK_CONFIGS[network]['faucet']['rpc_url']
            rpc_url = re.sub(r'<(\w+)>', lambda m: os.getenv(m.group(1), ''), rpc_url_template)

            # 10s timeout so a dead RPC endpoint fails the request
            # instead of hanging the Flask worker.
            request_kwargs = {
                'timeout': 10
            }
            w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs=request_kwargs))
            if self.FAUCET_ACCOUNT:
                w3.middleware_onion.add(construct_sign_and_send_raw_middleware(self.FAUCET_ACCOUNT))
            self.w3_instances[network] = w3

        # Per-(network, address) cooldown between payouts — the slot
        # is claimed atomically before the payout work and released
        # on failure (see app/cooldown.py for the in-memory
        # trade-offs).
        self.cooldowns = CooldownTable(COOLDOWN_SECONDS)

        # network -> the lock serializing that chain's payouts, native
        # AND ERC-20 (same wallet, same per-chain nonce sequence — see
        # send_lock_for). Per network on purpose: a Sepolia payout has
        # no business blocking a Hoodi one.
        self._send_locks = {}

        # network -> (unix time, balance in whole ETH) for the polled
        # faucet balance — see _faucet_balance. Pre-filled by the
        # warmup below.
        self._balance_cache = {}

        self._warm_up_networks()






    ############################################################
    # _warm_up_networks
    ############################################################
    #
    # The startup warmup, one thread per network so the
    # slowest RPC bounds the wall time: ask every chain for
    # its chain id and compare it against the config — a
    # mismatch means the frontend (which trusts the config)
    # and the faucet (which pays over the RPC) would operate
    # on DIFFERENT chains, so it screams instead of counting
    # as ready. Then the faucet balance is pre-fetched into
    # the cache, so the first page load answers instantly.
    # Success and failure both go to the console; a failed
    # network does NOT kill the app — the other networks and
    # faucets keep serving.
    #
    # Used by:
    #   - __init__ (above)
    ############################################################

    def _warm_up_networks(self):

        def warm(network, w3):
            try:
                actual_chain_id = int(w3.eth.chain_id)
                expected_chain_id = self.NETWORK_CONFIGS[network].get('chain_id')
                if actual_chain_id != expected_chain_id:
                    logging.error(
                        f"[EVM] {network} CHAIN ID MISMATCH — config says {expected_chain_id}, "
                        f"the RPC answers {actual_chain_id}; check faucet.rpc_url"
                    )
                    return

                if self.FAUCET_ADDRESS:
                    balance_eth = float(w3.from_wei(w3.eth.get_balance(self.FAUCET_ADDRESS), 'ether'))
                    self._balance_cache[network] = (int(time.time()), balance_eth)
                    print(f"[EVM] {network} ready — chain id {actual_chain_id}, faucet balance {balance_eth:.4f}")
                else:
                    print(f"[EVM] {network} connected (chain id {actual_chain_id}) — but NO FAUCET KEY is configured, payouts will fail")
            except Exception:
                logging.exception(f"[EVM] {network} FAILED to warm up")

        threads = [
            threading.Thread(target=warm, args=(network, w3), name=f'evm-warmup-{network}')
            for network, w3 in self.w3_instances.items()
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()






    ############################################################
    # is_supported_network
    ############################################################
    #
    # Used by:
    #   - request_eth / get_faucet_balance (below)
    ############################################################

    def is_supported_network(self, network):
        return network in self.NETWORK_CONFIGS






    ############################################################
    # verify_signature
    ############################################################
    #
    # Recovers the signer from an EIP-191 personal_sign
    # signature and checks it matches the address asking for
    # coins — proves the requester actually controls that
    # wallet. Any decoding hiccup counts as "not verified".
    #
    # Used by:
    #   - request_eth (below)
    ############################################################

    def verify_signature(self, network, address, message, signature):
        w3 = self.w3_instances[network]
        try:
            message_hash = encode_defunct(text=message)
            signer = w3.eth.account.recover_message(message_hash, signature=signature)
            return signer.lower() == (address or '').lower()
        except Exception:
            return False






    ############################################################
    # send_lock_for
    ############################################################
    #
    # The lock serializing one network's payouts. Shared BY
    # DESIGN with the ERC-20 faucet: native and token payouts
    # spend from the same wallet, so on any one chain they
    # must take turns reading the pending nonce. setdefault is
    # atomic under the GIL, so no extra locking here.
    #
    # Used by:
    #   - request_eth (below)
    #   - erc20_faucet.py — request_tokens
    ############################################################

    def send_lock_for(self, network):
        return self._send_locks.setdefault(network, threading.Lock())






    ############################################################
    # _faucet_balance
    ############################################################
    #
    # The faucet's balance on one chain in whole ETH, cached
    # for BALANCE_CACHE_TTL seconds — the frontend polls it
    # every few seconds per open browser tab, and a classroom
    # of open tabs would otherwise burn an Infura call per
    # poll. request_eth drops the entry after a payout, so the
    # next poll shows the new number immediately.
    #
    # Used by:
    #   - get_faucet_balance (below)
    #   - _warm_up_networks (above) — pre-fills it
    ############################################################

    def _faucet_balance(self, network):
        cached = self._balance_cache.get(network)
        if cached and int(time.time()) - cached[0] < BALANCE_CACHE_TTL:
            return cached[1]

        w3 = self.w3_instances[network]
        balance_eth = float(w3.from_wei(w3.eth.get_balance(self.FAUCET_ADDRESS), 'ether'))
        self._balance_cache[network] = (int(time.time()), balance_eth)
        return balance_eth






    ############################################################
    # request_eth
    ############################################################
    #
    # The actual payout: validate everything, then broadcast
    # one chunk-sized value transfer. Sends are serialized and
    # the nonce counts pending transactions, so a whole class
    # claiming at once can't collide on the same nonce. Returns
    # a (payload, http_status) tuple; user-facing errors are
    # Lithuanian.
    #
    # Used by:
    #   - evm_routes.py — GET /api/evm/<network>/request
    ############################################################

    def request_eth(self, network, to_address, signature, nonce):
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400

        if not self.FAUCET_ADDRESS:
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        w3 = self.w3_instances[network]

        amount_to_send = self.NETWORK_CONFIGS[network]['faucet']['chunk_size']
        amount_to_send_wei = Web3.to_wei(float(amount_to_send), 'ether')


        # STEP 1: input validation — all parameters present and the
        # address parses
        # =========================================================
        if not all([to_address, signature, nonce]):
            return {"error": "Trūksta reikalingų parametrų"}, 400

        try:
            to_address = w3.to_checksum_address(to_address)
        except Exception:
            return {"error": "Neteisingas adresas"}, 400

        if not w3.is_address(to_address):
            return {"error": "Neteisingas adresas"}, 400


        # STEP 2: signature check. This is the exact message the
        # frontend asks MetaMask to sign — any mismatch (different
        # nonce, different wording) fails recovery.
        # ========================================================
        message = f"Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}"
        if not self.verify_signature(network, to_address, message, signature):
            return {"error": "Kriptografinis parašas kažkodėl neatitinka"}, 403


        # STEP 3: eligibility — no top-up if the wallet already holds
        # a full chunk, the per-address cooldown slot must be free,
        # and the faucet itself must still have coins.
        # ===========================================================
        try:
            user_balance = w3.eth.get_balance(to_address)
        except Exception:
            return {"error": "Nepavyko gauti naudotojo balanso"}, 500

        if user_balance >= amount_to_send_wei:
            return {"error": f"Jūsų piniginėje jau yra pakankamai {self.NETWORK_CONFIGS[network]['faucet']['short_name']}."}, 400

        # The cooldown slot is check-and-CLAIMED atomically, per
        # (network, address) — claiming on one chain doesn't lock the
        # same wallet out of the others, and two parallel requests
        # from the same address can't both pass the check and get
        # paid twice. Every failure path below releases the slot.
        cooldown_key = (network, to_address.lower())
        remaining = self.cooldowns.claim(cooldown_key)
        if remaining:
            return {"error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {remaining} sek."}, 429

        try:
            faucet_balance = w3.eth.get_balance(self.FAUCET_ADDRESS)
        except Exception:
            self.cooldowns.release(cooldown_key)
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500

        if faucet_balance < amount_to_send_wei:
            self.cooldowns.release(cooldown_key)
            return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503


        # STEP 4: broadcast — under the network's send lock, so two
        # concurrent claims can't get filled with the same pending
        # nonce. The sign-and-send middleware (attached in __init__)
        # fills the nonce and chain id, signs and broadcasts.
        # gasPrice is passed explicitly to force a LEGACY transaction
        # — several of the configured testnets have spotty EIP-1559
        # support. The generous gas limit costs nothing, unused gas
        # is refunded.
        # ===========================================================
        try:
            with self.send_lock_for(network):
                tx_hash = w3.eth.send_transaction({
                    'from': self.FAUCET_ADDRESS,
                    'to': to_address,
                    'value': int(amount_to_send_wei),
                    'gas': 210000,
                    'gasPrice': w3.eth.gas_price,
                })
        except Exception:
            logging.exception(f"Failed to broadcast {network} payout")
            self.cooldowns.release(cooldown_key)
            return {"error": "Nepavyko išsiųsti transakcijos. Bandykite dar kartą."}, 500

        # Success — the cooldown slot claimed above stays, and the
        # cached balance is dropped so the page shows the payout on
        # its next poll.
        self._balance_cache.pop(network, None)

        return {
            "message": "ETH sent successfully",
            "transaction_hash": tx_hash.hex(),
            "amount": float(w3.from_wei(amount_to_send_wei, 'ether'))
        }, 200






    ############################################################
    # get_faucet_balance
    ############################################################
    #
    # The faucet wallet's balance, address and chunk size — the
    # UI shows it, and it's the operator's way to notice the
    # faucet needs a top-up. Served from the balance cache. The
    # old per-poll is_connected() probe is gone — it cost an
    # extra RPC call on every poll, and a dead endpoint fails
    # the balance call itself anyway.
    #
    # Used by:
    #   - evm_routes.py — GET /api/evm/<network>/faucet-balance
    ############################################################

    def get_faucet_balance(self, network):
        if not self.is_supported_network(network):
            return {"error": f"Unsupported network: {network}"}, 400

        if not self.FAUCET_ADDRESS:
            logging.error("FAUCET_ADDRESS is None or empty")
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        try:
            balance_eth = self._faucet_balance(network)
        except Exception:
            logging.exception(f"Failed to get faucet balance for network {network}")
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500

        return {
            "balance": balance_eth,
            "address": self.FAUCET_ADDRESS.lower(),
            "chunk_size": float(self.NETWORK_CONFIGS[network]['faucet']['chunk_size'])
        }, 200






    ############################################################
    # get_networks
    ############################################################
    #
    # Everything the frontend needs to render the network
    # picker and feed MetaMask's wallet_addEthereumChain, plus
    # which network to preselect. Deliberately COMPOSED, not a
    # raw config dump: the backend-only sections (faucet RPC
    # template, explorer API) stay out of the public payload.
    # icon is the /api/icons/... URL when an icon file exists
    # in the mounted config dir, else None (see app/icons.py).
    # The preselected network is DEFAULT_NETWORK, or — when
    # that key is not configured — the lowest picker id, which
    # is the first entry the picker lists.
    #
    # Used by:
    #   - evm_routes.py — GET /api/evm/networks
    ############################################################

    def get_networks(self):
        networks = {}
        for key, config in self.NETWORK_CONFIGS.items():
            faucet = config.get('faucet', {})
            metamask = config.get('metamask', {})
            networks[key] = {
                'id': config.get('id', 0),
                'chain_id': config.get('chain_id'),
                # The UI's names (faucet section) and the name
                # MetaMask stores (metamask section) travel
                # separately — editing one never changes the other
                'short_name': faucet.get('short_name', ''),
                'full_name': faucet.get('full_name', key),
                'icon': icon_url('evm', key),
                'chain_name': metamask.get('chain_name', faucet.get('full_name', key)),
                'native_currency': metamask.get('native_currency'),
                'rpc_urls': metamask.get('rpc_urls', []),
                'block_explorer_urls': metamask.get('block_explorer_urls', []),
            }

        default_key = DEFAULT_NETWORK if DEFAULT_NETWORK in networks else min(
            networks, key=lambda key: networks[key]['id'], default=None)

        return {
            "networks": networks,
            "default_network": default_key
        }
