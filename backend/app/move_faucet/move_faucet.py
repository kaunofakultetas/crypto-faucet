############################################################
#  [*] MOVE Faucet
#
#  A faucet for Move chains — Sui, and anything else added to
#  the chain registry (chains/). Every primitive differs from
#  the other families:
#
#    curve      Ed25519 (like SVM). The shared
#               FAUCET_PRIVATE_KEY is the seed, but the
#               ADDRESS is blake2b-256 over flag+pubkey — a
#               DIFFERENT wallet that has to be funded on
#               each Move chain separately
#    address    0x + 64 hex characters (32 bytes)
#    units      MIST, 1e9 to the coin
#    tx model   no nonce and no blockhash: every payout is
#               BUILT BY THE NODE at claim time
#               (simulateTransaction resolves the gas coins),
#               then signed here and executed
#
#  How a payout works, end to end:
#
#    1. The student signs the Lithuanian nonce message in a
#       Sui wallet (personal-message intent); the Ed25519
#       signature carries its own public key, which must
#       hash back to the claiming address.
#    2. The faucet checks the wallet doesn't already hold a
#       chunk, the per-(network, address) cooldown, and its
#       own balance (chunk + gas margin).
#    3. The node builds the transfer (SplitCoins from gas +
#       TransferObjects), the faucet signs the returned BCS
#       and executes — under a per-network send lock, because
#       two payouts resolved against the same gas coins would
#       race.
#
#  Everything is prepared eagerly at startup — clients built,
#  chains probed, balances pre-fetched — so a dead endpoint
#  shows up in the console before the first student arrives.
#  A network that fails to warm up does not kill the app.
#
#  Used by:
#    - move_routes.py — the Flask endpoints under /api/move/*
############################################################


import os
import re
import time
import base64
import hashlib
import logging
import threading

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.signature import Signature

from .chains import chain_params
from .graphql_client import SuiGraphqlClient
from ..cooldown import CooldownTable
from ..icons import icon_url
from ..env_secrets import resolve_placeholders, install_log_redaction


# Sui signature flag byte → the signing scheme. Only flag 0
# (plain Ed25519) can be verified here; the others are named
# in the refusal so the student changes ACCOUNT, not signature.
SIGNATURE_SCHEMES = {
    0: 'Ed25519',
    1: 'Secp256k1',
    2: 'Secp256r1',
    3: 'MultiSig',
    5: 'zkLogin',
    6: 'Passkey',
}


# How long a polled faucet balance is served from cache. The page
# polls every few seconds per open browser tab; payouts drop the
# cached entry, so a claim shows up immediately regardless.
BALANCE_CACHE_TTL = 10

# Seconds one address must wait between payouts on one network
COOLDOWN_SECONDS = 60

# The network the picker preselects. A key of _CONFIG/coins.py's
# MOVE map — when the operator drops that network, get_networks
# falls back to the lowest picker id instead.
DEFAULT_NETWORK = 'suiTestnet'

# A Move address: 0x plus exactly 32 bytes of hex
ADDRESS_PATTERN = re.compile(r'^0x[0-9a-fA-F]{64}$')








############################################################
# _uleb128
############################################################
#
# BCS length prefix for the personal-message payload — the
# wallet signs blake2b over intent + BCS(vector<u8> message),
# and vector lengths are ULEB128-encoded.
#
# Used by:
#   - MoveFaucet.verify_signature (below)
############################################################

def _uleb128(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)








############################################################
# _signature_scheme
############################################################
#
# The flag byte of a base64 Sui signature (flag || sig ||
# pubkey), or None when the string is not even base64 — that
# case is left to verify_signature's own refusal.
#
# Used by:
#   - MoveFaucet.request_move — the account-type refusal
############################################################

def _signature_scheme(signature):
    try:
        raw = base64.b64decode(signature or '')
    except Exception:
        return None
    return raw[0] if raw else None








############################################################
# MoveFaucet
############################################################
#
# One instance serves every configured Move network. Methods
# in groups:
#
#   setup    — __init__, _load_keypair, _warm_up_networks
#   helpers  — is_supported_network, _chunk_mist,
#              _faucet_balance
#   crypto   — verify_signature, _sign_transaction
#   public   — get_networks, get_faucet_balance, request_move
#
# All GraphQL work lives in graphql_client.py: one stateless
# client per network. Payouts are serialized per network by
# _send_locks and the polled faucet balance is cached for a
# few seconds.
#
# Used by:
#   - move_routes.py — one shared instance for all handlers
############################################################

