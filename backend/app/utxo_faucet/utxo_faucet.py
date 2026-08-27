############################################################
#  [*] UTXO Faucet
#
#  A minimal faucet for UTXO-based chains (Bitcoin, Litecoin
#  and the custom KNF coin), each in testnet / regtest /
#  mainnet flavours. It talks directly to an Electrum server
#  (ElectrumX) over SSL JSON-RPC — no local wallet files, no
#  bitcoind RPC. The protocol work lives in electrum_client.py
#  (ElectrumClient); this file holds the faucet logic.
#
#  How a payout works, end to end:
#
#    1. The faucet key (shared with the EVM faucet, an
#       Ethereum-style hex key) is converted into a Bitcoin
#       key and turned into the network's address flavour by
#       its DIALECT object (dialects/): native SegWit
#       (p2wpkh, bech32) on chains that have it, classic
#       base58 p2pkh on legacy chains that never activated
#       SegWit (Dogecoin). Which dialect a network speaks —
#       and every precise constant behind it — comes from the
#       in-code coin registry (coins/), keyed by the config's
#       coin + network flavour, resolved once at startup.
#    2. UTXOs and balances are fetched from the Electrum
#       server for that address' scripthash.
#    3. A transaction is built with embit and signed by the
#       dialect (BIP-143 witnesses vs legacy scriptSig).
#       ONE builder for every chain, KNF included — every
#       format difference lives behind the dialect's five
#       methods, and embit takes network params as plain data
#       instead of validating against a chain registry (the
#       reason the previous engines needed a hand-rolled KNF
#       path).
#    4. The raw transaction is broadcast through the same
#       Electrum connection.
#
#  Built for classroom load: every request still gets its own
#  NetworkContext, but the heavy pieces behind it are shared
#  and guarded — ONE long-lived, self-reconnecting
#  ElectrumClient per network, a short-TTL cache for the
#  polled faucet balance, and a per-network payout lock so two
#  simultaneous claims can't select (and try to double-spend)
#  the same UTXOs.
#
#  Everything is prepared EAGERLY at startup — clients built,
#  connections opened, balances pre-fetched — so a dead
#  server or a typoed endpoint screams in the console before
#  the first student arrives. A network that fails to warm up
#  does not kill the app (the other faucets keep serving);
#  its client simply self-heals on first use.
#
#  Used by:
#    - utxo_routes.py — the Flask endpoints under /api/utxo/*
############################################################


import os
import time
import hashlib
import logging
import threading

from embit import ec as embit_ec
from embit.transaction import Transaction, TransactionInput, TransactionOutput

from .coins import coin_params
from .dialects import dialect_for
from .electrum_client import ElectrumClient
from ..cooldown import CooldownTable
from ..icons import icon_url


# How long a polled faucet balance is served from cache. The page
# polls every few seconds per open browser tab; payouts drop the
# cached entry, so a claim shows up immediately regardless.
BALANCE_CACHE_TTL = 10

# Seconds one address must wait between payouts on one network
COOLDOWN_SECONDS = 60

# The network the picker preselects. A key of _CONFIG/coins.py's
# UTXO map — when the operator drops that network, get_networks
# falls back to the lowest picker id instead.
DEFAULT_NETWORK = 'btc4'




############################################################
# _electrum_scripthash
############################################################
#
# The Electrum protocol's script identifier: sha256 of the
# scriptPubKey, reversed, hex — the same formula for every
# dialect.
#
# Used by:
#   - UTXOFaucet — warmup and per-request identity
############################################################

def _electrum_scripthash(script) -> str:
    return hashlib.sha256(script.data).digest()[::-1].hex()








############################################################
# NetworkContext
############################################################
#
# Everything a single faucet request needs to know about the
# network it operates on: the faucet identity plus pointers to
# the network's SHARED pieces (the long-lived ElectrumClient).
# A fresh instance is still built per request — it's cheap,
# and no request ever mutates another's view; everything
# shared underneath carries its own lock.
#
# Used by:
#   - UTXOFaucet (below) — built in
#     _setup_wallet_for_network, threaded through everything
############################################################

