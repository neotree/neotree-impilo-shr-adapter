# Implementation Summary: CR Patient Retrieval & Timestamp Tracking

## Overview

This document outlines the enhancements made to the Neotree IMPILO SHR Adapter to support:
1. **Smart retry mechanism**: Pull Patient data from Client Registry (CR) before pushing to SHR
2. **Timestamp tracking**: Tie encounters and observations to the `completed_at` timestamp

These features enable resilient recovery when CR push succeeds but SHR push fails, avoiding duplicate patient records.

---

## Problem Statement

**Scenario**: A patient record is successfully pushed to Client Registry (CR), but the subsequent push to Shared Health Record (SHR) fails.

**Legacy Behavior**:
- On retry, the entire dual-flow (CR + SHR) would execute again
- This risks creating duplicate Patient records in CR
- Clinical data (Encounters, Observations) wouldn't be linked to the correct patient

**New Behavior**:
- On retry, check if patient already exists in CR
- If patient exists: skip CR push, only push clinical data to SHR
- If patient doesn't exist: perform full dual-flow
- Observations and encounters are timestamped with form completion time

---

## Implementation Details

### 1. Client Registry Patient Retrieval

**File**: `src/fhir-adapter/clients/openhim-client.ts`

**New Method**: `getPatientFromCR()`
```typescript
async getPatientFromCR(
  identifierSystem: string,
  identifierValue: string
): Promise<FHIRPatient | null>
```

**Purpose**:
- Query the CR endpoint specifically for patient lookups
- Search by Neotree identifier (`urn:neotree:impilo-id`)
- Used during retry scenarios to detect if patient already registered

**Key Features**:
- Uses `crEndpoint` configuration (separate from legacy `channelPath`)
- Returns full FHIR Patient resource if found
- Returns null if no match
- Logs success/failure with context for troubleshooting

---

### 2. Timestamp Tracking: `completedAt` Field

#### Type Changes

**File**: `src/shared/types/neotree.types.ts`

Added to `NeotreePatientData`:
```typescript
completedAt?: string; // Timestamp when encounter/observation was completed (from Neotree form completion)
```

**Semantics**:
- Represents when the Neotree form was submitted/completed
- More accurate than admission/discharge times for clinical data capture
- Useful for audit trails and data reconciliation

#### Mapper Implementation

**File**: `src/fhir-adapter/mappers/neotree-mapper.ts`

```typescript
// Extract from Neotree entry
const completedAt = entry.completed_at;

// Return in patient data
return {
  ...
  completedAt,
  ...
}
```

---

### 3. Encounter Translator Updates

**File**: `src/fhir-adapter/translators/encounter-translator.ts`

**Modified Method**: `buildPeriod()`

**Changes**:
- Primary: Uses `completedAt` as `period.end`
- Fallback: Uses `dischargeDateTime` if `completedAt` unavailable
- Handles all three timestamp sources: admission, discharge, completed

**Why**:
- `completedAt` reflects when clinical staff finalized the encounter record
- More precise than discharge time for in-progress encounters
- Better captures the actual data capture timestamp

---

### 4. Observation Translator Updates

**File**: `src/fhir-adapter/translators/observation-translator.ts`

**Modified Methods**:
- `translate()` - passes `completedAt` to builders
- `buildObservation()` - uses `completedAt` for vital signs and body measurements
- `buildApgarObservation()` - uses `completedAt` as baseline for Apgar time calculation

**Fallback Chain**:
1. `completedAt` (form submission time)
2. `admissionDateTime` (for vital signs) or `dateOfBirth` (for body measurements)
3. `dateOfBirth` (ultimate fallback)

**Why**:
- Observations should be timestamped when recorded/finalized
- `completedAt` is more accurate than admission time for clinical observations
- Maintains backward compatibility with historical data

---

### 5. Smart Retry Flow in Adapter Service

**File**: `src/fhir-adapter/services/adapter-service.ts`

#### New Method: `processEntrySHRRetry()`

```typescript
async processEntrySHRRetry(
  entry: NeotreeEntry,
  syncId?: string
): Promise<{ crPatient: FHIRPatient; shrResponse: FHIRBundle }>
```

**Purpose**: Explicitly retry SHR push after CR patient retrieval

**Flow**:
1. Retrieve existing patient from CR
2. Validate clinical data
3. Translate encounter/observations with CR patient ID
4. Send only SHR bundle (no CR bundle)
5. Return both patient and response

**Use Case**: Proactive recovery when SHR push specifically fails

#### Enhanced Method: `processSyncedEntry()` - Dual-Smart Mode

**Purpose**: Automatic detection and recovery

