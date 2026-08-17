############################################################
#  [*] UTXO config schema
#
#  The ENFORCED shape of one UTXO_NETWORK_CONFIGS entry —
#  identity plus the operator's faucet choices (coin, network
#  flavour, payout, ElectrumX endpoint) and the optional
#  explorer link. The coin + flavour pair is confirmed
#  against this package's own coin registry (coins/) at boot.
#  Built on the strict base, so a misspelled key fails the
#  boot with a precise error.
#
#  Used by:
#    - app/config_models.py — validate_configs()
############################################################


from typing import Optional, Literal

from pydantic import Field, model_validator

from ..config_base import StrictModel








############################################################
# UtxoFaucetSection
############################################################
#
# The OPERATOR's choices for one UTXO network — and nothing
# more: which coin ('bitcoin', 'litecoin', 'knfcoin',
# 'dogecoin'), which network flavour, the payout size and the
# ElectrumX endpoint (host:port, SSL).
#
# Everything protocol-precise — address version bytes, bech32
# HRPs, fee rates, dust limits — is a fact about the coin,
# not a choice, and resolves from the in-code registry
# (app/utxo_faucet/coins/) at startup. The validator below
# confirms the coin + flavour combination exists there, so a
# typo names the known options at boot.
#
# Used by:
#   - UtxoNetworkConfig (below)
############################################################

class UtxoFaucetSection(StrictModel):
    coin: str = Field(min_length=1)
    chunk_size: float = Field(gt=0)
    network: Literal['mainnet', 'testnet', 'regtest']
    electrum_server: str = Field(pattern=r'^[\w.\-]+:\d+$')




    ############################################################
    # coin_and_flavour_exist
    ############################################################
    #
    # The coin + network flavour must resolve in the in-code
    # registry — coin_params raises a ValueError that names
    # the known coins / available flavours, and that message
    # surfaces verbatim in the boot error.
    #
    # Used by:
    #   - pydantic — automatically on model validation
    ############################################################

    @model_validator(mode='after')
    def coin_and_flavour_exist(self):
        from app.utxo_faucet.coins import coin_params
        coin_params(self.coin, self.network)  # raises ValueError naming the options
        return self








############################################################
# UtxoExplorerSection
############################################################
#
# Where the UI links a transaction / address. Optional.
#
# Used by:
#   - UtxoNetworkConfig (below)
############################################################

class UtxoExplorerSection(StrictModel):
    block_explorer: str = Field(pattern=r'^https?://')








############################################################
# UtxoNetworkConfig
############################################################
#
# One UTXO network: identity plus the faucet section.
#
# Used by:
#   - app/config_models.py — validate_configs()
############################################################

class UtxoNetworkConfig(StrictModel):
    id: int = Field(ge=1)
    short_name: str = Field(min_length=1)
    full_name: str = Field(min_length=1)
    faucet: UtxoFaucetSection
    explorer: Optional[UtxoExplorerSection] = None