class NetworkContext:




    ############################################################
    # __init__
    ############################################################
    #
    # Plain fields only — the values are filled in by
    # _setup_wallet_for_network; the per-field comments below
    # are the contract.
    #
    # Used by:
    #   - UTXOFaucet._setup_wallet_for_network (below)
    ############################################################

    def __init__(self):
        self.network_key = None     # config key: 'btc4', 'ltc4', 'knf', ...
        self.dialect = None         # the network's SHARED address-dialect object (dialects/)
        self.key = None             # embit PrivateKey holding the faucet key
        self.script_pubkey = None   # the faucet's own script on this network (from the dialect)
        self.address = None         # faucet address on this network (bech32 or base58)
        self.scripthash = None      # Electrum scripthash of that script
        self.electrum = None        # the network's SHARED ElectrumClient — never closed here
        self.chunk_size_btc = None  # payout size for this network, in coins
        self.fee_rate = None        # sat/vB — per-network config override or the global default
        self.dust_limit = None      # sats below which change is left to the miners








############################################################
# UTXOFaucet
############################################################
#
# One instance serves every configured network; per-request
# state lives in NetworkContext. Methods in groups:
#
#   setup       — __init__, _warm_up_networks
#   keys        — _convert_ethereum_key_to_bitcoin,
#                 _faucet_scripthash_for
#   resolution  — _setup_wallet_for_network
#   queries     — _faucet_balance
#   building    — _estimate_fee,
#                 _create_and_broadcast_transaction
#   validation  — _validate_address
#   public API  — get_networks, get_faucet_balance,
#                 request_crypto
#
# All Electrum protocol work lives in electrum_client.py:
# one long-lived, self-reconnecting ElectrumClient per
# network, shared by every request. Payouts are serialized
# per network and the polled faucet balance is cached for a
# few seconds.
#
# Used by:
#   - utxo_routes.py — one shared instance for all handlers
############################################################

