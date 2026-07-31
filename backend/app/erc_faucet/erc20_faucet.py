############################################################
# ERC20 Faucet Logic
############################################################

import os
import time
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct
from .token_contracts import get_erc20_contract

class ERC20Faucet:
    def __init__(self, network_configs, token_configs):
        self.NETWORK_CONFIGS = network_configs
        self.TOKEN_CONFIGS = token_configs
        
        # Initialize Web3 instances (reuse from EVMFaucet or create new)
        self.w3_instances = {}
        for network in self.NETWORK_CONFIGS:
            if 'http' not in self.NETWORK_CONFIGS[network]['infura_network']:
                infura_url = f"https://{self.NETWORK_CONFIGS[network]['infura_network']}.infura.io/v3/{os.getenv('INFURA_PROJECT_ID')}"
            else:
                infura_url = self.NETWORK_CONFIGS[network]['infura_network']
            
            request_kwargs = {'timeout': 10}
            self.w3_instances[network] = Web3(
                Web3.HTTPProvider(infura_url, request_kwargs=request_kwargs)
            )
        
        # Faucet wallet
        self.FAUCET_PRIVATE_KEY = os.getenv('FAUCET_PRIVATE_KEY')
        self.FAUCET_PRIVATE_KEY = "0x" + self.FAUCET_PRIVATE_KEY.replace("0x", "")
        self.FAUCET_PRIVATE_KEY = self.FAUCET_PRIVATE_KEY.ljust(66, '0')
        
        try:
            self.FAUCET_ADDRESS = Account.from_key(self.FAUCET_PRIVATE_KEY).address
        except:
            self.FAUCET_ADDRESS = None
        
        # Rate limiting
        self.COOLDOWN_PERIOD = 60
        self.last_request = {}  # key: f"{network}_{token}_{address}"
    
    
    def is_supported_network(self, network):
        return network in self.TOKEN_CONFIGS
    
    
    def is_supported_token(self, network, token_symbol):
        if not self.is_supported_network(network):
            return False
        return token_symbol.upper() in self.TOKEN_CONFIGS[network]['tokens']
    
    
    def verify_signature(self, network, address, message, signature):
        w3 = self.w3_instances[network]
        try:
            message_hash = encode_defunct(text=message)
            signer = w3.eth.account.recover_message(message_hash, signature=signature)
            return signer.lower() == (address or '').lower()
        except:
            return False
    
    
    def request_tokens(self, network, token_symbol, to_address, signature, nonce):
        """Request ERC20 tokens from faucet"""
        token_symbol = token_symbol.upper()
        
        # Validation
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400
        
        if not self.is_supported_token(network, token_symbol):
            return {"error": f"Nepalaikomas žetonas: {token_symbol}"}, 400
        
        if not all([to_address, signature, nonce]):
            return {"error": "Trūksta reikalingų parametrų"}, 400
        
        w3 = self.w3_instances[network]
        token_config = self.TOKEN_CONFIGS[network]['tokens'][token_symbol]
        
        # Validate address
        try:
            to_address = w3.to_checksum_address(to_address)
        except:
            return {"error": "Neteisingas adresas"}, 400
        
        # Verify signature
        message = f"Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}"
        if not self.verify_signature(network, to_address, message, signature):
            return {"error": "Kriptografinis parašas neatitinka"}, 403
        
        # Get contract
        contract = get_erc20_contract(w3, token_config['contract_address'])
        
        # Calculate amount with decimals
        chunk_size = token_config['chunk_size']
        decimals = token_config['decimals']
        amount_to_send = int(chunk_size * (10 ** decimals))
        
        # Check user balance
        try:
            user_balance = contract.functions.balanceOf(to_address).call()
            if user_balance >= amount_to_send:
                return {
                    "error": f"Jūsų piniginėje jau yra pakankamai {token_symbol}."
                }, 400
        except:
            return {"error": "Nepavyko gauti naudotojo balanso"}, 500
        
        # Rate limiting
        addr_key = f"{network}_{token_symbol}_{to_address.lower()}"
        if addr_key in self.last_request:
            time_since = int(time.time()) - self.last_request[addr_key]
            if time_since < self.COOLDOWN_PERIOD:
                return {
                    "error": f"Žetonai jums jau išsiųsti. Daugiau galėsite pasiimti už {self.COOLDOWN_PERIOD - time_since} sek."
                }, 429
        
        # Check faucet balance
        try:
            faucet_token_balance = contract.functions.balanceOf(self.FAUCET_ADDRESS).call()
            if faucet_token_balance < amount_to_send:
                return {"error": "Čiaupas nebeturi žetonų. Praneškite dėstytojui."}, 503
        except:
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500
        
        # Build transaction
        nonce_tx = w3.eth.get_transaction_count(self.FAUCET_ADDRESS)
        
        # Build transfer transaction
        tx = contract.functions.transfer(to_address, amount_to_send).build_transaction({
            'nonce': nonce_tx,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
            'chainId': self.NETWORK_CONFIGS[network]['chain_id']
        })
        
        # Sign and send
        try:
            signed_tx = w3.eth.account.sign_transaction(tx, self.FAUCET_PRIVATE_KEY)
            tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            self.last_request[addr_key] = int(time.time())
            
            return {
                "message": f"{token_symbol} sent successfully",
                "transaction_hash": tx_hash.hex(),
                "amount": chunk_size,
                "token": token_symbol
            }, 200
        except Exception as e:
            return {"error": f"Nepavyko išsiųsti transakcijos: {str(e)}"}, 500
    
    
    def get_faucet_balances(self, network):
        """Get faucet balances for all tokens on a network"""
        if not self.is_supported_network(network):
            return {"error": f"Nepalaikomas tinklas: {network}"}, 400
        
        w3 = self.w3_instances[network]
        balances = {}
        
        for token_symbol, token_config in self.TOKEN_CONFIGS[network]['tokens'].items():
            try:
                contract = get_erc20_contract(w3, token_config['contract_address'])
                balance_raw = contract.functions.balanceOf(self.FAUCET_ADDRESS).call()
                balance = balance_raw / (10 ** token_config['decimals'])
                
                balances[token_symbol] = {
                    'balance': balance,
                    'chunk_size': token_config['chunk_size'],
                    'name': token_config['name'],
                    'symbol': token_config['symbol'],
                    'contract_address': token_config['contract_address']
                }
            except Exception as e:
                balances[token_symbol] = {
                    'error': f"Nepavyko gauti balanso: {str(e)}"
                }
        
        return {
            'faucet_address': self.FAUCET_ADDRESS.lower(),
            'balances': balances
        }, 200
    
    
    def get_token_configs(self):
        """Get all supported tokens across all networks"""
        return {
            'tokens': self.TOKEN_CONFIGS
        }, 200