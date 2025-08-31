"""
Reorg Attack API Routes
Main endpoint handlers for the blockchain visualization tool
"""

from flask import Blueprint, jsonify, request
import time
from datetime import datetime
from .reorg import ReorgAttackManager


bp_reorg_attack = Blueprint('reorg_attack', __name__)

# Configuration
REORG_ATTACK_CONFIG = {
    'publicside': {
        'rpchost': 'faucet-litecoind-public',
        'rpcport': 19332,
        'rpcuser': 'admin',
        'rpcpassword': 'admin',
    },
    'privateside': {
        'rpchost': 'faucet-litecoind-private',
        'rpcport': 19332,
        'rpcuser': 'admin',
        'rpcpassword': 'admin',
    },
    'sync': {
        'max_blocks_to_fetch': 100
    }
}

# Initialize the reorg attack manager (moved to end of file)
reorg_manager = None


####################################################################################
########################### Network Connection Endpoints ########################
####################################################################################

# @bp_reorg_attack.route('/api/reorgattack/test', methods=['GET'])
# def test_route():
#     """Simple test route to verify blueprint is working"""
#     return jsonify({
#         'success': True,
#         'message': 'Reorg attack API is working! Blueprint registration successful.',
#         'timestamp': time.time(),
#         'manager_initialized': reorg_manager is not None,
#         'manager_status': 'initialized' if reorg_manager else 'failed_to_initialize'
#     }), 200

@bp_reorg_attack.route('/api/reorgattack/connect', methods=['GET'])
def reorg_attack_connect():
    """Enable network activity on the full node"""
    result = reorg_manager.fullnode_connections.connect()
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code


@bp_reorg_attack.route('/api/reorgattack/disconnect', methods=['GET'])
def reorg_attack_disconnect():
    """Disable network activity on the full node"""
    result = reorg_manager.fullnode_connections.disconnect()
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code


@bp_reorg_attack.route('/api/reorgattack/privateside/getpeers', methods=['GET'])
def reorg_attack_get_peer_info():
    """Get peer info from private side"""
    try:
        peer_info = reorg_manager.fullnode_connections.get_peer_info()
        peer_addresses = [peer["addr"] for peer in peer_info]
        return jsonify(peer_addresses), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get peer info: {str(e)}'
        }), 500


####################################################################################
################################# Transactions ###################################
####################################################################################

@bp_reorg_attack.route('/api/reorgattack/fetchtxinfo/<string:txid>', methods=['GET'])
def reorg_fetch_tx_info(txid):
    """Fetch transaction info from both sides"""

    
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

    # Get transaction info from private side
    try:
        private_tx_info = reorg_manager.fullnode_rpc.get_raw_transaction(txid)
        to_send["privateside"]["blockhash"] = private_tx_info.get("blockhash", "")
        to_send["privateside"]["inputs"] = private_tx_info.get("vin", [])
        to_send["privateside"]["outputs"] = private_tx_info.get("vout", [])
    except Exception:
        pass

    # Get transaction info from public side
    try:
        if reorg_manager.electrum_rpc:
            public_tx_info = reorg_manager.electrum_rpc.get_transaction(txid)
            to_send["publicside"]["blockhash"] = public_tx_info.get("blockhash", "")
            to_send["publicside"]["inputs"] = public_tx_info.get("vin", [])
            to_send["publicside"]["outputs"] = public_tx_info.get("vout", [])
    except Exception:
        pass

    return jsonify(to_send), 200


@bp_reorg_attack.route('/api/reorgattack/transactions/send', methods=['POST'])
def reorg_send_raw_transaction():
    """Send raw transaction to private network"""
    try:
        data = request.get_json()
        
        if not data or 'raw_transaction' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing raw_transaction in request body'
            }), 400
        
        raw_tx = data['raw_transaction']
        result = reorg_manager.send_raw_transaction(raw_tx)
        
        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to send transaction: {str(e)}'
        }), 500


####################################################################################
########################### Blockchain Data Endpoints ###########################
####################################################################################

@bp_reorg_attack.route('/api/reorgattack/blockchain/data', methods=['GET'])
def get_blockchain_data():
    """Get blockchain visualization data (today's blocks by default)"""
    dateNow = datetime.now().strftime("%Y-%m-%d")
    target_date = request.args.get('date', dateNow)
    
    # Get data from manager
    result = reorg_manager.get_blockchain_data(date=target_date)
    
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code





@bp_reorg_attack.route('/api/reorgattack/blocks/<string:network>', methods=['GET'])
def get_network_blocks(network):
    """Get blocks for a specific network (today's blocks by default)"""

    
    try:
        from .reorg import ReorgDatabase
        
        # Get optional parameters
        target_date = request.args.get('date')
        show_all = request.args.get('all', 'false').lower() == 'true'
        
        if show_all:
            blocks = ReorgDatabase.get_blocks_by_network(network)
        else:
            if not target_date:
                target_date = ReorgDatabase.get_todays_date()
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
                'date_filter': target_date if not show_all else None,
                'showing_all_data': show_all,
                'total_blocks': len(formatted_blocks)
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get blocks for network {network}: {str(e)}'
        }), 500





@bp_reorg_attack.route('/api/reorgattack/dates/available', methods=['GET'])
def get_available_dates():
    """Get list of available dates with blockchain data"""

    
    try:
        from .reorg import ReorgDatabase
        from app.database.db import get_db_connection
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get distinct dates with block counts
        cursor.execute('''
            SELECT 
                Date,
                Network,
                COUNT(*) as block_count
            FROM Blockchain_Blocks 
            GROUP BY Date, Network
            ORDER BY Date DESC, Network
        ''')
        
        results = cursor.fetchall()
        conn.close()
        
        # Organize by date
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
        
        # Convert to sorted list
        available_dates = list(dates_data.values())
        today = ReorgDatabase.get_todays_date()
        
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








