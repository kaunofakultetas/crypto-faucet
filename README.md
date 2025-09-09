# Crypto Faucet

A comprehensive multi-blockchain faucet system developed for Vilnius University. This platform provides free testnet tokens for various blockchain networks, educational tools, and DApp hosting capabilities.

<img width="1234" height="960" alt="Screenshot 2025-08-14 at 11 07 20" src="https://github.com/user-attachments/assets/43f2eafa-8437-4757-b764-6b7f4a877c2a" />

## 🚀 Features

### Multi-Blockchain Faucet Support
- **EVM-Compatible Networks**:
  - Ethereum Sepolia Testnet
  - zkSync Sepolia Testnet
  - Polygon zkEVM Cardona Testnet
  - Linea Sepolia Testnet
  - Ethereum Hoodi Testnet

- **UTXO-Based Networks**:
  - Bitcoin Testnet3
  - Bitcoin Testnet4
  - Litecoin Testnet4

### Educational Tools
- **Blockchain Simulator**: Interactive SHA-256 blockchain demonstration
- **Transaction Graph Visualizer**: Explore cryptocurrency transaction flows (See [more](_docs/txgraph/README.md))
- **DApp Hosting**: File browser and hosting for decentralized applications
- **51% Attack Tool**: Visual interface for 51% attack on LTC Testnet4 network (See [more](_docs/51percent/README.md))

## 📋 Prerequisites

- Docker and Docker Compose
- Infura API key (for EVM networks)
- Etherscan API key (optional, for enhanced features)

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/kaunofakultetas/crypto-faucet.git
cd crypto-faucet
```

### 2. Configure Environment
Copy the sample configuration:
```bash
cp docker-compose.yml.sample docker-compose.yml
```

Edit `docker-compose.yml` and update the following environment variables:
```yaml
environment:
  - INFURA_PROJECT_ID=your_infura_project_id
  - ETHERSCAN_API_KEY=your_etherscan_api_key
  - FAUCET_PRIVATE_KEY=your_private_key_here
  - DEFAULT_WALLET_ETH_AMOUNT=0.2
  - APP_PASSWORD_1=your_secure_password
```

### 3. Deploy Stack
```bash
./runUpdateThisStack.sh
```

### 4. Access the Application
- **Main Interface**: `http://<server-ip>` (or your configured domain)
- **Default GUI Password**: ***FAUCET_GUI_PASSWORD***

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `INFURA_PROJECT_ID` | Infura API project ID | - | ✅ |
| `ETHERSCAN_API_KEY` | Etherscan API key | - | ❌ |
| `FAUCET_PRIVATE_KEY` | Private key for faucet wallet | - | ✅ |
| `DEFAULT_WALLET_ETH_AMOUNT` | ETH amount per faucet request | 0.2 | ❌ |
| `FAUCET_DEFAULT_NETWORK` | Default EVM network | sepolia | ❌ |
| `APP_DEBUG` | Enable debug mode | false | ❌ |
| `APP_PASSWORD_1` | System GUI access password | - | ✅ |

### Network Configuration

Networks are configured in `backend/main.py`:

- **EVM Networks**: Configured with chain ID, RPC URLs, and block explorers
- **UTXO Networks**: Configured with Electrum servers and transaction parameters

## 📚 Usage

### Requesting Testnet Tokens

#### EVM Networks (Ethereum-like)
1. Navigate to `/faucet/evm/{network}` (e.g., `/faucet/evm/sepolia`)
2. Connect your Web3 wallet (MetaMask, etc.)
3. Sign the verification message
4. Click "Request Tokens"
5. Receive testnet ETH in your wallet

#### UTXO Networks (Bitcoin and Litecoin)
1. Navigate to `/faucet/utxo/{network}` (e.g., `/faucet/utxo/btc3`, `/faucet/utxo/ltc`)
2. Enter your cryptocurrency testnet address (Bitcoin or Litecoin)
3. Click "Request Tokens"
4. Receive testnet cryptocurrency at your address

### Educational Tools

#### Blockchain Simulator
- Access at `/sha256`
- Interactive demonstration of blockchain concepts
- Mine blocks and explore hash functions

#### Transaction Graph (See [more](_docs/txgraph/README.md))
- Access at `/graph/{network}`
- Visualize cryptocurrency transaction flows
- Explore addresses and transaction relationships

### DApp Hosting
- Upload static files via `/dapps` file browser
- Host decentralized applications
- Manage hosted content

#### 51% Attack Tool (See [more](_docs/51percent/README.md))
- Access at `/reorgattack`
- Visual interface for 51% attack on LTC Testnet4 network
- Explore and control blockchain structure
- Test the impact of 51% attacks on the network
- Rent and point miners to your private blockchain (Default port: 63333)



### Project Structure
```
├── backend/                 # Python Flask API
│   ├── app/
│   │   ├── evm_faucet/     # Ethereum-like faucet logic
│   │   ├── utxo_faucet/    # UTXO-based faucet logic (Bitcoin, Litecoin)
│   │   └── reorg_attack/   # 51% attack tool (LTC Testnet4)
│   ├── main.py             # Application entry point
│   └── requirements.txt    # Python dependencies
├── vite/                   # React frontend
│   └── app/
│       ├── src/
│       │   ├── components/ # Reusable UI components
│       │   └── pages/      # Application pages
│       └── package.json    # Node.js dependencies
├── dapps-server/           # Static file hosting
├── dapps-filebrowser/      # File management interface
├── litecoind-public/       # Public Litecoin node data (Represents public blockchain)
├── litecoind-private/      # Private Litecoin node data (Controlled by students)
├── litecoind-dummy/        # Dummy Litecoin node data (Required for private node to work)
└── docker-compose.yml      # Container orchestration
```

### API Endpoints

#### EVM Faucet
- `GET /api/evm/networks` - List supported EVM networks
- `POST /api/evm/{network}/request` - Request testnet tokens
- `GET /api/evm/{network}/faucet-balance` - Check faucet balance

#### UTXO Faucet
- `GET /api/utxo/networks` - List supported UTXO networks
- `POST /api/utxo/{network}/request` - Request testnet tokens
- `GET /api/utxo/{network}/faucet-balance` - Check faucet balance

## 🙋‍♂️ Support

For questions, issues, or contributions:

1. **Issues**: Open a GitHub issue for bug reports
2. **Features**: Submit feature requests via GitHub issues
3. **Education**: This platform is designed for learning blockchain development
