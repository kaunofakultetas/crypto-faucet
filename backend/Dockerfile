FROM python:3.12.4

WORKDIR /app


# Dependencies
RUN  apt-get update && \
     apt-get -y install nano procps && \
     rm -rf /var/lib/apt/lists/*


# Setup Backend
# scrypt stays even though bitcoinlib is gone — the reorg-attack
# tool hashes KNF block headers with it (fullnode_rpc.py)
RUN pip install --no-cache-dir     \
     "requests==2.32.3"            \
     "web3==6.20.1"                \
     "flask==3.0.3"                \
     "embit==0.8.0"                \
     "aiohttp==3.12.15"            \
     "scrypt==0.9.4"


EXPOSE 8000
CMD ["python3", "-u", "main.py"]
