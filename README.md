# Neotree FHIR Adapter

Transforms Neotree neonatal patient data into FHIR R4 resources and submits them to OpenCR via OpenHIM.

**CDC-based design**: Uses watermark polling for reliable, ordered data processing. No HTTP triggers needed!

## How It Works

```
PostgreSQL Database (sessions table)
    │
    ├─ New sessions inserted with ingested_at timestamp
    │
    ↓
FHIR Adapter (polls every 30 seconds)
    │
    ├─ Queries: SELECT * FROM sessions WHERE ingested_at > watermark
    │
    ├─ Processes in chronological order
    │
    ├─ Transforms to FHIR resources
    │  • Patient (baby)
    │  • RelatedPerson (mother)
    │  • Encounter (admission/discharge)
    │  • Observations (vitals, Apgar scores)
    │  • Conditions (diagnoses)
    │
    ├─ Updates watermark after successful batch
    │
    ├─ Failed records tracked separately (retry every 5 min)
    │
    └─ Sends to OpenCR via OpenHIM
```

**Benefits**:
- Database never blocked by HTTP calls
- Chronological processing guaranteed
- Failed records don't block new data
- Can reset watermark to reprocess historical data
- Memory footprint: ~150-200MB

## Prerequisites

- Node.js 20.x or higher
- PostgreSQL 12.x or higher
- OpenHIM instance
- OpenCR instance

## Quick Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database (for CDC polling)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=neotree
DB_USER=postgres
# DB_PASSWORD= # Leave empty if using .pgpass (recommended)

# Source and Facility
SOURCE_ID=neotree-system
FACILITY_ID=your-facility-id
FACILITY_NAME=Your Facility Name

# OpenHIM
OPENHIM_BASE_URL=https://your-openhim-instance
OPENHIM_USERNAME=your-username
OPENHIM_PASSWORD=your-password
OPENHIM_CHANNEL_PATH=/fhir

LOG_LEVEL=info
ADAPTER_PORT=3001
ENCRYPTION_KEY=generate-32-char-key-here
```

**Recommended**: Use `.pgpass` file for database credentials:
```bash
# Copy example and edit with your credentials
cp .pgpass.example ~/.pgpass
nano ~/.pgpass  # Edit with your actual password
chmod 600 ~/.pgpass

# Or create manually with format: hostname:port:database:username:password
echo "localhost:5432:yourdbase:postgres:your_password" > ~/.pgpass
chmod 600 ~/.pgpass
```

Generate encryption key:
```bash
openssl rand -base64 32
```

### 3. Setup Database

```bash
# Run setup script (installs CDC watermark tracking)
chmod +x scripts/setup-database.sh
./scripts/setup-database.sh
```

This installs:
- `cdc_watermark` table - tracks last processed timestamp
- `cdc_failed_records` table - failed records for retry
- SQL functions for CDC operations

**Note:** The adapter needs database credentials to poll the sessions table. Use `.pgpass` file for security.

### 4. Start the Adapter

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Usage

The adapter automatically polls for new sessions and processes them:

```sql
-- Example: Insert session data
INSERT INTO sessions (id, ingested_at, data, ...)
VALUES (1, NOW(), '{...json data...}'::jsonb, ...);

```

## API Endpoints

### Health Check
```bash
curl http://localhost:3001/health
```

### Query Patient from OpenCR
```bash
curl "http://localhost:3001/api/patient/query?system=urn:oid:facility:patient&value=CB59-8830001"
```

### Search Patients in OpenCR
```bash
curl "http://localhost:3001/api/patient/search?family=Doe&given=Jean"
```

## FHIR Resources Created

| Neotree Data | FHIR Resource | Maps |
|--------------|---------------|------|
| Baby info | **Patient** | Name, gender, birth date, identifiers |
| Mother info | **RelatedPerson** | Mother's name, relationship to baby |
| Admission/discharge | **Encounter** | Dates, location, admission reason |
| Vitals | **Observation** | HR, RR, temp, SpO2 (LOINC codes) |
| Measurements | **Observation** | Weight, length, head circumference |
| Apgar scores | **Observation** | 1, 5, 10 minute scores |
| Diagnoses | **Condition** | Coded with SNOMED CT where available |

## Failure Handling

The CDC system includes **robust failure handling**:

- **Automatic retries**: Failed sessions retry every 5 minutes (unlimited attempts)
- **Non-blocking**: Failed records don't block new data processing
- **Watermark-based**: Processes sessions in chronological order
- **Idempotency**: Prevents duplicate submissions
- **No data loss**: Watermark advances even on failures

### Monitor CDC Status

```sql
-- Check watermark position
SELECT * FROM cdc_watermark WHERE table_name = 'sessions';

