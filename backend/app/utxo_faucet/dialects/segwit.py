############################################################
#  [*] SegwitDialect — bech32 / p2wpkh chains
#
#  The native-SegWit address dialect: bech32 addresses under
#  the network's HRP, p2wpkh spending, BIP-143 witness
#  signing, version-2 transactions. One instance per SegWit
#  network — same class, different HRP ('tb', 'tltc', 'knf').
#
#  Recipients are accepted as ANY witness program (p2wpkh,
#  p2wsh, taproot): the scriptPubKey is version opcode (OP_0,
#  or OP_1..OP_16 = 0x50 + n) followed by the pushed program.
#
#  Used by:
#    - dialects/__init__.py — dialect_for()
#    - utxo_faucet.py — through the NetworkContext
############################################################


from embit import script as embit_script
from embit import bech32 as embit_bech32
from embit.transaction import Witness, SIGHASH




############################################################
# SegwitDialect
############################################################

class SegwitDialect:

    # Version-2 transactions, and the conservative fee-estimate
    # vsizes: ~91 vbytes per p2wpkh input, ~31 per output
    TX_VERSION = 2
    INPUT_SIZE = 91
    OUTPUT_SIZE = 31


    def __init__(self, hrp: str):
        self.hrp = hrp




    ############################################################
    # faucet_script / faucet_address
    ############################################################
    #
    # The faucet's own p2wpkh scriptPubKey, and that script as
    # a bech32 address under this network's HRP. The script is
    # HRP-independent — every SegWit chain shares it (and its
    # Electrum scripthash); only the address encoding differs.
    #
    # Used by:
    #   - utxo_faucet.py — identity per network, warmup
    ############################################################

    def faucet_script(self, pub) -> embit_script.Script:
        return embit_script.p2wpkh(pub)


    def faucet_address(self, pub) -> str:
        return self.faucet_script(pub).address({'bech32': self.hrp})




    ############################################################
    # validate_address
    ############################################################
    #
    # Cheap sanity check — the address must carry this
    # network's HRP ('tb1...', 'knf1...'). The FULL checksum
    # validation happens in recipient_script, where the
    # address is bech32-decoded for real.
    #
    # Used by:
    #   - utxo_faucet.py — request_crypto's input validation
    ############################################################

    def validate_address(self, address: str) -> bool:
        return address.lower().startswith(self.hrp + '1')




    ############################################################
    # recipient_script
    ############################################################
    #
    # bech32-decode (full checksum check) into a
    # witness-program scriptPubKey. Raises ValueError on
    # anything that doesn't decode under this HRP.
    #
    # Used by:
    #   - utxo_faucet.py — the payout's recipient output
    ############################################################

    def recipient_script(self, address: str) -> embit_script.Script:
        witver, witprog = embit_bech32.decode(self.hrp, address)
        if witver is None or witprog is None:
            raise ValueError("Invalid recipient address")
        witprog = bytes(witprog)

        version_opcode = bytes([0x50 + witver if witver else 0])
        return embit_script.Script(version_opcode + bytes([len(witprog)]) + witprog)




    ############################################################
    # sign_input
    ############################################################
    #
    # BIP-143 witness signing for one input, in place. The
    # scriptCode is the classic p2pkh script over our pubkey
    # hash — exactly the last 20 bytes of the p2wpkh script
    # (OP_0 PUSH20 <hash160>). The witness stack becomes
    # <DER signature + SIGHASH_ALL byte> <compressed pubkey>;
    # signatures use deterministic RFC-6979 nonces.
    #
    # Used by:
    #   - utxo_faucet.py — the payout's signing loop
    ############################################################

    def sign_input(self, tx, index: int, key, faucet_script, amount_sat: int):
        script_code = embit_script.Script(b'\x76\xa9\x14' + faucet_script.data[2:] + b'\x88\xac')
        sighash = tx.sighash_segwit(index, script_code, amount_sat)
        der_sig = key.sign(sighash).serialize() + bytes([SIGHASH.ALL])
        tx.vin[index].witness = Witness([der_sig, key.get_public_key().serialize()])
