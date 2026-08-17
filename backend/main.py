############################################################
#  [*] Faucet Backend — entrypoint & configuration loading
#
#  The Flask app plus the LOADER for the five config maps
#  that drive every faucet (EVM networks, ERC-20 tokens,
#  UTXO networks, SVM networks, MOVE networks). The maps
#  themselves live
#  OUTSIDE the image, in the mounted config directory
#  (_CONFIG/coins.py on the host → /config/coins.py in the
#  container), so an operator edits coins live and restarts
#  the backend — never rebuilds the stack. All five are
#  validated against app/config_models.py right after
#  loading — a misspelled key, a malformed contract address
#  or a token on an unknown network kills the boot with a
#  precise error instead of becoming a silent runtime
#  fallback.
#
#  Run directly (python main.py) this file wires the
#  database, the seven blueprints and the dev server. The
#  route modules import THIS module back for their config
#  maps — that is why the blueprint imports sit inside
#  __main__: by the time they run, main is fully defined and
#  the circular import resolves cleanly.
#
#  Used by:
#    - app/evm_faucet/evm_routes.py — EVM_NETWORK_CONFIGS
#    - app/erc_faucet/erc20_routes.py — ERC20_TOKEN_CONFIGS
#    - app/utxo_faucet/utxo_routes.py — UTXO_NETWORK_CONFIGS
#    - app/svm_faucet/svm_routes.py — SVM_NETWORK_CONFIGS
#    - app/move_faucet/move_routes.py — MOVE_NETWORK_CONFIGS
#    - app/icons.py — CONFIG_DIR (the icons live beside coins.py)
#    - tests/ — config invariants + schema tests import main
#    - Dockerfile — CMD ["python3", "-u", "main.py"]
############################################################


import os
import sys
import importlib.util

from flask import Flask, Response
from werkzeug.middleware.proxy_fix import ProxyFix

from app.database.db import get_db_connection
from app.config_models import validate_configs


# The Flask app — the blueprint modules register their routes
# onto it in the __main__ block below.
app = Flask(__name__)




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








############################################################
# get_example_blockchain
############################################################
#
# GET /api/get-example-blockchain
#
# The pre-mined demo chain for the blockchain simulator: the
# stored blocks packed into one JSON array straight out of
# SQLite. Lives here rather than in a blueprint because it is
# the app's single standalone route.
#
# Used by:
#   - pages/BlockchainSimulator/Page.jsx — loads the demo
#     chain on mount
############################################################

@app.route('/api/get-example-blockchain', methods=['GET'])
def get_example_blockchain():
    with get_db_connection() as conn:
        sqlFetchData = conn.execute('''
            SELECT
                json_group_array(
                    json_object(
                        'data', Transactions, 
                        'previousHash', PrevBlock, 
                        'nonce', Nonce, 
                        'hash', BlockHash
                    )
                ) AS json_block
            FROM BlockchainSimulator_Blocks
        ''')
        returnJson = sqlFetchData.fetchone()[0]
    return Response(returnJson, mimetype='application/json')








############################################################
# Entrypoint
############################################################
#
# Wires the whole backend when run directly: the database
# schema, the seven feature blueprints, then the dev server.
# The blueprint imports are deliberately DEFERRED to down
# here — the route modules import main back for their config
# maps, and at this point main is fully defined, so the
# circular import resolves cleanly.
############################################################

if __name__ == '__main__':
    APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'



    # STEP 1: the SQLite schema (idempotent).
    # =======================================
    from app.database.db_init import init_db
    init_db()



    # STEP 2: ProxyFix for correct IP address detection.
    # ==================================================
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)



    # STEP 3: the feature blueprints — each import builds and
    # warms its faucet singletons, so the startup console report
    # happens here.
    # ==========================================================
    from app.evm_faucet.evm_routes import bp_evm_faucet
    app.register_blueprint(bp_evm_faucet, url_prefix='')

    from app.utxo_faucet.utxo_routes import bp_utxo_faucet
    app.register_blueprint(bp_utxo_faucet, url_prefix='')

    from app.erc_faucet.erc20_routes import bp_erc20_faucet
    app.register_blueprint(bp_erc20_faucet, url_prefix='')

    from app.svm_faucet.svm_routes import bp_svm_faucet
    app.register_blueprint(bp_svm_faucet, url_prefix='')

    from app.move_faucet.move_routes import bp_move_faucet
    app.register_blueprint(bp_move_faucet, url_prefix='')

    # Composes the five singletons above, so it must come after
    # their route modules have built them
    from app.faucet_catalog.catalog_routes import bp_faucet_catalog
    app.register_blueprint(bp_faucet_catalog, url_prefix='')

    from app.icons import bp_icons
    app.register_blueprint(bp_icons, url_prefix='')


    # STEP 4: the dev server. Debug mode means hot reload AND
    # the Werkzeug debugger — never expose it publicly.
    # =======================================================
    app.run(host='0.0.0.0', port=8000, debug=APP_DEBUG)