class UTXOFaucet:






    ############################################################
    # __init__
    ############################################################
    #
    # EVERYTHING is prepared here, at startup: configuration,
    # the cooldown table, the faucet identity, and one
    # ElectrumClient per configured network — then
    # _warm_up_networks opens every connection and pre-fetches
    # every balance, so misconfiguration is visible in the
    # console immediately, not on the first student's claim.
    #
    # Used by:
    #   - utxo_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, network_configs: dict):
        # Per-network settings from main.py's UTXO_NETWORK_CONFIGS —
        # identity at the top level, payout/connection settings under
        # each entry's 'faucet' section.
        self.network_configs = network_configs or {}

        # Same private key as the EVM faucet, so one funded identity
        # covers every chain the site offers.
        self.faucet_private_key = os.getenv('FAUCET_PRIVATE_KEY')
        self.default_amount_btc = float(os.getenv('DEFAULT_WALLET_BTC_AMOUNT', '0.001'))
        self.app_debug = os.getenv('APP_DEBUG', 'false').lower() == 'true'

        # Per-(network, address) cooldown between payouts (matches
        # the EVM faucet's keying) — the slot is claimed atomically
        # before the payout work and released on failure (see
        # app/cooldown.py for the in-memory trade-offs).
        self.cooldowns = CooldownTable(COOLDOWN_SECONDS)

        # The faucet identity is the same KEY on every chain; how it
        # becomes a script and an address is each network's dialect's
        # business (resolved below). A missing or broken key leaves
        # this None and every payout path answers with a config
        # error instead of crashing the import (the same pattern
        # EVMFaucet uses).
        self.faucet_key = None
        if self.faucet_private_key:
            try:
                self.faucet_key = embit_ec.PrivateKey(self._convert_ethereum_key_to_bitcoin(self.faucet_private_key))
            except Exception:
                logging.exception("Invalid FAUCET_PRIVATE_KEY for the UTXO faucet")

        # network_key -> the coin's protocol params and its address
        # dialect, both resolved ONCE at startup: the operator's
        # config names a coin and a network flavour; the in-code
        # registry (coins/) supplies the precise facts — address
        # version bytes / bech32 HRP, fee rate, dust limit — and the
        # dialect object built from them answers every format
        # question the payout path asks.
        self._coin_params = {}
        self._dialects = {}
        for network_key, config in self.network_configs.items():
            faucet_config = config.get('faucet', {})
            params = coin_params(faucet_config.get('coin', ''), faucet_config.get('network', ''))
            self._coin_params[network_key] = params
            self._dialects[network_key] = dialect_for(params)

        # network_key -> the lock serializing that chain's payouts:
        # two concurrent claims would otherwise select the same UTXOs
        # and race to double-spend them (the same discipline as
        # EVMFaucet.send_lock, but per chain — different chains never
        # contend).
        self._send_locks = {}

        # network_key -> (unix time, balance dict) for the polled
        # faucet balance — see _faucet_balance. Pre-filled by the
        # warmup below.
        self._balance_cache = {}

        # network_key -> its long-lived ElectrumClient. Built for
        # EVERY configured network right here — nothing is lazy —
        # then connected and warmed by _warm_up_networks, so a dead
        # endpoint fails the console at startup instead of failing
        # the first student.
        self._electrum_clients = {}
        for network_key, config in self.network_configs.items():
            self._electrum_clients[network_key] = ElectrumClient(
                config.get('faucet', {}).get('electrum_server', ''),
                debug=self.app_debug,
                label=network_key,
            )

        self._warm_up_networks()






    ############################################################
    # _warm_up_networks
    ############################################################
    #
    # The startup warmup, one thread per network so the
    # slowest server bounds the wall time: open every Electrum
    # connection and fetch the faucet balance (which also
    # primes the balance cache — the first page load answers
    # instantly). Success and failure both go to the console.
    # A failed network deliberately does NOT raise: the rest
    # of the backend (EVM faucets included) keeps serving, and
    # the failed client reconnects by itself on first use.
    #
    # Used by:
    #   - __init__ (above)
    ############################################################

    def _warm_up_networks(self):

        def warm(network_key, client):
            try:
                client.connect()

                scripthash = self._faucet_scripthash_for(network_key)
                if scripthash:
                    balance = client.get_balance(scripthash)
                    self._balance_cache[network_key] = (int(time.time()), balance)
                    print(f"[UTXO] {network_key} ready — faucet balance {balance['confirmed']} confirmed")
                else:
                    print(f"[UTXO] {network_key} connected — but NO FAUCET KEY is configured, payouts will fail")
            except Exception:
                logging.exception(f"[UTXO] {network_key} FAILED to warm up (endpoint: {client.host}:{client.port})")

        threads = [
            threading.Thread(target=warm, args=(key, client), name=f'utxo-warmup-{key}')
            for key, client in self._electrum_clients.items()
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()






    ############################################################
    # _convert_ethereum_key_to_bitcoin
    ############################################################
    #
    # Both key types are 32-byte secp256k1 scalars, so the same
    # hex material works on both sides — only the encoding
    # differs. Accepts '0x'-prefixed and bare hex. zfill pads
    # on the LEFT (a short key means stripped leading zeros) —
    # the exact same normalization the EVM faucet applies, so
    # both sides always derive the same identity from the
    # shared key.
    #
    # Used by:
    #   - _setup_wallet_for_network (below)
    ############################################################

    def _convert_ethereum_key_to_bitcoin(self, eth_private_key: str) -> bytes:
        hex_key = eth_private_key.replace("0x", "")
        hex_key = hex_key.zfill(64)
        hex_key = hex_key[:64]

        return bytes.fromhex(hex_key)






    ############################################################
    # _faucet_scripthash_for
    ############################################################
    #
    # The faucet's Electrum scripthash on one network — the
    # dialect's script for our key, hashed the Electrum way.
    # None when no faucet key is configured.
    #
    # Used by:
    #   - _warm_up_networks (above)
    ############################################################

    def _faucet_scripthash_for(self, network_key: str):
        if not self.faucet_key:
            return None

        script = self._dialects[network_key].faucet_script(self.faucet_key.get_public_key())
        return _electrum_scripthash(script)






    ############################################################
    # _setup_wallet_for_network
    ############################################################
    #
    # Builds the per-request NetworkContext: resolves the
    # network and points the context at the SHARED pieces —
    # the pre-derived faucet identity and the network's
    # long-lived ElectrumClient (created on first use; it
    # connects itself lazily inside request()).
    #
    # Used by:
    #   - get_faucet_balance / request_crypto (below)
    ############################################################

    def _setup_wallet_for_network(self, network_key: str) -> NetworkContext:
        ctx = NetworkContext()
        ctx.network_key = network_key


        # STEP 1: resolve the network from the config's faucet
        # section (payout + connection settings live there). The
        # network IS just its address params here — embit has no
        # chain registry to satisfy, so KNF needs nothing special.
        # ==========================================================
        config = self.network_configs.get(network_key)
        if not config:
            raise ValueError(f'Unknown UTXO network: {network_key}')
        faucet_config = config.get('faucet', {})


        # STEP 2: the network's long-lived Electrum client — created
        # and connected at startup, shared by every request.
        # ==========================================================
        ctx.electrum = self._electrum_clients[network_key]


        # STEP 3: the faucet identity on this chain — the network's
        # dialect turns the shared key into the script, address and
        # Electrum scripthash it has here.
        # =========================================================
        if not self.faucet_key:
            raise ValueError('Faucet private key not configured')

        ctx.key = self.faucet_key
        ctx.dialect = self._dialects[network_key]

        pub = self.faucet_key.get_public_key()
        ctx.script_pubkey = ctx.dialect.faucet_script(pub)
        ctx.scripthash = _electrum_scripthash(ctx.script_pubkey)
        ctx.address = ctx.dialect.faucet_address(pub)

        ctx.chunk_size_btc = float(faucet_config.get('chunk_size', self.default_amount_btc))

        # Relay economics are the COIN's facts, from the registry
        params = self._coin_params[network_key]
        ctx.fee_rate = params['fee_rate']
        ctx.dust_limit = params['dust_limit']

        return ctx






    ############################################################
    # _faucet_balance
    ############################################################
    #
    # The faucet's balance on one chain, cached for
    # BALANCE_CACHE_TTL seconds — the frontend polls it every
    # few seconds per open browser tab, and a classroom of
    # open tabs would otherwise turn every poll into an
    # Electrum round trip. request_crypto drops the entry
    # after a payout, so the next poll shows the new number
    # immediately.
    #
    # Used by:
    #   - get_faucet_balance / request_crypto (below)
    ############################################################

    def _faucet_balance(self, ctx: NetworkContext) -> dict:
        cached = self._balance_cache.get(ctx.network_key)
        if cached and int(time.time()) - cached[0] < BALANCE_CACHE_TTL:
            return cached[1]

        balance_info = ctx.electrum.get_balance(ctx.scripthash)
        self._balance_cache[ctx.network_key] = (int(time.time()), balance_info)
        return balance_info






    ############################################################
    # _estimate_fee
    ############################################################
    #
    # Conservative size estimate times the network's sat/vB
    # rate. The per-input/per-output sizes are the dialect's
    # constants (SegWit ~91/31 vbytes, legacy ~148/34 bytes);
    # the rate comes from the context — legacy chains like
    # Dogecoin need ~100x Bitcoin's rate to clear their relay
    # minimums.
    #
    # Used by:
    #   - _create_and_broadcast_transaction (below)
    ############################################################

    def _estimate_fee(self, ctx: NetworkContext, num_inputs: int, num_outputs: int) -> int:
        estimated_size = (num_inputs * ctx.dialect.INPUT_SIZE) + (num_outputs * ctx.dialect.OUTPUT_SIZE) + 10
        return estimated_size * ctx.fee_rate






    ############################################################
    # _create_and_broadcast_transaction
    ############################################################
    #
    # Builds, signs and broadcasts a payout with embit: ONE
    # code path for every chain. Every format difference — how
    # a recipient address becomes a scriptPubKey, which sighash
    # and unlocking format sign the inputs, the transaction
    # version — is the dialect's answer, not a branch here.
    # Signatures use deterministic RFC-6979 nonces.
    #
    # Used by:
    #   - request_crypto (below)
    ############################################################

    def _create_and_broadcast_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int) -> str:
        # STEP 1: what can we spend?
        # ==========================
        utxos = ctx.electrum.list_unspent(ctx.scripthash)
        if not utxos:
            raise ValueError("No UTXOs available")


        # STEP 2: greedy coin selection — the target includes the fee
        # for the inputs selected so far, so the change can never go
        # negative.
        # ===========================================================
        selected_utxos = []
        total_input = 0
        for utxo in utxos:
            selected_utxos.append(utxo)
            total_input += utxo['value']
            if total_input >= amount_sat + self._estimate_fee(ctx, len(selected_utxos), 2):
                break

        fee = self._estimate_fee(ctx, len(selected_utxos), 2)
        if total_input < amount_sat + fee:
            raise ValueError("Insufficient funds")

        change = total_input - amount_sat - fee


        # STEP 3: outputs. The dialect decodes the recipient (full
        # checksum check) into this chain's scriptPubKey flavour and
        # raises ValueError on anything that isn't valid here.
        # ===========================================================
        to_script = ctx.dialect.recipient_script(to_address)

        outputs = [TransactionOutput(amount_sat, to_script)]
        if change > ctx.dust_limit:
            outputs.append(TransactionOutput(change, ctx.script_pubkey))
        # sub-dust change is simply left to the miners as extra fee


        # STEP 4: build and sign. Electrum reports tx_hash in display
        # order — the wire format wants it reversed. The dialect owns
        # the transaction version and signs each input in place
        # (BIP-143 witness or legacy scriptSig).
        # ===========================================================
        tx = Transaction(
            version=ctx.dialect.TX_VERSION,
            vin=[TransactionInput(bytes.fromhex(u['tx_hash'])[::-1], u['tx_pos']) for u in selected_utxos],
            vout=outputs,
            locktime=0,
        )

        for i, utxo in enumerate(selected_utxos):
            ctx.dialect.sign_input(tx, i, ctx.key, ctx.script_pubkey, utxo['value'])


        # STEP 5: broadcast over the same Electrum connection.
        # ====================================================
        return ctx.electrum.request("blockchain.transaction.broadcast", [tx.serialize().hex()])






    ############################################################
    # _validate_address
    ############################################################
    #
    # The dialect's verdict on a recipient address — a cheap
    # HRP prefix check on SegWit chains (the full decode
    # happens at recipient_script), a full base58check decode
    # on legacy ones.
    #
    # Used by:
    #   - request_crypto (below)
    ############################################################

    def _validate_address(self, ctx: NetworkContext, address: str) -> bool:
        if not address:
            return False

        return ctx.dialect.validate_address(address)






    ############################################################
    # get_networks
    ############################################################
    #
    # Everything the frontend needs to render the network
    # picker. The preselected network is DEFAULT_NETWORK, or —
    # when that key is not configured — the lowest picker id,
    # which is the first entry the picker lists. chain_id is
    # always 0; the field only exists so the payload shape
    # matches the EVM faucet's.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/networks
    ############################################################

    def get_networks(self) -> dict:
        networks = {}
        for key, config in self.network_configs.items():
            faucet_config = config.get('faucet', {})
            networks[key] = {
                'id': config.get('id', 0),
                'short_name': config.get('short_name', 'BTC'),
                'full_name': config.get('full_name', key),
                'icon': icon_url('utxo', key),
                'chain_id': 0,  # not applicable for UTXO chains
                'chain': faucet_config.get('network', 'testnet'),
                'chunk_size': float(faucet_config.get('chunk_size')) if faucet_config.get('chunk_size') is not None else float(self.default_amount_btc),
            }

        default_key = DEFAULT_NETWORK if DEFAULT_NETWORK in networks else min(
            networks, key=lambda key: networks[key]['id'], default=None)

        return {
            'default_network': default_key,
            'networks': networks
        }






    ############################################################
    # get_faucet_balance
    ############################################################
    #
    # The faucet address and its confirmed / unconfirmed /
    # total balance. Returns (payload, http_status) — the
    # route just jsonify()s it. Failures log the real
    # exception and answer with a generic Lithuanian error.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/<network>/faucet-balance
    ############################################################

    def get_faucet_balance(self, network_key: str) -> tuple:
        try:
            ctx = self._setup_wallet_for_network(network_key)
            balance_info = self._faucet_balance(ctx)

            return {
                "balance": balance_info["total"],  # confirmed + unconfirmed
                "balance_confirmed": balance_info["confirmed"],
                "balance_unconfirmed": balance_info["unconfirmed"],
                "address": ctx.address,
                "chunk_size": float(ctx.chunk_size_btc or self.default_amount_btc)
            }, 200

        except Exception:
            logging.exception(f"Failed to get UTXO faucet balance for {network_key}")
            return {"error": "Nepavyko gauti čiaupo informacijos"}, 500






    ############################################################
    # request_crypto
    ############################################################
    #
    # The actual payout: validate the address, enforce the
    # cooldown, check the faucet balance and broadcast one
    # chunk to the student. Returns (payload, http_status);
    # user-facing errors in Lithuanian, with the raw exception
    # in 'details' for debugging.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/<network>/request-btc
    ############################################################

    def request_crypto(self, network_key: str, to_address: str) -> tuple:
        try:
            ctx = self._setup_wallet_for_network(network_key)


            # STEP 1: input validation — address present, right HRP for
            # this network, and not the faucet paying itself.
            # =========================================================
            if not to_address:
                return {"error": "Trūksta reikalingų parametrų"}, 400

            to_address = to_address.strip()

            if not self._validate_address(ctx, to_address):
                return {"error": "Neteisingas adresas"}, 400

            if to_address.lower() == ctx.address.lower():
                return {"error": "Negalima siųsti į čiaupo adresą"}, 400


            # STEP 2: the cooldown — per (network, address), so
            # claiming on one chain doesn't lock the others. The
            # slot is check-and-CLAIMED atomically before the payout
            # work — two parallel requests from the same address
            # would otherwise both pass a bare check, serialize
            # politely on the send lock and get paid twice. Every
            # failure path below releases the slot.
            # ======================================================
            if not ctx.chunk_size_btc or ctx.chunk_size_btc <= 0:
                return {"error": "chunk_size must be > 0 for this network"}, 500

            cooldown_key = (network_key, to_address.lower())
            remaining = self.cooldowns.claim(cooldown_key)
            if remaining:
                return {
                    "error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {remaining} sek."
                }, 429


            # STEP 3: does the faucet have the coins? The gate counts
            # CONFIRMED balance only — a conservative floor. The
            # selection itself spends unconfirmed change too; that is
            # what keeps a burst of claims flowing, up to the node's
            # ~25-deep unconfirmed-chain limit per block (accepted —
            # the next block clears it). The cached balance is fine
            # here: the UTXO selection inside the payout checks for
            # real. From here on every failure — balance shortage,
            # Electrum trouble, a failed broadcast — releases the
            # cooldown slot claimed in STEP 2 before the error
            # propagates.
            # ========================================================
            try:
                balance_info = self._faucet_balance(ctx)
                current_balance = balance_info["confirmed"]  # the conservative floor, see above
                if current_balance < ctx.chunk_size_btc:
                    self.cooldowns.release(cooldown_key)
                    return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503


                # STEP 4: build, sign and broadcast — serialized per
                # network, or two simultaneous claims would select the
                # same UTXOs and race to double-spend them. On success
                # the cached balance is dropped so the page shows the
                # payout on its next poll.
                # ======================================================
                amount_sat = int(float(ctx.chunk_size_btc) * 1e8)
                with self._send_locks.setdefault(network_key, threading.Lock()):
                    tx_id = self._create_and_broadcast_transaction(ctx, to_address, amount_sat)
            except Exception:
                self.cooldowns.release(cooldown_key)
                raise

            self._balance_cache.pop(network_key, None)

            return {
                "message": "Cryptocurrency sent successfully",
                "transaction_id": tx_id,
                "amount": float(ctx.chunk_size_btc),
                "from_address": ctx.address,
                "network": ctx.network_key
            }, 200

        except Exception as e:
            return {"error": "Nepavyko išsiųsti kriptovaliutą", "details": str(e)}, 500







