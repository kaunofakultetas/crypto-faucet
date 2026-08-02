############################################################
#  [*] ERC-20 Faucet
#
#  Pays out test ERC-20 tokens that are scattered across many
#  EVM chains. Everything here is TOKEN-first, the way a
#  student thinks about it: "I need LINK" comes before "on
#  which chain". Each token is defined ONCE (name, decimals,
#  chunk size) with a deployments map of network -> contract
#  address — see ERC20_TOKEN_CONFIGS in main.py.
#
#  This class deliberately owns NO wallet plumbing: it is
#  composed WITH the EVMFaucet instance and borrows its Web3
#  connections, its normalized private key, its signature
#  verification and — critically — its send lock. Native ETH
#  payouts and token payouts spend from the same wallet, so
#  they must share one nonce discipline or they'd race each
#  other onto the same nonce.
#
#  A payout mirrors the native flow: the student signs the
#  same Lithuanian nonce message in MetaMask, the faucet
#  checks the wallet holds ENOUGH native crypto on that chain
#  (half the native faucet's chunk — tokens without gas would
#  be unusable; the frontend shows the same rule with a link
#  to the native faucet), that it doesn't already hold a full
#  chunk, the per-(network, token, address) cooldown, and its
#  own token balance, then broadcasts a transfer() under the
#  shared lock. Note the wallet's CURRENT chain is irrelevant
#  — the faucet sends on whichever chain the request names.
#
#  Used by:
#    - erc20_routes.py — the Flask endpoints under /api/erc20/*
############################################################


import time
import logging
import threading

from .token_contracts import get_erc20_contract




############################################################
# ERC20Faucet
############################################################
#
# One instance serves every token on every chain. Methods in
# three groups:
#
#   catalog — deployments_of, is_supported,
#             get_token_catalog, get_token
#   payout  — request_tokens, _min_native_wei
#   setup   — __init__, _token_balance
#
# Used by:
#   - erc20_routes.py — one shared instance for all handlers
############################################################

