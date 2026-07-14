# -----------------------------------------------------------
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
#    3. A transaction is built and signed — with bitcoinlib
#       for Bitcoin/Litecoin, or by hand (raw bytes + ecdsa)
#       for KNF, whose network params bitcoinlib doesn't know.
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
# -----------------------------------------------------------

import os
import time
import ssl
import socket
import json
import struct
import hashlib

import bech32
import ecdsa
from bitcoinlib.keys import HDKey
from bitcoinlib.transactions import Transaction, Output, Input


# Electrum protocol version announced during the server.version
# handshake. Newer ElectrumX releases refuse to serve a session
# that doesn't introduce itself first (see _connect_electrum).
ELECTRUM_CLIENT_NAME = 'knf-faucet'
ELECTRUM_PROTOCOL_VERSION = '1.4'

# Outputs below this value (in satoshis) are considered dust and
# not worth creating — the would-be change is left to the miners.
DUST_LIMIT_SAT = 546




# -----------------------------------------------------------
# NetworkContext
# -----------------------------------------------------------
#
# Everything a single faucet request needs to know about the
# network it operates on: the derived key/address, the Electrum
# endpoint and the live SSL socket. A fresh instance is built
# per request, which keeps the faucet thread-safe without locks.
# -----------------------------------------------------------

class NetworkContext:

    def __init__(self):
        self.network = None         # bitcoinlib network name, e.g. 'litecoin_testnet'
        self.coin_type = None       # 'bitcoin' | 'litecoin' | 'knf'
        self.key = None             # HDKey holding the faucet private key
        self.address = None         # faucet bech32 address on this network
        self.scripthash = None      # Electrum scripthash of that address
        self.electrum_host = None
        self.electrum_port = None
        self.ssock = None           # live SSL socket to the Electrum server
        self.chunk_size_btc = None  # payout size for this network, in coins




# -----------------------------------------------------------
# UTXOFaucet
# -----------------------------------------------------------

