#!/usr/bin/env bash
#
# verana-test-flow.sh
# -------------------------------------------------------------------
# End-to-end exercise of the Verana modules against the running node.
#
# VALID FOR verana-node image `sha-5e32065` (verana main == v0.10.1-dev.13). If the
# node version changes, the CLI commands/flags below may differ and this file MUST
# be updated. (dev.13 renamed: tr->ec Ecosystem, perm->pp Participant; GF docs live
# in the `gf` module; Corporation `co` has no CLI, so it is created via raw tx JSON.)
#
# Flow (a REAL corporation is created and delegates to cooluser):
#   1. Create a Corporation (co MsgCreateCorporation) -> x/group policy account
#   2. Fund the Corporation
#   3. Corporation grants operator authorization to cooluser (via x/group proposal)
#   4. Ecosystem  (ec): create -> rotate DID -> archive/unarchive
#   5. Corporation Governance Framework (gf): add document -> activate next version
#   6. Credential Schema (cs): create -> update validity periods -> archive/unarchive
#   7. Participant (pp): create root -> self-create ISSUER (OPEN schema) -> revoke
#
# Requires the container running (`docker compose up -d`) with cooluser funded at genesis.
# -------------------------------------------------------------------
set -euo pipefail

# ---- Config (override via env) ------------------------------------
CONTAINER="${CONTAINER:-verana-node}"
KEY="${KEY:-cooluser}"                              # admin/member/operator key (funded at genesis)
CHAIN_ID="${CHAIN_ID:-vna-testnet-1}"
# DIDs must be globally unique on-chain; a run-id suffix keeps the script re-runnable.
RUN_ID="${RUN_ID:-$(date +%s)}"
CORP_DID="${CORP_DID:-did:example:corporation-${RUN_ID}}"
CORP_FUNDING="${CORP_FUNDING:-100000000000uvna}"   # 100 VNA: covers trust deposits + fees
ECO_DID="${ECO_DID:-did:example:ecosystem-${RUN_ID}}"
ECO_DID_ROTATED="${ECO_DID_ROTATED:-did:example:ecosystem-${RUN_ID}-rotated}"
ISSUER_DID="${ISSUER_DID:-did:example:issuer-${RUN_ID}}"
LANG_TAG="${LANG_TAG:-en}"
GF_URL="${GF_URL:-https://example.com/governance-framework.json}"

KB="--keyring-backend test --home /root/.verana"
TXFLAGS="--chain-id ${CHAIN_ID} --gas auto --gas-adjustment 1.6 --gas-prices 0.3uvna -y -o json"

# Delegable message types the corporation grants to the operator.
GRANT_MSGS="$(IFS=,; echo "\
/verana.ec.v1.MsgCreateEcosystem \
/verana.ec.v1.MsgUpdateEcosystem \
/verana.ec.v1.MsgArchiveEcosystem \
/verana.gf.v1.MsgAddGovernanceFrameworkDocument \
/verana.gf.v1.MsgIncreaseActiveGovernanceFrameworkVersion \
/verana.cs.v1.MsgCreateCredentialSchema \
/verana.cs.v1.MsgUpdateCredentialSchema \
/verana.cs.v1.MsgArchiveCredentialSchema \
/verana.pp.v1.MsgCreateRootParticipant \
/verana.pp.v1.MsgSelfCreateParticipant \
/verana.pp.v1.MsgRevokeParticipant" | tr -s ' ' ',')"

# ---- Helpers ------------------------------------------------------
v() { docker exec -i "$CONTAINER" veranad "$@"; }
c() { docker exec -i "$CONTAINER" "$@"; }
put() { docker exec -i "$CONTAINER" sh -c "cat > '$1'"; }
section() { echo; echo "==== $* ===="; }

# Compute a valid sha384 Subresource Integrity digest in-container.
sri() { echo "sha384-$(c python3 -c "import hashlib,base64,sys;print(base64.b64encode(hashlib.sha384(sys.argv[1].encode()).digest()).decode())" "$1" | tr -d '\r')"; }

# Wait until a tx hash is committed; print OK or fail on code!=0.
wait_tx() {
  local txhash="$1" desc="$2" res code
  for _ in $(seq 1 20); do
    sleep 2
    res="$(v query tx "$txhash" -o json 2>/dev/null || true)"
    code="$(echo "$res" | jq -r '.code // empty' 2>/dev/null || true)"
    [ -z "$code" ] && continue
    if [ "$code" = "0" ]; then echo "   OK  (tx ${txhash})"; return 0; fi
    echo "   FAILED (code ${code}): $(echo "$res" | jq -r '.raw_log')"; exit 1
  done
  echo "   ERROR: timed out waiting for ${desc} (${txhash})"; exit 1
}

