# Developer Guide: CR Patient Retrieval & Timestamp Features

## Quick Start

### Understanding the New Flow

The adapter now supports **three processing modes**:

#### 1. Standard Dual-Flow (Primary)
```
Entry → CR (Patient + RelatedPerson) + SHR (Encounter + Observations)
```
Used for new entries. Both CR and SHR bundles sent in sequence.

#### 2. SHR-Only Retry (New)
```
Failed Entry → Query CR for Patient → SHR (Encounter + Observations)
```
Used when CR succeeded but SHR failed. Patient already exists in CR.

#### 3. Explicit Retry with CR Lookup
```
Failed Entry → processEntrySHRRetry() → Explicit CR lookup + SHR push
```
Programmatic way to trigger SHR-only retry after CR lookup confirmation.

---

## API Reference

### AdapterService

#### `processEntrySHRRetry(entry: NeotreeEntry, syncId?: string)`

Explicit SHR-only retry method. Query CR for patient, then push clinical data.

**Parameters**:
- `entry`: Neotree entry with complete clinical data
- `syncId`: Optional sync tracking ID

**Returns**:
```typescript
Promise<{
  crPatient: FHIRPatient;      // Patient retrieved from CR
  shrResponse: FHIRBundle;     // SHR push response
}>
```

**Throws**: `AdapterError` if patient not found in CR or SHR push fails

**Example**:
```typescript
const adapter = new AdapterService();
try {
  const { crPatient, shrResponse } = await adapter.processEntrySHRRetry(entry);
  console.log(`SHR push succeeded for patient: ${crPatient.id}`);
} catch (error) {
  console.error('SHR retry failed:', error.message);
}
```

#### `processSyncedEntry(record: FailedSyncRecord)` (Enhanced)

Smart retry for failed records. Auto-detects CR state and chooses appropriate flow.

**Flow**:
1. Decrypt record
2. Try to retrieve patient from CR
3. If found → SHR-only push
4. If not found → Full dual-flow
5. Mark as synced on success

**When to Use**: Called by CDC retry loop automatically

---

### OpenHIMClient

#### `getPatientFromCR(identifierSystem: string, identifierValue: string)`

Query Client Registry specifically for patient lookups.

**Parameters**:
- `identifierSystem`: Identifier system URI (e.g., `urn:neotree:impilo-id`)
- `identifierValue`: Identifier value (e.g., Neotree UID)

**Returns**:
```typescript
Promise<FHIRPatient | null>
```

**Throws**: `OpenHIMError` if CR communication fails

**Example**:
```typescript
const client = new OpenHIMClient();
const patient = await client.getPatientFromCR(
  'urn:neotree:impilo-id',
  'neotree-uid-12345'
);

if (patient) {
  console.log(`Found patient: ${patient.id}`);
} else {
  console.log('Patient not in CR');
}
```

---

## Type Definitions

### NeotreePatientData Enhancement

```typescript
interface NeotreePatientData {
  // ... existing fields ...

  // Timestamps
  admissionDateTime?: string;
  dischargeDateTime?: string;
  completedAt?: string;  // NEW: Form submission timestamp
}
```

**When Populated**:
- Extracted from `entry.completed_at` in Neotree entry
- Represents when the clinical staff submitted/finalized the form
- ISO 8601 format (e.g., `2024-01-07T15:30:45.123Z`)

### FHIRPatient (imported)

```typescript
interface FHIRPatient {
  id?: string;
  resourceType: 'Patient';
  identifier: Identifier[];
  name?: HumanName[];
  birthDate?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  // ... other FHIR fields ...
}
```

---

## Code Examples

### Example 1: Using processEntrySHRRetry

```typescript
import { AdapterService } from './services/adapter-service';
import { NeotreeEntry } from '../shared/types/neotree.types';

async function handleSHRFailure(entry: NeotreeEntry, syncId: string) {
  const adapter = new AdapterService();

  try {
    logger.info({ uid: entry.uid }, 'Attempting SHR retry');

    const result = await adapter.processEntrySHRRetry(entry, syncId);

    logger.info(
      { patientId: result.crPatient.id, uid: entry.uid },
      'SHR retry successful'
    );

    return result.shrResponse;
  } catch (error) {
    logger.error(
      { uid: entry.uid, error: error.message },
      'SHR retry failed'
    );
    throw error;
  }
}
```

### Example 2: Manual CR Lookup

