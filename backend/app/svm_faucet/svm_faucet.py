############################################################
#  [*] SVM Faucet
#
#  A faucet for SVM chains — Solana, and anything else added
#  to the chain registry (chains/). Every primitive differs
#  from the EVM side:
#
#    curve      Ed25519. The shared FAUCET_PRIVATE_KEY is fed
#               to Keypair.from_seed, so the same secret gives
#               a DIFFERENT address here — one that has to be
#               funded on each SVM chain separately
#    address    base58-encoded 32-byte public key, no 0x
#    units      lamports, 1e9 to the coin
#    tx model   no nonce: every transaction carries a recent
#               blockhash that expires in ~150 slots, so a
#               payout is always built fresh at claim time
#
#  How a payout works, end to end:
#
#    1. The student signs the Lithuanian nonce message in
#       Phantom; the Ed25519 signature verifies directly
#       against the address they are claiming to.
#    2. The faucet checks the wallet doesn't already hold a
#       chunk, the per-(network, address) cooldown, and its
#       own balance.
#    3. A System Program transfer is built against a freshly
#       fetched blockhash, signed with the faucet keypair and
#       broadcast — under a per-network send lock, because two
#       payouts sharing a blockhash and signer would race.
#
#  Everything is prepared eagerly at startup — clients built,
#  versions probed, balances pre-fetched — so a dead endpoint
#  shows up in the console before the first student arrives. A
#  network that fails to warm up does not kill the app.
#
#  Used by:
#    - svm_routes.py — the Flask endpoints under /api/svm/*
############################################################


import os
import re
import time
import logging
import base64
import threading

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.hash import Hash
from solders.message import Message
from solders.transaction import Transaction
from solders.system_program import transfer, TransferParams

from .chains import chain_params
from .rpc_client import SolanaRpcClient
from ..cooldown import CooldownTable
from ..icons import icon_url


# How long a polled faucet balance is served from cache. The page
# polls every few seconds per open browser tab; payouts drop the
# cached entry, so a claim shows up immediately regardless.
BALANCE_CACHE_TTL = 10

# Seconds one address must wait between payouts on one network
COOLDOWN_SECONDS = 60

# The network the picker preselects. A key of _CONFIG/coins.py's
# SVM map — when the operator drops that network, get_networks
# falls back to the lowest picker id instead.
DEFAULT_NETWORK = 'solanaDevnet'








############################################################
# SVMFaucet
############################################################
#
# One instance serves every configured SVM network. Methods
# in groups:
#
#   setup    — __init__, _load_keypair, _warm_up_networks
#   helpers  — is_supported_network, _chunk_lamports,
#              _faucet_balance
#   auth     — verify_signature
#   public   — get_networks, get_faucet_balance, request_sol
#
# All RPC work lives in rpc_client.py: one stateless client
# per network. Payouts are serialized per network by
# _send_locks and the polled faucet balance is cached for a
# few seconds.
#
# Used by:
#   - svm_routes.py — one shared instance for all handlers
############################################################

