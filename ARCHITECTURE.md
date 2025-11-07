# Architecture

## Overview

Ultra-lean FHIR adapter using PostgreSQL HTTP triggers to transform Neotree neonatal data into FHIR R4 resources.

**Key advantage**: No separate listener process - PostgreSQL calls the adapter directly!

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                  │
│                                                         │
│  ┌──────────────┐      ┌────────────────────────┐     │
│  │ patient_data │─────▶│ HTTP Trigger Function  │     │
│  │   (table)    │      │ - Fires on INSERT/UPDATE│     │
│  └──────────────┘      │ - Calls http_post()     │     │
│                        └────────┬───────────────┬┘     │
└─────────────────────────────────┼───────────────┼──────┘
                                  │               │
                        HTTP POST │               │ Config
                                  │               │
┌─────────────────────────────────▼───────────────▼──────┐
│              Neotree FHIR Adapter (Node.js)            │
│                     Port 3001                          │
│                                                        │
│  ┌─────────────┐    ┌──────────────┐   ┌────────────┐  │
│  │ HTTP API    │───▶│   Mappers    │──▶│Translators │  │
│  │ (Express)   │    │   Extract    │   │  To FHIR   │  │
│  └─────────────┘    │   Fields     │   └────┬───────┘  │
│                     └──────────────┘        │          │
│                                             │          │
│                     ┌──────────────┐        │          │
│                     │Bundle Builder│◀───────┘          │
│                     └──────┬───────┘                   │
│                            │                           │
│                     ┌──────▼────────┐                  │
│                     │ OpenHIM Client│                  │
│                     │  (SHA-512 Auth)│                 │ 
│                     └──────┬────────┘                  │
└────────────────────────────┼────────────────────────── ┘
                             │ HTTPS
                             ▼
                    ┌────────────────┐
                    │    OpenHIM     │
                    │    Gateway     │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │     OpenCR     │
                    │(Client Registry)│
                    └────────────────┘
```

## Data Flow

### 1. Database Trigger (PostgreSQL)

```sql
-- When data changes
INSERT/UPDATE patient_data

     ↓

-- Trigger function executes
http_notify_neotree_patient_data()

     ↓

-- HTTP POST to adapter
POST http://localhost:3001/api/process
Content-Type: application/json
Body: { ...patient_data_row... }
```

### 2. FHIR Adapter Processing

```
HTTP Request
     ↓
Express API receives JSON
     ↓
Neotree Mapper extracts fields
  • Baby: name, gender, DOB, weight
  • Mother: name, HIV status
  • Clinical: vitals, diagnoses
     ↓
FHIR Translators create resources
  • PatientTranslator → Patient
  • RelatedPersonTranslator → RelatedPerson (mother)
  • EncounterTranslator → Encounter
  • ObservationTranslator → Observations (vitals, Apgar)
  • ConditionTranslator → Conditions (diagnoses)
     ↓
Bundle Builder creates transaction bundle
  • Assigns UUIDs
  • Links related resources
  • Adds conditional create logic
     ↓
OpenHIM Client sends bundle
  • Generates SHA-512 auth headers
  • POST to OpenHIM
     ↓
OpenHIM routes to OpenCR
     ↓
OpenCR processes and stores
```

## Components

### PostgreSQL HTTP Trigger

**File**: `src/fhir-adapter/database/setup-triggers.sql`

```sql
CREATE FUNCTION http_notify_neotree_patient_data()
RETURNS trigger AS $$
DECLARE
  adapter_url TEXT;
  response http_response;
BEGIN
  -- Get adapter URL from config
  SELECT value INTO adapter_url FROM adapter_config WHERE key = 'adapter_url';

  -- POST to adapter
  SELECT * INTO response FROM http((
    'POST', adapter_url,
    ARRAY[http_header('Content-Type', 'application/json')],
    'application/json',
    row_to_json(NEW)::text
  )::http_request);

  -- Log result
  RAISE NOTICE 'Adapter status: %', response.status;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Advantages**:
- Zero memory overhead
- Instant notification (no polling)
- Transactional consistency
- Built-in to PostgreSQL

### FHIR Adapter (Node.js)

**Entry Point**: `src/fhir-adapter/index.ts`

Express HTTP API that:
1. Receives patient data from PostgreSQL trigger
2. Maps to standardized format
3. Translates to FHIR resources
4. Bundles and sends to OpenCR

**Key Files**:

```
src/fhir-adapter/
├── index.ts                    # HTTP API (Express)
├── services/
│   ├── adapter-service.ts      # Orchestration
│   └── bundle-builder.ts       # FHIR bundle creation
├── mappers/
│   └── neotree-mapper.ts       # Extract Neotree fields
├── translators/
│   ├── patient-translator.ts
│   ├── related-person-translator.ts
│   ├── encounter-translator.ts
│   ├── observation-translator.ts
│   └── condition-translator.ts
└── clients/
    └── openhim-client.ts       # OpenHIM communication
```

