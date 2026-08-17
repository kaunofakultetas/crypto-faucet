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
#  When the coin lists base58 version bytes, LEGACY recipients
#  (p2pkh / p2sh) are accepted too — SegWit chains never
#  abolished them, and students' older wallets still hand
#  them out. That is recipient-side ONLY: a LegacyDialect is
#  composed in purely as the base58 codec, while the faucet's
#  own wallet, address and signing stay SegWit (a
#  witness-signed transaction paying a p2pkh output is
#  perfectly standard).
#
#  Used by:
#    - dialects/__init__.py — dialect_for()
#    - utxo_faucet.py — through the NetworkContext
############################################################


from embit import script as embit_script
from embit import bech32 as embit_bech32
from embit.transaction import Witness, SIGHASH

from .legacy import LegacyDialect




############################################################
# SegwitDialect
############################################################

class SegwitDialect:

    # Version-2 transactions, and the conservative fee-estimate
    # vsizes: ~91 vbytes per p2wpkh input, ~31 per output (a
    # legacy p2pkh output is 34 — the 3-byte difference sits
    # comfortably inside the input over-estimate)
    TX_VERSION = 2
    INPUT_SIZE = 91
    OUTPUT_SIZE = 31




    ############################################################
    # __init__
    ############################################################
    #
    # The network's bech32 HRP, plus — when the coin lists
    # base58 version bytes — the composed legacy codec for
    # old-wallet recipients (see the file header).
    #
    # Used by:
    #   - dialects/__init__.py — dialect_for(), per network
    ############################################################

    def __init__(self, hrp: str, p2pkh_prefix=None, p2sh_prefix=None):
        self.hrp = hrp

        # Recipient-side ONLY: when the coin lists base58 version
        # bytes, a LegacyDialect serves as the codec for old-wallet
        # recipient addresses. None = bech32 recipients only (KNF).
        self._legacy_recipients = (
            LegacyDialect(p2pkh_prefix, p2sh_prefix) if p2pkh_prefix is not None else None
        )




    ############################################################
    # faucet_script
    ############################################################
    #
    # The faucet's own p2wpkh scriptPubKey. It is
    # HRP-independent — every SegWit chain shares it (and its
    # Electrum scripthash); only the address encoding differs.
    #
    # Used by:
    #   - utxo_faucet.py — identity per network, warmup
    #   - faucet_address (below)
    ############################################################

    def faucet_script(self, pub) -> embit_script.Script:
        return embit_script.p2wpkh(pub)




    ############################################################
    # faucet_address
    ############################################################
    #
    # That script as a bech32 address under this network's
    # HRP.
    #
    # Used by:
    #   - utxo_faucet.py — identity per network, warmup
    ############################################################

    def faucet_address(self, pub) -> str:
        return self.faucet_script(pub).address({'bech32': self.hrp})




    ############################################################
    # validate_address
    ############################################################
    #
    # bech32: a cheap prefix check ('tb1...', 'knf1...') — the
    # FULL checksum validation happens in recipient_script,
    # where the address is bech32-decoded for real. Anything
    # else falls through to the legacy codec (full base58check
    # verdict) when the coin has one.
    #
    # Used by:
    #   - utxo_faucet.py — request_crypto's input validation
    ############################################################

    def validate_address(self, address: str) -> bool:
        if address.lower().startswith(self.hrp + '1'):
            return True

        if self._legacy_recipients is not None:
            return self._legacy_recipients.validate_address(address)

        return False




    ############################################################
    # recipient_script
    ############################################################
    #
    # bech32-decode (full checksum check) into a
    # witness-program scriptPubKey; an address that doesn't
    # decode under this HRP is handed to the legacy codec
    # (p2pkh / p2sh) when the coin has one. Raises ValueError
    # when neither accepts it.
    #
    # Used by:
    #   - utxo_faucet.py — the payout's recipient output
    ############################################################

    def recipient_script(self, address: str) -> embit_script.Script:
        witver, witprog = embit_bech32.decode(self.hrp, address)
        if witver is not None and witprog is not None:
            witprog = bytes(witprog)
            version_opcode = bytes([0x50 + witver if witver else 0])
            return embit_script.Script(version_opcode + bytes([len(witprog)]) + witprog)

        if self._legacy_recipients is not None:
            return self._legacy_recipients.recipient_script(address)

        raise ValueError("Invalid recipient address")




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
