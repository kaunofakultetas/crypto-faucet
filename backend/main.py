############################################################
#  [*] Faucet Backend — entrypoint
#
#  The Flask app, fully wired AT IMPORT: the SQLite schema,
#  ProxyFix, the seven feature blueprints (each import builds
#  and warms its faucet singletons — the startup console
#  report happens here) and the one route this file serves
#  itself. `main:app` is therefore a complete WSGI target for
#  any server; run directly (python main.py) it starts the
#  dev server. The config maps come from app/config_loader.py
#  (the operator's mounted _CONFIG/coins.py, validated) and
#  are re-exported here.
#
#  Used by:
#    - Dockerfile — CMD ["python3", "-u", "main.py"]
#    - tests/test_main.py — imports it with the warmups
#      patched out (tests/helpers.py import_main)
############################################################


import os

from flask import Flask, Response
from werkzeug.middleware.proxy_fix import ProxyFix

from app.database.db import get_db_connection


# The Flask app — the blueprints are registered onto it in the
# wiring block at the bottom of this file
app = Flask(__name__)




############################################################
# The validated config maps
############################################################
#
# Loaded and validated in app/config_loader.py; re-exported
# here so `main.EVM_NETWORK_CONFIGS` keeps working for anyone
# who reaches for them through the entrypoint.
############################################################

from app.config_loader import (  # noqa: E402 — after the app object, on purpose
    CONFIG_DIR,
    EVM_NETWORK_CONFIGS, ERC20_TOKEN_CONFIGS, UTXO_NETWORK_CONFIGS,
    SVM_NETWORK_CONFIGS, MOVE_NETWORK_CONFIGS,
)








############################################################
# get_example_blockchain
############################################################
#
# GET /api/get-example-blockchain
#
# The pre-mined demo chain for the blockchain simulator: the
# stored blocks packed into one JSON array straight out of
# SQLite, in height order (physical order is insert order only
# until a block is deleted and re-seeded) and carrying each
# block's height so the page can sort defensively. Lives here
# rather than in a blueprint because it is the app's single
# standalone route.
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
                        'height', Height,
                        'data', Transactions,
                        'previousHash', PrevBlock,
                        'nonce', Nonce,
                        'hash', BlockHash
                    )
                ) AS json_block
            FROM (
                SELECT * FROM BlockchainSimulator_Blocks
                ORDER BY CAST(Height AS INTEGER)
            )
        ''')
        returnJson = sqlFetchData.fetchone()[0]
    return Response(returnJson, mimetype='application/json')








############################################################
# Wiring
############################################################
#
# Runs at IMPORT, so `main:app` is the whole backend for any
# WSGI server, not just for `python main.py`: the database
# schema, ProxyFix, then the seven feature blueprints — each
# import builds and warms its faucet singletons, so the
# startup console report happens here. The blueprint imports
# sit down here, after the app object they register onto.
############################################################

# STEP 1: the SQLite schema (idempotent).
# =======================================
from app.database.db_init import init_db  # noqa: E402
init_db()


# STEP 2: ProxyFix for correct IP address detection.
# ==================================================
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)


# STEP 3: the feature blueprints.
# ===============================
from app.evm_faucet.evm_routes import bp_evm_faucet  # noqa: E402
app.register_blueprint(bp_evm_faucet, url_prefix='')

from app.utxo_faucet.utxo_routes import bp_utxo_faucet  # noqa: E402
app.register_blueprint(bp_utxo_faucet, url_prefix='')

from app.erc_faucet.erc20_routes import bp_erc20_faucet  # noqa: E402
app.register_blueprint(bp_erc20_faucet, url_prefix='')

from app.svm_faucet.svm_routes import bp_svm_faucet  # noqa: E402
app.register_blueprint(bp_svm_faucet, url_prefix='')

from app.move_faucet.move_routes import bp_move_faucet  # noqa: E402
app.register_blueprint(bp_move_faucet, url_prefix='')

# Composes the five singletons above, so it must come after
# their route modules have built them
from app.faucet_catalog.catalog_routes import bp_faucet_catalog  # noqa: E402
app.register_blueprint(bp_faucet_catalog, url_prefix='')

from app.icons import bp_icons  # noqa: E402
app.register_blueprint(bp_icons, url_prefix='')








############################################################
# Entrypoint
############################################################
#
# The dev server, when run directly. Debug mode means hot
# reload AND the Werkzeug debugger — never expose it publicly.
############################################################

if __name__ == '__main__':
    APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=8000, debug=APP_DEBUG)




