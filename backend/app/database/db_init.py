############################################################
#  [*] Database initialization
#
#  The idempotent SQLite schema: every feature's tables
#  (blockchain simulator, the EVM and the UTXO transaction
#  graphs) created IF NOT EXISTS on every boot, plus the
#  pre-mined demo chain the simulator page starts from.
#  Nothing here migrates or drops — a fresh volume gets the
#  full schema, an existing one is left untouched. Policy: a
#  schema change means deleting _DATA/backend/database.db and
#  letting this rebuild it (the graph tables are Etherscan /
#  ElectrumX caches, the demo chain is re-seeded) — never a
#  hand-patch through /dbgate. [id] is a real rowid alias
#  (INTEGER PRIMARY KEY), so every row gets one.
#
#  Used by:
#    - main.py — init_db() in the __main__ block, STEP 1
############################################################


import sqlite3

from .db import get_db_connection








############################################################
# init_db
############################################################
#
# The single entry point: schema first, then the seed data.
#
# Used by:
#   - main.py — once at startup
############################################################

def init_db():
    init_db_tables()

    init_default_data()








############################################################
# init_db_tables
############################################################
#
# Every table, grouped by feature. All CREATEs are IF NOT
# EXISTS — safe to run on every boot.
#
# Used by:
#   - init_db (above)
############################################################

