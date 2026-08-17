############################################################
#  [*] Crypto asset icons
#
#  Serves the operator-droppable icons from the mounted
#  config directory (CONFIG_DIR/icons — see main.py). The
#  filename convention IS the whole linkage: an icon for
#  catalog entry <key> of faucet type <type> lives at
#
#      icons/<type>/<key>.svg|png|webp
#      (e.g. icons/evm/sepolia.svg, icons/erc20/LINK.png)
#
#  Dropping a file into the mounted folder is enough — the
#  catalogs advertise it on their next fetch, no restart, no
#  rebuild, no config edit. Entries without an icon file get
#  None and the frontend falls back to its coloured hash-dot.
#
#    GET /api/icons/<type>/<key> — the icon file itself
#
#  Used by:
#    - main.py — blueprint registration
#    - app/evm_faucet/evm_faucet.py — get_networks payload
#    - app/erc_faucet/erc20_faucet.py — catalog + token payloads
#    - app/utxo_faucet/utxo_faucet.py — get_networks payload
#    - app/svm_faucet/svm_faucet.py — get_networks payload
############################################################


import os

from flask import Blueprint, abort, send_from_directory

from main import CONFIG_DIR





bp_icons = Blueprint('icons', __name__)


ICONS_DIR = os.path.join(CONFIG_DIR, 'icons')

# One folder per catalog, so an EVM network key can never
# collide with a token symbol
ICON_TYPES = ('evm', 'erc20', 'utxo', 'svm')

# Probed in this order — svg preferred, it stays crisp at the
# 10–20 px the identity dots render at
ICON_EXTENSIONS = ('svg', 'png', 'webp')







############################################################
# icon_url
############################################################
#
# The URL a catalog entry should advertise for its icon, or
# None when no icon file exists — the payload builders call
# this per entry, so a freshly dropped file shows up on the
# very next catalog fetch. The URL is extension-less; the
# route below re-probes, so replacing sepolia.png with
# sepolia.svg needs no other change.
#
# Used by:
#   - evm_faucet.get_networks / erc20_faucet.get_token_catalog
#     + get_token / utxo_faucet.get_networks /
#     svm_faucet.get_networks
############################################################

def icon_url(icon_type, key):
    for ext in ICON_EXTENSIONS:
        if os.path.isfile(os.path.join(ICONS_DIR, icon_type, f"{key}.{ext}")):
            return f"/api/icons/{icon_type}/{key}"
    return None







############################################################
# get_icon
############################################################
#
# GET /api/icons/<icon_type>/<key>
#
# The icon file itself, cached client-side for an hour — hard
# enough for classroom load, short enough that a replaced
# icon propagates within the hour. send_from_directory guards
# against path traversal; the explicit key check makes the
# probe loop safe too.
#
# Used by:
#   - the <img> the frontend's ItemDot renders whenever a
#     catalog entry carries an icon URL
############################################################

@bp_icons.route('/api/icons/<icon_type>/<key>', methods=['GET'])
def get_icon(icon_type, key):
    if icon_type not in ICON_TYPES or '/' in key or '\\' in key or '..' in key:
        abort(404)

    for ext in ICON_EXTENSIONS:
        relative = os.path.join(icon_type, f"{key}.{ext}")
        if os.path.isfile(os.path.join(ICONS_DIR, relative)):
            return send_from_directory(ICONS_DIR, relative, max_age=3600)

    abort(404)