class UTXOFaucet:

    def __init__(self, network_configs: dict):
        # Per-network settings (electrum_server, hrp, chunk_size, ...)
        # coming from main.py / environment.
        self.network_configs = network_configs or {}

        # Same private key as the EVM faucet, so one funded identity
        # covers every chain the site offers.
        self.faucet_private_key = os.getenv('FAUCET_PRIVATE_KEY')
        self.default_amount_btc = float(os.getenv('DEFAULT_WALLET_BTC_AMOUNT', '0.001'))
        self.fee_rate_sat_per_byte = int(os.getenv('BTC_FEE_RATE_SATVB', '10'))
        self.cooldown_seconds = int(os.getenv('UTXO_COOLDOWN_SECONDS', '60'))

        # address (lowercased) -> unix time of its last payout,
        # used to enforce the cooldown between requests.
        self.last_request = {}




    # -----------------------------------------------------------
    # Keys & addresses
    # -----------------------------------------------------------

    def _hash160(self, data: bytes) -> bytes:
        # Bitcoin's HASH160: RIPEMD160(SHA256(data)).
        sha256_hash = hashlib.sha256(data).digest()
        return hashlib.new('ripemd160', sha256_hash).digest()


    def _convert_ethereum_key_to_bitcoin(self, eth_private_key: str) -> bytes:
        # Both key types are 32-byte secp256k1 scalars, so the same hex
        # material works on both sides — only the encoding differs.
        # Accepts '0x'-prefixed and bare hex; pads/truncates to 64 chars.
        hex_key = eth_private_key.replace("0x", "")
        hex_key = hex_key.ljust(64, '0')
        hex_key = hex_key[:64]

        return bytes.fromhex(hex_key)


    def _get_hrp(self, network: str, coin_type: str, network_key: str = None) -> str:
        # The bech32 Human Readable Part ('tb', 'tltc', 'knf', ...) comes
        # straight from the network config — guessing it from the coin
        # type would silently produce addresses for the wrong chain.
        if network_key and network_key in self.network_configs:
            config_hrp = self.network_configs[network_key].get('hrp')
            if config_hrp:
                return config_hrp

        raise ValueError(f"No HRP configured for network: {network_key}")


    def _create_bech32_address(self, pubkey_hash: bytes, network: str, coin_type: str, network_key: str = None) -> str:
        # Native SegWit v0 address: witness version 0 + 20-byte pubkey hash.
        hrp = self._get_hrp(network, coin_type, network_key)
        converted = bech32.convertbits(pubkey_hash, 8, 5)
        return bech32.bech32_encode(hrp, [0] + converted)


    def _bech32_address_to_scripthash(self, address: str) -> str:
        # Electrum servers index by scripthash, not by address:
        # SHA256 of the output script, reversed, as hex.
        hrp, data = bech32.bech32_decode(address)
        valid_hrps = ('tb', 'bc', 'bcrt', 'tltc', 'ltc', 'rltc', 'knf')
        if hrp not in valid_hrps:
            raise ValueError('Invalid Bech32 address')

        decoded = bech32.convertbits(data[1:], 5, 8, False)
        script = b'\x00\x14' + bytes(decoded)  # OP_0 PUSH20 <pubkey hash>

        return hashlib.sha256(script).digest()[::-1].hex()




    # -----------------------------------------------------------
    # Network resolution
    # -----------------------------------------------------------

    def _get_coin_type_from_key(self, network_key: str) -> str:
        # Network keys are named like 'ltc4', 'knf', 'btc4' — the coin
        # type is encoded in the name itself.
        key_lower = network_key.lower()

        if 'ltc' in key_lower:
            return 'litecoin'
        elif 'knf' in key_lower:
            return 'knf'
        else:
            return 'bitcoin'


    def _get_bitcoinlib_network_name(self, generic_network: str, coin_type: str) -> str:
        # Map our generic 'testnet'/'regtest'/'mainnet' labels onto the
        # exact network names bitcoinlib expects.
        generic_lower = generic_network.lower()
        coin_lower = coin_type.lower()

        if coin_lower == 'litecoin':
            if generic_lower == 'mainnet':
                return 'litecoin'
            elif generic_lower == 'regtest':
                return 'litecoin_regtest'
            else:  # testnet
                return 'litecoin_testnet'

        elif coin_lower == 'knf':
            # bitcoinlib has no idea what KNF is; use bitcoin as a stand-in
            # and build KNF transactions by hand (see the raw tx builder).
            return 'bitcoin'

        else:  # bitcoin
            if generic_lower == 'mainnet':
                return 'bitcoin'
            elif generic_lower == 'regtest':
                return 'regtest'
            else:  # testnet
                return 'testnet'


    def _setup_wallet_for_network(self, network_key: str) -> NetworkContext:
        # Build the per-request context: resolve the network, derive the
        # faucet key/address for it and note where its Electrum server is.
        ctx = NetworkContext()

        config = self.network_configs.get(network_key)
        if not config:
            raise ValueError(f'Unknown UTXO network: {network_key}')

        generic_network = config.get('network', 'testnet')
        ctx.coin_type = self._get_coin_type_from_key(network_key)
        ctx.network = self._get_bitcoinlib_network_name(generic_network, ctx.coin_type)

        # Electrum endpoint, 'host:port' with 50002 (SSL) as the default port.
        electrum_server = config.get('electrum_server', '')
        if ':' in electrum_server:
            ctx.electrum_host, port_str = electrum_server.split(':', 1)
            ctx.electrum_port = int(port_str)
        else:
            ctx.electrum_host = electrum_server
            ctx.electrum_port = 50002

        if not self.faucet_private_key:
            raise ValueError('Faucet private key not configured')

        try:
            btc_private_key = self._convert_ethereum_key_to_bitcoin(self.faucet_private_key)

            # For KNF don't tell HDKey a network — bitcoinlib would try to
            # validate against params that don't match the custom chain.
            if ctx.coin_type == 'knf':
                ctx.key = HDKey(import_key=btc_private_key)
            else:
                ctx.key = HDKey(import_key=btc_private_key, network=ctx.network)
        except Exception as e:
            raise ValueError(f'Invalid private key for network {ctx.network}: {e}')

        # Faucet address + the scripthash Electrum indexes it under.
        pubkey = ctx.key.public_byte
        pubkey_hash = self._hash160(pubkey)
        ctx.address = self._create_bech32_address(pubkey_hash, ctx.network, ctx.coin_type, network_key)
        ctx.scripthash = self._bech32_address_to_scripthash(ctx.address)

        # Payout size for this network, falling back to the env default.
        ctx.chunk_size_btc = float(config.get('chunk_size', self.default_amount_btc))

        return ctx




    # -----------------------------------------------------------
    # Electrum connection
    # -----------------------------------------------------------

    def _connect_electrum(self, ctx: NetworkContext):
        # Open an SSL connection to the Electrum server. The servers run
        # with self-signed certificates, so verification is disabled.
        if not ctx.electrum_host or not ctx.electrum_port:
            raise ValueError('Electrum server not configured')

        sock = socket.create_connection((ctx.electrum_host, ctx.electrum_port))
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        ctx.ssock = context.wrap_socket(sock, server_hostname=ctx.electrum_host)

        # Protocol handshake. Recent ElectrumX versions close the session
        # ("server.version must be first msg") if any other request
        # arrives before this one.
        self._send_electrum_request(
            ctx,
            "server.version",
            [ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION]
        )


    def _disconnect_electrum(self, ctx: NetworkContext):
        if ctx.ssock:
            ctx.ssock.close()
            ctx.ssock = None


    def _send_electrum_request(self, ctx: NetworkContext, method: str, params: list):
        # One JSON-RPC round-trip over the open socket. Newline-delimited
        # protocol: send one line, read until the first '\n' comes back.
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
        print(f"[DEBUG] Electrum request '{method}' took {elapsed_time:.3f}s (network: {ctx.network})")

        try:
            response = json.loads(response_line.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON response from Electrum server: {e}")

        if "error" in response and response["error"]:
            raise RuntimeError(f"Electrum error: {response['error']}")

        if "result" not in response:
            raise ValueError("Unexpected Electrum response format")

        return response["result"]




    # -----------------------------------------------------------
    # Chain queries
    # -----------------------------------------------------------

    def _get_balance(self, ctx: NetworkContext) -> dict:
        # Faucet balance in whole coins (Electrum answers in satoshis).
        result = self._send_electrum_request(ctx, "blockchain.scripthash.get_balance", [ctx.scripthash])
        confirmed = result.get("confirmed", 0) / 1e8
        unconfirmed = result.get("unconfirmed", 0) / 1e8

        return {
            "confirmed": confirmed,
            "unconfirmed": unconfirmed,
            "total": confirmed + unconfirmed
        }


    def _get_utxos(self, ctx: NetworkContext) -> list:
        return self._send_electrum_request(ctx, "blockchain.scripthash.listunspent", [ctx.scripthash])




    # -----------------------------------------------------------
    # Transaction building
    # -----------------------------------------------------------

    def _create_inputs(self, ctx: NetworkContext, utxos: list, target_amount_sat: int = None) -> tuple:
        # Greedy coin selection: take UTXOs in the order Electrum returned
        # them until the target amount is covered.
        inputs = []
        total_input = 0

        for utxo in utxos:
            if target_amount_sat and total_input >= target_amount_sat:
                break

            # Same KNF caveat as in _setup_wallet_for_network: passing a
            # network would make bitcoinlib validate against wrong params.
            if ctx.coin_type == 'knf':
                input_obj = Input(
                    prev_txid=utxo['tx_hash'],
                    output_n=utxo['tx_pos'],
                    value=utxo['value'],
                    address=ctx.address,
                    script_type='p2wpkh'
                )
            else:
                input_obj = Input(
                    prev_txid=utxo['tx_hash'],
                    output_n=utxo['tx_pos'],
                    value=utxo['value'],
                    address=ctx.address,
                    script_type='p2wpkh',
                    network=ctx.network
                )

            inputs.append(input_obj)
            total_input += utxo['value']

        return inputs, total_input


    def _estimate_fee(self, num_inputs: int, num_outputs: int) -> int:
        # Conservative vsize estimate for a p2wpkh transaction:
        # ~91 vbytes per input, ~31 per output, ~10 of overhead.
        estimated_size = (num_inputs * 91) + (num_outputs * 31) + 10
        return estimated_size * self.fee_rate_sat_per_byte


    def _create_and_broadcast_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int) -> str:
        # Build, sign and broadcast a payout. Bitcoin/Litecoin go through
        # bitcoinlib; KNF takes the manual raw-bytes path below.
        utxos = self._get_utxos(ctx)
        if not utxos:
            raise ValueError("No UTXOs available")

        if ctx.coin_type == 'knf':
            return self._create_and_broadcast_raw_transaction(ctx, to_address, amount_sat, utxos)

        inputs, total_input = self._create_inputs(ctx, utxos, amount_sat)
        if total_input < amount_sat:
            raise ValueError("Insufficient funds")

        fee = self._estimate_fee(len(inputs), 2)
        outputs = [Output(amount_sat, to_address, network=ctx.network)]

        # Send the leftover back to the faucet, unless it's dust —
        # then it's cheaper to just leave it as extra fee.
        change = total_input - amount_sat - fee
        if change > DUST_LIMIT_SAT:
            outputs.append(Output(change, ctx.address, network=ctx.network))
        else:
            fee += change

        tx = Transaction(
            inputs=inputs,
            outputs=outputs,
            network=ctx.network,
            witness_type='segwit'
        )
        tx.sign(ctx.key)

        raw_tx = tx.raw_hex()
        return self._send_electrum_request(ctx, "blockchain.transaction.broadcast", [raw_tx])


    def _create_and_broadcast_raw_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int, utxos: list) -> str:
        # Hand-rolled SegWit v0 transaction for KNF, where bitcoinlib's
        # network validation gets in the way. Serializes the BIP-141
        # format byte by byte and signs each input per BIP-143.

        # --- Coin selection -----------------------------------
        selected_utxos = []
        total_input = 0
        for utxo in utxos:
            selected_utxos.append(utxo)
            total_input += utxo['value']
            if total_input >= amount_sat:
                break

        if total_input < amount_sat:
            raise ValueError("Insufficient funds")

        fee = self._estimate_fee(len(selected_utxos), 2)
        change = total_input - amount_sat - fee

        # --- Output scripts -----------------------------------
        # Recipient and change (faucet) pubkey hashes from bech32.
        to_hrp, to_data = bech32.bech32_decode(to_address)
        to_decoded = bech32.convertbits(to_data[1:], 5, 8, False)
        to_pubkey_hash = bytes(to_decoded)

        from_hrp, from_data = bech32.bech32_decode(ctx.address)
        from_decoded = bech32.convertbits(from_data[1:], 5, 8, False)
        from_pubkey_hash = bytes(from_decoded)

        outputs = [{
            'amount': amount_sat,
            'script_pubkey': b'\x00\x14' + to_pubkey_hash  # OP_0 PUSH20 <hash>
        }]

        if change > DUST_LIMIT_SAT:
            outputs.append({
                'amount': change,
                'script_pubkey': b'\x00\x14' + from_pubkey_hash
            })

        # --- Serialize the unsigned part ----------------------
        tx_bytes = struct.pack('<I', 2)   # version
        tx_bytes += b'\x00\x01'           # SegWit marker + flag

        tx_bytes += bytes([len(selected_utxos)])
        for utxo in selected_utxos:
            tx_bytes += bytes.fromhex(utxo['tx_hash'])[::-1]  # prev txid (reversed)
            tx_bytes += struct.pack('<I', utxo['tx_pos'])     # prev output index
            tx_bytes += b'\x00'                               # empty scriptSig (SegWit)
            tx_bytes += b'\xff\xff\xff\xff'                   # sequence

        tx_bytes += bytes([len(outputs)])
        for output in outputs:
            tx_bytes += struct.pack('<Q', output['amount'])
            tx_bytes += bytes([len(output['script_pubkey'])])
            tx_bytes += output['script_pubkey']

        # --- Witnesses (BIP-143 signature per input) ----------
        for i, utxo in enumerate(selected_utxos):
            hash_prevouts = hashlib.sha256(hashlib.sha256(
                b''.join([bytes.fromhex(u['tx_hash'])[::-1] + struct.pack('<I', u['tx_pos']) for u in selected_utxos])
            ).digest()).digest()

            hash_sequence = hashlib.sha256(hashlib.sha256(
                b'\xff\xff\xff\xff' * len(selected_utxos)
            ).digest()).digest()

            hash_outputs = hashlib.sha256(hashlib.sha256(
                b''.join([struct.pack('<Q', o['amount']) + bytes([len(o['script_pubkey'])]) + o['script_pubkey'] for o in outputs])
            ).digest()).digest()

            # scriptCode for p2wpkh: OP_DUP OP_HASH160 <hash> OP_EQUALVERIFY OP_CHECKSIG
            script_code = b'\x19\x76\xa9\x14' + from_pubkey_hash + b'\x88\xac'

            sighash_preimage = (
                struct.pack('<I', 2) +                       # version
                hash_prevouts +
                hash_sequence +
                bytes.fromhex(utxo['tx_hash'])[::-1] +       # this input's outpoint
                struct.pack('<I', utxo['tx_pos']) +
                script_code +
                struct.pack('<Q', utxo['value']) +           # amount being spent
                b'\xff\xff\xff\xff' +                        # sequence
                hash_outputs +
                struct.pack('<I', 0) +                       # locktime
                struct.pack('<I', 1)                         # SIGHASH_ALL
            )

            sighash = hashlib.sha256(hashlib.sha256(sighash_preimage).digest()).digest()

            sk = ecdsa.SigningKey.from_string(ctx.key.private_byte, curve=ecdsa.SECP256k1)
            signature = sk.sign_digest(sighash, sigencode=ecdsa.util.sigencode_der_canonize)

            # Witness stack: <signature + SIGHASH_ALL byte> <pubkey>
            tx_bytes += b'\x02'
            sig_with_hashtype = signature + b'\x01'
            tx_bytes += bytes([len(sig_with_hashtype)]) + sig_with_hashtype
            pubkey = ctx.key.public_byte
            tx_bytes += bytes([len(pubkey)]) + pubkey

        tx_bytes += struct.pack('<I', 0)  # locktime

        # --- Broadcast ----------------------------------------
        raw_tx = tx_bytes.hex()
        return self._send_electrum_request(ctx, "blockchain.transaction.broadcast", [raw_tx])




    # -----------------------------------------------------------
    # Validation
    # -----------------------------------------------------------

    def _validate_address(self, ctx: NetworkContext, address: str, network_key: str = None) -> bool:
        # Cheap sanity check: the address must carry this network's HRP
        # ('tb1...', 'tltc1...', 'knf1...'). Full checksum validation
        # happens implicitly when the transaction is built.
        if not address:
            return False

        address_lower = address.lower()
        expected_hrp = self._get_hrp(ctx.network, ctx.coin_type, network_key)

        return address_lower.startswith(expected_hrp + '1')




    # -----------------------------------------------------------
    # Public API (called from utxo_routes.py)
    # -----------------------------------------------------------

    def get_networks(self) -> dict:
        # Everything the frontend needs to render the network picker.
        default_key = os.getenv('UTXO_DEFAULT_NETWORK', 'btc4')

        networks = {}
        for key, config in self.network_configs.items():
            networks[key] = {
                'id': config.get('id', 0),
                'short_name': config.get('short_name', 'BTC'),
                'full_name': config.get('full_name', key),
                'chain_id': 0,  # not applicable for UTXO chains
                'chain': config.get('network', 'testnet'),
                'chunk_size': float(config.get('chunk_size')) if config.get('chunk_size') is not None else float(self.default_amount_btc),
            }

        return {
            'default_network': default_key,
            'networks': networks
        }


    def get_faucet_balance(self, network_key: str) -> tuple:
        # Returns (payload, http_status) — the route just jsonify()s it.
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

        except Exception as e:
            return {"error": str(e)}, 500

        finally:
            if ctx:
                self._disconnect_electrum(ctx)


    def request_crypto(self, network_key: str, to_address: str) -> tuple:
        # The actual payout: validate the address, enforce the cooldown,
        # check the faucet balance and broadcast one chunk to the student.
        # Returns (payload, http_status); user-facing errors in Lithuanian.
        ctx = None
        try:
            ctx = self._setup_wallet_for_network(network_key)

            # --- Input validation -----------------------------
            if not to_address:
                return {"error": "Trūksta reikalingų parametrų"}, 400

            to_address = to_address.strip()

            if not self._validate_address(ctx, to_address, network_key):
                return {"error": "Neteisingas adresas"}, 400

            if to_address.lower() == ctx.address.lower():
                return {"error": "Negalima siųsti į čiaupo adresą"}, 400

            # --- Cooldown --------------------------------------
            now = int(time.time())
            last_request_time = self.last_request.get(to_address.lower())

            if last_request_time and (now - last_request_time) < self.cooldown_seconds:
                remaining = self.cooldown_seconds - (now - last_request_time)
                return {
                    "error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {remaining} sek."
                }, 429

            if not ctx.chunk_size_btc or ctx.chunk_size_btc <= 0:
                return {"error": "chunk_size must be > 0 for this network"}, 500

            # --- Balance check ---------------------------------
            self._connect_electrum(ctx)

            balance_info = self._get_balance(ctx)
            current_balance = balance_info["confirmed"]  # only spend confirmed coins
            if current_balance < ctx.chunk_size_btc:
                return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503

            # --- Send ------------------------------------------
            amount_sat = int(float(ctx.chunk_size_btc) * 1e8)
            tx_id = self._create_and_broadcast_transaction(ctx, to_address, amount_sat)

            # Start the cooldown only after a successful broadcast.
            self.last_request[to_address.lower()] = now

            return {
                "message": "Cryptocurrency sent successfully",
                "transaction_id": tx_id,
                "amount": float(ctx.chunk_size_btc),
                "from_address": ctx.address,
                "network": ctx.network,
                "coin_type": ctx.coin_type
            }, 200

        except Exception as e:
            return {"error": "Nepavyko išsiųsti kriptovaliutą", "details": str(e)}, 500

        finally:
            if ctx:
                self._disconnect_electrum(ctx)