```typescript
import { OpenHIMClient } from './clients/openhim-client';

async function findOrCreatePatient(uid: string) {
  const client = new OpenHIMClient();

  // Try to find existing patient in CR
  let patient = await client.getPatientFromCR('urn:neotree:impilo-id', uid);

  if (patient) {
    logger.info({ patientId: patient.id }, 'Patient found in CR');
    return patient;
  }

  // Patient not in CR - would need to create via full dual-flow
  logger.warn({ uid }, 'Patient not found in CR - needs full enrollment');
  return null;
}
```

### Example 3: Handling completedAt

```typescript
import { EncounterTranslator } from './translators/encounter-translator';

const translator = new EncounterTranslator();

// Sample patient data with completedAt
const patientData = {
  uid: 'neotree-123',
  dateOfBirth: '2024-01-01',
  admissionDateTime: '2024-01-07T08:00:00Z',
  completedAt: '2024-01-07T15:30:45Z',  // Form submitted at 3:30 PM
  // ... other fields
};

// Encounter period will use:
// - start: admissionDateTime (08:00)
// - end: completedAt (15:30)
const encounter = translator.translate(patientData, 'Patient/123');

console.log(encounter.period);
// Output: {
//   start: '2024-01-07T08:00:00.000Z',
//   end: '2024-01-07T15:30:45.000Z'
// }
```

### Example 4: Observation Timestamps

```typescript
import { ObservationTranslator } from './translators/observation-translator';

const translator = new ObservationTranslator();

const patientData = {
  uid: 'neotree-123',
  dateOfBirth: '2024-01-01T10:00:00Z',
  completedAt: '2024-01-07T15:30:45Z',
  heartRate: 142,  // bpm
  // ... other fields
};

// Observations will be timestamped with completedAt
// (when vital signs were recorded/finalized)
const observations = translator.translate(
  patientData,
  'Patient/123',
  'Encounter/456'
);

console.log(observations[0].effectiveDateTime);
// Output: '2024-01-07T15:30:45.000Z'
```

---

## Error Handling

### Common Errors

#### 1. CR Lookup Fails (Network Issue)

```typescript
try {
  const patient = await client.getPatientFromCR(system, value);
} catch (error) {
  // OpenHIMError with status 503 (Service Unavailable)
  if (error.statusCode === 503) {
    // CR is down - fall back to full dual-flow
    await adapter.processEntryWithDualFlow(entry);
  }
}
```

#### 2. Patient Not Found in CR

```typescript
const patient = await client.getPatientFromCR(system, value);

if (!patient) {
  // Patient not enrolled in CR yet
  // This is expected if CR push never completed
  logger.warn({ uid }, 'Patient not in CR - performing full flow');
}
```

#### 3. SHR Push Fails

```typescript
try {
  const result = await adapter.processEntrySHRRetry(entry);
} catch (error) {
  // SHR endpoint unreachable or validation failed
  // Record will be stored in cdc_failed_records table
  // Will retry in 5 minutes (CDC retry loop)
  throw error;
}
```

---

## Testing

### Unit Test Example: CR Lookup

```typescript
import { OpenHIMClient } from './openhim-client';
import axios from 'axios';

jest.mock('axios');

describe('OpenHIMClient.getPatientFromCR', () => {
  it('should retrieve patient from CR', async () => {
    const mockPatient = {
      id: 'patient-123',
      resourceType: 'Patient',
      identifier: [{ system: 'urn:neotree:impilo-id', value: 'uid-456' }],
    };

    (axios.create as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({
        data: {
          entry: [{ resource: mockPatient }],
        },
      }),
    });

    const client = new OpenHIMClient();
    const result = await client.getPatientFromCR(
      'urn:neotree:impilo-id',
      'uid-456'
    );

    expect(result).toEqual(mockPatient);
  });

  it('should return null if patient not found', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({
        data: { entry: [] },
      }),
    });

    const client = new OpenHIMClient();
    const result = await client.getPatientFromCR(
      'urn:neotree:impilo-id',
      'uid-456'
    );

    expect(result).toBeNull();
  });
});
```

### Integration Test Example: Retry Flow

