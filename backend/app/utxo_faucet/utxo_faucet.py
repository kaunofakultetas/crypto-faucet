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
############################################################


import os
import time
import ssl
import socket
import json
import struct
import hashlib
import logging

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
        self.network = None         # bitcoinlib network name, e.g. 'litecoin_testnet'
        self.coin_type = None       # 'bitcoin' | 'litecoin' | 'knf'
        self.key = None             # HDKey holding the faucet private key
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
#   keys        — _hash160, _convert_ethereum_key_to_bitcoin,
#                 _get_hrp, _create_bech32_address,
#                 _bech32_address_to_scripthash
#   resolution  — _get_coin_type_from_key,
#                 _get_bitcoinlib_network_name,
#                 _setup_wallet_for_network
#   electrum    — _connect_electrum, _disconnect_electrum,
#                 _send_electrum_request
#   queries     — _get_balance, _get_utxos
#   building    — _create_inputs, _estimate_fee,
#                 _create_and_broadcast_transaction,
#                 _create_and_broadcast_raw_transaction
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
        # Per-network settings (electrum_server, hrp, chunk_size, ...)
        # coming from main.py / environment.
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
    # _hash160
    ############################################################
    #
    # Bitcoin's HASH160: RIPEMD160(SHA256(data)).
    #
    # Used by:
    #   - _setup_wallet_for_network (below)
    ############################################################

    def _hash160(self, data: bytes) -> bytes:
        sha256_hash = hashlib.sha256(data).digest()
        return hashlib.new('ripemd160', sha256_hash).digest()



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
    # the coin type would silently produce addresses for the
    # wrong chain.
    #
    # Used by:
    #   - _create_bech32_address (below)
    #   - _validate_address (below)
    ############################################################

    def _get_hrp(self, network: str, coin_type: str, network_key: str = None) -> str:
        if network_key and network_key in self.network_configs:
            config_hrp = self.network_configs[network_key].get('hrp')
            if config_hrp:
                return config_hrp

        raise ValueError(f"No HRP configured for network: {network_key}")



    ############################################################
    # _create_bech32_address
    ############################################################
    #
    # Native SegWit v0 address: witness version 0 + the 20-byte
    # pubkey hash, bech32-encoded under the network's HRP.
    #
    # Used by:
    #   - _setup_wallet_for_network (below)
    ############################################################

    def _create_bech32_address(self, pubkey_hash: bytes, network: str, coin_type: str, network_key: str = None) -> str:
        hrp = self._get_hrp(network, coin_type, network_key)
        converted = bech32.convertbits(pubkey_hash, 8, 5)
        return bech32.bech32_encode(hrp, [0] + converted)



    ############################################################
    # _bech32_address_to_scripthash
    ############################################################
    #
    # Electrum servers index by scripthash, not by address:
    # SHA256 of the output script, reversed, as hex. The HRP
    # allowlist is the hardcoded baseline plus every hrp the
    # network config declares — a new chain only needs its
    # config entry, not a code change here.
    #
    # Used by:
    #   - _setup_wallet_for_network (below)
    ############################################################

    def _bech32_address_to_scripthash(self, address: str) -> str:
        hrp, data = bech32.bech32_decode(address)
        configured_hrps = tuple(c.get('hrp') for c in self.network_configs.values() if c.get('hrp'))
        valid_hrps = ('tb', 'bc', 'bcrt', 'tltc', 'ltc', 'rltc', 'knf') + configured_hrps
        if hrp not in valid_hrps:
            raise ValueError('Invalid Bech32 address')

        decoded = bech32.convertbits(data[1:], 5, 8, False)
        script = b'\x00\x14' + bytes(decoded)  # OP_0 PUSH20 <pubkey hash>

        return hashlib.sha256(script).digest()[::-1].hex()



    ############################################################
    # _get_coin_type_from_key
    ############################################################
    #
    # Network keys are named like 'ltc4', 'knf', 'btc4' — the
    # coin type is encoded in the name itself; anything that
    # isn't Litecoin or KNF counts as Bitcoin.
    #
    # Used by:
    #   - _setup_wallet_for_network (below)
    ############################################################

    def _get_coin_type_from_key(self, network_key: str) -> str:
        key_lower = network_key.lower()

        if 'ltc' in key_lower:
            return 'litecoin'
        elif 'knf' in key_lower:
            return 'knf'
        else:
            return 'bitcoin'



    ############################################################
    # _get_bitcoinlib_network_name
    ############################################################
    #
    # Maps our generic 'testnet'/'regtest'/'mainnet' labels
    # onto the exact network names bitcoinlib expects. KNF is
    # special: bitcoinlib has no idea what it is, so bitcoin
    # stands in and KNF transactions are built by hand (see
    # _create_and_broadcast_raw_transaction).
    #
    # Used by:
    #   - _setup_wallet_for_network (below)
    ############################################################

    def _get_bitcoinlib_network_name(self, generic_network: str, coin_type: str) -> str:
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
            return 'bitcoin'

        else:  # bitcoin
            if generic_lower == 'mainnet':
                return 'bitcoin'
            elif generic_lower == 'regtest':
                return 'regtest'
            else:  # testnet
                return 'testnet'



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

        # STEP 1: resolve the network and coin type from the config.
        config = self.network_configs.get(network_key)
        if not config:
            raise ValueError(f'Unknown UTXO network: {network_key}')

        generic_network = config.get('network', 'testnet')
        ctx.coin_type = self._get_coin_type_from_key(network_key)
        ctx.network = self._get_bitcoinlib_network_name(generic_network, ctx.coin_type)

        # STEP 2: Electrum endpoint, 'host:port' with 50002 (SSL) as
        # the default port.
        electrum_server = config.get('electrum_server', '')
        if ':' in electrum_server:
            ctx.electrum_host, port_str = electrum_server.split(':', 1)
            ctx.electrum_port = int(port_str)
        else:
            ctx.electrum_host = electrum_server
            ctx.electrum_port = 50002

        # STEP 3: derive the key. For KNF don't tell HDKey a network —
        # bitcoinlib would try to validate against params that don't
        # match the custom chain.
        if not self.faucet_private_key:
            raise ValueError('Faucet private key not configured')

        try:
            btc_private_key = self._convert_ethereum_key_to_bitcoin(self.faucet_private_key)

            if ctx.coin_type == 'knf':
                ctx.key = HDKey(import_key=btc_private_key)
            else:
                ctx.key = HDKey(import_key=btc_private_key, network=ctx.network)
        except Exception as e:
            raise ValueError(f'Invalid private key for network {ctx.network}: {e}')

        # STEP 4: the faucet address, the scripthash Electrum indexes
        # it under, and this network's payout size.
        pubkey = ctx.key.public_byte
        pubkey_hash = self._hash160(pubkey)
        ctx.address = self._create_bech32_address(pubkey_hash, ctx.network, ctx.coin_type, network_key)
        ctx.scripthash = self._bech32_address_to_scripthash(ctx.address)

        ctx.chunk_size_btc = float(config.get('chunk_size', self.default_amount_btc))

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
    # _create_inputs
    ############################################################
    #
    # Greedy coin selection: take UTXOs in the order Electrum
    # returned them until the target amount PLUS the estimated
    # fee for the inputs selected so far is covered — selecting
    # for the amount alone could leave nothing for the fee and
    # push the change negative.
    #
    # Used by:
    #   - _create_and_broadcast_transaction (below)
    ############################################################

    def _create_inputs(self, ctx: NetworkContext, utxos: list, target_amount_sat: int = None) -> tuple:
        inputs = []
        total_input = 0

        for utxo in utxos:
            if target_amount_sat and total_input >= target_amount_sat + self._estimate_fee(len(inputs), 2):
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
    #   - _create_and_broadcast_raw_transaction (below)
    ############################################################

    def _estimate_fee(self, num_inputs: int, num_outputs: int) -> int:
        estimated_size = (num_inputs * 91) + (num_outputs * 31) + 10
        return estimated_size * self.fee_rate_sat_per_byte



    ############################################################
    # _create_and_broadcast_transaction
    ############################################################
    #
    # Builds, signs and broadcasts a payout. Bitcoin/Litecoin
    # go through bitcoinlib; KNF takes the manual raw-bytes
    # path below.
    #
    # Used by:
    #   - request_crypto (below)
    ############################################################

    def _create_and_broadcast_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int) -> str:
        # STEP 1: what can we spend?
        utxos = self._get_utxos(ctx)
        if not utxos:
            raise ValueError("No UTXOs available")

        if ctx.coin_type == 'knf':
            return self._create_and_broadcast_raw_transaction(ctx, to_address, amount_sat, utxos)

        # STEP 2: pick inputs — the selection targets amount + fee, so
        # the change can never go negative.
        inputs, total_input = self._create_inputs(ctx, utxos, amount_sat)
        fee = self._estimate_fee(len(inputs), 2)
        if total_input < amount_sat + fee:
            raise ValueError("Insufficient funds")

        # STEP 3: outputs — the payout, plus the leftover back to the
        # faucet unless it's dust (then it's cheaper to just leave it
        # as extra fee).
        outputs = [Output(amount_sat, to_address, network=ctx.network)]

        change = total_input - amount_sat - fee
        if change > DUST_LIMIT_SAT:
            outputs.append(Output(change, ctx.address, network=ctx.network))
        else:
            fee += change

        # STEP 4: sign with bitcoinlib and broadcast over Electrum.
        tx = Transaction(
            inputs=inputs,
            outputs=outputs,
            network=ctx.network,
            witness_type='segwit'
        )
        tx.sign(ctx.key)

        raw_tx = tx.raw_hex()
        return self._send_electrum_request(ctx, "blockchain.transaction.broadcast", [raw_tx])



    ############################################################
    # _create_and_broadcast_raw_transaction
    ############################################################
    #
    # Hand-rolled SegWit v0 transaction for KNF, where
    # bitcoinlib's network validation gets in the way.
    # Serializes the BIP-141 format byte by byte and signs
    # each input per BIP-143.
    #
    # Used by:
    #   - _create_and_broadcast_transaction (above) — the KNF
    #     branch
    ############################################################

    def _create_and_broadcast_raw_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int, utxos: list) -> str:
        # STEP 1: greedy coin selection — the target includes the fee
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

        # STEP 2: output scripts — recipient and change (faucet)
        # pubkey hashes straight from bech32.
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

        # STEP 3: serialize the unsigned part of the transaction.
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

        # STEP 4: one BIP-143 signature per input, appended as the
        # witness stack: <signature + SIGHASH_ALL byte> <pubkey>.
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

            tx_bytes += b'\x02'
            sig_with_hashtype = signature + b'\x01'
            tx_bytes += bytes([len(sig_with_hashtype)]) + sig_with_hashtype
            pubkey = ctx.key.public_byte
            tx_bytes += bytes([len(pubkey)]) + pubkey

        tx_bytes += struct.pack('<I', 0)  # locktime

        # STEP 5: broadcast over the same Electrum connection.
        raw_tx = tx_bytes.hex()
        return self._send_electrum_request(ctx, "blockchain.transaction.broadcast", [raw_tx])



    ############################################################
    # _validate_address
    ############################################################
    #
    # Cheap sanity check: the address must carry this network's
    # HRP ('tb1...', 'tltc1...', 'knf1...'). Full checksum
    # validation happens implicitly when the transaction is
    # built.
    #
    # Used by:
    #   - request_crypto (below)
    ############################################################

    def _validate_address(self, ctx: NetworkContext, address: str, network_key: str = None) -> bool:
        if not address:
            return False

        address_lower = address.lower()
        expected_hrp = self._get_hrp(ctx.network, ctx.coin_type, network_key)

        return address_lower.startswith(expected_hrp + '1')



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

            if not self._validate_address(ctx, to_address, network_key):
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
                "network": ctx.network,
                "coin_type": ctx.coin_type
            }, 200

        except Exception as e:
            return {"error": "Nepavyko išsiųsti kriptovaliutą", "details": str(e)}, 500

        finally:
            if ctx:
                self._disconnect_electrum(ctx)