**New Logic** (lines 57-324):
```
1. Decrypt failed record
2. Validate data
3. Attempt CR patient retrieval:
   - If found:
     • SHR-only push (use existing patient ID)
     • Avoid duplicate patient creation
   - If not found:
     • Full dual-flow push (legacy behavior)
     • Create new patient if needed
4. Mark as synced on success
5. Keep encrypted on failure
```

**Key Benefits**:
- **Idempotent**: Repeated retries don't create duplicates
- **Intelligent**: Adapts based on CR state
- **Backward Compatible**: Falls back to full flow if patient not in CR
- **Comprehensive Logging**: Tracks CR retrieval success/failure

---

## Data Flow Diagrams

### Successful Initial Flow (No Failure)

```
Neotree Entry
    ↓
Dual-Flow Processing
    ├─ Demographics → CR (Patient + RelatedPerson)
    └─ Clinical → SHR (Encounter + Observations)
    ↓
Both succeed → Mark synced
```

### Failure Scenario: CR Success, SHR Fails

#### Legacy (Before Enhancement)
```
Retry:
    ├─ Push to CR again (Risk: duplicate patient)
    └─ Push to SHR
```

#### New (After Enhancement)
```
Retry:
    ├─ Query CR for patient
    ├─ Found: Use existing patient ID
    └─ Push to SHR with CR patient reference

    Result: No duplicate, clinical data linked correctly
```

---

## Configuration

No new environment variables required. Uses existing:
- `OPENHIM_CR_ENDPOINT`: Client Registry endpoint (default: `/CR/fhir`)
- `OPENHIM_SHR_ENDPOINT`: Shared Health Record endpoint (default: `/SHR/fhir`)

---

## Testing Scenarios

### Scenario 1: Both CR and SHR Succeed
- Expected: Normal flow, synced=true
- `completedAt` used for timing

### Scenario 2: CR Succeeds, SHR Fails on First Try
- Expected on Retry: CR retrieval finds patient, SHR-only push
- Result: Same patient, clinical data added

### Scenario 3: CR Fails (Network Issue)
- Expected: Falls back to full dual-flow on retry
- Result: May create duplicate if CR recovered

### Scenario 4: Missing `completedAt`
- Expected: Fallback to admissionDateTime/dischargeDateTime
- Observations: Fallback to dateOfBirth
- Result: Data still captured, less precise timing

---

## Logging

### Key Log Messages

**CR Patient Retrieval Success**:
```
INFO: Successfully retrieved patient from Client Registry
  {patientId: "abc123", identifierValue: "neotree-uid-456"}
```

**SHR-Only Push During Retry**:
```
INFO: Patient already exists in CR - proceeding with SHR-only push
  {recordId: 1, impiloId: "uuid", patientId: "abc123"}
```

**Full Dual-Flow Fallback**:
```
INFO: Patient not in CR - performing full legacy dual-flow push
  {recordId: 1, impiloId: "uuid"}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/fhir-adapter/clients/openhim-client.ts` | Added `getPatientFromCR()` method |
| `src/shared/types/neotree.types.ts` | Added `completedAt?: string` field |
| `src/fhir-adapter/mappers/neotree-mapper.ts` | Extract `completed_at` from entry |
| `src/fhir-adapter/translators/encounter-translator.ts` | Use `completedAt` for period.end |
| `src/fhir-adapter/translators/observation-translator.ts` | Use `completedAt` for effectiveDateTime |
| `src/fhir-adapter/services/adapter-service.ts` | Added `processEntrySHRRetry()` and enhanced `processSyncedEntry()` |

---

## Backward Compatibility

✅ **Fully Backward Compatible**:
- New `completedAt` field is optional
- Translators gracefully fall back to existing timestamps
- `processSyncedEntry()` behavior unchanged if patient not in CR
- No breaking changes to public APIs

---

## Future Enhancements

1. **Explicit SHR Retry Endpoint**: REST API to manually trigger SHR retry
2. **CR Sync Status Tracking**: Database field to track which records have CR patients
3. **Duplicate Detection on Retry**: Enhanced matching using CR patient data
4. **Timestamp Precision**: Support time-of-birth alongside completed_at
5. **Audit Trail**: Log all CR lookups for compliance

---

## Related Documentation

- FHIR Encounter Period: http://hl7.org/fhir/encounter-definitions.html#Encounter.period
- FHIR Observation Effective: http://hl7.org/fhir/observation-definitions.html#Observation.effective_x_
- Neotree Entry Schema: See `src/shared/types/neotree.types.ts`
- OpenHIM Routing: See `src/fhir-adapter/clients/openhim-client.ts`

---

## Summary

This implementation provides a robust recovery mechanism for dual-flow processing failures while improving data precision through completed_at timestamp tracking. The smart retry logic prevents duplicate patient registration and ensures clinical data is correctly linked during recovery scenarios.