```typescript
describe('AdapterService.processSyncedEntry with CR retry', () => {
  it('should detect existing patient in CR and do SHR-only push', async () => {
    const adapter = new AdapterService();

    // Mock CR client to return existing patient
    jest.spyOn(adapter['openhimClient'], 'getPatientFromCR')
      .mockResolvedValue({
        id: 'patient-existing-123',
        resourceType: 'Patient',
      });

    // Mock SHR bundle push
    jest.spyOn(adapter['openhimClient'], 'sendBundleToSHR')
      .mockResolvedValue({ type: 'transaction-response', entry: [] });

    const failedRecord = {
      id: 1,
      session_id: BigInt(123),
      impilo_uid: 'encrypted-uuid',
      data: 'encrypted-neotree-entry',
      // ... other fields
    };

    await adapter.processSyncedEntry(failedRecord);

    // Verify SHR push was called (not CR bundle push)
    expect(adapter['openhimClient'].sendBundleToSHR).toHaveBeenCalled();
  });
});
```

---

## Troubleshooting

### Issue: `Cannot retrieve patient from CR`

**Cause**: CR endpoint unreachable

**Solution**:
1. Check OpenHIM configuration: `OPENHIM_CR_ENDPOINT`
2. Verify CR instance is running: `curl -X GET {OPENHIM_BASE_URL}/heartbeat`
3. Check network connectivity: `ping {CR_HOST}`

### Issue: `completedAt is undefined`

**Cause**: Neotree entry missing `completed_at` field

**Solution**:
1. Verify Neotree entry structure includes `completed_at`
2. Check Neotree version/script: may need update
3. Will fallback to `admissionDateTime` automatically (no error)

### Issue: Duplicate patient records created

**Cause**: CR lookup failed, falling back to full dual-flow

**Solution**:
1. Check CR connectivity during retry
2. Monitor `cdc_failed_records` table for retry attempts
3. Review logs: search for "Patient not in CR"

---

## Performance Considerations

### CR Lookup Cost

- **Network**: ~100-200ms per lookup
- **Database**: Negligible (indexed on identifier)
- **Recommended**: Cache CR patient lookups for 5 minutes in production

### Retry Frequency

- **Primary CDC loop**: Every 30 seconds
- **Failed records retry**: Every 5 minutes
- **Max attempts**: Configurable (default: 3)

### Scaling Notes

- SHR-only retry reduces CR load by ~50% in failure scenarios
- Each SHR push is smaller (no RelatedPerson, fewer resources)
- Monitor CDC watermark progress in production

---

## Migration Guide

### Upgrading from Previous Version

1. **No database migration required**: `completedAt` is optional
2. **No config changes required**: Uses existing CR endpoint
3. **Backward compatible**: Old entries without `completedAt` will work

### Enabling SHR-Only Retry

The feature is **automatic** via `processSyncedEntry()`:
- No code changes needed
- Existing CDC retry loop benefits immediately
- For manual control, use `processEntrySHRRetry()` method

---

## Monitoring

### Key Metrics

```typescript
// Monitor CR retrieval success rate
metrics.recordCRRetrieval({
  status: 'success' | 'not-found' | 'error',
  duration: number,
  uid: string,
});

// Monitor retry flow choice
metrics.recordRetryFlowChoice({
  flow: 'shr-only' | 'full-dual-flow',
  recordId: number,
});

// Monitor encounter/observation timestamps
metrics.recordTimestampSource({
  source: 'completedAt' | 'admissionDateTime' | 'dateOfBirth',
  resource: 'encounter' | 'observation',
});
```

### Log Patterns to Monitor

```bash
# SHR-only retry success
grep "Patient already exists in CR - proceeding with SHR-only push" logs

# CR retrieval failures
grep "Failed to retrieve patient from Client Registry" logs

# Timestamp fallbacks
grep "Use completedAt" logs  # or fallback messages
```

---

## Best Practices

1. **Always provide `completedAt`**: Ensures accurate clinical data timestamps
2. **Handle CR lookup timeouts**: Set reasonable timeout (≤5 seconds)
3. **Monitor failed records table**: Alert if retry attempts exceed threshold
4. **Test CR connectivity**: Periodic health checks before major pushes
5. **Version control**: Track Neotree script versions when form structure changes

---

## References

- [FHIR Encounter Specification](http://hl7.org/fhir/encounter.html)
- [FHIR Observation Specification](http://hl7.org/fhir/observation.html)
- [OpenHIM Documentation](http://openhim.org/)
- [RFC 3339 - Date and Time on the Internet](https://tools.ietf.org/html/rfc3339)