### FHIR Resource Mapping

#### Patient (Baby)
```javascript
{
  resourceType: "Patient",
  identifier: [{ value: "CB59-8830349" }],  // from uid
  name: [{
    given: ["Jean"],                         // from BabyFirst
    family: "Doe"                            // from BabyLast
  }],
  gender: "male",                            // from Gender
  birthDate: "2025-09-04"                    // from DOBTOB
}
```

#### RelatedPerson (Mother)
```javascript
{
  resourceType: "RelatedPerson",
  patient: { reference: "Patient/..." },
  relationship: [{
    coding: [{ code: "MTH", display: "mother" }]
  }],
  name: [{
    given: ["Jean"],                         // from MotherFirstName
    family: "Doe"                            // from MotherSurname
  }]
}
```

#### Observations
```javascript
// Vital Signs
{ code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },  // Heart rate
  valueQuantity: { value: 129, unit: "/min" } }

{ code: { coding: [{ system: "http://loinc.org", code: "8310-5" }] },  // Temperature
  valueQuantity: { value: 36.9, unit: "Cel" } }

// Apgar Scores
{ code: { coding: [{ system: "http://loinc.org", code: "9272-6" }] },  // Apgar 1 min
  valueQuantity: { value: 6, unit: "{score}" },
  effectiveDateTime: "2025-09-04T11:11:00Z" }
```

#### Conditions
```javascript
{
  resourceType: "Condition",
  code: {
    coding: [{
      system: "http://snomed.info/sct",
      code: "237364002",                     // SNOMED CT
      display: "Macrosomia"
    }],
    text: "Macrosomia (>4000g)"             // Original Neotree text
  },
  clinicalStatus: { code: "active" }
}
```

## Security

### OpenHIM Authentication

```javascript
// Generate auth headers
timestamp = new Date().toISOString()
salt = randomBytes(16).hex()
passwordHash = sha512(salt + password)
token = sha512(passwordHash + salt + timestamp)

// Send with request
headers: {
  'auth-username': username,
  'auth-ts': timestamp,
  'auth-salt': salt,
  'auth-token': token
}
```

### Database Security

- Trigger function runs with minimal permissions
- No credentials in trigger code
- SSL/TLS for all connections
- Adapter URL stored in database (easy to update)

## Performance

### Resource Usage

| Component | Memory | CPU |
|-----------|--------|-----|
| PostgreSQL (existing) | 0 MB extra | Negligible |
| FHIR Adapter | 100-150 MB | Low |
| **Total** | **100-150 MB** | **Low** |

### Latency

- Trigger fires: <1ms
- HTTP call to adapter: <10ms
- FHIR transformation: 10-50ms
- OpenHIM submission: 50-200ms
- **Total**: <300ms end-to-end

### Scalability

**Vertical scaling**: Add CPU/memory to server
**Horizontal scaling**: Multiple adapter instances behind load balancer
**Database**: Trigger overhead is minimal, scales with PostgreSQL

## Error Handling

### PostgreSQL Trigger

```sql
EXCEPTION
  WHEN OTHERS THEN
    -- Log but don't fail transaction
    RAISE WARNING 'Error calling adapter: %', SQLERRM;
    RETURN NEW;
```

**Strategy**: Don't block database operations if adapter is down

### FHIR Adapter

```javascript
try {
  // Process
} catch (error) {
  logger.error({ error, uid }, 'Processing failed');
  return { success: false, error: error.message };
}
```

**Strategy**: Log errors, return HTTP 500, allow retry

## Configuration

### Environment Variables

```env
# Facility
SOURCE_ID=neotree-system
FACILITY_ID=facility-id
FACILITY_NAME=Facility Name

# OpenHIM
OPENHIM_BASE_URL=https://openhim-instance
OPENHIM_USERNAME=username
OPENHIM_PASSWORD=password
OPENHIM_CHANNEL_PATH=/fhir

# Application
NODE_ENV=production
LOG_LEVEL=info
ADAPTER_PORT=3001
```

### Database Configuration

```sql
-- Stored in adapter_config table
INSERT INTO adapter_config (key, value)
VALUES ('adapter_url', 'http://localhost:3001/api/process');

-- Update anytime without restarting
UPDATE adapter_config SET value = 'http://new-url:3001/api/process' WHERE key = 'adapter_url';
```

## Deployment

### Development
```bash
npm run dev
```

### Production (systemd)
```bash
npm run build
sudo systemctl start neotree-adapter
```

### Monitoring
```bash
# Check health
curl http://localhost:3001/health

# View logs
sudo journalctl -u neotree-adapter -f

# Check PostgreSQL trigger
psql -c "SELECT * FROM pg_trigger WHERE tgname = 'neotree_patient_data_http_notify';"
```

## Design Decisions


