############################################################
#  [*] Config models — the connector
#
#  The single validation entry point for main.py's five
#  config maps. The SCHEMAS themselves live with their
#  families — app/<family>/config_schema.py, each built on
#  app/config_base.py's strict foundation — so this module
#  only imports them and enforces the rules that SPAN
#  families: unique picker ids, unique EVM chain ids, and
#  every ERC-20 deployment referencing an existing EVM
#  network.
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


from app.evm_faucet.config_schema import EvmNetworkConfig
from app.erc_faucet.config_schema import Erc20TokenConfig
from app.utxo_faucet.config_schema import UtxoNetworkConfig
from app.svm_faucet.config_schema import SvmNetworkConfig
from app.move_faucet.config_schema import MoveNetworkConfig








############################################################
# validate_configs
############################################################
#
# The single entry point: validates all five maps through
# their family schemas, enforces the cross-map rules the
# per-entry models can't see (unique ids and chain ids; every
# token deployment referencing an existing EVM network), and
# returns NORMALIZED PLAIN DICTS (None sections dropped) so
# consumers keep their ordinary dict access. Raises
# ValueError with the offending entry's name in the message —
# the boot dies loudly on a bad config.
#
# Used by:
#   - main.py — right after the config definitions
############################################################

def validate_configs(evm_configs, erc20_configs, utxo_configs, svm_configs, move_configs):
    evm, erc20, utxo, svm, move = {}, {}, {}, {}, {}

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

    for key, config in (svm_configs or {}).items():
        try:
            svm[key] = SvmNetworkConfig.model_validate(config)
        except ValueError as e:
            raise ValueError(f"SVM network '{key}' is misconfigured:\n{e}") from None

    for key, config in (move_configs or {}).items():
        try:
            move[key] = MoveNetworkConfig.model_validate(config)
        except ValueError as e:
            raise ValueError(f"MOVE network '{key}' is misconfigured:\n{e}") from None

    # Cross-map rules: unique picker ids per family, unique EVM
    # chain ids, and every token deployment on a known network.
    for family, configs in (('EVM', evm), ('UTXO', utxo), ('SVM', svm), ('MOVE', move)):
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
        {key: model.model_dump(exclude_none=True) for key, model in svm.items()},
        {key: model.model_dump(exclude_none=True) for key, model in move.items()},
    )
