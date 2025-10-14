############################################################
# Author:           Tomas Vanagas
# Updated:          2025-09-04
# Version:          1.0
# Description:      UTXO faucet for blockchain 
############################################################



import os
import time
import ssl
import socket
import json
import hashlib

from bitcoinlib.keys import HDKey
from bitcoinlib.transactions import Transaction, Output, Input
import bech32
import ecdsa
import struct


class NetworkContext:
    """Holds network-specific context for a single request (thread-safe)."""
    def __init__(self):
        self.network = None
        self.coin_type = None
        self.key = None
        self.address = None
        self.scripthash = None
        self.electrum_host = None
        self.electrum_port = None
        self.ssock = None
        self.chunk_size_btc = None


class UTXOFaucet:
    """
    UTXO-based cryptocurrency faucet supporting Bitcoin and Litecoin networks.
    Supports testnet, regtest and mainnet for both coins.
    Based on: https://github.com/tomasvanagas/btc-minimal-wallet
    """
    
    def __init__(self, network_configs: dict):
        self.network_configs = network_configs or {}
        
        # Configuration from environment
        self.faucet_private_key = os.getenv('FAUCET_PRIVATE_KEY')  # Same key as EVM faucet
        self.default_amount_btc = float(os.getenv('DEFAULT_WALLET_BTC_AMOUNT', '0.001'))
        self.fee_rate_sat_per_byte = int(os.getenv('BTC_FEE_RATE_SATVB', '10'))
        self.cooldown_seconds = int(os.getenv('UTXO_COOLDOWN_SECONDS', '60'))
        
        # Request tracking for cooldown
        self.last_request = {}
    


    def _hash160(self, data: bytes) -> bytes:
        """Bitcoin HASH160: RIPEMD160(SHA256(data))"""
        sha256_hash = hashlib.sha256(data).digest()
        return hashlib.new('ripemd160', sha256_hash).digest()
    


    def _convert_ethereum_key_to_bitcoin(self, eth_private_key: str) -> bytes:
        """
        Convert Ethereum hex private key to Bitcoin format.
        Handles both '0x' prefixed and non-prefixed hex keys.
        """
        # Remove '0x' prefix if present
        hex_key = eth_private_key.replace("0x", "")

        # If key is too short, pad it with zeros
        hex_key = hex_key.ljust(64, '0')

        # If key is too long, truncate it
        hex_key = hex_key[:64]
        
        private_key_bytes = bytes.fromhex(hex_key)
        
        # Return raw bytes for HDKey to handle
        return private_key_bytes
    


    def _get_hrp(self, network: str, coin_type: str, network_key: str = None) -> str:
        """Get Human Readable Part for bech32 encoding from network configuration."""
        
        if network_key and network_key in self.network_configs:
            config_hrp = self.network_configs[network_key].get('hrp')
            if config_hrp:
                return config_hrp
        
        # If no HRP found in config, raise an error instead of falling back
        raise ValueError(f"No HRP configured for network: {network_key}")
    


    def _create_bech32_address(self, pubkey_hash: bytes, network: str, coin_type: str, network_key: str = None) -> str:
        """Create bech32 address from public key hash."""
        hrp = self._get_hrp(network, coin_type, network_key)
        converted = bech32.convertbits(pubkey_hash, 8, 5)
        return bech32.bech32_encode(hrp, [0] + converted)
    


    def _bech32_address_to_scripthash(self, address: str) -> str:
        """Convert bech32 address to scripthash for Electrum queries."""
        hrp, data = bech32.bech32_decode(address)
        valid_hrps = ('tb', 'bc', 'bcrt', 'tltc', 'ltc', 'rltc', 'knf')
        if hrp not in valid_hrps:
            raise ValueError('Invalid Bech32 address')
        
        decoded = bech32.convertbits(data[1:], 5, 8, False)
        script = b'\x00\x14' + bytes(decoded)
        
        # Electrum uses reversed SHA256 hash as hex
        return hashlib.sha256(script).digest()[::-1].hex()
    


    def _get_coin_type_from_key(self, network_key: str) -> str:
        """Determine coin type from network key."""
        key_lower = network_key.lower()
        
        if 'ltc' in key_lower:
            return 'litecoin'
        elif 'knf' in key_lower:
            return 'knf'
        else:
            return 'bitcoin'
    


    def _get_bitcoinlib_network_name(self, generic_network: str, coin_type: str) -> str:
        """Get the specific network name that bitcoinlib expects."""
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
            # For custom networks like KNF, use bitcoin mainnet as base but handle specially
            return 'bitcoin'
        else:  # bitcoin
            if generic_lower == 'mainnet':
                return 'bitcoin'
            elif generic_lower == 'regtest':
                return 'regtest'
            else:  # testnet
                return 'testnet'



    def _setup_wallet_for_network(self, network_key: str) -> NetworkContext:
        """Initialize wallet context for the specified network."""
        ctx = NetworkContext()
        
        # Get network configuration
        config = self.network_configs.get(network_key)
        if not config:
            raise ValueError(f'Unknown UTXO network: {network_key}')
        
        # Use explicit network type from config
        generic_network = config.get('network', 'testnet')
        ctx.coin_type = self._get_coin_type_from_key(network_key)
        
        # Get the specific network name that bitcoinlib expects
        ctx.network = self._get_bitcoinlib_network_name(generic_network, ctx.coin_type)
        
        # Setup Electrum server connection
        electrum_server = config.get('electrum_server', '')
        if ':' in electrum_server:
            ctx.electrum_host, port_str = electrum_server.split(':', 1)
            ctx.electrum_port = int(port_str)
        else:
            ctx.electrum_host = electrum_server
            ctx.electrum_port = 50002  # Default Electrum port
        
        # Initialize wallet from private key
        if not self.faucet_private_key:
            raise ValueError('Faucet private key not configured')
        
        try:
            # Convert Ethereum hex private key to Bitcoin format
            btc_private_key = self._convert_ethereum_key_to_bitcoin(self.faucet_private_key)
            
            # For custom networks like KNF, don't specify network in HDKey to avoid validation issues
            if ctx.coin_type == 'knf':
                ctx.key = HDKey(import_key=btc_private_key)
            else:
                ctx.key = HDKey(import_key=btc_private_key, network=ctx.network)
        except Exception as e:
            raise ValueError(f'Invalid private key for network {ctx.network}: {e}')
        
        # Generate address and scripthash
        pubkey = ctx.key.public_byte
        pubkey_hash = self._hash160(pubkey)
        ctx.address = self._create_bech32_address(pubkey_hash, ctx.network, ctx.coin_type, network_key)
        ctx.scripthash = self._bech32_address_to_scripthash(ctx.address)

        # Determine chunk size for this network (fallback to env default)
        ctx.chunk_size_btc = float(config.get('chunk_size', self.default_amount_btc))
        
        return ctx
    


    def _connect_electrum(self, ctx: NetworkContext):
        """Connect to Electrum server."""
        if not ctx.electrum_host or not ctx.electrum_port:
            raise ValueError('Electrum server not configured')
        
        sock = socket.create_connection((ctx.electrum_host, ctx.electrum_port))
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        ctx.ssock = context.wrap_socket(sock, server_hostname=ctx.electrum_host)
    


    def _disconnect_electrum(self, ctx: NetworkContext):
        """Disconnect from Electrum server."""
        if ctx.ssock:
            ctx.ssock.close()
            ctx.ssock = None
    


    def _send_electrum_request(self, ctx: NetworkContext, method: str, params: list):
        """Send JSON-RPC request to Electrum server."""
        if not ctx.ssock:
            raise ConnectionError("Not connected to Electrum server")
        
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }
        
        # Start timing
        start_time = time.time()
        
        ctx.ssock.sendall((json.dumps(request) + "\n").encode("utf-8"))
        
        # Read response until we get a complete line (JSON-RPC messages end with \n)
        response_data = b""
        while True:
            chunk = ctx.ssock.recv(1024)
            if not chunk:
                raise ConnectionError("Connection closed by server")
            response_data += chunk
            if b'\n' in response_data:
                # Get the first complete message
                response_line = response_data.split(b'\n', 1)[0]
                break
        
        # Calculate elapsed time
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
    


    def _get_balance(self, ctx: NetworkContext) -> dict:
        """Get balance information in BTC."""
        result = self._send_electrum_request(ctx, "blockchain.scripthash.get_balance", [ctx.scripthash])
        confirmed = result.get("confirmed", 0) / 1e8
        unconfirmed = result.get("unconfirmed", 0) / 1e8
        total = confirmed + unconfirmed
        
        return {
            "confirmed": confirmed,
            "unconfirmed": unconfirmed,
            "total": total
        }
    


    def _get_utxos(self, ctx: NetworkContext) -> list:
        """Get unspent transaction outputs."""
        return self._send_electrum_request(ctx, "blockchain.scripthash.listunspent", [ctx.scripthash])
    


    def _create_inputs(self, ctx: NetworkContext, utxos: list, target_amount_sat: int = None) -> tuple:
        """Create transaction inputs from UTXOs."""
        inputs = []
        total_input = 0
        
        for utxo in utxos:
            if target_amount_sat and total_input >= target_amount_sat:
                break
            
            # For custom networks like KNF, don't specify network in Input to avoid validation issues
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
        """Estimate transaction fee in satoshis."""
        # Conservative size estimate for segwit p2wpkh transactions
        estimated_size = (num_inputs * 91) + (num_outputs * 31) + 10
        return estimated_size * self.fee_rate_sat_per_byte
    


    def _create_and_broadcast_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int) -> str:
        """Create, sign and broadcast a cryptocurrency transaction."""
        utxos = self._get_utxos(ctx)
        if not utxos:
            raise ValueError("No UTXOs available")
        
        # For KNF, use manual raw transaction construction
        if ctx.coin_type == 'knf':
            return self._create_and_broadcast_raw_transaction(ctx, to_address, amount_sat, utxos)
        
        # For Bitcoin/Litecoin, use bitcoinlib
        inputs, total_input = self._create_inputs(ctx, utxos, amount_sat)
        if total_input < amount_sat:
            raise ValueError("Insufficient funds")
        
        # Calculate fee and create outputs
        fee = self._estimate_fee(len(inputs), 2)
        outputs = [Output(amount_sat, to_address, network=ctx.network)]
        
        # Add change output if economical
        change = total_input - amount_sat - fee
        if change > 546:
            outputs.append(Output(change, ctx.address, network=ctx.network))
        else:
            fee += change
        
        # Create and sign transaction
        tx = Transaction(
            inputs=inputs, 
            outputs=outputs, 
            network=ctx.network, 
            witness_type='segwit'
        )
        tx.sign(ctx.key)
        
        # Broadcast transaction
        raw_tx = tx.raw_hex()
        return self._send_electrum_request(ctx, "blockchain.transaction.broadcast", [raw_tx])




    def _create_and_broadcast_raw_transaction(self, ctx: NetworkContext, to_address: str, amount_sat: int, utxos: list) -> str:
        """Create raw SegWit transaction for custom networks like KNF."""
        
        # Select UTXOs
        selected_utxos = []
        total_input = 0
        for utxo in utxos:
            selected_utxos.append(utxo)
            total_input += utxo['value']
            if total_input >= amount_sat:
                break
        
        if total_input < amount_sat:
            raise ValueError("Insufficient funds")
        
        # Calculate fee
        fee = self._estimate_fee(len(selected_utxos), 2)
        change = total_input - amount_sat - fee
        
        # Decode recipient address
        to_hrp, to_data = bech32.bech32_decode(to_address)
        to_decoded = bech32.convertbits(to_data[1:], 5, 8, False)
        to_pubkey_hash = bytes(to_decoded)
        
        # Decode sender address (for change)
        from_hrp, from_data = bech32.bech32_decode(ctx.address)
        from_decoded = bech32.convertbits(from_data[1:], 5, 8, False)
        from_pubkey_hash = bytes(from_decoded)
        
        # Build outputs
        outputs = []
        # Output 1: to recipient
        outputs.append({
            'amount': amount_sat,
            'script_pubkey': b'\x00\x14' + to_pubkey_hash  # OP_0 + 20 bytes
        })
        
        # Output 2: change (if economical)
        if change > 546:
            outputs.append({
                'amount': change,
                'script_pubkey': b'\x00\x14' + from_pubkey_hash
            })
        
        # Build transaction
        # Version (4 bytes, little endian)
        tx_bytes = struct.pack('<I', 2)
        
        # Marker and flag for SegWit
        tx_bytes += b'\x00\x01'
        
        # Input count
        tx_bytes += bytes([len(selected_utxos)])
        
        # Inputs
        for utxo in selected_utxos:
            # Previous TX hash (32 bytes, reversed)
            tx_bytes += bytes.fromhex(utxo['tx_hash'])[::-1]
            # Previous output index (4 bytes, little endian)
            tx_bytes += struct.pack('<I', utxo['tx_pos'])
            # Script length (0 for SegWit)
            tx_bytes += b'\x00'
            # Sequence (4 bytes)
            tx_bytes += b'\xff\xff\xff\xff'
        
        # Output count
        tx_bytes += bytes([len(outputs)])
        
        # Outputs
        for output in outputs:
            # Amount (8 bytes, little endian)
            tx_bytes += struct.pack('<Q', output['amount'])
            # Script length
            tx_bytes += bytes([len(output['script_pubkey'])])
            # Script
            tx_bytes += output['script_pubkey']
        
        # Witness data
        for i, utxo in enumerate(selected_utxos):
            # Sign this input
            # Build sighash preimage for SegWit
            hash_prevouts = hashlib.sha256(hashlib.sha256(
                b''.join([bytes.fromhex(u['tx_hash'])[::-1] + struct.pack('<I', u['tx_pos']) for u in selected_utxos])
            ).digest()).digest()
            
            hash_sequence = hashlib.sha256(hashlib.sha256(
                b'\xff\xff\xff\xff' * len(selected_utxos)
            ).digest()).digest()
            
            hash_outputs = hashlib.sha256(hashlib.sha256(
                b''.join([struct.pack('<Q', o['amount']) + bytes([len(o['script_pubkey'])]) + o['script_pubkey'] for o in outputs])
            ).digest()).digest()
            
            # Script code for p2wpkh: OP_DUP OP_HASH160 <20-byte-pubkey-hash> OP_EQUALVERIFY OP_CHECKSIG
            script_code = b'\x19\x76\xa9\x14' + from_pubkey_hash + b'\x88\xac'
            
            # Sighash preimage
            sighash_preimage = (
                struct.pack('<I', 2) +  # version
                hash_prevouts +
                hash_sequence +
                bytes.fromhex(utxo['tx_hash'])[::-1] +  # outpoint
                struct.pack('<I', utxo['tx_pos']) +
                script_code +
                struct.pack('<Q', utxo['value']) +  # amount
                b'\xff\xff\xff\xff' +  # sequence
                hash_outputs +
                struct.pack('<I', 0) +  # locktime
                struct.pack('<I', 1)  # sighash type (SIGHASH_ALL)
            )
            
            # Hash for signing
            sighash = hashlib.sha256(hashlib.sha256(sighash_preimage).digest()).digest()
            
            # Sign with private key
            sk = ecdsa.SigningKey.from_string(ctx.key.private_byte, curve=ecdsa.SECP256k1)
            signature = sk.sign_digest(sighash, sigencode=ecdsa.util.sigencode_der_canonize)
            
            # Add witness (number of items: 2, signature + pubkey)
            tx_bytes += b'\x02'  # 2 witness items
            # Signature with SIGHASH_ALL byte
            sig_with_hashtype = signature + b'\x01'
            tx_bytes += bytes([len(sig_with_hashtype)]) + sig_with_hashtype
            # Public key
            pubkey = ctx.key.public_byte
            tx_bytes += bytes([len(pubkey)]) + pubkey
        
        # Locktime (4 bytes)
        tx_bytes += struct.pack('<I', 0)
        
        # Convert to hex
        raw_tx = tx_bytes.hex()
        
        # Broadcast
        return self._send_electrum_request(ctx, "blockchain.transaction.broadcast", [raw_tx])



    def _validate_address(self, ctx: NetworkContext, address: str, network_key: str = None) -> bool:
        """Validate address for current network and coin type."""
        if not address:
            return False
        
        address_lower = address.lower()
        expected_hrp = self._get_hrp(ctx.network, ctx.coin_type, network_key)
        
        return address_lower.startswith(expected_hrp + '1')
    


    def get_networks(self) -> dict:
        """Get available networks configuration."""
        default_key = os.getenv('UTXO_DEFAULT_NETWORK', 'btc4')
        
        networks = {}
        for key, config in self.network_configs.items():
            networks[key] = {
                'id': config.get('id', 0),
                'short_name': config.get('short_name', 'BTC'),
                'full_name': config.get('full_name', key),
                'chain_id': 0,  # Not applicable for UTXO chains
                'chain': config.get('network', 'testnet'),
                'chunk_size': float(config.get('chunk_size')) if config.get('chunk_size') is not None else float(self.default_amount_btc),
            }
        
        return {
            'default_network': default_key,
            'networks': networks
        }
    


    def get_faucet_balance(self, network_key: str) -> tuple:
        """Get faucet balance for specified network."""
        ctx = None
        try:
            ctx = self._setup_wallet_for_network(network_key)
            
            self._connect_electrum(ctx)
            balance_info = self._get_balance(ctx)
            
            return {
                "balance": balance_info["total"],  # Total balance (confirmed + unconfirmed)
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
        """Send cryptocurrency to specified address."""
        ctx = None
        try:
            ctx = self._setup_wallet_for_network(network_key)
            
            # Validate inputs
            if not to_address:
                return {"error": "Trūksta reikalingų parametrų"}, 400
            
            to_address = to_address.strip()
            
            if not self._validate_address(ctx, to_address, network_key):
                return {"error": "Neteisingas adresas"}, 400
            
            if to_address.lower() == ctx.address.lower():
                return {"error": "Negalima siųsti į čiaupo adresą"}, 400
            
            # Check cooldown
            now = int(time.time())
            last_request_time = self.last_request.get(to_address.lower())
            
            if last_request_time and (now - last_request_time) < self.cooldown_seconds:
                remaining = self.cooldown_seconds - (now - last_request_time)
                return {
                    "error": f"Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už {remaining} sek."
                }, 429
            
            # Validate amount (per-network chunk size)
            if not ctx.chunk_size_btc or ctx.chunk_size_btc <= 0:
                return {"error": "chunk_size must be > 0 for this network"}, 500
            
            # Connect and check balance
            self._connect_electrum(ctx)
            
            balance_info = self._get_balance(ctx)
            current_balance = balance_info["confirmed"]  # Use confirmed balance for sending
            if current_balance < ctx.chunk_size_btc:
                return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503
            
            # Send transaction
            amount_sat = int(float(ctx.chunk_size_btc) * 1e8)
            tx_id = self._create_and_broadcast_transaction(ctx, to_address, amount_sat)
            
            # Update cooldown tracking
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