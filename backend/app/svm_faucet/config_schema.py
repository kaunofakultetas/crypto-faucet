############################################################
#  [*] SVM config schema
#
#  The ENFORCED shape of one SVM_NETWORK_CONFIGS entry —
#  identity plus the operator's faucet choices (chain,
#  network flavour, payout, the backend's own RPC), the
#  wallet section (public endpoints for Phantom) and the
#  optional explorer links. The chain + flavour pair AND the
#  payout's rent-exempt viability are confirmed against this
#  package's own chain registry (chains/) at boot. Built on
#  the strict base, so a misspelled key fails the boot with a
#  precise error.
#
#  Used by:
#    - app/config_models.py — validate_configs()
############################################################


from typing import Optional

from pydantic import Field, model_validator

from ..config_base import StrictModel








############################################################
# SvmFaucetSection
############################################################
#
# The OPERATOR's choices for one SVM network: which chain
# ('solana'), which network flavour, the display names, the
# payout size and the backend's own RPC (which may carry
# <ENV_NAME> placeholders, resolved at startup by SVMFaucet).
#
# Everything protocol-precise — the native symbol, lamport
# decimals, the per-signature fee, the rent-exempt minimum —
# is a fact about the chain and resolves from the in-code
# registry (app/svm_faucet/chains/). The validator below
# confirms the chain + flavour combination exists there and
# that the payout clears the rent-exempt minimum.
#
# Used by:
#   - SvmNetworkConfig (below)
############################################################

class SvmFaucetSection(StrictModel):
    chain: str = Field(min_length=1)
    network: str = Field(min_length=1)
    short_name: str = Field(min_length=1)
    full_name: str = Field(min_length=1)
    rpc_url: str = Field(pattern=r'^https?://')
    chunk_size: float = Field(gt=0)




    ############################################################
    # chain_and_flavour_are_payable
    ############################################################
    #
    # Two boot checks on one config entry:
    #
    #   - the chain + network flavour must resolve in the
    #     in-code registry — chain_params raises a ValueError
    #     that names the known chains / available flavours, and
    #     that message surfaces verbatim in the boot error
    #   - the payout must clear the chain's rent-exempt
    #     minimum. An account funded below it is reclaimed by
    #     the runtime, so the student would watch the transfer
    #     confirm and the balance vanish
    #
    # Both compare constants, so both belong here rather than
    # in the payout path: the operator learns at boot, not on
    # the first claim.
    #
    # Used by:
    #   - pydantic — automatically on model validation
    ############################################################

    @model_validator(mode='after')
    def chain_and_flavour_are_payable(self):
        from app.svm_faucet.chains import chain_params
        params = chain_params(self.chain, self.network)  # raises ValueError naming the options

        chunk_lamports = int(self.chunk_size * (10 ** params['decimals']))
        if chunk_lamports < params['min_payout_lamports']:
            raise ValueError(
                f"chunk_size {self.chunk_size} is {chunk_lamports} lamports — below the "
                f"{params['min_payout_lamports']} lamport rent-exempt minimum on '{self.chain}'"
            )
        return self








############################################################
# SvmWalletSection
############################################################
#
# What the student's Phantom wallet should talk to —
# public endpoints only, never the backend's keyed RPC.
#
# Used by:
#   - SvmNetworkConfig (below)
############################################################

class SvmWalletSection(StrictModel):
    rpc_urls: list[str] = Field(min_length=1)








############################################################
# SvmExplorerSection
############################################################
#
# Where the UI links a transaction / address. Optional.
#
# Used by:
#   - SvmNetworkConfig (below)
############################################################

class SvmExplorerSection(StrictModel):
    block_explorer_urls: list[str] = []








############################################################
# SvmNetworkConfig
############################################################
#
# One SVM network: identity plus the consumer sections. There
# is no chain_id — SVM chains are told apart by their RPC
# endpoint, not by a numeric id the way EVM chains are.
#
# Used by:
#   - app/config_models.py — validate_configs()
############################################################

class SvmNetworkConfig(StrictModel):
    id: int = Field(ge=1)
    faucet: SvmFaucetSection
    wallet: SvmWalletSection
    explorer: Optional[SvmExplorerSection] = None
