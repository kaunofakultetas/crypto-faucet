############################################################
#  [*] Config models
#
#  The ENFORCED schema for main.py's three config maps
#  (EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS,
#  UTXO_NETWORK_CONFIGS). Every model forbids unknown keys,
#  so a misspelled field name fails the boot with a precise
#  error instead of silently falling back to a default
#  somewhere at runtime — the same fail-at-startup philosophy
#  as the warmups, applied to configuration.
#
#  main.py authors the configs as plain readable dicts and
#  pipes them through validate_configs() at import time; what
#  comes back out is normalized plain dicts again, so every
#  consumer keeps its ordinary dict access.
#
#  Used by:
#    - main.py — validate_configs() right after the config
#      definitions
#    - tests/test_config_models.py — the negative cases
############################################################


from typing import Optional, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator




############################################################
# StrictModel
############################################################
#
# Shared base: unknown keys are ERRORS. This is what turns
# 'chunk_sizee' from a silent runtime fallback into a loud
# boot failure.
#
# Used by:
#   - every model below
############################################################

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')




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
#   - validate_configs (below)
############################################################

class EvmNetworkConfig(StrictModel):
    id: int = Field(ge=1)
    chain_id: int = Field(ge=1)
    faucet: EvmFaucetSection
    metamask: EvmMetamaskSection
    explorer: Optional[EvmExplorerSection] = None




############################################################
# Erc20TokenConfig
############################################################
#
# One token, token-first: defined once with a deployments map
# of network key -> contract address. The network keys are
# cross-checked against the EVM configs in validate_configs.
#
# Used by:
#   - validate_configs (below)
############################################################

class Erc20TokenConfig(StrictModel):
    name: str = Field(min_length=1)
    decimals: int = Field(ge=0, le=36)
    chunk_size: float = Field(gt=0)
    deployments: dict[str, str]

    @field_validator('deployments')
    @classmethod
    def addresses_are_contracts(cls, deployments):
        import re
        for network, address in deployments.items():
            if not re.fullmatch(r'0x[0-9a-fA-F]{40}', address):
                raise ValueError(f"deployment on '{network}' has a malformed contract address: {address}")
        return deployments




############################################################
# UtxoFaucetSection
############################################################
#
# What the UTXO payout machinery uses: payout size, chain
# flavour, the bech32 HRP addresses are built with, and the
# ElectrumX endpoint (host:port, SSL).
#
# Used by:
#   - UtxoNetworkConfig (below)
############################################################

class UtxoFaucetSection(StrictModel):
    chunk_size: float = Field(gt=0)
    network: Literal['mainnet', 'testnet', 'regtest']
    hrp: str = Field(pattern=r'^[a-z]{2,8}$')
    electrum_server: str = Field(pattern=r'^[\w.\-]+:\d+$')




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
#   - validate_configs (below)
############################################################

class UtxoNetworkConfig(StrictModel):
    id: int = Field(ge=1)
    short_name: str = Field(min_length=1)
    full_name: str = Field(min_length=1)
    faucet: UtxoFaucetSection
    explorer: Optional[UtxoExplorerSection] = None




############################################################
# validate_configs
############################################################
#
# The single entry point: validates all three maps, enforces
# the cross-map rules the per-entry models can't see (unique
# ids and chain ids; every token deployment referencing an
# existing EVM network), and returns NORMALIZED PLAIN DICTS
# (None sections dropped) so consumers keep their ordinary
# dict access. Raises ValueError with the offending entry's
# name in the message — the boot dies loudly on a bad config.
#
# Used by:
#   - main.py — right after the config definitions
############################################################

def validate_configs(evm_configs, erc20_configs, utxo_configs):
    evm, erc20, utxo = {}, {}, {}

    for key, config in (evm_configs or {}).items():
        try:
            evm[key] = EvmNetworkConfig.model_validate(config)
        except ValueError as e:
            raise ValueError(f"EVM network '{key}' is misconfigured:\n{e}") from None

    for symbol, config in (erc20_configs or {}).items():
        try:
            erc20[symbol] = Erc20TokenConfig.model_validate(config)
        except ValueError as e:
            raise ValueError(f"ERC-20 token '{symbol}' is misconfigured:\n{e}") from None

    for key, config in (utxo_configs or {}).items():
        try:
            utxo[key] = UtxoNetworkConfig.model_validate(config)
        except ValueError as e:
            raise ValueError(f"UTXO network '{key}' is misconfigured:\n{e}") from None

    # Cross-map rules: unique picker ids per family, unique EVM
    # chain ids, and every token deployment on a known network.
    for family, configs in (('EVM', evm), ('UTXO', utxo)):
        ids = [c.id for c in configs.values()]
        if len(ids) != len(set(ids)):
            raise ValueError(f"{family} network configs reuse an 'id' — picker order would break")

    chain_ids = [c.chain_id for c in evm.values()]
    if len(chain_ids) != len(set(chain_ids)):
        raise ValueError("EVM network configs reuse a 'chain_id'")

    for symbol, token in erc20.items():
        for network in token.deployments:
            if network not in evm:
                raise ValueError(
                    f"ERC-20 token '{symbol}' is deployed on unknown network '{network}' — "
                    f"known EVM networks: {sorted(evm)}"
                )

    return (
        {key: model.model_dump(exclude_none=True) for key, model in evm.items()},
        {key: model.model_dump(exclude_none=True) for key, model in erc20.items()},
        {key: model.model_dump(exclude_none=True) for key, model in utxo.items()},
    )
