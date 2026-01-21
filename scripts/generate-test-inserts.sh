#!/bin/bash
# Generate a new test record with random UID and send to TEST_NODE_API endpoint
# The UID is automatically extracted from the generated record
#
# Usage: ./scripts/generate-test-inserts.sh [scriptId] [unique_key]
#
# Examples:
#   # Generate with defaults (random UID, default scriptId)
#   ./scripts/generate-test-inserts.sh
#
#   # Generate with custom scriptId
#   ./scripts/generate-test-inserts.sh "-ZO1TK4zMvLhxTw6eKia"
#
#   # Generate with custom scriptId and unique_key
#   ./scripts/generate-test-inserts.sh "-ZO1TK4zMvLhxTw6eKia" "abc123def456"

set -e

# Load NVM if it exists
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  # Ensure an active Node version in non-interactive shells.
  if command -v nvm &> /dev/null; then
    nvm use node >/dev/null
  fi
fi

# Ensure Node.js is available before we try to use it.
if ! command -v node &> /dev/null; then
  echo "Error: node is not available. Install Node.js (or enable it via nvm) and try again." >&2
  exit 1
fi

# Pick a ts-node runner without assuming yarn is installed.
TS_NODE_CMD=""
if [ -x "./node_modules/.bin/ts-node" ]; then
  TS_NODE_CMD="./node_modules/.bin/ts-node"
elif command -v yarn &> /dev/null; then
  TS_NODE_CMD="yarn ts-node"
elif command -v npx &> /dev/null; then
  TS_NODE_CMD="npx ts-node"
else
  echo "Error: ts-node runner not found. Install dependencies (yarn install) or add yarn/npx to PATH." >&2
  exit 1
fi

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '#' | xargs)
fi

# Script parameters from arguments or defaults
PARAM_SCRIPT_ID=${1:-"-ZO1TK4zMvLhxTw6eKia"}
# Generate a random 32-character unique key if not provided
PARAM_UNIQUE_KEY=${2:-$(openssl rand -hex 16)}

# Generate test record and save to generated.json
echo "Generating test record..."
$TS_NODE_CMD scripts/generate-test-record.ts

# Read generated.json
JSON_DATA=$(cat scripts/generated.json)

# Extract the UID from the generated record (don't override it)
# Use jq for robust JSON parsing, fall back to grep if jq not available
if command -v jq &> /dev/null; then
  GENERATED_UID=$(echo "$JSON_DATA" | jq -r '.uid')
else
  # Fallback: parse with sed/grep for systems without jq
  GENERATED_UID=$(echo "$JSON_DATA" | sed -n 's/.*"uid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
fi

if [ -z "$GENERATED_UID" ] || [ "$GENERATED_UID" = "null" ]; then
  echo "Error: Could not extract UID from generated record" >&2
  echo "Debug: First 500 chars of JSON: $(echo "$JSON_DATA" | head -c 500)" >&2
  exit 1
fi

echo "Generated record with UID: $GENERATED_UID"

# Extract the data portion to send in request body
echo "Sending generated record to TEST_NODE_API..."

# Send POST request to TEST_NODE_API with query parameters
echo "Sending to: ${TEST_NODE_API}/save-poll-data?uid=${GENERATED_UID}&scriptId=${PARAM_SCRIPT_ID}&unique_key=${PARAM_UNIQUE_KEY}"
curl -X POST "${TEST_NODE_API}/save-poll-data?uid=${GENERATED_UID}&scriptId=${PARAM_SCRIPT_ID}&unique_key=${PARAM_UNIQUE_KEY}" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${NODE_API_KEY}" \
  -d "$JSON_DATA" \
  -v

echo ""
echo "✓ Record sent to: ${TEST_NODE_API}/save-poll-data"
echo "✓ UID: ${GENERATED_UID}"
echo "✓ Script ID: ${PARAM_SCRIPT_ID}"
echo "✓ Generated JSON saved to: scripts/generated.json"
