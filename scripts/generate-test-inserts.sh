#!/bin/bash
# Insert synthetic test sessions into the source table.
# Uses the DB_* settings from .env (password from DB_PASSWORD or ~/.pgpass).
# Usage: ./scripts/generate-test-inserts.sh [count] [starting-id] [table-name]
# Example: ./scripts/generate-test-inserts.sh 10 497751 sessions

set -e

COUNT=${1:-1}
STARTING_ID=${2:-497753}
TABLE_NAME=${3:-${DB_SOURCE_TABLE:-sessions}}

npx ts-node scripts/generate-test-data.ts "$COUNT" "$STARTING_ID" "$TABLE_NAME"
