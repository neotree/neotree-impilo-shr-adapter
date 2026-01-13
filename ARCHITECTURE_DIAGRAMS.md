# Architecture Diagrams: CR Patient Retrieval & Timestamp Tracking

## 1. Data Flow: Initial Processing (Success Path)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Neotree Entry                               │
│  {uid, completed_at, entries, script, diagnoses, ...}              │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
         ┌──────────────────────────────┐
         │  mapNeotreeToPatientData()   │ ← Extract completed_at
         │  Returns NeotreePatientData  │
         └────────────┬─────────────────┘
                      │
         ┌────────────┴────────────────────────┐
         │                                     │
         ▼                                     ▼
    ┌─────────────────┐              ┌──────────────────────┐
    │ Demographics    │              │  Clinical Data       │
    │ (Patient + Mom) │              │ (Vitals, Diagnoses) │
    └────────┬────────┘              └──────────┬───────────┘
             │                                   │
             ▼                                   ▼
    ┌──────────────────────┐         ┌────────────────────────┐
    │ Patient Translator   │         │ Encounter Translator   │
    │ + RelatedPerson      │         │ (uses completedAt)     │
    │ Translator           │         │                        │
    └────────┬─────────────┘         └──────────┬─────────────┘
             │                                   │
             ▼                                   ▼
    ┌──────────────────────┐         ┌────────────────────────┐
    │ CR Bundle            │         │ SHR Bundle             │
    │ (Patient+            │         │ (Encounter+            │
    │  RelatedPerson)      │         │  Observations+         │
    │                      │         │  Conditions)           │
    └────────┬─────────────┘         └──────────┬─────────────┘
             │                                   │
             │                    ┌──────────────┘
             │                    │
             ▼                    ▼
    ┌─────────────────────────────────────┐
    │  OpenHIM (Dual-Flow Processing)     │
    │  sendBundleToCR()                   │
    │  sendBundleToSHR()                  │
    └────────────┬────────────────────────┘
                 │
    ┌────────────┴───────────────┐
    │                            │
    ▼                            ▼
┌─────────────┐         ┌──────────────┐
│  CR Success │         │  SHR Success │
│ Patient ID: │         │ Resources:   │
│ abc123      │         │ Created ✓    │
└─────────────┘         └──────────────┘
    │                            │
    └────────────┬───────────────┘
                 │
                 ▼
         ┌──────────────────┐
         │  Mark synced=true│
         │  In database     │
         └──────────────────┘
```

---

## 2. Retry Flow: Smart Detection (Failed SHR Path)

```
┌──────────────────────────────────────────────────────┐
│  Failed Record in cdc_failed_records                 │
│  (CR succeeded, SHR failed)                          │
│  {id, session_id, impilo_id (encrypted),            │
│   data (encrypted), synced: false, ...}             │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
      ┌──────────────────────────────┐
      │  CDC Retry Loop (5-minute    │
      │  intervals)                  │
      │  queryCDCFailedRecords()     │
      └────────────┬─────────────────┘
                   │
                   ▼
      ┌──────────────────────────────┐
      │  processSyncedEntry()        │
      │  1. Decrypt data             │
      │  2. Validate                 │
      └────────────┬─────────────────┘
                   │
                   ▼
      ┌──────────────────────────────────┐
      │  NEW: Query Client Registry      │
      │  getPatientFromCR()              │
      │  (by urn:neotree:impilo-id)      │
      └──────────────┬────────────────────┘
                     │
         ┌───────────┴────────────┐
         │                        │
         ▼                        ▼
   ┌─────────────┐        ┌──────────────┐
   │ Patient     │        │ Patient NOT  │
   │ FOUND in CR │        │ in CR        │
   │             │        │ (First try)  │
   └──────┬──────┘        └──────┬───────┘
          │                      │
          │ SHR-ONLY PUSH        │ FULL DUAL-FLOW
          │                      │
          ▼                      ▼
    ┌──────────────┐      ┌─────────────────┐
    │ Use existing │      │ Create new      │
    │ patient ID   │      │ Patient in CR   │
    │ from CR      │      │                 │
    └──────┬───────┘      └────────┬────────┘
           │                       │
           ▼                       ▼
    ┌──────────────────┐  ┌──────────────────┐
    │ Translate only   │  │ Translate Patient│
    │ Encounter +      │  │ + RelatedPerson  │
    │ Observations +   │  │ (CR Bundle)      │
    │ Conditions       │  │                  │
    └────────┬─────────┘  └────────┬─────────┘
             │                     │
             ▼                     ▼
    ┌──────────────────┐  ┌─────────────────┐
    │ SHR Bundle       │  │ Send to CR      │
    │ (clinical only)  │  │ sendBundleToCR()│
    └────────┬─────────┘  └────────┬────────┘
             │                     │
             ▼                     ▼
    ┌──────────────────┐  ┌──────────────┐
    │ Send to SHR      │  │ CR Response  │
    │ sendBundleToSHR()│  │ (get ID)     │
    └────────┬─────────┘  └──────┬───────┘
             │                   │
             └───────────┬───────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Send SHR Bundle      │
              │ sendBundleToSHR()    │
              └──────────┬───────────┘
                         │
         ┌───────────────┴────────────┐
         │                            │
         ▼                            ▼
    ┌─────────────┐         ┌──────────────┐
    │  Success    │         │  Failure     │
    │  Update     │         │  Update      │
    │  synced=true│         │  error msg   │
    │             │         │  Retry again │
    └─────────────┘         │  later       │
                            └──────────────┘
