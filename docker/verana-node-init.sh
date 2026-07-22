#!/usr/bin/env bash
set -e
HOME_DIR=/root/.verana
GENESIS=$HOME_DIR/config/genesis.json
SENTINEL=$HOME_DIR/.init-complete
CHAIN_ID=vna-testnet-1
MONIKER=validator1
KEY=cooluser
MNEMONIC="pink glory help gown abstract eight nice crazy forward ketchup skill cheese"
YIELD_ADDR=verana1wjnrmvjlgxvs098cnu3jaczzjjm4csmqep067h

if [ ! -f "$SENTINEL" ]; then
  echo ">> First boot: initializing $CHAIN_ID and funding $KEY ..."
  rm -rf "$HOME_DIR/config" "$HOME_DIR/data" "$HOME_DIR/keyring-test"
  veranad init "$MONIKER" --chain-id "$CHAIN_ID" --default-denom uvna

  echo "$MNEMONIC" | veranad keys add "$KEY" --recover --keyring-backend test
  veranad add-genesis-account "$KEY" 1000000000000000000000uvna --keyring-backend test
  veranad add-genesis-account "$YIELD_ADDR" 1uvna --keyring-backend test

  sed -i 's/"stake"/"uvna"/g' "$GENESIS"
  tmp=$(mktemp)
  jq '.app_state.gov.params.max_deposit_period="100s"
      | .app_state.gov.params.voting_period="100s"
      | .app_state.gov.params.expedited_voting_period="90s"' "$GENESIS" > "$tmp" && mv "$tmp" "$GENESIS"

  veranad gentx "$KEY" 1000000000uvna \
    --chain-id "$CHAIN_ID" --moniker "$MONIKER" \
    --commission-rate 0.10 --commission-max-rate 0.20 \
    --commission-max-change-rate 0.01 --min-self-delegation 1 \
    --keyring-backend test
  veranad collect-gentxs
  veranad validate-genesis

  sed -i 's/minimum-gas-prices = ""/minimum-gas-prices = "0.25uvna"/' "$HOME_DIR/config/app.toml"
  sed -i 's/enable = false/enable = true/'                            "$HOME_DIR/config/app.toml"
  sed -i 's/swagger = false/swagger = true/'                          "$HOME_DIR/config/app.toml"
  sed -i 's/enabled-unsafe-cors = false/enabled-unsafe-cors = true/'  "$HOME_DIR/config/app.toml"
  sed -i 's#address = "tcp://localhost:#address = "tcp://0.0.0.0:#'    "$HOME_DIR/config/app.toml"
  sed -i 's#address = "localhost:#address = "0.0.0.0:#'               "$HOME_DIR/config/app.toml"
  sed -i 's/cors_allowed_origins = \[\]/cors_allowed_origins = ["*"]/' "$HOME_DIR/config/config.toml"
  sed -i 's#laddr = "tcp://127.0.0.1:#laddr = "tcp://0.0.0.0:#'        "$HOME_DIR/config/config.toml"
  sed -i 's/^timeout_commit = .*/timeout_commit = "1s"/'              "$HOME_DIR/config/config.toml"

  touch "$SENTINEL"
fi

echo ">> Starting node ..."
exec veranad start

