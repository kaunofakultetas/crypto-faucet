############################################################
#  [*] MOVE config schema
#
#  The ENFORCED shape of one MOVE_NETWORK_CONFIGS entry —
#  identity plus the operator's faucet choices (chain,
#  network flavour, payout, the backend's own GraphQL
#  endpoint), the wallet section (public endpoint the page
#  may query) and the optional explorer links. The chain +
#  flavour pair is confirmed against this package's own chain
#  registry (chains/) at boot. Built on the strict base, so a
#  misspelled key fails the boot with a precise error.
#
#  Used by:
#    - app/config_models.py — validate_configs()
############################################################


from typing import Optional

from pydantic import Field, model_validator

from ..config_base import StrictModel








############################################################
# MoveFaucetSection
############################################################
#
# The OPERATOR's choices for one Move network: which chain
# ('sui'), which network flavour, the display names, the
# payout size and the backend's own GraphQL endpoint (which
# may carry <ENV_NAME> placeholders, resolved at startup by
# MoveFaucet).
#
# Everything protocol-precise — the native symbol, MIST
# decimals, the coin type tag, the gas margin — is a fact
# about the chain and resolves from the in-code registry
# (app/move_faucet/chains/). The validator below confirms the
# chain + flavour combination exists there.
#
# Used by:
#   - MoveNetworkConfig (below)
############################################################

class MoveFaucetSection(StrictModel):
    chain: str = Field(min_length=1)
    network: str = Field(min_length=1)
    short_name: str = Field(min_length=1)
    full_name: str = Field(min_length=1)
    rpc_url: str = Field(pattern=r'^https?://')
    chunk_size: float = Field(gt=0)




    ############################################################
    # chain_and_flavour_exist
    ############################################################
    #
    # The chain + network flavour must resolve in the in-code
    # registry — chain_params raises a ValueError that names
    # the known chains / available flavours, and that message
    # surfaces verbatim in the boot error. Compares constants,
    # so it belongs here: the operator learns at boot, not on
    # the first claim.
    #
    # Used by:
    #   - pydantic — automatically on model validation
    ############################################################

    @model_validator(mode='after')
    def chain_and_flavour_exist(self):
        from app.move_faucet.chains import chain_params
        chain_params(self.chain, self.network)  # raises ValueError naming the options
        return self








############################################################
# MoveWalletSection
############################################################
#
# The public GraphQL endpoint the PAGE may query for the
# student's balance — public endpoints only, never the
# backend's keyed RPC.
#
# Used by:
#   - MoveNetworkConfig (below)
############################################################

class MoveWalletSection(StrictModel):
    rpc_urls: list[str] = Field(min_length=1)








############################################################
# MoveExplorerSection
############################################################
#
# Where the UI links a transaction / address. Optional.
#
# Used by:
#   - MoveNetworkConfig (below)
############################################################

class MoveExplorerSection(StrictModel):
    block_explorer_urls: list[str] = []








############################################################
# MoveNetworkConfig
############################################################
#
# One Move network: identity plus the consumer sections.
# Like SVM there is no chain_id — Move chains are told apart
# by their endpoint, not by a numeric id.
#
# Used by:
#   - validate_configs — app/config_models.py
############################################################

class MoveNetworkConfig(StrictModel):
    id: int = Field(ge=1)
    faucet: MoveFaucetSection
    wallet: MoveWalletSection
    explorer: Optional[MoveExplorerSection] = None