class SVMFaucet:






    ############################################################
    # __init__
    ############################################################
    #
    # EVERYTHING is prepared here, at startup: configuration,
    # the cooldown table, the faucet keypair, the resolved
    # chain params and one RPC client per configured network —
    # then _warm_up_networks probes every endpoint and
    # pre-fetches every balance. network_configs is main.py's
    # SVM_NETWORK_CONFIGS.
    #
    # Used by:
    #   - svm_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, network_configs: dict):
        self.NETWORK_CONFIGS = network_configs or {}
        self.APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'

        # Per-(network, address) cooldown between payouts, keyed the
        # same way as the other faucets (see app/cooldown.py for the
        # in-memory trade-offs).
        self.cooldowns = CooldownTable(COOLDOWN_SECONDS)

        # Same FAUCET_PRIVATE_KEY as EVM and UTXO, reinterpreted as
        # an Ed25519 seed. A missing or broken key leaves this None
        # and every payout path answers with a config error instead
        # of crashing the import.
        self.faucet_keypair = self._load_keypair()
        self.FAUCET_ADDRESS = str(self.faucet_keypair.pubkey()) if self.faucet_keypair else None

        # network_key -> the chain's protocol facts (symbol,
        # decimals, fee, rent-exempt minimum), resolved ONCE from
        # the in-code registry (chains/) by the config's chain +
        # network flavour.
        self._chain_params = {}

        # network_key -> its RPC client. <NAME> placeholders in the
        # rpc_url are environment variable references, resolved here
        # and only here — the config file never holds the API key.
        self._clients = {}
        for network_key, config in self.NETWORK_CONFIGS.items():
            faucet_config = config.get('faucet', {})
            self._chain_params[network_key] = chain_params(
                faucet_config.get('chain', ''), faucet_config.get('network', ''))

            rpc_url = re.sub(r'<(\w+)>', lambda m: os.getenv(m.group(1), ''),
                             faucet_config.get('rpc_url', ''))
            self._clients[network_key] = SolanaRpcClient(
                rpc_url, debug=self.APP_DEBUG, label=network_key)

        # network_key -> the lock serializing that chain's payouts:
        # two concurrent claims would otherwise build transactions
        # against the same blockhash with the same signer and race.
        # Per network on purpose — one chain's payout has no
        # business blocking another's.
        self._send_locks = {}

        # network_key -> (unix time, balance in coins) for the
        # polled faucet balance. Pre-filled by the warmup below.
        self._balance_cache = {}

        self._warm_up_networks()






    ############################################################
    # _load_keypair
    ############################################################
    #
    # Ed25519 keypair from FAUCET_PRIVATE_KEY — the same hex
    # the EVM and UTXO faucets read. zfill pads on the LEFT,
    # because a short key means stripped leading zeros;
    # padding the right would silently derive a different
    # wallet.
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
            logging.exception('Invalid FAUCET_PRIVATE_KEY for the SVM faucet')
            return None






    ############################################################
    # _warm_up_networks
    ############################################################
    #
    # The startup warmup, one thread per network so the
    # slowest endpoint bounds the wall time: probe the node's
    # version and fetch the faucet balance (which also primes
    # the balance cache). A failed network deliberately does
    # NOT raise — the rest of the backend keeps serving.
    #
    # Used by:
    #   - __init__ (above)
    ############################################################

    def _warm_up_networks(self):

        def warm(network_key, client):
            try:
                version = client.get_version()

                if self.FAUCET_ADDRESS:
                    decimals = self._chain_params[network_key]['decimals']
                    balance = client.get_balance(self.FAUCET_ADDRESS) / (10 ** decimals)
                    self._balance_cache[network_key] = (int(time.time()), balance)
                    print(f"[SVM] {network_key} ready — solana-core {version}, faucet balance {balance:.4f}")
                else:
                    print(f"[SVM] {network_key} connected (solana-core {version}) — but NO FAUCET KEY is configured, payouts will fail")
            except Exception:
                logging.exception(f"[SVM] {network_key} FAILED to warm up")

        threads = [
            threading.Thread(target=warm, args=(key, client), name=f'svm-warmup-{key}')
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
    #   - get_faucet_balance / request_sol (below)
    ############################################################

    def is_supported_network(self, network: str) -> bool:
        return network in self.NETWORK_CONFIGS






    ############################################################
    # _chunk_lamports
    ############################################################
    #
    # The payout size for one network, in lamports. The config
    # states it in whole coins; the decimals are a chain fact.
    # Boot validation already proved this clears the chain's
    # rent-exempt minimum (see config_models.py).
    #
    # Used by:
    #   - request_sol (below)
    ############################################################

    def _chunk_lamports(self, network: str) -> int:
        chunk = float(self.NETWORK_CONFIGS[network]['faucet']['chunk_size'])
        decimals = self._chain_params[network]['decimals']
        return int(chunk * (10 ** decimals))






    ############################################################
    # _faucet_balance
    ############################################################
    #
    # The faucet's balance on one chain in whole coins, cached
    # for BALANCE_CACHE_TTL seconds — the page polls it every
    # few seconds per open browser tab. request_sol drops the
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
            return cached[1]

        decimals = self._chain_params[network]['decimals']
        balance = self._clients[network].get_balance(self.FAUCET_ADDRESS) / (10 ** decimals)
        self._balance_cache[network] = (int(time.time()), balance)
        return balance






    ############################################################
    # verify_signature
    ############################################################
    #
    # The ownership proof: the wallet signed the message with
    # the secret behind `address`, so the signature verifies
    # against that public key directly — there is no key
    # recovery step. Anything malformed (bad base58, wrong
    # length, junk) answers False rather than raising.
    #
    # Used by:
    #   - request_sol (below)
    ############################################################

    def verify_signature(self, address: str, message: str, signature: str) -> bool:
        try:
            pubkey = Pubkey.from_string(address)
            parsed = Signature.from_string(signature)
            return parsed.verify(pubkey, message.encode('utf-8'))
        except Exception:
            return False






    ############################################################
    # get_networks
    ############################################################
    #
    # Everything the frontend needs to render the picker and
    # the page. Deliberately COMPOSED, not a raw config dump:
    # the backend's own RPC URL (which carries the API key)
    # stays out. icon is the /api/icons/... URL when an icon
    # file exists in the mounted config dir, else None (see
    # app/icons.py). The preselected network is
    # DEFAULT_NETWORK, or — when that key is not configured —
    # the lowest picker id, which is the first entry the picker
    # lists.
    #
    # Used by:
    #   - svm_routes.py — GET /api/svm/networks
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
                'icon': icon_url('svm', key),
                'symbol': params['symbol'],
                'decimals': params['decimals'],
                # The cluster the wallet must sit on — Phantom is
                # driven by cluster name, not by a numeric chain id
                'cluster': faucet.get('network', 'devnet'),
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
    #   - svm_routes.py — GET /api/svm/<network>/faucet-balance
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
            logging.exception(f"Failed to get SVM faucet balance for {network}")
            return {"error": "Nepavyko gauti čiaupo informacijos"}, 500






    ############################################################
    # request_sol
    ############################################################
    #
    # The actual payout: validate everything, then broadcast
    # one chunk-sized System Program transfer under the
    # network's send lock. Returns a (payload, http_status)
    # tuple; user-facing errors are Lithuanian.
    #
    # Used by:
    #   - svm_routes.py — GET /api/svm/<network>/request
    ############################################################

    def request_sol(self, network: str, to_address: str, signature: str, nonce: str) -> tuple:
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400

        if not self.faucet_keypair:
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        client = self._clients[network]
        params = self._chain_params[network]
        amount_lamports = self._chunk_lamports(network)


        # STEP 1: input validation — all parameters present and the
        # address is a real base58 Ed25519 public key.
        # =========================================================
        if not all([to_address, signature, nonce]):
            return {"error": "Trūksta reikalingų parametrų"}, 400

        to_address = to_address.strip()
        try:
            recipient = Pubkey.from_string(to_address)
        except Exception:
            return {"error": "Neteisingas adresas"}, 400

        if to_address == self.FAUCET_ADDRESS:
            return {"error": "Negalima siųsti į čiaupo adresą"}, 400


        # STEP 2: signature check. This is the exact message the
        # frontend asks Phantom to sign — any mismatch (different
        # nonce, different wording) fails verification.
        # ======================================================
        message = f"Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}"
        if not self.verify_signature(to_address, message, signature):
            return {"error": "Kriptografinis parašas kažkodėl neatitinka"}, 403


        # STEP 3: eligibility — no top-up if the wallet already
        # holds a chunk, the cooldown slot must be free, and the
        # faucet must still have the chunk plus the signature fee.
        # Every failure path after the claim releases the slot.
        # =======================================================
        try:
            user_lamports = client.get_balance(to_address)
        except Exception:
            logging.exception(f"Failed to read {to_address} balance on {network}")
            return {"error": "Nepavyko gauti naudotojo balanso"}, 500

        if user_lamports >= amount_lamports:
            return {"error": f"Jūsų piniginėje jau yra pakankamai {params['symbol']}."}, 400

        # The cooldown slot is check-and-CLAIMED atomically, per
        # (network, address), so two parallel requests from the same
        # address can't both pass the check and get paid twice.
        cooldown_key = (network, to_address)
        remaining = self.cooldowns.claim(cooldown_key)
        if remaining:
            return {"error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {remaining} sek."}, 429

        try:
            faucet_lamports = client.get_balance(self.FAUCET_ADDRESS)
        except Exception:
            self.cooldowns.release(cooldown_key)
            logging.exception(f"Failed to read the faucet balance on {network}")
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500

        if faucet_lamports < amount_lamports + params['fee_lamports']:
            self.cooldowns.release(cooldown_key)
            return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503


        # STEP 4: build, sign and broadcast — under the network's
        # send lock. The blockhash is fetched INSIDE the lock and
        # used immediately: it expires in ~150 slots, so a payout
        # can never be prepared in advance the way an EVM nonce
        # can. setdefault is atomic under the GIL, so the lock map
        # needs no lock of its own.
        # =======================================================
        try:
            with self._send_locks.setdefault(network, threading.Lock()):
                blockhash = Hash.from_string(client.get_latest_blockhash())

                instruction = transfer(TransferParams(
                    from_pubkey=self.faucet_keypair.pubkey(),
                    to_pubkey=recipient,
                    lamports=amount_lamports,
                ))
                message_obj = Message.new_with_blockhash(
                    [instruction], self.faucet_keypair.pubkey(), blockhash)
                transaction = Transaction([self.faucet_keypair], message_obj, blockhash)

                tx_signature = client.send_transaction(
                    base64.b64encode(bytes(transaction)).decode('utf-8'))
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
            "transaction_id": str(tx_signature),
            "amount": amount_lamports / (10 ** params['decimals']),
            "from_address": self.FAUCET_ADDRESS,
            "network": network,
        }, 200