####################################################################################
######################### Transaction Management Endpoints ######################
####################################################################################

@bp_reorg_attack.route('/api/reorgattack/transactions', methods=['GET'])
def get_all_transactions():
    """Get all tracked transactions"""

    
    try:
        from .reorg import ReorgDatabase
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




@bp_reorg_attack.route('/api/reorgattack/transactions', methods=['POST'])
def add_transaction_tracking():
    """Add a transaction for tracking"""
    try:
        data = request.get_json()
        
        if not data or 'txid' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing txid in request body'
            }), 400
        
        txid = data['txid']
        color = data.get('color', 'blue')
        
        result = reorg_manager.add_transaction_tracking(txid, color)
        
        status_code = 201 if result['success'] else 500
        return jsonify(result), status_code
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to add transaction tracking: {str(e)}'
        }), 500




@bp_reorg_attack.route('/api/reorgattack/transactions/<string:txid>', methods=['DELETE'])
def remove_transaction_tracking(txid):
    """Remove a transaction from tracking"""
    result = reorg_manager.remove_transaction_tracking(txid)
    
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code








####################################################################################
############################ Network Status Endpoints ###########################
####################################################################################

@bp_reorg_attack.route('/api/reorgattack/status', methods=['GET'])
def get_network_status():
    """Get current network connection status with blockchain tips"""
    result = reorg_manager.get_network_status()
    
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code




@bp_reorg_attack.route('/api/reorgattack/electrum/test', methods=['GET'])
def test_electrum_connection():
    """Test Electrum connection and return detailed status"""

    
    try:
        if not reorg_manager.electrum_rpc:
            return jsonify({
                'success': False,
                'connected': False,
                'message': 'Electrum RPC not initialized',
                'config': {
                    'network': REORG_ATTACK_CONFIG['publicside']['faucetnetwork'],
                    'server': 'not configured'
                }
            }), 500
        
        # Test basic connection
        server_version = reorg_manager.electrum_rpc.get_server_version()
        
        # Test blockchain access
        current_height = reorg_manager.electrum_rpc.get_current_height()
        
        return jsonify({
            'success': True,
            'connected': True,
            'message': 'Electrum connection working',
            'server_info': {
                'version': server_version,
                'current_height': current_height,
                'socket_connected': reorg_manager.electrum_rpc.is_connected()
            },
            'config': {
                'network': REORG_ATTACK_CONFIG['publicside']['faucetnetwork'],
                'server': f"{reorg_manager.electrum_rpc.electrum_host}:{reorg_manager.electrum_rpc.electrum_port}"
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'connected': False,
            'message': f'Electrum connection test failed: {str(e)}',
            'config': {
                'network': REORG_ATTACK_CONFIG['publicside']['faucetnetwork'],
                'server': f"{reorg_manager.electrum_rpc.electrum_host}:{reorg_manager.electrum_rpc.electrum_port}" if reorg_manager.electrum_rpc else 'not initialized'
            }
        }), 500









####################################################################################
############################# System Information #################################
####################################################################################

@bp_reorg_attack.route('/api/reorgattack/database/stats', methods=['GET'])
def get_database_stats():
    """Get statistics about stored blockchain data"""

    
    try:
        from .reorg import ReorgDatabase
        from app.database.db import get_db_connection
        
        # Get stats for both networks
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
        
        # Get total tracked transactions
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get public network stats
        cursor.execute('''
            SELECT 
                COUNT(*) as total_blocks,
                MIN(Height) as min_height,
                MAX(Height) as max_height
            FROM Blockchain_Blocks 
            WHERE Network = 'public'
        ''')
        result = cursor.fetchone()
        if result and result[0] > 0:
            public_stats = {
                'total_blocks': result[0],
                'min_height': result[1],
                'max_height': result[2],
                'height_range': result[2] - result[1] + 1 if result[1] and result[2] else 0
            }
        
        # Get private network stats
        cursor.execute('''
            SELECT 
                COUNT(*) as total_blocks,
                MIN(Height) as min_height,
                MAX(Height) as max_height
            FROM Blockchain_Blocks 
            WHERE Network = 'private'
        ''')
        result = cursor.fetchone()
        if result and result[0] > 0:
            private_stats = {
                'total_blocks': result[0],
                'min_height': result[1],
                'max_height': result[2],
                'height_range': result[2] - result[1] + 1 if result[1] and result[2] else 0
            }
        
        cursor.execute('SELECT COUNT(*) FROM Blockchain_Transactions')
        total_transactions = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM Blockchain_TxInBlocks')
        total_tx_block_links = cursor.fetchone()[0]
        
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









####################################################################################
########################## Administrative Endpoints ##############################
####################################################################################

@bp_reorg_attack.route('/api/reorgattack/system/sync/status', methods=['GET'])
def get_sync_status():
    """Get background sync status"""

    
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




@bp_reorg_attack.route('/api/reorgattack/system/sync/force', methods=['POST'])
def force_sync():
    """Force a sync of recent data (on-demand)"""
    
    try:
        # Force sync recent data
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




# Initialize the reorg attack manager at the end
reorg_manager = ReorgAttackManager(REORG_ATTACK_CONFIG)