```

---

## 3. Timestamp Fallback Logic (Decision Tree)

```
┌─────────────────────────────────────────────────┐
│     ENCOUNTER: Build Period (start & end)       │
└────────────────┬────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
    ┌────────────┐   ┌──────────────┐
    │ start time │   │ end time     │
    └─────┬──────┘   └──────┬───────┘
          │                 │
          ▼                 ▼
    admissionDateTime   ┌──────────────┐
                        │ completedAt? │
                        │ (PRIMARY)    │
                        └──────┬───────┘
                               │
                          Yes  │  No
                        ┌──────┴──────┐
                        ▼             ▼
                   Use for END   ┌──────────────┐
                                │dischargeDate?│
                                └──────┬───────┘
                                       │
                                  Yes  │  No
                                ┌──────┴──────┐
                                ▼             ▼
                           Use for END   undefined
```

```
┌─────────────────────────────────────────────┐
│   OBSERVATION: effectiveDateTime (Vitals)   │
└────────────────┬────────────────────────────┘
                 │
                 ▼
            ┌──────────────────┐
            │ completedAt?     │
            │ (BEST - recorded │
            │  time)           │
            └────────┬─────────┘
                     │
                Yes  │  No
            ┌────────┴──────┐
            ▼               ▼
        Use as        ┌─────────────────┐
      effective       │admissionDateTime?│
      DateTime        │(SECONDARY)      │
                      └────────┬────────┘
                               │
                           Yes │ No
                        ┌──────┴──────┐
                        ▼             ▼
                   Use as        ┌──────────────┐
                 effective       │dateOfBirth?  │
                 DateTime        │(FALLBACK)    │
                                 └──────┬───────┘
                                        │
                                    Yes │ No
                                 ┌──────┴─────┐
                                 ▼            ▼
                            Use birth    undefined
                            time as base
```

```
┌────────────────────────────────────────────┐
│ OBSERVATION: effectiveDateTime (Apgar)     │
└────────────┬───────────────────────────────┘
             │
             ▼
        ┌──────────────────┐
        │ completedAt?     │
        │ (BEST)           │
        └────────┬─────────┘
                 │
            Yes  │  No
        ┌────────┴──────┐
        ▼               ▼
   Calculate as     ┌──────────────┐
   completedAt +    │dateOfBirth?  │
   N minutes        │(FALLBACK)    │
                    └────────┬─────┘
                             │
                         Yes │ No
                      ┌──────┴─────┐
                      ▼            ▼
                  Calculate as  undefined
                  birth + N min
```

---

## 4. Component Integration: Before & After

### BEFORE (Single Point of Failure)

```
┌──────────────────────────────────────────┐
│         Neotree Entry                    │
└────────────────────┬─────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │ processEntry()         │
        │ (Legacy: Single Bundle)│
        └────────────┬───────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
    ┌────────────┐        ┌──────────┐
    │ CR Success │        │SHR Fail  │
    │            │        │          │
    └────────────┘        └────┬─────┘
                               │
                               ▼
                    ┌──────────────────┐
                    │ RETRY: Full Push │
                    │ Risk: Duplicate  │
                    │ Patient!         │
                    └──────────────────┘
