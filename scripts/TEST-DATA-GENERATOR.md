# Test Data Generator for push_test Table

This script generates synthetic test data INSERT statements for the `push_test` table while maintaining the JSONB structure and keeping the script metadata consistent.

## Features

- **Auto-incrementing IDs**: Tracks and increments the last ID
- **Randomized data**: Generates realistic random values for all entry fields
- **Maintains structure**: Keeps all JSON keys and structure intact
- **Preserves script info**: Script object and scriptid remain unchanged
- **Unique UIDs**: Generates unique patient UIDs (CB59-XXXXXXX format)
- **Unique keys**: Generates random unique keys for each record
- **Realistic values**: Uses realistic ranges for medical data (weight, Apgar scores, vital signs, etc.)

## Usage

### Option 1: Using the Bash Wrapper (Recommended)

```bash
# Generate 1 record starting from ID 497751 (default)
./scripts/generate-test-inserts.sh

# Generate 10 records starting from ID 497751
./scripts/generate-test-inserts.sh 10

# Generate 5 records starting from ID 500000
./scripts/generate-test-inserts.sh 5 500000

# Generate 20 records and save to custom file
./scripts/generate-test-inserts.sh 20 497751 my-test-data.sql
```

### Option 2: Using TypeScript Directly

```bash
# Generate 1 record (output to console)
npx ts-node scripts/generate-test-data.ts

# Generate 10 records starting from ID 497751
npx ts-node scripts/generate-test-data.ts 10 497751

# Save to file
npx ts-node scripts/generate-test-data.ts 10 497751 > my-inserts.sql
```

## Inserting Generated Data

After generating the SQL file, insert it into the database:

```bash
# Using psql
psql -U postgres -d neotree_nodeapi_local -f scripts/generated-inserts.sql

# With password from .env
PGPASSWORD=your_password psql -U postgres -d neotree_nodeapi_local -f scripts/generated-inserts.sql
```

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

```sql
INSERT INTO push_test (id, uid, ingested_at, data, scriptid, unique_key)
VALUES (
    497751,
    'CB59-8845623',
    '2025-11-07 14:32:15.456',
    '{"uid": "CB59-8845623", "appEnv": "PROD", ...}'::jsonb,
    '-ZO1TK4zMvLhxTw6eKia',
    'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
);
```

## Finding the Last ID

To find the last ID in your database:

```sql
SELECT MAX(id) FROM push_test;
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
- Check your `.env` file for correct database credentials
- Ensure PostgreSQL is running
- Verify database name: `neotree_nodeapi_local`