-- View failed records
SELECT session_id, attempt_count, last_error, last_attempt_at
FROM cdc_failed_records
ORDER BY created_at DESC;

-- Reset watermark to reprocess (caution!)
SELECT reset_watermark('sessions', '2024-01-01 00:00:00');
```

### Monitoring Endpoints

```bash
# Health check with CDC stats
curl http://localhost:3001/health

# CDC statistics
curl http://localhost:3001/api/monitoring/stats
```

**See [FAILURE-HANDLING.md](./FAILURE-HANDLING.md) for comprehensive recovery procedures.**

## Troubleshooting

### Check CDC status
```sql
-- View watermark
SELECT * FROM cdc_watermark WHERE table_name = 'sessions';

-- Check for failed records
SELECT COUNT(*) FROM cdc_failed_records;
```

### Test CDC manually
```sql
-- Insert test session
INSERT INTO sessions (ingested_at, data, ...)
VALUES (NOW(), '{}'::jsonb, ...);

-- Check if processed (wait 30 seconds)
SELECT * FROM cdc_watermark WHERE table_name = 'sessions';
```

### Adapter not processing
```bash
# Check adapter is running and database connected
curl http://localhost:3001/health

# Check logs
journalctl -u neotree-adapter -f

# Verify .pgpass or DB_PASSWORD
psql -U postgres -d neotree -c "SELECT 1"
```

## Production Deployment

### As systemd service

Create `/etc/systemd/system/neotree-adapter.service`:

```ini
[Unit]
Description=Neotree FHIR Adapter
After=network.target

[Service]
Type=simple
User=neotree
WorkingDirectory=/opt/neotree-adapter
ExecStart=/usr/bin/node /opt/neotree-adapter/dist/fhir-adapter/index.js
EnvironmentFile=/opt/neotree-adapter/.env
Restart=on-failure
MemoryLimit=256M

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable neotree-adapter
sudo systemctl start neotree-adapter
sudo journalctl -u neotree-adapter -f
```

## Project Structure

```
neotree-impilo-shr-adapter/
├── src/
│   ├── fhir-adapter/
│   │   ├── clients/
│   │   │   └── openhim-client.ts       # OpenHIM communication
│   │   ├── database/
│   │   │   └── setup-cdc.sql           # CDC watermark setup
│   │   ├── mappers/
│   │   │   └── neotree-mapper.ts       # Data extraction
│   │   ├── translators/
│   │   │   ├── patient-translator.ts
│   │   │   ├── related-person-translator.ts
│   │   │   ├── encounter-translator.ts
│   │   │   ├── observation-translator.ts
│   │   │   └── condition-translator.ts
│   │   ├── services/
│   │   │   ├── adapter-service.ts      # Main orchestration
│   │   │   ├── cdc-service.ts          # CDC polling service
│   │   │   └── bundle-builder.ts       # FHIR bundles
│   │   └── index.ts                    # HTTP API + CDC
│   └── shared/
│       ├── config/                     # Configuration
│       ├── database/
│       │   └── pool.ts                 # PostgreSQL connection
│       ├── types/                      # Type definitions
│       └── utils/                      # Utilities
├── scripts/
│   └── setup-database.sh               # Database CDC setup
├── .env.example                        # Configuration template
├── .pgpass.example                     # Database credentials template
├── package.json
└── README.md
```

## Security

- OpenHIM authentication with SHA-512 hashing
- Database credentials via .pgpass file 
- Input validation on all endpoints
- Structured logging (no sensitive data)
- Configurable resource limits
- Connection pooling with max limits

## Architecture Details

See [ARCHITECTURE.md](./ARCHITECTURE.md) for technical deep-dive.

## License

MIT
