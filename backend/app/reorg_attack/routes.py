from flask import Blueprint, jsonify
import os
import requests
from requests.auth import HTTPBasicAuth
from typing import List, Dict
from app.database.db import get_db_connection
import json
import socket
import ssl


from main import UTXO_NETWORK_CONFIGS

bp_reorg_attack = Blueprint('reorg_attack', __name__)





REORG_ATTACK_CONFIG = {
    'publicside': {
        'connectiontype': 'electrum',
        'faucetnetwork': 'ltc4',
        'peeraddresses': [
            "54.39.129.45:19335",
            "81.17.120.243:19335",
            "109.123.248.66:19335",
            "167.114.119.46:19335"
        ]
    },
    'privateside': {
        'rpchost': 'faucet-litecoind',
        'rpcport': 19332,
        'rpcuser': 'admin',
        'rpcpassword': 'admin',
    }
}





class ElectrumRPC:

    def __init__(self, electrum_host: str, electrum_port: int):
        self.electrum_host = electrum_host
        self.electrum_port = electrum_port
        
        # Configuration from environment
        self.ssock = self._connect_electrum()


    def _connect_electrum(self):
        """Connect to Electrum server."""
        if not self.electrum_host or not self.electrum_port:
            raise ValueError('Electrum server not configured')
        
        sock = socket.create_connection((self.electrum_host, self.electrum_port))
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        self.ssock = context.wrap_socket(sock, server_hostname=self.electrum_host)
    

    def rpc_call(self, method: str, params: List = None):
        """Send JSON-RPC request to Electrum server."""
        if not self.ssock:
            raise ConnectionError("Not connected to Electrum server")
        
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }
        
        self.ssock.sendall((json.dumps(request) + "\n").encode("utf-8"))
        
        # Read response until we get a complete line (JSON-RPC messages end with \n)
        response_data = b""
        while True:
            chunk = self.ssock.recv(1024)
            if not chunk:
                raise ConnectionError("Connection closed by server")
            response_data += chunk
            if b'\n' in response_data:
                # Get the first complete message
                response_line = response_data.split(b'\n', 1)[0]
                break
        
        try:
            response = json.loads(response_line.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON response from Electrum server: {e}")
        
        if "error" in response and response["error"]:
            raise RuntimeError(f"Electrum error: {response['error']}")
        
        if "result" not in response:
            raise ValueError("Unexpected Electrum response format")
        
        return response["result"]










class FullNodeRPC:

    @staticmethod
    def rpc_call(method: str, params: List = None) -> Dict:
        """Make RPC call to Full Node"""
        if params is None:
            params = []
            
        payload = {
            "jsonrpc": "1.0",
            "id": "reorg_attack",
            "method": method,
            "params": params
        }
        
        # RPC Connection Config
        rpchost = REORG_ATTACK_CONFIG['privateside']['rpchost']
        rpcport = REORG_ATTACK_CONFIG['privateside']['rpcport']
        rpcuser = REORG_ATTACK_CONFIG['privateside']['rpcuser']
        rpcpass = REORG_ATTACK_CONFIG['privateside']['rpcpassword']

        auth = HTTPBasicAuth(rpcuser, rpcpass)
        response = requests.post(f"http://{rpchost}:{rpcport}", json=payload, auth=auth)
        data = response.json()
        
        if "error" in data and data["error"]:
            raise Exception(f"RPC Error: {data['error']}")
        return data["result"]





class FullNodeConnections:

    @staticmethod
    def set_network_active(active: bool) -> Dict:
        """Enable or disable network activity on the full node"""

        # Enable network activity
        return FullNodeRPC.rpc_call("setnetworkactive", [active])
    

    @staticmethod
    def disconnect_all_peers() -> Dict:
        """Disconnect from all peers"""
        try:
            # Try the modern approach first (Bitcoin Core v0.21+)
            return FullNodeRPC.rpc_call("disconnectnode", ["*"])
        except Exception as e:
            # If that fails, get all peers and disconnect them individually
            peers = FullNodeRPC.rpc_call("getpeerinfo")
            results = []
            for peer in peers:
                try:
                    result = FullNodeRPC.rpc_call("disconnectnode", [peer['addr']])
                    results.append(result)
                except Exception as peer_error:
                    results.append(f"Failed to disconnect {peer['addr']}: {str(peer_error)}")
            return {"disconnected_peers": results}
        

    @staticmethod
    def get_peer_info() -> Dict:
        """Get peer info from the full node"""
        return FullNodeRPC.rpc_call("getpeerinfo")










####################################################################################
########################### Full Node Communications ###############################
####################################################################################
@bp_reorg_attack.route('/api/reorgattack/connect', methods=['GET'])
def reorg_attack_connect():
    """Enable network activity on the full node"""
    try:
        result = FullNodeConnections.set_network_active(True)
        return jsonify({
            'success': True,
            'message': 'Network activity enabled',
            'result': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to enable network activity: {str(e)}'
        }), 500



@bp_reorg_attack.route('/api/reorgattack/disconnect', methods=['GET'])
def reorg_attack_disconnect():
    """Disable network activity on the full node"""
    try:
        # First disconnect all current peers
        FullNodeConnections.disconnect_all_peers()
        
        # Then disable network activity to prevent new connections
        FullNodeConnections.set_network_active(False)
        
        return jsonify({
            'success': True,
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to disable network activity: {str(e)}'
        }), 500



@bp_reorg_attack.route('/api/reorgattack/privateside/getpeers', methods=['GET'])
def reorg_attack_get_peer_info():
    get_peer_info = FullNodeConnections.get_peer_info()
    to_send = [ peer["addr"] for peer in get_peer_info ]
    return jsonify(to_send), 200
####################################################################################
####################################################################################
####################################################################################









####################################################################################
################################# Transactions #####################################
####################################################################################

public_side_network = REORG_ATTACK_CONFIG['publicside']['faucetnetwork']
public_electrum_server = UTXO_NETWORK_CONFIGS[public_side_network]['electrum_server']
public_electrum_rpc = ElectrumRPC(public_electrum_server.split(":")[0], int(public_electrum_server.split(":")[1]))



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

    # Get the transaction info from the private side
    private_tx_info = FullNodeRPC.rpc_call("getrawtransaction", [txid])
    try:
        to_send["privateside"]["blockhash"] = private_tx_info["blockhash"]
        to_send["privateside"]["inputs"] = private_tx_info["vin"]
        to_send["privateside"]["outputs"] = private_tx_info["vout"]
    except Exception as e:
        pass
    


    # Get the transaction info from the public side
    try:
        # For Electrum, use blockchain.transaction.get with verbose=True to get parsed data
        public_tx_info = public_electrum_rpc.rpc_call("blockchain.transaction.get", [txid, True])
        
        to_send["publicside"]["blockhash"] = public_tx_info.get("blockhash", "")
        to_send["publicside"]["inputs"] = public_tx_info.get("vin", [])
        to_send["publicside"]["outputs"] = public_tx_info.get("vout", [])
    except Exception as e:
        # If the transaction is not found on public side, leave fields empty
        print(f"Public side transaction fetch failed: {e}")
        pass

    return jsonify(to_send), 200

####################################################################################
####################################################################################
####################################################################################