# Broadcast a veranad tx subcommand, wait until committed.
submit() {
  local desc="$1"; shift
  echo ">> ${desc}"
  local out txhash
  out="$(v "$@" ${KB} ${TXFLAGS} 2>&1)" || { echo "$out"; exit 1; }
  txhash="$(echo "$out" | grep -o '"txhash":"[^"]*"' | head -1 | cut -d'"' -f4)"
  [ -z "$txhash" ] && { echo "   ERROR: no txhash:"; echo "$out"; exit 1; }
  wait_tx "$txhash" "$desc"
}

# Latest-id helpers (entities are id-monotonic).
last_group()  { v query group groups-by-admin "$1"      -o json | jq -r '.groups | max_by(.id|tonumber) | .id'; }
last_prop()   { v query group proposals-by-group-policy "$1" -o json | jq -r '.proposals | max_by(.id|tonumber) | .id'; }
last_eco()    { v query ec list-ecosystems   -o json | jq -r '.ecosystems  | max_by(.id|tonumber) | .id'; }
last_schema() { v query cs list-schemas      -o json | jq -r '(.schemas // []) | max_by(.id|tonumber) | .id'; }
# dev.13: pp returns `.participants[]` with a `.role` (not `.permissions[]`/`.type`).
last_perm()   { v query pp list-participants  -o json | jq -r --arg t "$1" '[(.participants // [])[]|select(.role==$t)] | max_by(.id|tonumber) | .id'; }

# ---- Preflight ----------------------------------------------------
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "ERROR: container '$CONTAINER' is not running. Start it with: docker compose up -d"
  exit 1
fi
ADDR="$(v keys show "$KEY" -a ${KB})"
echo "Operator / admin / member: ${KEY} = ${ADDR}"

# ============================================================
section "1. Create the Corporation (co MsgCreateCorporation, raw tx JSON)"
# co has no CLI subcommand; build, sign and broadcast the message directly.
cat <<JSON | put /tmp/corp.json
{
  "body": { "messages": [{
    "@type": "/verana.co.v1.MsgCreateCorporation",
    "signer": "${ADDR}",
    "members": [{ "address": "${ADDR}", "weight": "1", "metadata": "founder" }],
    "group_metadata": "corporation:${CORP_DID}",
    "group_policy_metadata": "policy:${CORP_DID}",
    "decision_policy": {
      "@type": "/cosmos.group.v1.ThresholdDecisionPolicy",
      "threshold": "1", "windows": { "voting_period": "60s", "min_execution_period": "0s" }
    },
    "did": "${CORP_DID}", "language": "${LANG_TAG}",
    "doc_url": "${GF_URL}", "doc_digest_sri": "$(sri 'corp cgf v1')"
  }], "memo": "", "timeout_height": "0", "extension_options": [], "non_critical_extension_options": [] },
  "auth_info": { "signer_infos": [], "fee": { "amount": [{"denom":"uvna","amount":"400000"}], "gas_limit": "800000", "payer": "", "granter": "" } },
  "signatures": []
}
JSON
echo ">> Create Corporation ${CORP_DID}"
v tx sign /tmp/corp.json --from "$KEY" --chain-id "$CHAIN_ID" ${KB} --output-document /tmp/corp-signed.json >/dev/null 2>&1
CORP_HASH="$(v tx broadcast /tmp/corp-signed.json -o json 2>/dev/null | grep -o '"txhash":"[^"]*"' | head -1 | cut -d'"' -f4)"
wait_tx "$CORP_HASH" "MsgCreateCorporation"
# MsgCreateCorporation self-administers the group (admin becomes the policy), so the
# corporation address and group id are read straight from the tx events.
CORP_EVENTS="$(v query tx "$CORP_HASH" -o json)"
GROUP_ID="$(echo "$CORP_EVENTS" | jq -r '[.events[]|select(.type=="cosmos.group.v1.EventCreateGroup")|.attributes[]|select(.key=="group_id")|.value]|last' | tr -d '"\\')"
CORP="$(echo "$CORP_EVENTS" | jq -r '[.events[]|select(.type=="cosmos.group.v1.EventCreateGroupPolicy")|.attributes[]|select(.key=="address")|.value]|last' | tr -d '"\\')"
echo "   Corporation = ${CORP}  (group_id=${GROUP_ID})"

# ============================================================
section "2. Fund the Corporation"
submit "Fund ${CORP} with ${CORP_FUNDING}" \
  tx bank send "$ADDR" "$CORP" "$CORP_FUNDING"
v query bank balances "$CORP" -o json | jq -c '.balances'

# ============================================================
section "3. Corporation grants operator authorization to ${KEY} (x/group proposal)"
# A group policy account can only act via proposals; the inner Msg signer is the corporation.
cat <<JSON | put /tmp/grant-prop.json
{
  "group_policy_address": "${CORP}",
  "messages": [{
    "@type": "/verana.de.v1.MsgGrantOperatorAuthorization",
    "corporation": "${CORP}", "operator": "", "grantee": "${ADDR}",
    "msg_types": [$(echo "$GRANT_MSGS" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"",(i>1?",":""),$i}}')],
    "expiration": null, "authz_spend_limit": [], "authz_spend_limit_period": null,
    "with_feegrant": false, "feegrant_spend_limit": [], "feegrant_spend_limit_period": null, "fee_spend_limit": []
  }],
  "metadata": "grant-operator-authz", "title": "Grant operator authz to ${KEY}",
  "summary": "Authorize ${KEY} to run VPR messages on behalf of the corporation",
  "proposers": ["${ADDR}"]
}
JSON
submit "Submit operator-grant proposal" tx group submit-proposal /tmp/grant-prop.json --from "$KEY"
PROP_ID="$(last_prop "$CORP")"; echo "   Proposal ID = ${PROP_ID}"
submit "Vote YES on proposal ${PROP_ID}" tx group vote "$PROP_ID" "$ADDR" VOTE_OPTION_YES "approve" --from "$KEY"
submit "Execute proposal ${PROP_ID}"     tx group exec "$PROP_ID" --from "$KEY"
v query de list-operator-authorizations -o json | jq -c --arg c "$CORP" '.operator_authorizations[]|select(.corporation==$c)|{corporation, grantee, msg_types:(.msg_types|length)}'

# ============================================================
section "4. Ecosystem lifecycle (on behalf of the corporation)"
submit "Create Ecosystem ${ECO_DID}" \
  tx ec create-ecosystem "$CORP" "$ECO_DID" "$LANG_TAG" "$GF_URL" "$(sri 'eco gf v1')" --from "$KEY"
ECO_ID="$(last_eco)"; echo "   Ecosystem ID = ${ECO_ID}"
submit "Rotate the Ecosystem DID -> ${ECO_DID_ROTATED}" \
  tx ec update-ecosystem "$CORP" "$ECO_ID" "$ECO_DID_ROTATED" --from "$KEY"
submit "Archive the Ecosystem"   tx ec archive-ecosystem "$CORP" "$ECO_ID" true  --from "$KEY"
submit "Unarchive the Ecosystem" tx ec archive-ecosystem "$CORP" "$ECO_ID" false --from "$KEY"

# ============================================================
section "5. Corporation Governance Framework (gf)"
# gf docs are corporation-level (CGF); [operator] is the signing operator address.
ACTIVE_GF="$(v query ec get-ecosystem "$ECO_ID" -o json | jq -r '(.ecosystem // .).active_version // 1')"
NEXT_GF=$((ACTIVE_GF + 1))
submit "Add governance framework document v${NEXT_GF}" \
  tx gf add-governance-framework-document "$CORP" "$ADDR" "$LANG_TAG" \
     "https://example.com/gf-v${NEXT_GF}.json" "$(sri "gf v${NEXT_GF}")" "$NEXT_GF" --from "$KEY"
submit "Activate governance framework version ${NEXT_GF}" \
  tx gf increase-active-gf-version "$CORP" "$ADDR" --from "$KEY"

# ============================================================
section "6. Credential Schema lifecycle"
# Modes 1=OPEN/2=GRANTOR_VALIDATION/3=ECOSYSTEM; asset-type 1=TU "tu"; digest sha256; validity periods are {"value":N}.
SCHEMA_JSON='{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","title":"ExampleCredential","description":"Example credential schema for testing","properties":{"name":{"type":"string"},"country":{"type":"string"}},"required":["name"]}'
VP='{"value":365}'
submit "Create Credential Schema under Ecosystem ${ECO_ID} (issuer/verifier mode OPEN)" \
  tx cs create-credential-schema "$ECO_ID" "$SCHEMA_JSON" 1 1 1 1 tu sha256 \
     --corporation "$CORP" \
     --issuer-grantor-validation-validity-period "$VP" \
     --verifier-grantor-validation-validity-period "$VP" \
     --issuer-validation-validity-period "$VP" \
     --verifier-validation-validity-period "$VP" \
     --holder-validation-validity-period "$VP" --from "$KEY"
SCHEMA_ID="$(last_schema)"; echo "   Credential Schema ID = ${SCHEMA_ID}"
submit "Update Credential Schema validity periods" \
  tx cs update "$SCHEMA_ID" --corporation "$CORP" \
     --issuer-grantor-validation-validity-period "$VP" \
     --verifier-grantor-validation-validity-period "$VP" \
     --issuer-validation-validity-period '{"value":180}' \
     --verifier-validation-validity-period "$VP" \
     --holder-validation-validity-period "$VP" --from "$KEY"
submit "Archive the Credential Schema"   tx cs archive "$SCHEMA_ID" true  --corporation "$CORP" --from "$KEY"
submit "Unarchive the Credential Schema" tx cs archive "$SCHEMA_ID" false --corporation "$CORP" --from "$KEY"

# ============================================================
section "7. Participants (pp)"
# Root (ECOSYSTEM) participant for the schema; controller-only. effective-from is
# mandatory and must be in the future, but the perm must be active before it can be
# revoked, so we use a short offset and wait for it to elapse before revoking.
EFFECTIVE_FROM="$(c date -u -d '+45 seconds' +%Y-%m-%dT%H:%M:%SZ | tr -d '\r')"
submit "Create root participant for schema ${SCHEMA_ID} (effective ${EFFECTIVE_FROM})" \
  tx pp create-root-participant "$SCHEMA_ID" "$ECO_DID" 0 0 0 \
     --corporation "$CORP" --effective-from "$EFFECTIVE_FROM" --from "$KEY"
ROOT_PERM_ID="$(last_perm ECOSYSTEM)"; echo "   Root (ECOSYSTEM) participant ID = ${ROOT_PERM_ID}"
# Self-created ISSUER participant (allowed because the schema is OPEN); [role] is the enum name in lowercase.
submit "Self-create an ISSUER participant under root ${ROOT_PERM_ID}" \
  tx pp self-create-participant issuer "$ROOT_PERM_ID" "$ISSUER_DID" \
     --corporation "$CORP" --effective-from "$EFFECTIVE_FROM" --from "$KEY"
ISSUER_PERM_ID="$(last_perm ISSUER)"; echo "   ISSUER participant ID = ${ISSUER_PERM_ID}"
v query pp get-participant "$ISSUER_PERM_ID" -o json | jq '(.participant // .) | {id, schema_id, role, did, validator_participant_id, grantee}'
# Revocation requires the participant to be active. Validation uses the chain's block
# time (which can lag wall-clock), so poll latest_block_time until it passes effective_from.
EFF_EPOCH="$(date -u -d "$EFFECTIVE_FROM" +%s)"
echo ">> Waiting for chain block time to reach ${EFFECTIVE_FROM}..."
for _ in $(seq 1 60); do
  BT="$(v status 2>&1 | jq -r '.sync_info.latest_block_time' 2>/dev/null | sed 's/\.[0-9]*//')"
  BT_EPOCH="$(date -u -d "$BT" +%s 2>/dev/null || echo 0)"
  [ "$BT_EPOCH" -ge "$EFF_EPOCH" ] && break
  sleep 2
done
submit "Revoke ISSUER participant ${ISSUER_PERM_ID}" \
  tx pp revoke-participant "$ISSUER_PERM_ID" --corporation "$CORP" --from "$KEY"

# ============================================================
section "RESULT"
echo "Corporation ${CORP} (group_id=${GROUP_ID}, did=${CORP_DID})"
echo "Ecosystem ${ECO_ID}:"
v query ec get-ecosystem "$ECO_ID" -o json | jq '(.ecosystem // .) | {id, did, active_version, archived}'
echo "Credential Schema ${SCHEMA_ID}:"
v query cs get-schema "$SCHEMA_ID" -o json | jq '(.schema // .) | {id, ecosystem_id, archived}'
echo "Participants for schema ${SCHEMA_ID}:"
v query pp list-participants -o json | jq --argjson s "$SCHEMA_ID" '(.participants // [])[] | select((.schema_id|tonumber)==$s) | {id, role, did}'
echo
echo "All steps completed."
