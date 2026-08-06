############################################################
#  [*] Reorg attack HTTP API
#
#  The REST surface of the 51% attack tool, consumed by the
#  ReorgAttack page (useReorgAttack.jsx). The live set:
#
#    GET    /api/reorgattack/connect            — attach private node
#    GET    /api/reorgattack/disconnect         — detach private node
#    GET    /api/reorgattack/blockchain/data    — the attack view
#    GET    /api/reorgattack/status             — connection status
#    POST   /api/reorgattack/transactions/send  — broadcast raw tx
#    POST   /api/reorgattack/transactions       — track a txid
#    DELETE /api/reorgattack/transactions/<txid> — untrack
#
#  The remaining endpoints (peers, fetchtxinfo, blocks/<net>,
#  dates/available, GET transactions, database/stats, sync/*)
#  have NO callers today and several are broken — each one's
#  banner says exactly how. Nothing was deleted or fixed in
#  the restyle pass; the banners document the found state.
#
#  reorg_manager is declared None up top and instantiated at
#  the BOTTOM of the file — building it opens RPC clients, and
#  the module wants every route registered first.
#
#  Used by:
#    - main.py — blueprint registration
############################################################


from flask import Blueprint, jsonify, request
from datetime import datetime
from .reorg import ReorgAttackManager, ReorgDatabase
from app.database.db import get_db_connection



bp_reorg_attack = Blueprint('reorg_attack', __name__)

# The two fullnode connections (docker service names on the
# stack's internal network). The 'dummy' entry is UNUSED —
# nothing reads it, and the faucet-knfcoind-dummy container no
# longer exists in the stack.
REORG_ATTACK_CONFIG = {
    'publicside': {
        'rpchost': 'faucet-knfcoind-public',
        'rpcport': 19332,
        'rpcuser': 'admin',
        'rpcpassword': 'admin',
    },
    'privateside': {
        'rpchost': 'faucet-knfcoind-private',
        'rpcport': 19332,
        'rpcuser': 'admin',
        'rpcpassword': 'admin',
    },
    "dummy": {
        'rpchost': 'faucet-knfcoind-dummy',
        'rpcport': 19332,
        'rpcuser': 'admin',
        'rpcpassword': 'admin',
    }
}


# Forward declaration — the real instance is built at the end
# of the file (see the header)
reorg_manager = None








############################################################
# reorg_attack_connect
############################################################
#
# GET /api/reorgattack/connect
#
# Re-attaches the private node to the public network — the
# "heal" side of the attack switch.
#
# Used by:
#   - useReorgAttack.jsx — the connection mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/connect', methods=['GET'])
def reorg_attack_connect():
    result = reorg_manager.fullnode_connections.connect()
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code








############################################################
# reorg_attack_disconnect
############################################################
#
# GET /api/reorgattack/disconnect
#
# Detaches the private node from the public network — the
# "split" side of the attack switch: from here the students
# mine their own chain.
#
# Used by:
#   - useReorgAttack.jsx — the connection mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/disconnect', methods=['GET'])
def reorg_attack_disconnect():
    result = reorg_manager.fullnode_connections.disconnect()
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code








############################################################
# reorg_attack_get_peer_info
############################################################
#
# GET /api/reorgattack/privateside/getpeers
#
# The private node's peer addresses, as a bare list.
#
# Used by:
#   - nothing calls this at the moment — the page reads the
#     connection state from /status instead
############################################################

@bp_reorg_attack.route('/api/reorgattack/privateside/getpeers', methods=['GET'])
def reorg_attack_get_peer_info():
    try:
        peer_info = reorg_manager.fullnode_connections.get_peer_info()
        peer_addresses = [peer["addr"] for peer in peer_info]
        return jsonify(peer_addresses), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get peer info: {str(e)}'
        }), 500








############################################################
# reorg_fetch_tx_info
############################################################
#
# GET /api/reorgattack/fetchtxinfo/<txid>
#
# BROKEN: reorg_manager has no 'fullnode_rpc' attribute (the
# manager exposes public_rpc / private_rpc), so the lookup
# raises, the bare except swallows it, and the endpoint
# always answers the empty skeleton. Despite the "both
# sides" shape of the payload, only the private side is even
# attempted.
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/fetchtxinfo/<string:txid>', methods=['GET'])
def reorg_fetch_tx_info(txid):

    to_send = {
        "publicside": {
            "blockhash": "",
            "inputs": [],
            "outputs": []
        },
        "privateside": {
            "blockhash": "",
            "inputs": [],
            "outputs": []
        }
    }

    try:
        private_tx_info = reorg_manager.fullnode_rpc.get_raw_transaction(txid)
        to_send["privateside"]["blockhash"] = private_tx_info.get("blockhash", "")
        to_send["privateside"]["inputs"] = private_tx_info.get("vin", [])
        to_send["privateside"]["outputs"] = private_tx_info.get("vout", [])
    except Exception:
        pass


    return jsonify(to_send), 200








