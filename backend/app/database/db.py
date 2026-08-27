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
# ClosingConnection
############################################################
#
# sqlite3's own `with conn:` commits or rolls back but leaves
# the handle OPEN for the garbage collector — Python 3.13+
# reports every one of those as "unclosed database". Every
# caller in the app uses `with get_db_connection() as conn:`
# for exactly one unit of work, so here the block's end also
# closes the connection.
############################################################

class ClosingConnection(sqlite3.Connection):







    ########################################################
    # __exit__
    ########################################################
    #
    # Commit/rollback exactly as sqlite3 does, then close —
    # in a finally, so a failing commit still releases the
    # handle.
    #
    # Used by:
    #   - every `with get_db_connection() as conn:` block
    ########################################################

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()








############################################################
# get_db_connection
############################################################
#
# One fresh connection per call, rows addressable by column
# name, closed when its `with` block ends (ClosingConnection
# above). GOTCHA: the default filename is evaluated ONCE at
# import time — changing DB_PATH needs a process restart,
# not just a new request.
#
# Used by:
#   - see the file header — every consumer of the database
############################################################

def get_db_connection(filename=os.getenv('DB_PATH', '/data/database.db')):
    conn = sqlite3.connect(filename, factory=ClosingConnection)
    conn.row_factory = sqlite3.Row
    return conn
