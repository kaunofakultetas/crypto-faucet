############################################################
# Author:           Tomas Vanagas
# Updated:          2025-06-29
# Version:          1.0
# Description:      Database connection
############################################################


import sqlite3
import os


def get_db_connection(filename=os.getenv('DB_PATH', 'transactions.db')):
    conn = sqlite3.connect(filename)
    conn.row_factory = sqlite3.Row
    return conn