############################################################
# reorg_send_raw_transaction
############################################################
#
# POST /api/reorgattack/transactions/send
#
# Broadcasts a raw HEX transaction ({raw_transaction, color?})
# into the PRIVATE node; the manager auto-tracks it under the
# color (default 'blue').
#
# Used by:
#   - useReorgAttack.jsx — the rawTransaction mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions/send', methods=['POST'])
def reorg_send_raw_transaction():
    try:
        data = request.get_json()

        if not data or 'raw_transaction' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing raw_transaction in request body'
            }), 400

        raw_tx = data['raw_transaction']
        color = data.get('color', 'blue')
        result = reorg_manager.send_raw_transaction(raw_tx, color)

        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to send transaction: {str(e)}'
        }), 500








############################################################
# get_blockchain_data
############################################################
#
# GET /api/reorgattack/blockchain/data
#
# The attack view payload (?date=YYYY-MM-DD, default today):
# syncs both nodes and returns blocks + tips + tracked
# transactions — see ReorgAttackManager.get_blockchain_data.
#
# Used by:
#   - useReorgAttack.jsx — the page's poll query
############################################################

@bp_reorg_attack.route('/api/reorgattack/blockchain/data', methods=['GET'])
def get_blockchain_data():
    dateNow = datetime.now().strftime("%Y-%m-%d")
    target_date = request.args.get('date', dateNow)

    result = reorg_manager.get_blockchain_data(date=target_date)

    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code








############################################################
# get_network_blocks
############################################################
#
# GET /api/reorgattack/blocks/<network>
#
# BROKEN twice over: ReorgDatabase has no method
# get_blocks_by_network_and_date, and Blockchain_Blocks has
# no Network column (networks are told apart by their
# coinbase message) — the endpoint always answers 500.
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/blocks/<string:network>', methods=['GET'])
def get_network_blocks(network):
    try:
        target_date = request.args.get('date')

        if not target_date:
            target_date = datetime.now().strftime("%Y-%m-%d")
        blocks = ReorgDatabase.get_blocks_by_network_and_date(network, target_date)

        formatted_blocks = []
        for block in blocks:
            formatted_blocks.append({
                'network': block[0],
                'height': block[1],
                'hash': block[2],
                'prevHash': block[3],
                'coinbaseMessage': block[4],
                'date': block[5],
                'time': block[6]
            })

        return jsonify({
            'success': True,
            'blocks': formatted_blocks,
            'metadata': {
                'network': network,
                'date_filter': target_date,
                'total_blocks': len(formatted_blocks)
            }
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get blocks for network {network}: {str(e)}'
        }), 500








