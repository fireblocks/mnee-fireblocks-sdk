# MNEE BSV SDK

SDK for handling MNEE token transactions with Fireblocks signing on the Bitcoin SV blockchain.

## Overview

This SDK provides a streamlined way to manage MNEE token transactions on the Bitcoin SV blockchain using Fireblocks for transaction signing. It implements the 1Sat Ordinals protocol and provides a robust API for interacting with MNEE tokens.


*NOTE*: This SDK uses Fireblocks RAW signing. Kindly note that running this SDK is on your own responsibility.
Learn more about [RAW Signing](https://developers.fireblocks.com/docs/raw-signing)

*NOTE*: This project is still WIP which might introduce breaking changes in the future.

## Installation

### Option 1: Local Development

```bash
git clone https://github.com/fireblocks/mnee-fireblocks-sdk
cd mnee-bsv
npm install
npm start
```

### Option 2: Docker Deployment
```bash
git clone https://github.com/fireblocks/mnee-fireblocks-sdk
cd mnee-bsv
mkdir -p secrets

# Copy your Fireblocks secret key into the secrets directory
cp /path/to/your/fireblocks_secret.key ./secrets/

# Edit your .env file
nano .env

# Build and run the container
docker-compose build
docker-compose up
```

## Environment Setup

### For Local Development

Create a .env file in the project root with the following required variables:
```bash
# Required environment variables
MNEE_COSIGNER_URL='https://sandbox-cosigner.mnee.net/v1'
FIREBLOCKS_SECRET_KEY_PATH='/path/to/fireblocks_secret.key'
FIREBLOCKS_API_KEY='your-fireblocks-api-key'
MNEE_COSIGNER_AUTH_TOKEN='your-cosigner-auth-token'

MNEE_LOG_LEVEL='INFO'          # Logging level (DEBUG, INFO, WARN, ERROR, NONE)
```
### For Docker Deployment

The same .env file is used, but note that the secret key path in the Docker environment is fixed at `fireblocks_secret.key`. Your `.env` should contain:
```bash

# Required environment variables for Docker deployment
MNEE_COSIGNER_URL='https://sandbox-cosigner.mnee.net/v1'
FIREBLOCKS_SECRET_KEY_PATH='/secrets/fireblocks_secret.key'  # Don't change this path for Docker
FIREBLOCKS_API_KEY='your-fireblocks-api-key'
MNEE_COSIGNER_AUTH_TOKEN='your-cosigner-auth-token'
MNEE_LOG_LEVEL='INFO'          # Logging level (DEBUG, INFO, WARN, ERROR, NONE)
```

## API Reference
REST API Endpoints (Docker)
The service exposes the following REST API endpoints when running:

`/health`	- GET	Health check for the API	None
`/api/info`	- GET	Get API server information	None
`/api/balance/vault/:vaultAccountId` -	GET	Get balance for a vault account	vaultAccountId in path
`/api/balance/address/:address` -	GET	Get balance for a specific address	address in path
`/api/address/vault/:vaultAccountId` - GET Get addresses for a vault account	vaultAccountId in path
`/api/transfer`	- POST Transfer tokens from a vault	JSON body with sourceVaultAccountId, recipientAddress, and amount
`/api/utxos/:address` -	GET	Get UTXOs for an address	address in path

### Example API Requests

Check balance for a vault account:

```bash
curl -X GET http://localhost:3000/api/balance/vault/23
```

Transfer tokens:
```bash
curl -X POST http://localhost:3000/api/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "sourceVaultAccountId": "23",
    "recipientAddress": "1tkSDyyX1hqQTDV7Hf1cTXfWk5q1LMRbS",
    "amount": 0.1
  }'
```

## SDK Methods

- `transferTokensFromVault`: Transfer MNEE tokens from a Fireblocks vault account
```js
sync transferTokensFromVault(
  sourceVaultAccountId: string,
  recipientAddress: string,
  amount?: number,  
  options?: TransferOptions
): Promise<TransactionHashResponse>
```

- `getBalanceForVaultAccount`: Get MNEE token balance for a vault account
```js
async getBalanceForVaultAccount(
  vaultAccountId: string
): Promise<number>
```

- `getAddressBalance`: Get MNEE token balance for a specific address
```js
async getAddressBalance(
  address: string
): Promise<number>
```



