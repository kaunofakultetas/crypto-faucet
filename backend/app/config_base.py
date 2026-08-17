############################################################
#  [*] Config base — the shared strict foundation
#
#  The one pydantic rule every family's config schema builds
#  on. It lives in its own dependency-free module so the
#  family schemas (app/<family>/config_schema.py) and the
#  connector (app/config_models.py) can both import it
#  without ever importing each other's way — a clean DAG
#  instead of a circular-import trap.
#
#  Used by:
#    - app/evm_faucet/config_schema.py
#    - app/erc_faucet/config_schema.py
#    - app/utxo_faucet/config_schema.py
#    - app/svm_faucet/config_schema.py
#    - app/move_faucet/config_schema.py
############################################################


from pydantic import BaseModel, ConfigDict








############################################################
# StrictModel
############################################################
#
# Shared base: unknown keys are ERRORS. This is what turns
# 'chunk_sizee' from a silent runtime fallback into a loud
# boot failure.
#
# Used by:
#   - every model in every family's config_schema.py
############################################################

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')
