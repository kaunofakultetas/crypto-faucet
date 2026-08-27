############################################################
#  [*] Database connection
#
#  The single SQLite entry point for the whole backend. The
#  DB path comes from DB_PATH (default /data/database.db —
#  the ./_DATA/backend mount in docker-compose).
#
#  Used by:
#    - main.py, the evm/erc20 explorer, the blockchain
#      simulator route, db_init.py
#      and tools/ — every SQL statement in the app goes
#      through this helper
############################################################


import sqlite3
import os








############################################################
# get_db_connection
############################################################
#
# One fresh connection per call, rows addressable by column
# name. GOTCHA: the default filename is evaluated ONCE at
# import time — changing DB_PATH needs a process restart,
# not just a new request.
#
# Used by:
#   - see the file header — every consumer of the database
############################################################

def get_db_connection(filename=os.getenv('DB_PATH', '/data/database.db')):
    conn = sqlite3.connect(filename)
    conn.row_factory = sqlite3.Row
    return conn
