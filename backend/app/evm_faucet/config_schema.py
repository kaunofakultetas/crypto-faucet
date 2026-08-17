############################################################
#  [*] EVM config schema
#
#  The ENFORCED shape of one EVM_NETWORK_CONFIGS entry —
#  identity (id, chain_id) plus the three consumer sections:
#  'faucet' (the backend's own RPC and payout), 'metamask'
#  (what wallet_addEthereumChain receives, verbatim) and the
#  optional 'explorer' (the /graph scraper). Built on the
#  strict base, so a misspelled key fails the boot with a
#  precise error.
#
#  Used by:
#    - app/config_models.py — validate_configs()
############################################################


from typing import Optional

from pydantic import Field

from ..config_base import StrictModel








############################################################
# EvmNativeCurrency
############################################################
#
# The nativeCurrency object handed to MetaMask verbatim
# (EIP-3085). Symbol length is loose on purpose — MetaMask's
# documented 2-6 is not enforced in practice ('LineaETH').
#
# Used by:
#   - EvmMetamaskSection (below)
############################################################

class EvmNativeCurrency(StrictModel):
    name: str = Field(min_length=1)
    symbol: str = Field(min_length=1, max_length=12)
    decimals: int = Field(ge=0, le=36)








############################################################
# EvmFaucetSection
############################################################
#
# What the backend itself uses: display names, its own RPC
# (may carry <ENV_NAME> placeholders, resolved at startup by
# EVMFaucet) and the payout size.
#
# Used by:
#   - EvmNetworkConfig (below)
############################################################

class EvmFaucetSection(StrictModel):
    short_name: str = Field(min_length=1)
    full_name: str = Field(min_length=1)
    rpc_url: str = Field(pattern=r'^https?://')
    chunk_size: float = Field(gt=0)








############################################################
# EvmMetamaskSection
############################################################
#
# Exactly what wallet_addEthereumChain receives. The URL
# fields are ARRAYS by EIP-3085 — MetaMask rejects bare
# strings, and extra entries are meaningful (fallback RPCs).
#
# Used by:
#   - EvmNetworkConfig (below)
############################################################

class EvmMetamaskSection(StrictModel):
    chain_name: str = Field(min_length=1)
    native_currency: EvmNativeCurrency
    rpc_urls: list[str] = Field(min_length=1)
    block_explorer_urls: list[str] = []








############################################################
# EvmExplorerSection
############################################################
#
# The /graph scraper's Etherscan-style API. The whole section
# is optional on a network — no section, no graph.
#
# Used by:
#   - EvmNetworkConfig (below)
############################################################

class EvmExplorerSection(StrictModel):
    etherscan_api_url: str = Field(pattern=r'^https?://')








############################################################
# EvmNetworkConfig
############################################################
#
# One EVM network: top-level identity plus the three consumer
# sections.
#
# Used by:
#   - app/config_models.py — validate_configs()
############################################################

class EvmNetworkConfig(StrictModel):
    id: int = Field(ge=1)
    chain_id: int = Field(ge=1)
    faucet: EvmFaucetSection
    metamask: EvmMetamaskSection
    explorer: Optional[EvmExplorerSection] = None
