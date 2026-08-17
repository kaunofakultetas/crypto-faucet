############################################################
#  [*] LegacyDialect — base58 / p2pkh chains (pre-SegWit)
#
#  The legacy address dialect for chains that never activated
#  SegWit (Dogecoin): base58check addresses keyed by version
#  byte, classic p2pkh spending, the original pre-BIP-143
#  sighash with scriptSig unlocking, version-1 transactions.
#  One instance per legacy network — same class, different
#  version bytes (doge testnet: 0x71 P2PKH, 0xc4 P2SH).
#
#  Recipients are accepted as p2pkh, and — when the config
#  names a p2sh_prefix — p2sh.
#
#  Used by:
#    - dialects/__init__.py — dialect_for()
#    - utxo_faucet.py — through the NetworkContext
#    - segwit.py — composed in as the RECIPIENT codec on
#      SegWit coins that also accept old base58 addresses
#      (only validate_address / recipient_script are called
#      in that role)
############################################################


from embit import script as embit_script
from embit import base58 as embit_base58
from embit import hashes as embit_hashes
from embit.transaction import SIGHASH




############################################################
# LegacyDialect
############################################################

class LegacyDialect:

    # Version-1 transactions (maximally compatible; nothing here
    # needs BIP-68 semantics), and the fee-estimate sizes: ~148
    # bytes per p2pkh input (the scriptSig carries what a
    # witness would), ~34 per output
    TX_VERSION = 1
    INPUT_SIZE = 148
    OUTPUT_SIZE = 34




    ############################################################
    # __init__
    ############################################################
    #
    # Just the network's base58 version bytes. p2sh_prefix is
    # optional — None means p2sh recipients are rejected.
    #
    # Used by:
    #   - dialects/__init__.py — dialect_for(), per network
    #   - segwit.py — SegwitDialect.__init__, composing the
    #     recipient-side codec
    ############################################################

    def __init__(self, p2pkh_prefix: int, p2sh_prefix=None):
        self.p2pkh_prefix = int(p2pkh_prefix)
        self.p2sh_prefix = int(p2sh_prefix) if p2sh_prefix is not None else None




    ############################################################
    # faucet_script
    ############################################################
    #
    # The faucet's own classic p2pkh scriptPubKey. It carries
    # no version byte — every legacy chain shares it (and its
    # Electrum scripthash); only the address encoding differs.
    #
    # Used by:
    #   - utxo_faucet.py — identity per network, warmup
    ############################################################

    def faucet_script(self, pub) -> embit_script.Script:
        return embit_script.p2pkh(pub)




    ############################################################
    # faucet_address
    ############################################################
    #
    # The same key hash as a base58check address under this
    # network's p2pkh version byte.
    #
    # Used by:
    #   - utxo_faucet.py — identity per network, warmup
    ############################################################

    def faucet_address(self, pub) -> str:
        keyhash = embit_hashes.hash160(pub.serialize())
        return embit_base58.encode_check(bytes([self.p2pkh_prefix]) + keyhash)




    ############################################################
    # _decode
    ############################################################
    #
    # base58check decode to the 21-byte version+hash payload,
    # or None on a bad checksum / wrong length. Base58 has no
    # cheap prefix worth testing, so validation IS the decode.
    #
    # Used by:
    #   - validate_address / recipient_script (below)
    ############################################################

    def _decode(self, address: str):
        try:
            payload = embit_base58.decode_check(address)
        except Exception:
            return None
        if len(payload) != 21:
            return None
        return payload




    ############################################################
    # validate_address
    ############################################################
    #
    # A FULL check — checksum plus this network's version
    # byte(s). Unlike the SegWit dialect there is no cheap
    # pre-check / full-check split.
    #
    # Used by:
    #   - utxo_faucet.py — request_crypto's input validation
    ############################################################

    def validate_address(self, address: str) -> bool:
        payload = self._decode(address)
        if payload is None:
            return False
        return payload[0] == self.p2pkh_prefix or (
            self.p2sh_prefix is not None and payload[0] == self.p2sh_prefix
        )




    ############################################################
    # recipient_script
    ############################################################
    #
    # base58check decode into the classic p2pkh — or, when
    # configured, p2sh — scriptPubKey, keyed by the leading
    # version byte. Raises ValueError on anything else.
    #
    # Used by:
    #   - utxo_faucet.py — the payout's recipient output
    ############################################################

    def recipient_script(self, address: str) -> embit_script.Script:
        payload = self._decode(address)
        if payload is None:
            raise ValueError("Invalid recipient address")

        version, keyhash = payload[0], payload[1:]
        if version == self.p2pkh_prefix:
            return embit_script.Script(b'\x76\xa9\x14' + keyhash + b'\x88\xac')
        if self.p2sh_prefix is not None and version == self.p2sh_prefix:
            return embit_script.Script(b'\xa9\x14' + keyhash + b'\x87')
        raise ValueError("Invalid recipient address")




    ############################################################
    # sign_input
    ############################################################
    #
    # Pre-BIP-143 signing for one input, in place: the sighash
    # commits to our p2pkh scriptPubKey in this input's slot
    # (embit blanks the other inputs' scripts itself), and the
    # unlocking data goes in the scriptSig — <DER signature +
    # SIGHASH_ALL byte> <compressed pubkey>. With every
    # witness left empty, embit serializes the legacy
    # (pre-BIP-141) wire format — these chains know no other.
    # amount_sat is unused (the legacy sighash does not commit
    # to input amounts) but kept for the shared signature.
    #
    # Used by:
    #   - utxo_faucet.py — the payout's signing loop
    ############################################################

    def sign_input(self, tx, index: int, key, faucet_script, amount_sat: int):
        sighash = tx.sighash_legacy(index, faucet_script)
        der_sig = key.sign(sighash).serialize() + bytes([SIGHASH.ALL])
        pub_bytes = key.get_public_key().serialize()
        tx.vin[index].script_sig = embit_script.Script(
            bytes([len(der_sig)]) + der_sig + bytes([len(pub_bytes)]) + pub_bytes
        )