class ERC20Faucet:

    ############################################################
    # __init__
    ############################################################
    #
    # Composition, not duplication: evm_faucet is the shared
    # EVMFaucet instance whose Web3 connections, key, signature
    # check and send lock this class borrows. token_configs is
    # main.py's ERC20_TOKEN_CONFIGS (token-first, with a
    # deployments map per token).
    #
    # Used by:
    #   - erc20_routes.py — at import time, the single instance
    ############################################################

    def __init__(self, evm_faucet, token_configs):
        self.evm_faucet = evm_faucet
        self.TOKEN_CONFIGS = token_configs or {}

        # (network, token, address) -> unix time of the last payout
        # ATTEMPT — the slot is claimed atomically under cooldown_lock
        # before the slow RPC work, so two parallel requests from the
        # same address can't both pass the check; a failed attempt
        # releases the slot again. Same in-memory trade-offs as the
        # other faucets: resets on restart, fresh wallets walk around
        # it — accepted for a lab faucet handing out test tokens.
        self.COOLDOWN_PERIOD = 60
        self.last_request = {}
        self.cooldown_lock = threading.Lock()

        # (token, network) -> (unix time, balance). One token page
        # asks for the faucet's balance on EVERY chain the token
        # lives on, and the page polls — without this cache that is
        # one RPC call per chain per poll.
        self.BALANCE_CACHE_TTL = 30
        self._balance_cache = {}




    ############################################################
    # deployments_of
    ############################################################
    #
    # Where one token lives: [(network, contract_address), …]
    # for every deployment whose network the backend can
    # actually reach (a config typo therefore hides the row
    # instead of breaking the page).
    #
    # Used by:
    #   - get_token_catalog / get_token (below)
    #   - is_supported (below)
    ############################################################

    def deployments_of(self, token_symbol):
        config = self.TOKEN_CONFIGS.get(token_symbol)
        if not config:
            return []

        return [
            (network, address)
            for network, address in (config.get('deployments') or {}).items()
            if network in self.evm_faucet.w3_instances
        ]




    ############################################################
    # is_supported
    ############################################################
    #
    # A (network, token) pair is supported when the token has a
    # reachable deployment on that network.
    #
    # Used by:
    #   - request_tokens (below)
    ############################################################

    def is_supported(self, network, token_symbol):
        return any(net == network for net, _ in self.deployments_of(token_symbol))




    ############################################################
    # _token_balance
    ############################################################
    #
    # The faucet's balance of one token on one chain, in whole
    # tokens, cached for BALANCE_CACHE_TTL seconds. Returns
    # None when the call fails (logged) — the page renders a
    # dash instead of losing the whole row.
    #
    # Used by:
    #   - get_token (below)
    ############################################################

    def _token_balance(self, token_symbol, network, contract_address, decimals):
        cache_key = (token_symbol, network)
        cached = self._balance_cache.get(cache_key)
        if cached and int(time.time()) - cached[0] < self.BALANCE_CACHE_TTL:
            return cached[1]

        balance = None
        try:
            w3 = self.evm_faucet.w3_instances[network]
            contract = get_erc20_contract(w3, contract_address)
            raw = contract.functions.balanceOf(self.evm_faucet.FAUCET_ADDRESS).call()
            balance = raw / (10 ** decimals)
        except Exception:
            logging.exception(f"Failed to fetch {token_symbol} balance on {network}")

        self._balance_cache[cache_key] = (int(time.time()), balance)
        return balance




    ############################################################
    # get_token_catalog
    ############################################################
    #
    # Every token the faucet offers, with the list of networks
    # it lives on — this is what the navbar's token picker
    # renders. Deliberately free of RPC calls: no balances
    # here, so the picker is instant.
    #
    # Used by:
    #   - erc20_routes.py — GET /api/erc20/tokens
    ############################################################

    def get_token_catalog(self):
        tokens = {}
        for symbol, config in self.TOKEN_CONFIGS.items():
            networks = [network for network, _ in self.deployments_of(symbol)]
            if not networks:
                continue

            tokens[symbol] = {
                'symbol': symbol,
                'name': config.get('name', symbol),
                'decimals': config['decimals'],
                'chunk_size': float(config['chunk_size']),
                'networks': networks,
            }

        return {
            'default_token': next(iter(tokens), None),
            'tokens': tokens,
        }, 200




    ############################################################
    # get_token
    ############################################################
    #
    # One token across every chain it lives on — the ERC-20
    # faucet page in a single payload. Each deployment carries
    # the faucet's balance plus the full network metadata the
    # frontend needs to hand MetaMask
    # (wallet_addEthereumChain / wallet_watchAsset).
    #
    # With a wallet_address, each deployment also reports that
    # wallet's NATIVE balance (wallet_native_wei) — checked
    # HERE, over the backend's own RPC connections, because the
    # public rpc_urls we ship to MetaMask are not reliable from
    # a browser (rpc.sepolia.org answers 403). The page gates
    # its claim buttons on it; None (bad address, RPC hiccup)
    # makes the frontend fail open — request_tokens still
    # enforces the rule.
    #
    # Used by:
    #   - erc20_routes.py — GET /api/erc20/token/<symbol>
    ############################################################

    def get_token(self, token_symbol, wallet_address=None):
        token_symbol = (token_symbol or '').upper()
        config = self.TOKEN_CONFIGS.get(token_symbol)

        if not config:
            return {"error": f"Nepalaikomas žetonas: {token_symbol}"}, 400

        deployments = []
        for network, contract_address in self.deployments_of(token_symbol):
            network_config = self.evm_faucet.NETWORK_CONFIGS[network]
            faucet_config = network_config.get('faucet', {})
            metamask_config = network_config.get('metamask', {})
            w3 = self.evm_faucet.w3_instances[network]

            wallet_native_wei = None
            if wallet_address:
                try:
                    wallet_native_wei = str(w3.eth.get_balance(w3.to_checksum_address(wallet_address)))
                except Exception:
                    logging.exception(f"Failed to fetch native balance of {wallet_address} on {network}")

            deployments.append({
                'network': network,
                'full_name': faucet_config.get('full_name', network),
                'short_name': faucet_config.get('short_name', ''),
                'chain_name': metamask_config.get('chain_name', faucet_config.get('full_name', network)),
                'chain_id': network_config.get('chain_id'),
                'native_currency': metamask_config.get('native_currency'),
                'rpc_urls': metamask_config.get('rpc_urls', []),
                'block_explorer_urls': metamask_config.get('block_explorer_urls', []),
                'contract_address': contract_address,
                'balance': self._token_balance(token_symbol, network, contract_address, config['decimals']),
                # Strings, not ints: 0.025 ETH is 2.5e16 wei — past
                # JavaScript's safe-integer range
                'min_native_wei': str(self._min_native_wei(network)),
                'wallet_native_wei': wallet_native_wei,
            })

        return {
            'token': {
                'symbol': token_symbol,
                'name': config.get('name', token_symbol),
                'decimals': config['decimals'],
                'chunk_size': float(config['chunk_size']),
            },
            'faucet_address': (self.evm_faucet.FAUCET_ADDRESS or '').lower(),
            'deployments': deployments,
        }, 200




    ############################################################
    # _min_native_wei
    ############################################################
    #
    # The gas threshold for a payout, in wei: HALF of the native
    # faucet's chunk on that chain. A wallet below it gets
    # pointed at the native faucet first — receiving tokens is
    # free, but a wallet that can't afford a transaction would
    # just sit on them. A network with no chunk_size configured
    # yields 0, which disables the check.
    #
    # Used by:
    #   - get_token (above) — shipped to the frontend per
    #     deployment, so both sides gate on the SAME number
    #   - request_tokens (below) — the enforcement
    ############################################################

    def _min_native_wei(self, network):
        w3 = self.evm_faucet.w3_instances[network]
        chunk = float(self.evm_faucet.NETWORK_CONFIGS[network].get('faucet', {}).get('chunk_size', 0))
        return int(w3.to_wei(chunk / 2, 'ether'))




    ############################################################
    # request_tokens
    ############################################################
    #
    # The actual payout: validate everything, then broadcast
    # one chunk-sized transfer() under the send lock shared
    # with the native EVM faucet (same wallet, same nonce
    # sequence). The student's wallet does NOT have to be on
    # the target chain — the signature only proves address
    # ownership. Returns a (payload, http_status) tuple;
    # user-facing errors are Lithuanian.
    #
    # Used by:
    #   - erc20_routes.py —
    #     GET /api/erc20/<network>/<token>/request
    ############################################################

    def request_tokens(self, network, token_symbol, to_address, signature, nonce):
        token_symbol = (token_symbol or '').upper()

        if not self.is_supported(network, token_symbol):
            return {"error": f"Žetonas {token_symbol} šiame tinkle neegzistuoja"}, 400

        if not self.evm_faucet.FAUCET_ADDRESS:
            return {"error": "Čiaupo adresas nesukonfigūruotas"}, 500

        w3 = self.evm_faucet.w3_instances[network]
        config = self.TOKEN_CONFIGS[token_symbol]
        contract_address = config['deployments'][network]

        # STEP 1: input validation — all parameters present and the
        # address parses.
        if not all([to_address, signature, nonce]):
            return {"error": "Trūksta reikalingų parametrų"}, 400

        try:
            to_address = w3.to_checksum_address(to_address)
        except Exception:
            return {"error": "Neteisingas adresas"}, 400

        # STEP 2: signature check — the exact message the frontend
        # asks MetaMask to sign, identical to the native ETH flow.
        message = f"Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: {nonce}"
        if not self.evm_faucet.verify_signature(network, to_address, message, signature):
            return {"error": "Kriptografinis parašas kažkodėl neatitinka"}, 403

        contract = get_erc20_contract(w3, contract_address)
        amount_to_send = int(float(config['chunk_size']) * (10 ** config['decimals']))

        # STEP 3: eligibility — the wallet must hold ENOUGH native
        # crypto on this chain (half the native faucet's chunk;
        # receiving tokens is free, but USING them costs gas — a
        # wallet below the bar gets pointed at the native faucet
        # instead), must not already hold a full chunk, the
        # (network, token, address) cooldown has to be over, and
        # the faucet must still hold the tokens.
        try:
            native_balance = w3.eth.get_balance(to_address)
            user_balance = contract.functions.balanceOf(to_address).call()
        except Exception:
            return {"error": "Nepavyko gauti naudotojo balanso"}, 500

        if native_balance < self._min_native_wei(network):
            network_config = self.evm_faucet.NETWORK_CONFIGS[network]
            native_symbol = (network_config.get('metamask', {}).get('native_currency') or {}).get('symbol', 'ETH')
            needed = float(network_config.get('faucet', {}).get('chunk_size', 0)) / 2
            return {"error": f"Piniginėje per mažai {native_symbol} tinklo mokesčiams (reikia bent {needed:g} {native_symbol}). Pirmiausia pasiimkite jų iš {network_config.get('faucet', {}).get('full_name', network)} faucet'o."}, 400

        if user_balance >= amount_to_send:
            return {"error": f"Jūsų piniginėje jau yra pakankamai {token_symbol}."}, 400

        # The cooldown slot is check-and-CLAIMED atomically, before
        # the remaining RPC work — two parallel requests from the
        # same address would otherwise both pass a bare check and
        # get paid twice. Every failure path below releases the
        # slot, so a failed attempt never locks the student out.
        # (Its own tiny lock, not the send lock: no RPC happens
        # while holding it.)
        cooldown_key = (network, token_symbol, to_address.lower())
        with self.cooldown_lock:
            last_attempt = self.last_request.get(cooldown_key)
            if last_attempt is not None:
                time_since = int(time.time()) - last_attempt
                if time_since < self.COOLDOWN_PERIOD:
                    return {"error": f"Žetonai jums jau išsiųsti. Daugiau galėsite pasiimti už {self.COOLDOWN_PERIOD - time_since} sek."}, 429
            self.last_request[cooldown_key] = int(time.time())

        try:
            faucet_token_balance = contract.functions.balanceOf(self.evm_faucet.FAUCET_ADDRESS).call()
        except Exception:
            self.last_request.pop(cooldown_key, None)
            return {"error": "Nepavyko gauti čiaupo balanso"}, 500

        if faucet_token_balance < amount_to_send:
            self.last_request.pop(cooldown_key, None)
            return {"error": "Čiaupas nebeturi žetonų. Praneškite dėstytojui."}, 503

        # STEP 4: build, sign and broadcast — under the SHARED send
        # lock with a pending nonce, so token and native payouts from
        # the same wallet never collide. Gas is estimated per chain
        # (zkSync-style chains want very different numbers than the
        # classic 100k), with a safe fallback.
        transfer_fn = contract.functions.transfer(to_address, amount_to_send)

        try:
            gas_limit = int(transfer_fn.estimate_gas({'from': self.evm_faucet.FAUCET_ADDRESS}) * 1.5)
        except Exception:
            gas_limit = 100000

        try:
            with self.evm_faucet.send_lock:
                nonce_tx = w3.eth.get_transaction_count(self.evm_faucet.FAUCET_ADDRESS, 'pending')
                tx = transfer_fn.build_transaction({
                    'from': self.evm_faucet.FAUCET_ADDRESS,
                    'nonce': nonce_tx,
                    'gas': gas_limit,
                    'gasPrice': w3.eth.gas_price,
                    'chainId': self.evm_faucet.NETWORK_CONFIGS[network]['chain_id'],
                })

                signed_tx = w3.eth.account.sign_transaction(tx, self.evm_faucet.FAUCET_PRIVATE_KEY)

                # web3 v7 renamed rawTransaction -> raw_transaction;
                # the image ships 6.20.1, which only has the OLD name
                # — accept either so an upgrade doesn't break payouts
                raw_tx = getattr(signed_tx, 'raw_transaction', None) or signed_tx.rawTransaction
                tx_hash = w3.eth.send_raw_transaction(raw_tx)
        except Exception:
            logging.exception(f"Failed to broadcast {token_symbol} payout on {network}")
            self.last_request.pop(cooldown_key, None)
            return {"error": "Nepavyko išsiųsti transakcijos. Bandykite dar kartą."}, 500

        # Success — the cooldown slot claimed in STEP 3 stays, and
        # the cached balance is dropped so the page shows the new
        # number on its next poll.
        self._balance_cache.pop((token_symbol, network), None)

        return {
            "message": f"{token_symbol} sent successfully",
            "transaction_hash": tx_hash.hex(),
            "amount": float(config['chunk_size']),
            "token": token_symbol,
            "network": network,
        }, 200
