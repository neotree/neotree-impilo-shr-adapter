# Quick Reference: New Features

## 🎯 Features at a Glance

### 1. Smart CR Retry
When CR push succeeds but SHR fails, the retry mechanism:
- ✅ Queries Client Registry for existing patient
- ✅ Skips CR push if patient found
- ✅ Only pushes clinical data to SHR
- ✅ Prevents duplicate patient records

### 2. Form Completion Timestamps
Encounters and observations now tied to `completedAt`:
- ✅ Represents when clinical staff finalized the form
- ✅ More accurate than discharge times
- ✅ Used for encounter period.end
- ✅ Used for observation effectiveDateTime

---

## 📋 Key Changes Summary

| Component | Change | Impact |
|-----------|--------|--------|
| **OpenHIMClient** | Added `getPatientFromCR()` | CR-specific patient lookups |
| **NeotreePatientData** | Added `completedAt` field | Timestamp tracking |
| **Neotree Mapper** | Extract `completed_at` | Map Neotree → FHIR timing |
| **EncounterTranslator** | Use `completedAt` for period.end | Better timing precision |
| **ObservationTranslator** | Use `completedAt` for effectiveDateTime | Clinical data timestamps |
| **AdapterService** | Enhanced `processSyncedEntry()` | Smart retry detection |
| **AdapterService** | Added `processEntrySHRRetry()` | Explicit SHR-only retry |

---

## 🔄 Processing Flows

### Flow 1: Normal (Both Succeed)
```
Entry → CR Bundle + SHR Bundle → Success ✓
```

### Flow 2: CR Success, SHR Fails → Auto-Retry
```
Failed Entry (encrypted) → CDC Retry Loop
  ├─ Query CR for patient
  ├─ Patient found? Yes → SHR-only push
  └─ Patient found? No → Full dual-flow push
```

### Flow 3: Manual SHR-Only Retry
```
adapter.processEntrySHRRetry(entry)
  └─ Query CR → SHR push
```

---

## 💻 Code Snippets

### Auto-Retry (No Code Change Needed)
The retry happens automatically in `processSyncedEntry()`:
```typescript
// CDC retry loop calls this automatically
// Enhanced to detect CR state and choose appropriate flow
await adapter.processSyncedEntry(failedRecord);
```

### Manual SHR-Only Retry
```typescript
const { crPatient, shrResponse } = await adapter.processEntrySHRRetry(entry);
```

### CR Patient Lookup
```typescript
const patient = await client.getPatientFromCR(
  'urn:neotree:impilo-id',
  'neotree-uid-123'
);
```

---

## ⏰ Timestamp Fallback Chain

### Encounters
1. `completedAt` (form submission time)
2. `dischargeDateTime` (if available)
3. `admissionDateTime` (fallback)

### Observations (Vital Signs)
1. `completedAt`
2. `admissionDateTime`
3. `dateOfBirth`

### Observations (Body Measurements)
1. `completedAt`
2. `dateOfBirth`

---

## 🐛 Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| `Cannot retrieve patient from CR` | CR offline | Check OpenHIM health |
| `Patient not in CR` | CR push never completed | Falls back to full flow |
| `completedAt is undefined` | Neotree entry missing field | Gracefully falls back to other timestamps |
| Duplicate patients created | CR lookup failed during retry | Monitor CR connectivity |

---

## 📊 Monitoring

### Log Lines to Watch
```bash
# Success: CR patient found, SHR-only push
"Patient already exists in CR - proceeding with SHR-only push"

# Fallback: Patient not in CR, full flow
"Patient not in CR - performing full legacy dual-flow push"

# Debug: CR lookup attempt
"Attempting to retrieve existing patient from CR"
```

### Metrics to Track
- CR lookup success rate
- SHR-only retry count
- Full dual-flow retry count
- Average CR lookup latency

---

## 🚀 Deployment Checklist

- [ ] Code changes reviewed
- [ ] TypeScript compilation passes: `npm run build`
- [ ] Tests pass: `npm run test`
- [ ] CR endpoint configured correctly
- [ ] SHR endpoint configured correctly
- [ ] OpenHIM health check passes
- [ ] Database migrations applied (none needed)
- [ ] Logs monitored for errors
- [ ] CDC retry loop functioning normally

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `IMPLEMENTATION_SUMMARY.md` | High-level overview & design |
| `DEVELOPER_GUIDE.md` | Detailed API & code examples |
| `QUICK_REFERENCE.md` | This file - quick lookup |

---

## 🔗 Related Configuration

```bash
# Existing config (no changes needed)
OPENHIM_BASE_URL=http://localhost:5001
OPENHIM_USERNAME=root@openhim.org
OPENHIM_PASSWORD=****
OPENHIM_CR_ENDPOINT=/CR/fhir       # Uses this for CR queries
OPENHIM_SHR_ENDPOINT=/SHR/fhir     # Uses this for SHR pushes
```

---

## ✅ Implementation Status

- ✅ Client Registry patient retrieval (`getPatientFromCR`)
- ✅ Form completion timestamp (`completedAt`)
- ✅ Encounter period timing updates
- ✅ Observation timing updates
- ✅ Smart retry flow in `processSyncedEntry`
- ✅ Explicit `processEntrySHRRetry` method
- ✅ TypeScript compilation clean
- ✅ Backward compatible (all changes optional)

---

## 🎓 Learning Resources

- See `DEVELOPER_GUIDE.md` for:
  - Detailed API reference
  - Code examples
  - Testing patterns
  - Error handling

- See `IMPLEMENTATION_SUMMARY.md` for:
  - Problem statement
  - Architecture overview
  - Data flow diagrams
  - Future enhancements

---

## 📞 Support

For questions or issues:
1. Check `DEVELOPER_GUIDE.md` troubleshooting section
2. Review relevant code in `src/fhir-adapter/services/adapter-service.ts`
3. Monitor logs for `getPatientFromCR` or `SHR retry` messages
4. Verify CR/SHR endpoint connectivity
