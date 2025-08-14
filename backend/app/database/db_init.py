############################################################
# Author:           Tomas Vanagas
# Updated:          2025-07-27
# Version:          1.0
# Description:      Database initialization
############################################################


from .db import get_db_connection





def init_db():
    init_db_tables()

    init_default_data()




def init_db_tables():
    with get_db_connection() as conn:
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
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [addresses] ( 
                [address] TEXT NULL,
                [name] TEXT NULL,
                [is_contract] INTEGER NULL,
                CONSTRAINT [sqlite_autoindex_addresses_1] UNIQUE ([address])
            );
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [transactions] ( 
                [id] INTEGER AUTO_INCREMENT NULL,
                [network] TEXT NULL,
                [from_address] TEXT NULL,
                [to_address] TEXT NULL,
                [value] REAL NULL,
                [hash] TEXT NULL,
                [block_number] INTEGER NULL,
                [timestamp] INTEGER NULL,
                PRIMARY KEY ([id]),
                CONSTRAINT [sqlite_autoindex_transactions_1] UNIQUE ([network], [hash])
            );
        ''')
            




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