############################################################
# get_available_dates
############################################################
#
# GET /api/reorgattack/dates/available
#
# BROKEN: the SQL selects a Network column that
# Blockchain_Blocks does not have — sqlite raises and the
# endpoint always answers 500. (The conn.close() inside the
# with-block is redundant, too.)
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/dates/available', methods=['GET'])
def get_available_dates():
    try:
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT 
                    Date,
                    Network,
                    COUNT(*) as block_count
                FROM Blockchain_Blocks 
                GROUP BY Date, Network
                ORDER BY Date DESC, Network
            ''')

            results = sqlFetchData.fetchall()
            conn.close()

            dates_data = {}
            for row in results:
                date = row[0]
                network = row[1]
                count = row[2]

                if date not in dates_data:
                    dates_data[date] = {
                        'date': date,
                        'public_blocks': 0,
                        'private_blocks': 0,
                        'total_blocks': 0
                    }

                if network == 'public':
                    dates_data[date]['public_blocks'] = count
                elif network == 'private':
                    dates_data[date]['private_blocks'] = count

                dates_data[date]['total_blocks'] = dates_data[date]['public_blocks'] + dates_data[date]['private_blocks']

            available_dates = list(dates_data.values())
            today = datetime.now().strftime("%Y-%m-%d")

            return jsonify({
                'success': True,
                'available_dates': available_dates,
                'total_dates': len(available_dates),
                'today': today,
                'has_todays_data': today in dates_data
            }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get available dates: {str(e)}'
        }), 500








############################################################
# get_all_transactions
############################################################
#
# GET /api/reorgattack/transactions
#
# The tracked-transaction list, standalone.
#
# Used by:
#   - nothing calls this at the moment — /blockchain/data
#     already carries the same list
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions', methods=['GET'])
def get_all_transactions():
    try:
        transactions = ReorgDatabase.get_all_tracked_transactions()
        return jsonify({
            'success': True,
            'transactions': transactions
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get transactions: {str(e)}'
        }), 500








############################################################
# add_transaction_tracking
############################################################
#
# POST /api/reorgattack/transactions
#
# Starts color-tracking a txid ({txid, color?}) across both
# chains. Answers 201 on success.
#
# Used by:
#   - useReorgAttack.jsx — the trackTransaction mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions', methods=['POST'])
def add_transaction_tracking():
    try:
        data = request.get_json()

        if not data or 'txid' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing txid in request body'
            }), 400

        txid = data['txid']
        color = data.get('color', 'blue')

        result = reorg_manager.track_transaction(txid, color)

        status_code = 201 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to add transaction tracking: {str(e)}'
        }), 500








############################################################
# remove_transaction_tracking
############################################################
#
# DELETE /api/reorgattack/transactions/<txid>
#
# Stops tracking one transaction.
#
# Used by:
#   - useReorgAttack.jsx — the untrackTransaction mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions/<string:txid>', methods=['DELETE'])
def remove_transaction_tracking(txid):
    result = reorg_manager.remove_transaction_tracking(txid)

    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code








############################################################
# get_network_status
############################################################
#
# GET /api/reorgattack/status
#
# The private node's connection status enriched with the
# public tip and the stored-block summary — see
# ReorgAttackManager.get_network_status.
#
# Used by:
#   - useReorgAttack.jsx — the status query
############################################################

@bp_reorg_attack.route('/api/reorgattack/status', methods=['GET'])
def get_network_status():
    result = reorg_manager.get_network_status()

    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code








############################################################
# get_database_stats
############################################################
#
# GET /api/reorgattack/database/stats
#
# BROKEN: both per-network queries filter on a Network column
# that Blockchain_Blocks does not have — sqlite raises and
# the endpoint always answers 500. (Same redundant
# conn.close() inside the with-block as dates/available.)
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/database/stats', methods=['GET'])
def get_database_stats():
    try:
        public_stats = {
            'total_blocks': 0,
            'min_height': None,
            'max_height': None,
            'height_range': 0
        }
        private_stats = {
            'total_blocks': 0,
            'min_height': None,
            'max_height': None,
            'height_range': 0
        }

        with get_db_connection() as conn:

            sqlFetchData = conn.execute('''
                SELECT 
                    COUNT(*) as total_blocks,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height
                FROM Blockchain_Blocks 
                WHERE Network = 'public'
            ''')
            result = sqlFetchData.fetchone()
            if result and result[0] > 0:
                public_stats = {
                    'total_blocks': result[0],
                    'min_height': result[1],
                    'max_height': result[2],
                    'height_range': result[2] - result[1] + 1 if result[1] and result[2] else 0
                }

            sqlFetchData = conn.execute('''
                SELECT 
                    COUNT(*) as total_blocks,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height
                FROM Blockchain_Blocks 
                WHERE Network = 'private'
            ''')
            result = sqlFetchData.fetchone()
            if result and result[0] > 0:
                private_stats = {
                    'total_blocks': result[0],
                    'min_height': result[1],
                    'max_height': result[2],
                    'height_range': result[2] - result[1] + 1 if result[1] and result[2] else 0
                }

            sqlFetchData = conn.execute('SELECT COUNT(*) FROM Blockchain_Transactions')
            total_transactions = sqlFetchData.fetchone()[0]

            sqlFetchData = conn.execute('SELECT COUNT(*) FROM Blockchain_TxInBlocks')
            total_tx_block_links = sqlFetchData.fetchone()[0]

            conn.close()

            return jsonify({
                'success': True,
                'stats': {
                    'public_network': public_stats,
                    'private_network': private_stats,
                    'total_transactions_tracked': total_transactions,
                    'total_tx_block_links': total_tx_block_links,
                    'database_message': 'All historical experiment data is preserved',
                    'sync_mode': 'on-demand',
                    'sync_status': 'Data is synced when requested by user'
                }
            }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get database stats: {str(e)}'
        }), 500








############################################################
# get_sync_status
############################################################
#
# GET /api/reorgattack/system/sync/status
#
# A static description of the on-demand sync model — no
# state is consulted.
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/system/sync/status', methods=['GET'])
def get_sync_status():
    try:
        return jsonify({
            'success': True,
            'sync_status': {
                'sync_mode': 'on-demand',
                'description': 'Data is synced automatically when endpoints are called'
            }
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get sync status: {str(e)}'
        }), 500








############################################################
# force_sync
############################################################
#
# POST /api/reorgattack/system/sync/force
#
# BROKEN: reorg_manager has no sync_recent_data method — the
# call raises and the endpoint always answers 500. (The
# actual syncing happens inside get_blockchain_data.)
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/system/sync/force', methods=['POST'])
def force_sync():
    try:
        reorg_manager.sync_recent_data()

        return jsonify({
            'success': True,
            'message': 'Recent data synced successfully'
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to force sync: {str(e)}'
        }), 500




# The real instance, after every route above is registered —
# building it opens the RPC clients (see the header)
reorg_manager = ReorgAttackManager(REORG_ATTACK_CONFIG)
