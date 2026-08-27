############################################################
#  [*] Config loader — the five maps, validated
#
#  Resolves the operator's mounted configuration directory,
#  loads _CONFIG/coins.py from it and validates the five maps
#  that drive every faucet (EVM networks, ERC-20 tokens, UTXO
#  networks, SVM networks, MOVE networks) against
#  app/config_models.py — a misspelled key, a malformed
#  contract address or a token on an unknown network kills
#  the boot with a precise error instead of becoming a silent
#  runtime fallback. What every consumer imports from here
#  are the validated, normalized maps.
#
#  Lives in its own module so the route modules can take
#  their maps WITHOUT importing main (which builds the whole
#  app at import) — and so the tests can validate the real
#  configs without building it either.
#
#  Used by:
#    - main.py — re-exports the maps, serves the app
#    - app/evm_faucet/evm_routes.py — EVM_NETWORK_CONFIGS
#    - app/erc_faucet/erc20_routes.py — ERC20_TOKEN_CONFIGS
#    - app/utxo_faucet/utxo_routes.py — UTXO_NETWORK_CONFIGS
#    - app/svm_faucet/svm_routes.py — SVM_NETWORK_CONFIGS
#    - app/move_faucet/move_routes.py — MOVE_NETWORK_CONFIGS
#    - app/icons.py — CONFIG_DIR (the icons live beside coins.py)
#    - tests/test_configs.py, tests/test_config_models.py
############################################################


import os
import sys
import importlib.util

from app.config_models import validate_configs








############################################################
# CONFIG_DIR
############################################################
#
# Where the operator's mounted configuration lives: coins.py
# and the icons/ folder. Resolution order — an explicit
# CONFIG_DIR env var, the docker mount (/config, from the
# compose line ./_CONFIG:/config), then the repo's _CONFIG/
# for runs straight from a checkout (tests, local dev
# without docker).
#
# Used by:
#   - the coins.py loader (below)
#   - app/icons.py — ICONS_DIR = CONFIG_DIR/icons
############################################################

_REPO_CONFIG_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_CONFIG')
)

CONFIG_DIR = os.getenv('CONFIG_DIR') or (
    '/config' if os.path.isdir('/config') else _REPO_CONFIG_DIR
)




############################################################
# Coins configuration — loaded from CONFIG_DIR/coins.py
############################################################
#
# The five maps are loaded from the MOUNTED file and
# validated before anything uses them; what the rest of the
# app imports from main are the validated, normalized maps.
#
# The loaded module is registered in sys.modules so the
# Werkzeug dev reloader watches coins.py like any backend
# file — in dev mode, saving it restarts Flask by itself. In
# production a config edit takes one
# `docker restart faucet-backend`.
############################################################

def _load_coins_module():
    path = os.path.join(CONFIG_DIR, 'coins.py')
    spec = importlib.util.spec_from_file_location('coins_config', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules['coins_config'] = module
    spec.loader.exec_module(module)
    return module


_coins = _load_coins_module()

EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS, UTXO_NETWORK_CONFIGS, SVM_NETWORK_CONFIGS, MOVE_NETWORK_CONFIGS = validate_configs(
    getattr(_coins, 'EVM_NETWORK_CONFIGS', {}),
    getattr(_coins, 'ERC20_TOKEN_CONFIGS', {}),
    getattr(_coins, 'UTXO_NETWORK_CONFIGS', {}),
    getattr(_coins, 'SVM_NETWORK_CONFIGS', {}),
    getattr(_coins, 'MOVE_NETWORK_CONFIGS', {}),
)