```

### AFTER (Smart Retry with CR Awareness)

```
┌──────────────────────────────────────────────┐
│         Neotree Entry + completedAt         │
└────────────────────┬────────────────────────┘
                     │
                     ▼
    ┌────────────────────────────────┐
    │ processEntryWithDualFlow()     │
    │ (Enhanced: Dual + Timestamp)   │
    └────────────┬──────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
      ▼                     ▼
 ┌─────────────┐      ┌──────────┐
 │ CR Success  │      │SHR Fail  │
 │             │      │          │
 └─────────────┘      └────┬─────┘
                           │
                           ▼
          ┌────────────────────────────┐
          │ processSyncedEntry()       │
          │ (NEW: Smart Detection)     │
          └────────────┬───────────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │ getPatientFromCR()     │
          │ Query CR for patient   │
          └────────────┬───────────┘
                       │
        ┌──────────────┴──────────┐
        │                         │
        ▼                         ▼
   ┌─────────────┐         ┌──────────────┐
   │Found: SHR   │         │Not Found:    │
   │Only Push    │         │Full Flow     │
   │No Risk of   │         │              │
   │Duplicate    │         └──────────────┘
   └─────────────┘
```

---

## 5. Class Dependencies (Simplified)

```
┌─────────────────────────────────────────────────────────┐
│                  AdapterService                         │
│  - processEntry()                                       │
│  - processEntryWithDualFlow()                           │
│  - processEntrySHRRetry()                 ← NEW METHOD  │
│  - processSyncedEntry() ← ENHANCED                      │
└────┬──────────┬──────────────┬──────────────┬───────────┘
     │          │              │              │
     ▼          ▼              ▼              ▼
  ┌──────────────────┐  ┌──────────────────────────────┐
  │ OpenHIMClient    │  │ Translators (All Enhanced)   │
  │ ├─ sendBundle()  │  │ ├─ PatientTranslator        │
  │ ├─ sendBundleTo  │  │ ├─ EncounterTranslator      │
  │ │  CR()          │  │ │   (uses completedAt)      │
  │ ├─ sendBundleTo  │  │ ├─ ObservationTranslator    │
  │ │  SHR()         │  │ │   (uses completedAt)      │
  │ └─ getPatientFrom│  │ ├─ ConditionTranslator      │
  │    CR() ← NEW    │  │ └─ RelatedPersonTranslator  │
  └──────────────────┘  └──────────────────────────────┘
       │                          │
       ▼                          ▼
  ┌─────────────┐         ┌─────────────────┐
  │ OpenHIM     │         │ NeotreeMapper   │
  │ Instance    │         │ (Enhanced to    │
  │             │         │  extract        │
  │             │         │  completed_at)  │
  └─────────────┘         └─────────────────┘
```

---

## 6. Database Storage: Failed Records Table

```
┌─────────────────────────────────────────────────────────┐
│         cdc_failed_records                              │
│  (Stores encrypted data for async retry)               │
├─────────────────────────────────────────────────────────┤
│ id                 │ Session-unique ID                  │
│ session_id         │ Original session ref               │
│ ingested_at        │ When first processed               │
│ attempt_count      │ Retry attempt counter              │
│ last_error         │ Last failure reason                │
│ last_attempt_at    │ Last retry timestamp               │
│ created_at         │ Record creation time               │
│ impilo_uid         │ ENCRYPTED: UUID                    │
│ impilo_id          │ ENCRYPTED: Unique ID               │
│ data               │ ENCRYPTED: Full Neotree entry      │
│ synced             │ Flag: synced=true after success    │
└─────────────────────────────────────────────────────────┘
                           ▲
                           │
                    Retry Logic:
                    ├─ Every 5 minutes
                    ├─ Check synced=false
                    ├─ Try CR retrieval (NEW)
                    ├─ SHR-only if found (NEW)
                    ├─ Full flow if not found
                    └─ Update on result
