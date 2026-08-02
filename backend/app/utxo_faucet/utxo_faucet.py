############################################################
#  [*] UTXO Faucet
#
#  A minimal faucet for UTXO-based chains (Bitcoin, Litecoin
#  and the custom KNF coin), each in testnet / regtest /
#  mainnet flavours. It talks directly to an Electrum server
#  (ElectrumX) over SSL JSON-RPC — no local wallet files, no
#  bitcoind RPC.
#
#  How a payout works, end to end:
#
#    1. The faucet key (shared with the EVM faucet, an
#       Ethereum-style hex key) is converted into a Bitcoin
#       key and turned into a native SegWit (p2wpkh, bech32)
#       address.
#    2. UTXOs and balances are fetched from the Electrum
#       server for that address' scripthash.
#    3. A transaction is built and BIP-143-signed with embit —
#       ONE code path for every chain, KNF included, because
#       embit takes network params as plain data instead of
#       validating against a chain registry (the reason the
#       previous engines needed a hand-rolled KNF path).
#    4. The raw transaction is broadcast through the same
#       Electrum connection.
#
#  Every request gets its own NetworkContext + Electrum
#  connection, so concurrent requests to different networks
#  never share state.
#
#  Based on: https://github.com/tomasvanagas/btc-minimal-wallet
#
#  Used by:
#    - utxo_routes.py — the Flask endpoints under /api/utxo/*
############################################################


import os
import time
import ssl
import socket
import json
import hashlib
import logging

from embit import ec as embit_ec
from embit import script as embit_script
from embit import bech32 as embit_bech32
from embit.transaction import Transaction, TransactionInput, TransactionOutput, Witness, SIGHASH


# Electrum protocol version announced during the server.version
# handshake. Newer ElectrumX releases refuse to serve a session
# that doesn't introduce itself first (see _connect_electrum).
ELECTRUM_CLIENT_NAME = 'knf-faucet'
ELECTRUM_PROTOCOL_VERSION = '1.4'

# Outputs below this value (in satoshis) are considered dust and
# not worth creating — the would-be change is left to the miners.
DUST_LIMIT_SAT = 546








############################################################
# NetworkContext
############################################################
#
# Everything a single faucet request needs to know about the
# network it operates on: the derived key/address, the
# Electrum endpoint and the live SSL socket. A fresh instance
# is built per request, which keeps the faucet thread-safe
# without locks.
#
# Used by:
#   - UTXOFaucet (below) — built in
#     _setup_wallet_for_network, threaded through everything
############################################################

class NetworkContext:

    def __init__(self):
        self.network_key = None     # config key: 'btc4', 'ltc4', 'knf', ...
        self.hrp = None             # bech32 prefix from the config: 'tb', 'knf', ...
        self.key = None             # embit PrivateKey holding the faucet key
        self.script_pubkey = None   # the faucet's own p2wpkh script
        self.address = None         # faucet bech32 address on this network
        self.scripthash = None      # Electrum scripthash of that address
        self.electrum_host = None
        self.electrum_port = None
        self.ssock = None           # live SSL socket to the Electrum server
        self.chunk_size_btc = None  # payout size for this network, in coins








############################################################
# UTXOFaucet
############################################################
#
# One instance serves every configured network; per-request
# state lives in NetworkContext. Methods in groups:
#
#   setup       — __init__
#   keys        — _convert_ethereum_key_to_bitcoin, _get_hrp
#   resolution  — _setup_wallet_for_network
#   electrum    — _connect_electrum, _disconnect_electrum,
#                 _send_electrum_request
#   queries     — _get_balance, _get_utxos
#   building    — _estimate_fee,
#                 _create_and_broadcast_transaction
#   validation  — _validate_address
#   public API  — get_networks, get_faucet_balance,
#                 request_crypto
#
# Used by:
#   - utxo_routes.py — one shared instance for all handlers
############################################################