def init_db_tables():
    with get_db_connection() as conn:


        ######################## Blockchain Simulator tables ########################
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [BlockchainSimulator_Blocks] (
                [Height] TEXT NOT NULL,
                [BlockHash] TEXT NOT NULL,
                [PrevBlock] TEXT NOT NULL,
                [Nonce] TEXT NOT NULL,
                [Transactions] TEXT NOT NULL,
                CONSTRAINT [sqlite_autoindex_BlockchainSimulator_Blocks_1] UNIQUE ([Height], [BlockHash], [PrevBlock], [Nonce], [Transactions])
            );
        ''')
        #####################################################################



        ######################## Faucet graph tables ########################
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [Graph_Addresses] (
                [address] TEXT NULL,
                [name] TEXT NULL,
                [is_contract] INTEGER NULL,
                [is_hub] INTEGER NULL,
                CONSTRAINT [sqlite_autoindex_Graph_Addresses_1] UNIQUE ([address])
            );
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [Graph_Transactions] (
                [id] INTEGER PRIMARY KEY AUTOINCREMENT,
                [network] TEXT NULL,
                [from_address] TEXT NULL,
                [to_address] TEXT NULL,
                [value] REAL NULL,
                [hash] TEXT NULL,
                [block_number] INTEGER NULL,
                [timestamp] INTEGER NULL,
                CONSTRAINT [sqlite_autoindex_Graph_Transactions_1] UNIQUE ([network], [hash])
            );
        ''')
        # The graph's date slider filters by a [from, to) unix range —
        # this index keeps those day-window queries instant as the
        # table grows. The explorer's queries compare lowercase
        # values against these columns DIRECTLY (no LOWER() on the
        # column, which would bypass the index) — everything is
        # stored lowercase by store_transactions.
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_graph_transactions_network_timestamp ON Graph_Transactions(network, timestamp)
        ''')
        #####################################################################



        ######################## UTXO transaction graph tables ########################
        # An ElectrumX cache for the UTXO graph (app/utxo_faucet/
        # explorer.py). Addresses keep their exact spelling — base58
        # is case-sensitive, bech32 is lowercase already. Names live
        # in Graph_Addresses above, shared with the EVM graph.

        # Every address the crawl has read: when its history was last
        # read, how long it was, and whether it is a public hub (a
        # history too long to follow)
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [GraphUtxo_Addresses] (
                [network] TEXT NOT NULL,
                [address] TEXT NOT NULL,
                [last_refresh] INTEGER NULL,
                [history_size] INTEGER NULL,
                [is_hub] INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ([network], [address])
            );
        ''')

        # Each address' history as the server last listed it — one
        # row per (address, transaction) with the height (> 0 mined,
        # 0 / -1 in the mempool). A transaction's status comes from
        # these rows; one no history lists any more was dropped
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [GraphUtxo_History] (
                [network] TEXT NOT NULL,
                [address] TEXT NOT NULL,
                [txid] TEXT NOT NULL,
                [height] INTEGER NOT NULL,
                PRIMARY KEY ([network], [address], [txid])
            );
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_graphutxo_history_txid ON GraphUtxo_History(network, txid)
        ''')

        # Block times by height, from the block headers
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [GraphUtxo_Blocks] (
                [network] TEXT NOT NULL,
                [height] INTEGER NOT NULL,
                [time] INTEGER NOT NULL,
                PRIMARY KEY ([network], [height])
            );
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_graphutxo_blocks_time ON GraphUtxo_Blocks(network, time)
        ''')

        # Decoded transactions — immutable once fetched: size in
        # virtual bytes and whether it mints coins (coinbase)
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [GraphUtxo_Transactions] (
                [network] TEXT NOT NULL,
                [txid] TEXT NOT NULL,
                [vsize] INTEGER NOT NULL,
                [is_coinbase] INTEGER NOT NULL DEFAULT 0,
                [fetched_at] INTEGER NOT NULL,
                PRIMARY KEY ([network], [txid])
            );
        ''')

        # Their outputs, amounts in integer satoshis; address NULL
        # when the script has no address form (OP_RETURN, bare pubkey)
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [GraphUtxo_Outputs] (
                [network] TEXT NOT NULL,
                [txid] TEXT NOT NULL,
                [vout] INTEGER NOT NULL,
                [address] TEXT NULL,
                [script_type] TEXT NOT NULL,
                [value] INTEGER NOT NULL,
                PRIMARY KEY ([network], [txid], [vout])
            );
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_graphutxo_outputs_address ON GraphUtxo_Outputs(network, address)
        ''')

        # Their inputs: the output each one spends (a coinbase has
        # none stored)
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [GraphUtxo_Inputs] (
                [network] TEXT NOT NULL,
                [txid] TEXT NOT NULL,
                [vin] INTEGER NOT NULL,
                [prev_txid] TEXT NOT NULL,
                [prev_vout] INTEGER NOT NULL,
                PRIMARY KEY ([network], [txid], [vin])
            );
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_graphutxo_inputs_prev ON GraphUtxo_Inputs(network, prev_txid, prev_vout)
        ''')
        ###############################################################################








############################################################
# init_default_data
############################################################
#
# The blockchain simulator's pre-mined demo chain (10 blocks,
# Lithuanian sample transactions) — INSERT OR IGNORE, so a
# database that already has them is untouched.
#
# Used by:
#   - init_db (above)
############################################################

def init_default_data():

    sample_blocks = [
        {"Height":"0","BlockHash":"0000000000c8d30df00df761f0d73e814b19a0dc7bece5dc620eab5551f0f5db","PrevBlock":"0","Nonce":"227969571629","Transactions":"1) Nauja kriptovaliuta ---> Satoshi (50BTC)"},
        {"Height":"1","BlockHash":"0000000000ac4a3f4f45417e3befc780c496176e3c0468c92ca37e743790ccf0","PrevBlock":"0000000000c8d30df00df761f0d73e814b19a0dc7bece5dc620eab5551f0f5db","Nonce":"913766198743","Transactions":"1) Nauja kriptovaliuta ---> Jonas (50BTC)\n2) Satoshi ---> Saulius (2BTC)"},
        {"Height":"2","BlockHash":"000000000013a018ec584889625adf3ddda1bdbaa41bec232bb78dcebd42da0e","PrevBlock":"0000000000ac4a3f4f45417e3befc780c496176e3c0468c92ca37e743790ccf0","Nonce":"67054785720","Transactions":"1) Nauja kriptovaliuta ---> Gabija (50BTC)\n2) Saulius ---> Jonas (2BTC)"},
        {"Height":"3","BlockHash":"0000000000454e22a166a17b9cb2c09163f9a90686b50ca835fe910f01d02a1b","PrevBlock":"000000000013a018ec584889625adf3ddda1bdbaa41bec232bb78dcebd42da0e","Nonce":"77902282117","Transactions":"1) Nauja kriptovaliuta ---> Agnė (50BTC)\n2) Gabija ---> Jonas (8BTC)\n3) Jonas ---> Agnė (2BTC)"},
        {"Height":"4","BlockHash":"000000000083ad99f39346981a5a9be26ef7e4abd8c2559faa7f31a11fe05143","PrevBlock":"0000000000454e22a166a17b9cb2c09163f9a90686b50ca835fe910f01d02a1b","Nonce":"749962019361","Transactions":"1) Nauja kriptovaliuta ---> Rokas (50BTC)\n2) Agnė ---> Mantas (3BTC)\n3) Jonas ---> Mantas (10BTC)"},
        {"Height":"5","BlockHash":"0000000000f7564d08e4c5b8189da2f0115108ae56cc61d33df9b14daf74e68b","PrevBlock":"000000000083ad99f39346981a5a9be26ef7e4abd8c2559faa7f31a11fe05143","Nonce":"506281792967","Transactions":"1) Nauja kriptovaliuta ---> Mantas (50BTC)"},
        {"Height":"6","BlockHash":"00000000008d6ac78b0e03d17cc024edadad2de194b3bf60ed0b6a2066df056b","PrevBlock":"0000000000f7564d08e4c5b8189da2f0115108ae56cc61d33df9b14daf74e68b","Nonce":"571892833284","Transactions":"1) Nauja kriptovaliuta ---> Gabija (50BTC)\n2) Mantas ---> Agnė (5BTC)"},
        {"Height":"7","BlockHash":"00000000003881046cd5c6070356e1960010405e5eee387bbf6e7d8346aa0edd","PrevBlock":"00000000008d6ac78b0e03d17cc024edadad2de194b3bf60ed0b6a2066df056b","Nonce":"543053658674","Transactions":"1) Nauja kriptovaliuta ---> Rokas (50BTC)\n2) Agnė ---> Simona (5BTC)"},
        {"Height":"8","BlockHash":"000000000033a7f6f11b4c5b2aef87417056a1cd1dc7f4bfd56882b5bfd05af0","PrevBlock":"00000000003881046cd5c6070356e1960010405e5eee387bbf6e7d8346aa0edd","Nonce":"640000152443","Transactions":"1) Nauja kriptovaliuta ---> Simona (50BTC)"},
        {"Height":"9","BlockHash":"0000000000eae5d5c2d12b30cb84d7bbcde31de5a16a82ed41b350a1434b0130","PrevBlock":"000000000033a7f6f11b4c5b2aef87417056a1cd1dc7f4bfd56882b5bfd05af0","Nonce":"1291810786235","Transactions":"1) Nauja kriptovaliuta ---> Mantas (50BTC)\n2) Rokas ---> Saulius (2BTC)\n3) Simona ---> Agnė (5BTC)\n4) Mantas ---> Gabija (3BTC)\n5) Simona ---> Agnė (4BTC)"}
    ]

    with get_db_connection() as conn:
        for block in sample_blocks:
            conn.execute(''' 
                INSERT OR IGNORE INTO BlockchainSimulator_Blocks (Height, BlockHash, PrevBlock, Nonce, Transactions) 
                VALUES (?, ?, ?, ?, ?) 
            ''', 
                [block['Height'], block['BlockHash'], block['PrevBlock'], block['Nonce'], block['Transactions']])