class MoveFaucet:






    ############################################################
    # __init__
    ############################################################
    #
    # EVERYTHING is prepared here, at startup: configuration,
    # the cooldown table, the faucet keypair, the resolved
    # chain params and one GraphQL client per configured
    # network — then _warm_up_networks probes every endpoint
    # and pre-fetches every balance. network_configs is
    # main.py's MOVE_NETWORK_CONFIGS.
    #
    # Used by:
    #   - move_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, network_configs: dict):
        self.NETWORK_CONFIGS = network_configs or {}
        self.APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'

        # Per-(network, address) cooldown between payouts, keyed the
        # same way as the other faucets (see app/cooldown.py for the
        # in-memory trade-offs).
        self.cooldowns = CooldownTable(COOLDOWN_SECONDS)

        # Same FAUCET_PRIVATE_KEY as every other family, used as an
        # Ed25519 seed like SVM — but hashed into a Sui address, so
        # this is yet another wallet to fund. A missing or broken
        # key leaves this None and every payout path answers with a
        # config error instead of crashing the import.
        self.faucet_keypair = self._load_keypair()
        self.FAUCET_ADDRESS = None
        if self.faucet_keypair:
            pubkey = bytes(self.faucet_keypair.pubkey())
            self.FAUCET_ADDRESS = '0x' + hashlib.blake2b(
                bytes([0]) + pubkey, digest_size=32).hexdigest()

        # network_key -> the chain's protocol facts (symbol,
        # decimals, coin type, gas margin), resolved ONCE from the
        # in-code registry (chains/) by the config's chain +
        # network flavour.
        self._chain_params = {}

        # network_key -> its GraphQL client. <NAME> placeholders in
        # the rpc_url are environment variable references, resolved
        # here and only here — an unset one fails the boot, and the
        # resolved value is scrubbed from every log line
        # (env_secrets.py).
        install_log_redaction()
        self._clients = {}
        for network_key, config in self.NETWORK_CONFIGS.items():
            faucet_config = config.get('faucet', {})
            self._chain_params[network_key] = chain_params(
                faucet_config.get('chain', ''), faucet_config.get('network', ''))

            rpc_url = resolve_placeholders(
                faucet_config.get('rpc_url', ''), f"MOVE network '{network_key}' rpc_url")
            self._clients[network_key] = SuiGraphqlClient(
                rpc_url, debug=self.APP_DEBUG, label=network_key)

        # network_key -> the lock serializing that chain's payouts:
        # two concurrent claims would otherwise be resolved by the
        # node against the same gas coins and race. Per network on
        # purpose — one chain's payout has no business blocking
        # another's.
        self._send_locks = {}

        # network_key -> (unix time, balance in coins) for the
        # polled faucet balance. Pre-filled by the warmup below.
        self._balance_cache = {}

        self._warm_up_networks()






    ############################################################
    # _load_keypair
    ############################################################
    #
    # Ed25519 keypair from FAUCET_PRIVATE_KEY — normalized the
    # same way in EVERY family, both directions: zfill pads a
    # short key on the LEFT (stripped leading zeros), [:64]
    # truncates an over-long one. The stack prefers RUNNING
    # off an imperfect key over refusing to serve. Anything
    # that still fails (non-hex junk) is logged and degrades
    # to None: payouts answer a config error, the faucet
    # serves regardless.
    #
    # Used by:
    #   - __init__ (above)
    ############################################################

    def _load_keypair(self):
        shared = os.getenv('FAUCET_PRIVATE_KEY', '').strip()
        if not shared:
            return None

        try:
            hex_key = shared.replace('0x', '').zfill(64)[:64]
            return Keypair.from_seed(bytes.fromhex(hex_key))
        except Exception:
            logging.exception('Invalid FAUCET_PRIVATE_KEY for the MOVE faucet')
            return None






    ############################################################
    # _warm_up_networks
    ############################################################
    #
    # The startup warmup, one thread per network so the
    # slowest endpoint bounds the wall time: probe the chain's
    # identifier and fetch the faucet balance (which also
    # primes the balance cache). A failed network deliberately
    # does NOT raise — the rest of the backend keeps serving.
    #
    # The chain identifier is PRINTED, not compared to the
    # config's 'network' label — accepted: Sui's identifier
    # form differs between RPC generations (a short hex on
    # JSON-RPC, a checkpoint digest on GraphQL), so there is
    # no stable per-network constant to pin it to. The boot
    # line is the operator's check; the page separately warns
    # when the wallet's chain is not sui:<network>.
    #
    # Used by:
    #   - __init__ (above)
    ############################################################

    def _warm_up_networks(self):

        def warm(network_key, client):
            try:
                chain_id = client.get_chain_identifier()

                if self.FAUCET_ADDRESS:
                    params = self._chain_params[network_key]
                    balance = client.get_balance(
                        self.FAUCET_ADDRESS, params['coin_type']) / (10 ** params['decimals'])
                    self._balance_cache[network_key] = (int(time.time()), balance)
                    print(f"[MOVE] {network_key} ready — chain {chain_id}, faucet balance {balance:.4f}")
                else:
                    print(f"[MOVE] {network_key} connected (chain {chain_id}) — but NO FAUCET KEY is configured, payouts will fail")
            except Exception:
                logging.exception(f"[MOVE] {network_key} FAILED to warm up")

        threads = [
            threading.Thread(target=warm, args=(key, client), name=f'move-warmup-{key}')
            for key, client in self._clients.items()
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
    #   - get_faucet_balance / request_move (below)
    ############################################################

    def is_supported_network(self, network: str) -> bool:
        return network in self.NETWORK_CONFIGS






    ############################################################
    # _chunk_mist
    ############################################################
    #
    # The payout size for one network, in MIST. The config
    # states it in whole coins; the decimals are a chain fact.
    #
    # Used by:
    #   - request_move (below)
    ############################################################

    def _chunk_mist(self, network: str) -> int:
        chunk = float(self.NETWORK_CONFIGS[network]['faucet']['chunk_size'])
        decimals = self._chain_params[network]['decimals']
        # round, not int: 1.001 * 1e9 is 1000999999.9999999 in binary
        return int(round(chunk * (10 ** decimals)))






    ############################################################
    # _faucet_balance
    ############################################################
    #
    # The faucet's balance on one chain in whole coins, cached
    # for BALANCE_CACHE_TTL seconds — the page polls it every
    # few seconds per open browser tab. request_move drops the
    # entry after a payout, so the next poll shows the new
    # number immediately.
    #
    # Used by:
    #   - get_faucet_balance (below)
    #   - _warm_up_networks (above) — pre-fills it
    ############################################################

    def _faucet_balance(self, network: str) -> float:
        cached = self._balance_cache.get(network)
        if cached and int(time.time()) - cached[0] < BALANCE_CACHE_TTL:
            if isinstance(cached[1], Exception):
                raise cached[1]
            return cached[1]

        params = self._chain_params[network]
        try:
            balance = self._clients[network].get_balance(
                self.FAUCET_ADDRESS, params['coin_type']) / (10 ** params['decimals'])
        except Exception as error:
            # A FAILED read is remembered for the same TTL: during an
            # outage every poll from every tab would otherwise repeat
            # the full round-trip (and its timeout) instead of
            # answering from the remembered failure
            self._balance_cache[network] = (int(time.time()), error)
            raise
        self._balance_cache[network] = (int(time.time()), balance)
        return balance






    ############################################################
    # verify_signature
    ############################################################
    #
    # The ownership proof, Sui's personal-message scheme: the
    # wallet signed blake2b-256 over intent (3,0,0) + the
    # BCS-encoded message, and the serialized signature is
    # base64 of flag || sig64 || pubkey32. Verification is
    # threefold — the flag must be Ed25519, the embedded
    # public key must hash back to the claiming ADDRESS
    # (blake2b over flag+pubkey), and the Ed25519 signature
    # must verify over the digest. Confirmed against the
    # node's own verifySignature endpoint. It proves the
    # requester controls (or once controlled) that wallet,
    # nothing more: the message is bound to no network or
    # moment, so a captured claim stays valid. Accepted — it
    # can only ever pay the signer's own address with testnet
    # coin, and a fresh keypair is cheaper than a replay.
    # Anything malformed answers False rather than raising.
    #
    # Used by:
    #   - request_move (below)
    ############################################################

    def verify_signature(self, address: str, message: str, signature: str) -> bool:
        try:
            raw = base64.b64decode(signature)
            if len(raw) != 97 or raw[0] != 0:
                return False
            sig, pubkey = raw[1:65], raw[65:97]

            derived = '0x' + hashlib.blake2b(bytes([0]) + pubkey, digest_size=32).hexdigest()
            if derived != address.lower():
                return False

            encoded = message.encode('utf-8')
            payload = bytes([3, 0, 0]) + _uleb128(len(encoded)) + encoded
            digest = hashlib.blake2b(payload, digest_size=32).digest()
            return Signature.from_bytes(sig).verify(Pubkey.from_bytes(pubkey), digest)
        except Exception:
            return False






    ############################################################
    # _sign_transaction
    ############################################################
    #
    # The faucet's own signature over the node-built payout:
    # blake2b-256 over intent (0,0,0) + the TransactionData
    # BCS, signed Ed25519, serialized as base64 of
    # flag || sig64 || pubkey32 — the format executeTransaction
    # expects. The bytes are signed as the node built them,
    # UNINSPECTED: the endpoint is trusted with this chain's
    # balance (never with the key). Accepted for testnet coin
    # against Mysten's own node — see chains/sui.py before
    # configuring anything else.
    #
    # Used by:
    #   - request_move (below)
    ############################################################

    def _sign_transaction(self, tx_bcs_b64: str) -> str:
        tx_bcs = base64.b64decode(tx_bcs_b64)
        digest = hashlib.blake2b(bytes([0, 0, 0]) + tx_bcs, digest_size=32).digest()
        signature = bytes(self.faucet_keypair.sign_message(digest))
        pubkey = bytes(self.faucet_keypair.pubkey())
        return base64.b64encode(bytes([0]) + signature + pubkey).decode()






    ############################################################
    # get_networks
    ############################################################
    #
    # Everything the frontend needs to render the picker and
    # the page. Deliberately COMPOSED, not a raw config dump:
    # the backend's own RPC URL stays out. icon is the
    # /api/icons/... URL when an icon file exists in the
    # mounted config dir, else None (see app/icons.py). The
    # preselected network is DEFAULT_NETWORK, or — when that
    # key is not configured — the lowest picker id, which is
    # the first entry the picker lists.
    #
    # Used by:
    #   - move_routes.py — GET /api/move/networks
    ############################################################

    def get_networks(self) -> dict:
        networks = {}
        for key, config in self.NETWORK_CONFIGS.items():
            faucet = config.get('faucet', {})
            params = self._chain_params[key]
            networks[key] = {
                'id': config.get('id', 0),
                'short_name': faucet.get('short_name', params['symbol']),
                'full_name': faucet.get('full_name', key),
                'icon': icon_url('move', key),
                'symbol': params['symbol'],
                'decimals': params['decimals'],
                'coin_type': params['coin_type'],
                # The network flavour the wallet should be on —
                # informational only: Sui wallets are chain-scoped,
                # there is no switch step
                'network': faucet.get('network', 'testnet'),
                'chunk_size': float(faucet.get('chunk_size', 0)),
                'rpc_urls': config.get('wallet', {}).get('rpc_urls', []),
                'block_explorer_urls': config.get('explorer', {}).get('block_explorer_urls', []),
            }

        default_key = DEFAULT_NETWORK if DEFAULT_NETWORK in networks else min(
            networks, key=lambda key: networks[key]['id'], default=None)

        return {
            'default_network': default_key,
            'networks': networks,
        }






    ############################################################
    # get_faucet_balance
    ############################################################
    #
    # The faucet address and its balance on one network.
    # Returns (payload, http_status) — the route just
    # jsonify()s it. Failures log the real exception and
    # answer with a generic Lithuanian error.
    #
    # Used by:
    #   - move_routes.py — GET /api/move/<network>/faucet-balance
    ############################################################

    def get_faucet_balance(self, network: str) -> tuple:
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400

        if not self.FAUCET_ADDRESS:
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        try:
            params = self._chain_params[network]
            return {
                "balance": self._faucet_balance(network),
                "address": self.FAUCET_ADDRESS,
                "symbol": params['symbol'],
                "chunk_size": float(self.NETWORK_CONFIGS[network]['faucet']['chunk_size']),
            }, 200
        except Exception:
            logging.exception(f"Failed to get MOVE faucet balance for {network}")
            return {"error": "Nepavyko gauti čiaupo informacijos"}, 500






    ############################################################
    # request_move
    ############################################################
    #
    # The actual payout: validate everything, then have the
    # node build one chunk-sized transfer, sign it and execute
    # — under the network's send lock. Returns a
    # (payload, http_status) tuple; user-facing errors are
    # Lithuanian.
    #
    # Used by:
    #   - move_routes.py — GET /api/move/<network>/request
    ############################################################

    def request_move(self, network: str, to_address: str, signature: str, nonce: str) -> tuple:
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400

        if not self.faucet_keypair:
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        client = self._clients[network]
        params = self._chain_params[network]
        amount_mist = self._chunk_mist(network)


        # STEP 1: input validation — all parameters present and the
        # address is a real 32-byte hex Move address.
        # =========================================================
        if not all([to_address, signature, nonce]):
            return {"error": "Trūksta reikalingų parametrų"}, 400

        to_address = to_address.strip()
        if not ADDRESS_PATTERN.match(to_address):
            return {"error": "Neteisingas adresas"}, 400
        to_address = to_address.lower()

        if to_address == self.FAUCET_ADDRESS:
            return {"error": "Negalima siųsti į čiaupo adresą"}, 400


        # STEP 2: signature check. This is the exact message the
        # frontend asks the wallet to sign — any mismatch (different
        # nonce, different wording) fails verification.
        # ======================================================
        # A wallet account that signs with anything but plain
        # Ed25519 (a Google-login zkLogin account, a hardware or
        # multisig one) is told WHICH account type it is — retrying
        # the same signature would never help
        scheme = _signature_scheme(signature)
        if scheme not in (None, 0):
            name = SIGNATURE_SCHEMES.get(scheme, f'schema {scheme}')
            return {"error": f"Ši piniginės paskyra pasirašo {name} raktu, o čiaupas priima tik įprastas Ed25519 paskyras. Pasirinkite piniginėje kitą paskyrą."}, 400

        # The exact bytes the wallet signed — the wording (its missing
        # commas included) is the contract with the frontend hook that
        # builds the same string; never reword it on one side alone.
        message = f"Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}"
        if not self.verify_signature(to_address, message, signature):
            return {"error": "Parašas neatitinka nurodyto adreso. Prijunkite tą pačią piniginę ir bandykite dar kartą."}, 403


        # STEP 3: eligibility — no top-up if the wallet already
        # holds a chunk, the cooldown slot must be free, and the
        # faucet must still have the chunk plus the gas margin.
        # Every failure path after the claim releases the slot.
        # =======================================================
        try:
            user_mist = client.get_balance(to_address, params['coin_type'])
        except Exception:
            logging.exception(f"Failed to read {to_address} balance on {network}")
            return {"error": "Nepavyko gauti naudotojo balanso"}, 500

        if user_mist >= amount_mist:
            return {"error": f"Jūsų piniginėje jau yra pakankamai {params['symbol']}."}, 400

        # The cooldown slot is check-and-CLAIMED atomically, per
        # (network, address), so two parallel requests from the same
        # address can't both pass the check and get paid twice.
        cooldown_key = (network, to_address)
        remaining = self.cooldowns.claim(cooldown_key)
        if remaining:
            return {"error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {remaining} sek."}, 429

        try:
            faucet_mist = client.get_balance(self.FAUCET_ADDRESS, params['coin_type'])
        except Exception:
            self.cooldowns.release(cooldown_key)
            logging.exception(f"Failed to read the faucet balance on {network}")
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500

        if faucet_mist < amount_mist + params['fee_mist']:
            self.cooldowns.release(cooldown_key)
            return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503


        # STEP 4: build, sign and execute — under the network's
        # send lock. The transaction is built by the NODE inside
        # the lock (simulateTransaction resolves the gas coins that
        # very second), so a payout can never be prepared in
        # advance. setdefault is atomic under the GIL, so the lock
        # map needs no lock of its own.
        # =======================================================
        try:
            with self._send_locks.setdefault(network, threading.Lock()):
                tx_bcs = client.build_transfer(
                    self.FAUCET_ADDRESS,
                    base64.b64encode(bytes.fromhex(to_address[2:])).decode(),
                    base64.b64encode(amount_mist.to_bytes(8, 'little')).decode(),
                )
                digest = client.execute(tx_bcs, self._sign_transaction(tx_bcs))
        except Exception:
            logging.exception(f"Failed to broadcast {network} payout")
            self.cooldowns.release(cooldown_key)
            return {"error": "Nepavyko išsiųsti transakcijos. Bandykite dar kartą."}, 500

        # Success — the cooldown slot claimed above stays, and the
        # cached balance is dropped so the page shows the payout on
        # its next poll.
        self._balance_cache.pop(network, None)

        return {
            "message": f"{params['symbol']} sent successfully",
            "transaction_id": digest,
            "amount": amount_mist / (10 ** params['decimals']),
            "from_address": self.FAUCET_ADDRESS,
            "network": network,
        }, 200
