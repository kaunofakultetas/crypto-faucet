############################################################
#  [*] ERC-20 contract helpers
#
#  The minimal ABI surface the faucet needs to talk to any
#  standard ERC-20 token — balances and transfers, plus the
#  metadata getters (name/symbol/decimals) for debugging in
#  a REPL. The token metadata the app actually displays comes
#  from ERC20_TOKEN_CONFIGS in main.py, not from the chain:
#  the config is authoritative and costs no RPC calls.
#
#  Used by:
#    - erc20_faucet.py — every balance check and transfer
############################################################




############################################################
# ERC20_ABI
############################################################
#
# Just the five standard functions the faucet touches. Any
# ERC-20 deployment answers these; nothing token-specific
# belongs here.
#
# Used by:
#   - get_erc20_contract (below)
############################################################

ERC20_ABI = [
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"}
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [],
        "name": "symbol",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [],
        "name": "name",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function"
    }
]




############################################################
# get_erc20_contract
############################################################
#
# A web3 contract handle for one deployment — the address is
# checksummed on the way in, so lowercase config entries work.
#
# Used by:
#   - erc20_faucet.py — get_network_tokens / request_tokens
############################################################

def get_erc20_contract(w3, contract_address):
    return w3.eth.contract(
        address=w3.to_checksum_address(contract_address),
        abi=ERC20_ABI
    )
