#!/bin/bash
# Generate test data INSERT statements for push_test table
# Usage: ./scripts/generate-test-inserts.sh [count] [starting-id] [output-file]
# Example: ./scripts/generate-test-inserts.sh 10 497751 generated-inserts.sql

set -e

COUNT=${1:-1}
STARTING_ID=${2:-497751}
OUTPUT_FILE=${3:-scripts/generated-inserts.sql}

echo "Generating $COUNT test records starting from ID $STARTING_ID..."

# Run the TypeScript script and save to output file
npx ts-node scripts/generate-test-data.ts "$COUNT" "$STARTING_ID" > "$OUTPUT_FILE"

echo "Generated SQL file: $OUTPUT_FILE"
echo ""
echo "To insert into database, run:"
echo "  psql -U postgres -d neotree_nodeapi_local -f $OUTPUT_FILE"
echo ""
echo "Or with password:"
echo "  PGPASSWORD=your_password psql -U postgres -d neotree_nodeapi_local -f $OUTPUT_FILE"