class UTXOFaucet:

    ############################################################
    # __init__
    ############################################################
    #
    # Only configuration and the cooldown table live on the
    # instance — everything network-specific is derived per
    # request in _setup_wallet_for_network.
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
        self.fee_rate_sat_per_byte = int(os.getenv('BTC_FEE_RATE_SATVB', '10'))
        self.cooldown_seconds = int(os.getenv('UTXO_COOLDOWN_SECONDS', '60'))
        self.app_debug = os.getenv('APP_DEBUG', 'false').lower() == 'true'

        # (network, address) -> unix time of its last payout, for the
        # cooldown between requests (matches the EVM faucet's keying).
        # In-memory on purpose: resets on restart, fresh wallets walk
        # around it — accepted for a lab faucet on testnets.
        self.last_request = {}



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
    # _get_hrp
    ############################################################
    #
    # The bech32 Human Readable Part ('tb', 'tltc', 'knf', ...)
    # comes straight from the network config — guessing it from
    # the coin name would silently produce addresses for the
    # wrong chain.
    #
    # Used by:
    #   - _setup_wallet_for_network (below)
    ############################################################

    def _get_hrp(self, network_key: str) -> str:
        config_hrp = self.network_configs.get(network_key, {}).get('faucet', {}).get('hrp')
        if config_hrp:
            return config_hrp

        raise ValueError(f"No HRP configured for network: {network_key}")



    ############################################################
    # _setup_wallet_for_network
    ############################################################
    #
    # Builds the per-request NetworkContext: resolves the
    # network, derives the faucet key/address for it and notes
    # where its Electrum server is. Does NOT open the socket —
    # that's _connect_electrum, called only by the paths that
    # actually talk to the chain.
    #
    # Used by:
    #   - get_faucet_balance / request_crypto (below)
    ############################################################

    def _setup_wallet_for_network(self, network_key: str) -> NetworkContext:
        ctx = NetworkContext()
        ctx.network_key = network_key

        # STEP 1: resolve the network from the config's faucet
        # section (payout + connection settings live there). The
        # network IS just its HRP here — embit has no chain registry
        # to satisfy, so KNF needs nothing special.
        config = self.network_configs.get(network_key)
        if not config:
            raise ValueError(f'Unknown UTXO network: {network_key}')
        faucet_config = config.get('faucet', {})

        ctx.hrp = self._get_hrp(network_key)

        # STEP 2: Electrum endpoint, 'host:port' with 50002 (SSL) as
        # the default port.
        electrum_server = faucet_config.get('electrum_server', '')
        if ':' in electrum_server:
            ctx.electrum_host, port_str = electrum_server.split(':', 1)
            ctx.electrum_port = int(port_str)
        else:
            ctx.electrum_host = electrum_server
            ctx.electrum_port = 50002

        # STEP 3: derive the faucet identity — the same 32 secret
        # bytes as the EVM faucet, the same compressed pubkey the
        # old engines derived (verified byte-for-byte during the
        # embit migration).
        if not self.faucet_private_key:
            raise ValueError('Faucet private key not configured')

        try:
            ctx.key = embit_ec.PrivateKey(self._convert_ethereum_key_to_bitcoin(self.faucet_private_key))
        except Exception as e:
            raise ValueError(f'Invalid private key: {e}')

        # STEP 4: the faucet's p2wpkh script, its bech32 address, the
        # scripthash Electrum indexes it under (SHA256 of the script,
        # reversed), and this network's payout size.
        ctx.script_pubkey = embit_script.p2wpkh(ctx.key.get_public_key())
        ctx.address = ctx.script_pubkey.address({'bech32': ctx.hrp})
        ctx.scripthash = hashlib.sha256(ctx.script_pubkey.data).digest()[::-1].hex()

        ctx.chunk_size_btc = float(faucet_config.get('chunk_size', self.default_amount_btc))

        return ctx



    ############################################################
    # _connect_electrum
    ############################################################
    #
    # Opens an SSL connection to the Electrum server. The
    # servers run with self-signed certificates, so
    # verification is disabled. The server.version handshake
    # goes out immediately — recent ElectrumX versions close
    # the session ("server.version must be first msg") if any
    # other request arrives before it.
    #
    # Used by:
    #   - get_faucet_balance / request_crypto (below)
    ############################################################

    def _connect_electrum(self, ctx: NetworkContext):
        if not ctx.electrum_host or not ctx.electrum_port:
            raise ValueError('Electrum server not configured')

        sock = socket.create_connection((ctx.electrum_host, ctx.electrum_port))
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        ctx.ssock = context.wrap_socket(sock, server_hostname=ctx.electrum_host)

        self._send_electrum_request(
            ctx,
            "server.version",
            [ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION]
        )



    ############################################################
    # _disconnect_electrum
    ############################################################
    #
    # Used by:
    #   - get_faucet_balance / request_crypto (below) — their
    #     finally blocks, so the socket never leaks
    ############################################################

    def _disconnect_electrum(self, ctx: NetworkContext):
        if ctx.ssock:
            ctx.ssock.close()
            ctx.ssock = None



    ############################################################
    # _send_electrum_request
    ############################################################
    #
    # One JSON-RPC round-trip over the open socket. Newline-
    # delimited protocol: send one line, read until the first
    # '\n' comes back. Electrum-side errors surface as raised
    # exceptions, never as return values. The timing print
    # only fires with APP_DEBUG on.
    #
    # Used by:
    #   - _connect_electrum (above) — the handshake
    #   - _get_balance / _get_utxos (below)
    #   - both transaction broadcast paths (below)
    ############################################################

    def _send_electrum_request(self, ctx: NetworkContext, method: str, params: list):
        if not ctx.ssock:
            raise ConnectionError("Not connected to Electrum server")

        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }

        start_time = time.time()

        ctx.ssock.sendall((json.dumps(request) + "\n").encode("utf-8"))

        response_data = b""
        while True:
            chunk = ctx.ssock.recv(1024)
            if not chunk:
                raise ConnectionError("Connection closed by server")
            response_data += chunk
            if b'\n' in response_data:
                response_line = response_data.split(b'\n', 1)[0]
                break

        elapsed_time = time.time() - start_time
        if self.app_debug:
            print(f"[DEBUG] Electrum request '{method}' took {elapsed_time:.3f}s (network: {ctx.network_key})")

        try:
            response = json.loads(response_line.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON response from Electrum server: {e}")

        if "error" in response and response["error"]:
            raise RuntimeError(f"Electrum error: {response['error']}")

        if "result" not in response:
            raise ValueError("Unexpected Electrum response format")

        return response["result"]



    ############################################################
    # _get_balance
    ############################################################
    #
    # Faucet balance in whole coins (Electrum answers in
    # satoshis), split into confirmed / unconfirmed / total.
    #
    # Used by:
    #   - get_faucet_balance / request_crypto (below)
    ############################################################

    def _get_balance(self, ctx: NetworkContext) -> dict:
        result = self._send_electrum_request(ctx, "blockchain.scripthash.get_balance", [ctx.scripthash])
        confirmed = result.get("confirmed", 0) / 1e8
        unconfirmed = result.get("unconfirmed", 0) / 1e8

        return {
            "confirmed": confirmed,
            "unconfirmed": unconfirmed,
            "total": confirmed + unconfirmed
        }



    ############################################################
    # _get_utxos
    ############################################################
    #
    # Used by:
    #   - _create_and_broadcast_transaction (below)
    ############################################################

    def _get_utxos(self, ctx: NetworkContext) -> list:
        return self._send_electrum_request(ctx, "blockchain.scripthash.listunspent", [ctx.scripthash])



    ############################################################
    # _estimate_fee
    ############################################################
    #
    # Conservative vsize estimate for a p2wpkh transaction:
    # ~91 vbytes per input, ~31 per output, ~10 of overhead,
    # times the configured sat/vB rate.
    #
    # Used by:
    #   - _create_and_broadcast_transaction (below)
    ############################################################

    def _estimate_fee(self, num_inputs: int, num_outputs: int) -> int:
        estimated_size = (num_inputs * 91) + (num_outputs * 31) + 10
        return estimated_size * self.fee_rate_sat_per_byte



    ############################################################
    # _create_and_broadcast_transaction
    ############################################################
    #
    # Builds, signs and broadcasts a payout with embit: ONE
    # code path for every chain, KNF included — the BIP-141
    # transaction format is identical across them, only the
    # bech32 HRP differs and that comes from the config.
    # Signatures use deterministic RFC-6979 nonces, and the
    # recipient address is checksum-validated and accepted as
    # any witness program (p2wpkh, p2wsh, taproot).
    #
    # Used by:
    #   - request_crypto (below)
    ############################################################

    def _create_and_broadcast_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int) -> str:
        # STEP 1: what can we spend?
        utxos = self._get_utxos(ctx)
        if not utxos:
            raise ValueError("No UTXOs available")

        # STEP 2: greedy coin selection — the target includes the fee
        # for the inputs selected so far, so the change can never go
        # negative.
        selected_utxos = []
        total_input = 0
        for utxo in utxos:
            selected_utxos.append(utxo)
            total_input += utxo['value']
            if total_input >= amount_sat + self._estimate_fee(len(selected_utxos), 2):
                break

        fee = self._estimate_fee(len(selected_utxos), 2)
        if total_input < amount_sat + fee:
            raise ValueError("Insufficient funds")

        change = total_input - amount_sat - fee

        # STEP 3: outputs. The recipient decodes against this
        # network's HRP (full checksum check) into a witness-program
        # scriptPubKey: version opcode (OP_0, or OP_1..OP_16 =
        # 0x50 + n) followed by the pushed program.
        witver, witprog = embit_bech32.decode(ctx.hrp, to_address)
        if witver is None or witprog is None:
            raise ValueError("Invalid recipient address")
        witprog = bytes(witprog)

        version_opcode = bytes([0x50 + witver if witver else 0])
        to_script = embit_script.Script(version_opcode + bytes([len(witprog)]) + witprog)

        outputs = [TransactionOutput(amount_sat, to_script)]
        if change > DUST_LIMIT_SAT:
            outputs.append(TransactionOutput(change, ctx.script_pubkey))
        # sub-dust change is simply left to the miners as extra fee

        # STEP 4: build and sign. Electrum reports tx_hash in display
        # order — the wire format wants it reversed. Per input the
        # witness stack is <DER signature + SIGHASH_ALL byte>
        # <compressed pubkey>; embit does the BIP-143 sighash math.
        tx = Transaction(
            version=2,
            vin=[TransactionInput(bytes.fromhex(u['tx_hash'])[::-1], u['tx_pos']) for u in selected_utxos],
            vout=outputs,
            locktime=0,
        )

        # scriptCode for p2wpkh per BIP-143: the classic p2pkh script
        # over our pubkey hash — which is exactly the last 20 bytes
        # of the p2wpkh script (OP_0 PUSH20 <hash160>)
        pub = ctx.key.get_public_key()
        script_code = embit_script.Script(b'\x76\xa9\x14' + ctx.script_pubkey.data[2:] + b'\x88\xac')

        for i, utxo in enumerate(selected_utxos):
            sighash = tx.sighash_segwit(i, script_code, utxo['value'])
            der_sig = ctx.key.sign(sighash).serialize() + bytes([SIGHASH.ALL])
            tx.vin[i].witness = Witness([der_sig, pub.serialize()])

        # STEP 5: broadcast over the same Electrum connection.
        return self._send_electrum_request(ctx, "blockchain.transaction.broadcast", [tx.serialize().hex()])



    ############################################################
    # _validate_address
    ############################################################
    #
    # Cheap sanity check: the address must carry this network's
    # HRP ('tb1...', 'tltc1...', 'knf1...'). Full checksum
    # validation happens in _create_and_broadcast_transaction,
    # where the address is bech32-decoded for real.
    #
    # Used by:
    #   - request_crypto (below)
    ############################################################

    def _validate_address(self, ctx: NetworkContext, address: str) -> bool:
        if not address:
            return False

        return address.lower().startswith(ctx.hrp + '1')



    ############################################################
    # get_networks
    ############################################################
    #
    # Everything the frontend needs to render the network
    # picker. chain_id is always 0 — the field only exists so
    # the payload shape matches the EVM faucet's.
    #
    # Used by:
    #   - utxo_routes.py — GET /api/utxo/networks
    ############################################################

    def get_networks(self) -> dict:
        default_key = os.getenv('UTXO_DEFAULT_NETWORK', 'btc4')

        networks = {}
        for key, config in self.network_configs.items():
            faucet_config = config.get('faucet', {})
            networks[key] = {
                'id': config.get('id', 0),
                'short_name': config.get('short_name', 'BTC'),
                'full_name': config.get('full_name', key),
                'chain_id': 0,  # not applicable for UTXO chains
                'chain': faucet_config.get('network', 'testnet'),
                'chunk_size': float(faucet_config.get('chunk_size')) if faucet_config.get('chunk_size') is not None else float(self.default_amount_btc),
            }

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
        ctx = None
        try:
            ctx = self._setup_wallet_for_network(network_key)

            self._connect_electrum(ctx)
            balance_info = self._get_balance(ctx)

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

        finally:
            if ctx:
                self._disconnect_electrum(ctx)



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
        ctx = None
        try:
            ctx = self._setup_wallet_for_network(network_key)

            # STEP 1: input validation — address present, right HRP for
            # this network, and not the faucet paying itself.
            if not to_address:
                return {"error": "Trūksta reikalingų parametrų"}, 400

            to_address = to_address.strip()

            if not self._validate_address(ctx, to_address):
                return {"error": "Neteisingas adresas"}, 400

            if to_address.lower() == ctx.address.lower():
                return {"error": "Negalima siųsti į čiaupo adresą"}, 400

            # STEP 2: the cooldown — per (network, address), so
            # claiming on one chain doesn't lock the others.
            now = int(time.time())
            cooldown_key = (network_key, to_address.lower())
            last_request_time = self.last_request.get(cooldown_key)

            if last_request_time and (now - last_request_time) < self.cooldown_seconds:
                remaining = self.cooldown_seconds - (now - last_request_time)
                return {
                    "error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {remaining} sek."
                }, 429

            if not ctx.chunk_size_btc or ctx.chunk_size_btc <= 0:
                return {"error": "chunk_size must be > 0 for this network"}, 500

            # STEP 3: does the faucet have the coins? Only confirmed
            # balance counts — unconfirmed change can't be re-spent on
            # every chain config.
            self._connect_electrum(ctx)

            balance_info = self._get_balance(ctx)
            current_balance = balance_info["confirmed"]  # only spend confirmed coins
            if current_balance < ctx.chunk_size_btc:
                return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503

            # STEP 4: build, sign and broadcast; the cooldown starts
            # only after a successful broadcast.
            amount_sat = int(float(ctx.chunk_size_btc) * 1e8)
            tx_id = self._create_and_broadcast_transaction(ctx, to_address, amount_sat)

            self.last_request[cooldown_key] = now

            return {
                "message": "Cryptocurrency sent successfully",
                "transaction_id": tx_id,
                "amount": float(ctx.chunk_size_btc),
                "from_address": ctx.address,
                "network": ctx.network_key
            }, 200

        except Exception as e:
            return {"error": "Nepavyko išsiųsti kriptovaliutą", "details": str(e)}, 500

        finally:
            if ctx:
                self._disconnect_electrum(ctx)
