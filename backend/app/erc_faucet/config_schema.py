############################################################
#  [*] ERC-20 config schema
#
#  The ENFORCED shape of one ERC20_TOKEN_CONFIGS entry —
#  token-first: a token is defined once with a deployments
#  map of network key -> contract address. The network keys
#  are cross-checked against the EVM configs by the connector
#  (that rule spans two maps, so it cannot live here). Built
#  on the strict base, so a misspelled key fails the boot
#  with a precise error.
#
#  Used by:
#    - app/config_models.py — validate_configs()
############################################################


from pydantic import Field, field_validator

from ..config_base import StrictModel








############################################################
# Erc20TokenConfig
############################################################
#
# One token, token-first: defined once with a deployments map
# of network key -> contract address. The network keys are
# cross-checked against the EVM configs in validate_configs.
#
# Used by:
#   - app/config_models.py — validate_configs()
############################################################

class Erc20TokenConfig(StrictModel):
    name: str = Field(min_length=1)
    decimals: int = Field(ge=0, le=36)
    chunk_size: float = Field(gt=0)
    deployments: dict[str, str]




    ############################################################
    # addresses_are_contracts
    ############################################################
    #
    # Every deployment value must be a well-formed 0x…40-hex
    # contract address — the network-key side is cross-checked
    # against the EVM map later, in validate_configs.
    #
    # Used by:
    #   - pydantic — automatically on model validation
    ############################################################

    @field_validator('deployments')
    @classmethod
    def addresses_are_contracts(cls, deployments):
        import re
        for network, address in deployments.items():
            if not re.fullmatch(r'0x[0-9a-fA-F]{40}', address):
                raise ValueError(f"deployment on '{network}' has a malformed contract address: {address}")
        return deployments
