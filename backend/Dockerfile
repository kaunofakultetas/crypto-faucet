FROM python:3.12.4

WORKDIR /app


# Dependencies
RUN  apt-get update && \
     apt-get -y install nano procps && \
     rm -rf /var/lib/apt/lists/*


# Setup Backend
RUN pip install --no-cache-dir     \
     "requests==2.32.3"            \
     "web3==6.20.1"                \
     "flask==3.0.3"                \
     "embit==0.8.0"                \
     "aiohttp==3.12.15"            \
     "scrypt==0.9.4"               \
     "solders==0.23.0"


# Copy the source code
COPY . .

EXPOSE 8000
CMD ["python3", "-u", "main.py"]