```

---

## 7. HTTP Request Flow: CR Lookup

```
┌─────────────────────────────────────────────────────────┐
│        AdapterService.processSyncedEntry()              │
│        (Retry logic)                                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────────┐
         │  OpenHIMClient.           │
         │  getPatientFromCR()       │
         └────────────┬──────────────┘
                      │
                      ▼
        ┌─────────────────────────────────┐
        │ HTTP GET Request                │
        │ URI: {OPENHIM}/CR/fhir/Patient  │
        │ Params: identifier=             │
        │  urn:neotree:impilo-id|uid-123  │
        │ Headers:                        │
        │  - Authorization: Basic ...     │
        │  - X-OpenHIM-ClientID: ...      │
        └────────────┬────────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │  OpenHIM (Routing)           │
        │  Route to CR endpoint        │
        └────────────┬─────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │  FHIR Server (CR)            │
        │  Patient Search Response     │
        │  FHIR Bundle with entry[]    │
        └────────────┬─────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │  Parse Response              │
        │  Extract Patient resource    │
        │  Return FHIRPatient | null   │
        └────────────┬─────────────────┘
                     │
                     ▼
         ┌───────────────────────────┐
         │  Use result for routing   │
         │  SHR-only or full flow    │
         └───────────────────────────┘
```

---

## 8. Complete End-to-End Scenario

### Scenario: CR Success, SHR Fails → Smart Retry

```
Time: T+0 (Initial Processing)
┌──────────────────────────────────┐
│ Neotree Entry Arrives            │
│ uid: neotree-123                 │
│ completed_at: 2024-01-07T15:30Z  │
└────────────┬─────────────────────┘
             │
             ▼
  processEntryWithDualFlow()
  ├─ CR: Patient + RelatedPerson
  │  └─ CR Response: Patient/abc123 ✓
  │
  └─ SHR: Encounter + Observations
     └─ SHR Response: ERROR 503 Service Unavailable ✗

Time: T+0, Record stored encrypted

  cdc_failed_records
  ├─ data: encrypted (neotree entry)
  ├─ impilo_id: encrypted (uuid)
  ├─ synced: false
  └─ last_attempt_at: T+0

─────────────────────────────────────────────

Time: T+300s (5 minutes later - Retry #1)
┌──────────────────────────────────┐
│ CDC Retry Loop                   │
│ processSyncedEntry()             │
└────────────┬─────────────────────┘
             │
             ├─ Decrypt data
             ├─ Validate
             │
             ├─ Query CR:
             │  └─ Patient/abc123 FOUND ✓
             │
             ├─ Create SHR Bundle (clinical only)
             │  └─ Use Patient/abc123 reference
             │
             ├─ Send to SHR:
             │  └─ Encounter + Observations ✓
             │
             └─ Update DB:
                └─ synced: true, last_error: null

Time: T+305s
✅ RECOVERY COMPLETE - No duplicate patient!
   Patient enrolled once (T+0), clinical data added (T+305s)
```

---

## 9. Timestamp Propagation Through Processing

```
┌─────────────────────────┐
│ Neotree Entry           │
│ completed_at:           │
│ "2024-01-07T15:30:45Z"  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ mapNeotreeToPatientData()       │
│ Extract: entry.completed_at     │
│ Return: completedAt: "..."      │
└────────────┬────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌────────────────────────────┐
│ EncounterTranslator        │
│ buildPeriod()              │
│ period.end =               │
│  completedAt (timestamp)   │
└────────────┬───────────────┘
             │
             ▼
┌──────────────────────────────┐
│ FHIR Encounter Resource      │
│ {                            │
│   period: {                  │
│     start: "...",            │
│     end: "2024-01-07T15:30Z" │
│   }                          │
│ }                            │
└──────────────────────────────┘
        │
        ├────────────────────────────┐
        │                            │
        ▼                            ▼
┌──────────────────────┐  ┌─────────────────────┐
│ ObservationTranslator│  │ Sent to SHR         │
│ buildObservation()   │  │ with accurate       │
│ effectiveDateTime =  │  │ timestamps          │
│  completedAt         │  │                     │
└──────────────────────┘  └─────────────────────┘
```

---

## Summary

These diagrams illustrate:

1. **Standard Flow**: How data moves from Neotree through dual-flow processing
2. **Retry Flow**: Smart detection and adaptive processing based on CR state
3. **Timestamp Logic**: Fallback chains ensuring data is always timestamped
4. **Integration**: How components interact (before/after comparison)
5. **Dependencies**: Class structure and relationships
6. **Database**: Encrypted storage and retry mechanism
7. **HTTP Requests**: Detailed CR lookup protocol
8. **End-to-End**: Complete recovery scenario
9. **Timestamp Propagation**: How completedAt flows through the system

The key innovation is **Step 7 (HTTP Flow)** and **Step 8 (End-to-End)** which show how the system now intelligently recovers from partial failures without creating duplicates.
