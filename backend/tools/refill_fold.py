############################################################
#  [*] Refill tool — claim test FOLD from the Interfold faucet
#
#  One claim from Interfold's own on-chain faucet on Sepolia:
#  calls its faucet() function signed with OUR faucet wallet,
#  which pays 200 FOLD (plus their mock USDC fee token) to the
#  caller. Their contract tops up only wallets holding LESS
#  than 200 FOLD — claims do not stack, so this tool is a
#  top-up to run whenever payouts drain the wallet below 200
#  (at chunk_size 5 that is every ~40 student claims).
#
#  Until someone calls the FOLD token's permissionless tge()
#  (possible from 2026-10-07 09:52 UTC on), the claimed FOLD
#  sits in the wallet but cannot be paid out — transfers
#  revert with TransferRestricted and students get a 503.
#  Claiming ahead of that date is still fine.
#
#  Run inside the backend container, which holds the key and
#  the Infura id in its environment:
#
#      sudo docker exec -i faucet-backend python /app/tools/refill_fold.py
#
#  Prints addresses, the tx hash and balances — never the key.
#
#  Used by:
#    - nothing calls this — an operator-run CLI tool
############################################################


import os

from web3 import Web3
from eth_account import Account


# The Interfold Sepolia deployment (docs.theinterfold.com,
# deploy-to-testnet tutorial) — same addresses as the FOLD
# entry in _CONFIG/coins.py
FOLD_TOKEN = Web3.to_checksum_address('0x9752444A6a955D420402EaFf5f818afCddb9c340')
INTERFOLD_FAUCET = Web3.to_checksum_address('0x6e281411C055BEEbD74bDFcB9aB095aa98907F85')

SEPOLIA_CHAIN_ID = 11155111

ERC20_ABI = [
    {'name': 'balanceOf', 'outputs': [{'type': 'uint256'}],
     'inputs': [{'name': 'a', 'type': 'address'}],
     'stateMutability': 'view', 'type': 'function'},
]

FAUCET_ABI = [
    {'name': 'faucet', 'outputs': [], 'inputs': [],
     'stateMutability': 'nonpayable', 'type': 'function'},
]




# ##########################################################
# main
# ##########################################################
#
# Used by:
#   - the __main__ guard below
# ##########################################################

def main():

    # STEP 1: connect and load the wallet from the environment
    # ========================================================
    w3 = Web3(Web3.HTTPProvider(
        f"https://sepolia.infura.io/v3/{os.environ['INFURA_PROJECT_ID']}",
        request_kwargs={'timeout': 30},
    ))
    account = Account.from_key(os.environ['FAUCET_PRIVATE_KEY'])
    print('faucet wallet:', account.address)

    if w3.eth.chain_id != SEPOLIA_CHAIN_ID:
        raise SystemExit('RPC is not Sepolia — refusing')

    fold = w3.eth.contract(address=FOLD_TOKEN, abi=ERC20_ABI)
    upstream = w3.eth.contract(address=INTERFOLD_FAUCET, abi=FAUCET_ABI)

    before = fold.functions.balanceOf(account.address).call()
    print('FOLD before:', before / 1e18)


    # STEP 2: simulate first — their faucet reverts when the
    # wallet already holds 200 FOLD or more, and a doomed
    # claim should not cost gas
    # =======================================================
    try:
        upstream.functions.faucet().estimate_gas({'from': account.address})
    except Exception:
        raise SystemExit('claim would revert — wallet already holds 200+ FOLD, nothing to do')


    # STEP 3: build, sign and broadcast the claim
    # ===========================================
    tx = upstream.functions.faucet().build_transaction({
        'from': account.address,
        'nonce': w3.eth.get_transaction_count(account.address),
        'maxFeePerGas': w3.eth.gas_price * 2,
        'maxPriorityFeePerGas': w3.to_wei(1, 'gwei'),
        'chainId': SEPOLIA_CHAIN_ID,
    })
    tx['gas'] = int(w3.eth.estimate_gas(tx) * 1.2)

    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print('claim tx: https://sepolia.etherscan.io/tx/0x' + tx_hash.hex().removeprefix('0x'))


    # STEP 4: wait for the receipt and report the new balance
    # =======================================================
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
    print('status:', 'success' if receipt.status == 1 else 'FAILED', '— gas used:', receipt.gasUsed)
    print('FOLD after:', fold.functions.balanceOf(account.address).call() / 1e18)


if __name__ == '__main__':
    main()
