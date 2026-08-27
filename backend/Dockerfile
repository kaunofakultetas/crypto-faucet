FROM python:3.14.7

WORKDIR /app


# Dependencies
RUN  apt-get update &&                                           \
     apt-get -y upgrade &&                                       \
     apt-get -y install --no-install-recommends procps &&        \
     rm -rf /var/lib/apt/lists/*


# Setup Backend
RUN pip install --no-cache-dir     \
     "requests==2.34.2"            \
     "web3==7.16.0"                \
     "eth-account==0.14.0"         \
     "flask==3.1.3"                \
     "werkzeug==3.1.8"             \
     "pydantic==2.13.4"            \
     "embit==0.8.0"                \
     "aiohttp==3.14.3"             \
     "solders==0.29.0"


# Copy the source code
COPY . .

EXPOSE 8000
CMD ["python3", "-u", "main.py"]
