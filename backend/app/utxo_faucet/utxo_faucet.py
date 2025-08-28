import os
import time
import ssl
import socket
import json
import hashlib

from bitcoinlib.keys import HDKey
from bitcoinlib.transactions import Transaction, Output, Input
import bech32


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
        
        # Current wallet context (set per network request)
        self._reset_context()
    


    def _reset_context(self):
        """Reset wallet context for a new network request."""
        self.network = None
        self.coin_type = None
        self.key = None
        self.address = None
        self.scripthash = None
        self.electrum_host = None
        self.electrum_port = None
        self.ssock = None
        self.chunk_size_btc = None
    


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
    


    def _get_hrp(self) -> str:
        """Get Human Readable Part for bech32 encoding based on network and coin type."""
        if self.coin_type == 'litecoin':
            if self.network in ('testnet', 'litecoin_testnet'):
                return 'tltc'
            elif self.network in ('regtest', 'litecoin_regtest'):
                return 'rltc'
            else:
                return 'ltc'  # mainnet
        else:  # bitcoin
            if self.network in ('testnet', 'bitcoin_testnet'):
                return 'tb'
            elif self.network in ('regtest', 'bitcoin_regtest'):
                return 'bcrt'
            else:
                return 'bc'  # mainnet
    


    def _create_bech32_address(self, pubkey_hash: bytes) -> str:
        """Create bech32 address from public key hash."""
        hrp = self._get_hrp()
        converted = bech32.convertbits(pubkey_hash, 8, 5)
        return bech32.bech32_encode(hrp, [0] + converted)
    


    def _bech32_address_to_scripthash(self, address: str) -> str:
        """Convert bech32 address to scripthash for Electrum queries."""
        hrp, data = bech32.bech32_decode(address)
        valid_hrps = ('tb', 'bc', 'bcrt', 'tltc', 'ltc', 'rltc')
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
        else:  # bitcoin
            if generic_lower == 'mainnet':
                return 'bitcoin'
            elif generic_lower == 'regtest':
                return 'regtest'
            else:  # testnet
                return 'testnet'

    def _setup_wallet_for_network(self, network_key: str):
        """Initialize wallet context for the specified network."""
        # Get network configuration
        config = self.network_configs.get(network_key)
        if not config:
            raise ValueError(f'Unknown UTXO network: {network_key}')
        
        # Use explicit network type from config
        generic_network = config.get('network', 'testnet')
        self.coin_type = self._get_coin_type_from_key(network_key)
        
        # Get the specific network name that bitcoinlib expects
        self.network = self._get_bitcoinlib_network_name(generic_network, self.coin_type)
        
        # Setup Electrum server connection
        electrum_server = config.get('electrum_server', '')
        if ':' in electrum_server:
            self.electrum_host, port_str = electrum_server.split(':', 1)
            self.electrum_port = int(port_str)
        else:
            self.electrum_host = electrum_server
            self.electrum_port = 50002  # Default Electrum port
        
        # Initialize wallet from private key
        if not self.faucet_private_key:
            raise ValueError('Faucet private key not configured')
        
        try:
            # Convert Ethereum hex private key to Bitcoin format
            btc_private_key = self._convert_ethereum_key_to_bitcoin(self.faucet_private_key)
            self.key = HDKey(import_key=btc_private_key, network=self.network)
        except Exception as e:
            raise ValueError(f'Invalid private key for network {self.network}: {e}')
        
        # Generate address and scripthash
        pubkey = self.key.public_byte
        pubkey_hash = self._hash160(pubkey)
        self.address = self._create_bech32_address(pubkey_hash)
        self.scripthash = self._bech32_address_to_scripthash(self.address)

        # Determine chunk size for this network (fallback to env default)
        self.chunk_size_btc = float(config.get('chunk_size', self.default_amount_btc))
    


    def _connect_electrum(self):
        """Connect to Electrum server."""
        if not self.electrum_host or not self.electrum_port:
            raise ValueError('Electrum server not configured')
        
        sock = socket.create_connection((self.electrum_host, self.electrum_port))
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        self.ssock = context.wrap_socket(sock, server_hostname=self.electrum_host)
    


    def _disconnect_electrum(self):
        """Disconnect from Electrum server."""
        if self.ssock:
            self.ssock.close()
            self.ssock = None
    


    def _send_electrum_request(self, method: str, params: list):
        """Send JSON-RPC request to Electrum server."""
        if not self.ssock:
            raise ConnectionError("Not connected to Electrum server")
        
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }
        
        self.ssock.sendall((json.dumps(request) + "\n").encode("utf-8"))
        
        # Read response until we get a complete line (JSON-RPC messages end with \n)
        response_data = b""
        while True:
            chunk = self.ssock.recv(1024)
            if not chunk:
                raise ConnectionError("Connection closed by server")
            response_data += chunk
            if b'\n' in response_data:
                # Get the first complete message
                response_line = response_data.split(b'\n', 1)[0]
                break
        
        try:
            response = json.loads(response_line.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON response from Electrum server: {e}")
        
        if "error" in response and response["error"]:
            raise RuntimeError(f"Electrum error: {response['error']}")
        
        if "result" not in response:
            raise ValueError("Unexpected Electrum response format")
        
        return response["result"]
    


    def _get_balance(self) -> dict:
        """Get balance information in BTC."""
        result = self._send_electrum_request("blockchain.scripthash.get_balance", [self.scripthash])
        confirmed = result.get("confirmed", 0) / 1e8
        unconfirmed = result.get("unconfirmed", 0) / 1e8
        total = confirmed + unconfirmed
        
        return {
            "confirmed": confirmed,
            "unconfirmed": unconfirmed,
            "total": total
        }
    


    def _get_utxos(self) -> list:
        """Get unspent transaction outputs."""
        return self._send_electrum_request("blockchain.scripthash.listunspent", [self.scripthash])
    


    def _create_inputs(self, utxos: list, target_amount_sat: int = None) -> tuple:
        """Create transaction inputs from UTXOs."""
        inputs = []
        total_input = 0
        
        for utxo in utxos:
            if target_amount_sat and total_input >= target_amount_sat:
                break
            
            input_obj = Input(
                prev_txid=utxo['tx_hash'],
                output_n=utxo['tx_pos'],
                value=utxo['value'],
                address=self.address,
                script_type='p2wpkh',
                network=self.network
            )
            inputs.append(input_obj)
            total_input += utxo['value']
        
        return inputs, total_input
    


    def _estimate_fee(self, num_inputs: int, num_outputs: int) -> int:
        """Estimate transaction fee in satoshis."""
        # Conservative size estimate for segwit p2wpkh transactions
        estimated_size = (num_inputs * 91) + (num_outputs * 31) + 10
        return estimated_size * self.fee_rate_sat_per_byte
    


    def _create_and_broadcast_transaction(self, to_address: str, amount_sat: int) -> str:
        """Create, sign and broadcast a cryptocurrency transaction."""
        utxos = self._get_utxos()
        if not utxos:
            raise ValueError("No UTXOs available")
        
        inputs, total_input = self._create_inputs(utxos, amount_sat)
        if total_input < amount_sat:
            raise ValueError("Insufficient funds")
        
        # Calculate fee and create outputs
        fee = self._estimate_fee(len(inputs), 2)  # Assuming 2 outputs (recipient + change)
        outputs = [Output(amount_sat, to_address, network=self.network)]
        
        # Add change output if economical
        change = total_input - amount_sat - fee
        if change > 546:  # Dust threshold
            outputs.append(Output(change, self.address, network=self.network))
        else:
            # Add dust to fee
            fee += change
        
        # Create and sign transaction
        tx = Transaction(
            inputs=inputs, 
            outputs=outputs, 
            network=self.network, 
            witness_type='segwit'
        )
        tx.sign(self.key)
        
        # Broadcast transaction
        raw_tx = tx.raw_hex()
        return self._send_electrum_request("blockchain.transaction.broadcast", [raw_tx])
    


    def _validate_address(self, address: str) -> bool:
        """Validate address for current network and coin type."""
        if not address:
            return False
        
        address_lower = address.lower()
        expected_hrp = self._get_hrp()
        
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
        try:
            self._reset_context()
            self._setup_wallet_for_network(network_key)
            
            self._connect_electrum()
            balance_info = self._get_balance()
            
            return {
                "balance": balance_info["total"],  # Total balance (confirmed + unconfirmed)
                "balance_confirmed": balance_info["confirmed"],
                "balance_unconfirmed": balance_info["unconfirmed"],
                "address": self.address,
                "chunk_size": float(self.chunk_size_btc or self.default_amount_btc)
            }, 200
            
        except Exception as e:
            return {"error": str(e)}, 500
        finally:
            self._disconnect_electrum()
    


    def request_crypto(self, network_key: str, to_address: str) -> tuple:
        """Send cryptocurrency to specified address."""
        try:
            self._reset_context()
            self._setup_wallet_for_network(network_key)
            
            # Validate inputs
            if not to_address:
                return {"error": "Trūksta reikalingų parametrų"}, 400
            
            to_address = to_address.strip()
            
            if not self._validate_address(to_address):
                return {"error": "Neteisingas adresas"}, 400
            
            if to_address.lower() == self.address.lower():
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
            if not self.chunk_size_btc or self.chunk_size_btc <= 0:
                return {"error": "chunk_size must be > 0 for this network"}, 500
            
            # Connect and check balance
            self._connect_electrum()
            
            balance_info = self._get_balance()
            current_balance = balance_info["confirmed"]  # Use confirmed balance for sending
            if current_balance < self.chunk_size_btc:
                return {"error": "Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui."}, 503
            
            # Send transaction
            amount_sat = int(float(self.chunk_size_btc) * 1e8)
            tx_id = self._create_and_broadcast_transaction(to_address, amount_sat)
            
            # Update cooldown tracking
            self.last_request[to_address.lower()] = now
            
            return {
                "message": "Cryptocurrency sent successfully",
                "transaction_id": tx_id,
                "amount": float(self.chunk_size_btc),
                "from_address": self.address,
                "network": self.network,
                "coin_type": self.coin_type
            }, 200
            
        except Exception as e:
            return {"error": "Nepavyko išsiųsti kriptovaliutą", "details": str(e)}, 500
        finally:
            self._disconnect_electrum()