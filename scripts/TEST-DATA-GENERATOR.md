# Test Data Generator

This script inserts synthetic test sessions straight into the source table (`sessions` by default) while maintaining the JSONB structure and keeping the script metadata consistent.

It connects to the database itself using the same `DB_*` settings as the adapter (from `.env`), and inserts with parameterised queries. It no longer prints SQL for you to run through `psql`.

## Features

- **Auto-incrementing IDs**: Tracks and increments the last ID
- **Randomized data**: Generates realistic random values for all entry fields
- **Maintains structure**: Keeps all JSON keys and structure intact
- **Preserves script info**: Script object and scriptid remain unchanged
- **Unique UIDs**: Generates unique patient UIDs (CB59-XXXXXXX format)
- **Unique keys**: Generates random unique keys for each record
- **Realistic values**: Uses realistic ranges for medical data (weight, Apgar scores, vital signs, etc.)

## Database Connection

The script reads these from `.env` (the same settings the adapter uses):

| Variable | Default | Notes |
|---|---|---|
| `DB_HOST` | `localhost` | |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `neotree` | e.g. `neotree_nodeapi_local` for a local copy |
| `DB_USER` | `postgres` | |
| `DB_PASSWORD` | _(unset)_ | Leave unset to use `~/.pgpass` |
| `DB_SSL` | `false` | `true` = TLS with certificate verification |
| `DB_SSL_CA` | _(unset)_ | CA file for a private or self-signed database certificate |
| `DB_SOURCE_TABLE` | `sessions` | Used when no table name argument is given |

## Usage

Arguments: `[count] [starting-id] [table-name]`, all optional.

- `count`: number of records to insert (default `1`)
- `starting-id`: ID of the first record (default `497751` directly, `497753` via the wrapper)
- `table-name`: target table (default `DB_SOURCE_TABLE`, then `sessions`). Supported tables are `sessions` and `push_test`; anything else is rejected. Each table has its own fixed SQL in `TABLE_QUERIES` in `generate-test-data.ts`, so to support another table, add an entry there.

### Option 1: Using the Bash Wrapper

```bash
# Insert 1 record
./scripts/generate-test-inserts.sh

# Insert 10 records starting from ID 497751
./scripts/generate-test-inserts.sh 10 497751

# Insert 5 records starting from ID 500000 into push_test
./scripts/generate-test-inserts.sh 5 500000 push_test
```

### Option 2: Using TypeScript Directly

```bash
# Insert 1 record
npx ts-node scripts/generate-test-data.ts

# Insert 10 records starting from ID 497751 into sessions
npx ts-node scripts/generate-test-data.ts 10 497751 sessions
```

All records are inserted in one transaction: if any insert fails, none are kept.

## What Gets Randomized

The script generates random but realistic values for:

- **Patient Info**:
  - Baby first/last name
  - Mother first/last name
  - Gender (Male/Female)
  - Birth weight (2000-5000g)
  - Length (45-60cm)
  - OFC - Head circumference (30-40cm)

- **Vital Signs**:
  - Heart rate (110-150 bpm)
  - Respiratory rate (20-40/min)
  - Temperature (35-37°C)
  - Oxygen saturation
  - Apgar scores (1min: 5-9, 5min: 7-10)

- **Dates/Times**:
  - Birth date/time (within last 7 days)
  - Admission timestamp
  - HIV test dates

- **Clinical Data**:
  - Gestation (35-42 weeks)
  - Age in hours (1-48)
  - Antenatal care visits (1-8)
  - Labor duration (2-12 hours)

- **Location**:
  - Province (Harare, Bulawayo, etc.)
  - District

## What Stays Constant

- **Script metadata**:
  - script.id: `-ZO1TK4zMvLhxTw6eKia`
  - script.type: `admission`
  - script.title: `Sally Mugabe CH Admission`
  - scriptid: `-ZO1TK4zMvLhxTw6eKia`
  - hospital_id: `-MZm_dIkquPzKnJl-tbM`

- **All JSON keys and structure**: Maintains exact same structure as original records

## Example Output

After inserting, the script prints the table's total row count and the 10 newest rows:

```
Inserting 2 test record(s) into sessions, starting at ID 497751...
Inserted 2 record(s).
Total records in sessions: 1532
┌─────────┬────────┬────────────────┬─────────────────────────┬────────────────────────┬────────────────────┐
│ (index) │ id     │ uid            │ ingested_at             │ scriptid               │ unique_key         │
├─────────┼────────┼────────────────┼─────────────────────────┼────────────────────────┼────────────────────┤
│ 0       │ 497752 │ 'CB59-3349102' │ 2026-11-24T10:12:03.000Z │ '-ZO1TK4zMvLhxTw6eKia' │ 'f0c1...'          │
│ 1       │ 497751 │ 'CB59-8845623' │ 2026-11-24T10:12:03.000Z │ '-ZO1TK4zMvLhxTw6eKia' │ 'a1b2...'          │
└─────────┴────────┴────────────────┴─────────────────────────┴────────────────────────┴────────────────────┘
```

## Finding the Last ID

To find the last ID in your database:

```sql
SELECT MAX(id) FROM sessions;
```

Then use that number + 1 as your starting ID.

## Troubleshooting

**Error: Cannot find module 'ts-node'**
```bash
npm install -g ts-node
```

**Error: Permission denied**
```bash
chmod +x scripts/generate-test-inserts.sh
```

**Database connection error**
- Check the `DB_*` values in your `.env` file (see [Database Connection](#database-connection))
- Ensure PostgreSQL is running
- If you use `~/.pgpass`, check it has a line matching your `DB_HOST:DB_PORT:DB_NAME:DB_USER`

**Error: Unsupported table**
- Only `sessions` and `push_test` are supported. To use another table, add it to `TABLE_QUERIES` in `scripts/generate-test-data.ts`

**Error: duplicate key value violates unique constraint**
- That ID already exists. Pick a higher `starting-id` (see [Finding the Last ID](#finding-the-last-id)). Nothing from that run was inserted.
