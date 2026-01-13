# FHIR Resource Mapping Documentation

This document provides a comprehensive mapping of database variables to FHIR R4 resources used in the Neotree-OpenCR bridge.

---

## Table of Contents

1. [Patient Resource Mapping](#patient-resource-mapping)
2. [Observation Resource Mapping](#observation-resource-mapping)
3. [Encounter References](#encounter-references)
4. [Extension Definitions](#extension-definitions)
5. [Identifier Systems](#identifier-systems)

---

## Patient Resource Mapping

The Patient resource is created from the `NeonatalCareWithDemographics` interface, which combines data from:
- `consultation.neonatal_care`
- `consultation.patient`
- `report.person_demographic`

### Source Database Tables

| Table | Schema | Purpose |
|-------|--------|---------|
| `neonatal_care` | `consultation` | Main encounter/episode record |
| `patient` | `consultation` | Patient linkage and facility info |
| `person_demographic` | `report` | Patient demographic data |

### Variable Mappings

| Database Variable | Source Table | FHIR Field | FHIR Path | Description | Transformation |
|-------------------|--------------|------------|-----------|-------------|----------------|
| `neonatal_care_id` | `neonatal_care` | N/A | N/A | Used for Encounter reference | Referenced as `Encounter/{neonatal_care_id}` |
| `patient_id` | `neonatal_care` | Identifier | `identifier[1].value` | Secondary patient identifier | System: `urn:impilo:uid` |
| `impilo_neotree_id` | `neonatal_care` | Identifier | `identifier[0].value` | Primary unique identifier | System: `urn:neotree:impilo-id`<br/>Format: `PP-DD-SS-YYYY-P-XXXXX` |
| `person_id` | `patient` | Identifier | `identifier[2].value` | Facility-specific patient ID | System: `urn:impilo:person-id` |
| `facility_id` | `patient` | Managing Organization | `managingOrganization.reference` | Facility/organization reference | Format: `Organization/{facility_id}`<br/>Fallback: Uses `FACILITY_ID` env var |
| `firstname` | `person_demographic` | Name | `name[0].given[0]` | Patient's first name | Trimmed, only if not empty |
| `lastname` | `person_demographic` | Name | `name[0].family` | Patient's last name | Trimmed, only if not empty |
| `sex` | `person_demographic` | Gender | `gender` | Patient's sex/gender | Normalized: `"m"`/`"male"` → `"male"`<br/>`"f"`/`"female"` → `"female"`<br/>Other → `"unknown"` |
| `birthdate` | `person_demographic` | Birth Date | `birthDate` | Patient's date of birth | Format: `YYYY-MM-DD` (ISO 8601 date) |
| `clientId` (env) | Configuration | Meta Tag | `meta.tag[0].code` | OpenCR client ID | System: `http://openclientregistry.org/fhir/clientid` |

### Patient Resource Structure

```json
{
  "resourceType": "Patient",
  "meta": {
    "tag": [{
      "system": "http://openclientregistry.org/fhir/clientid",
      "code": "{FACILITY_ID}"
    }]
  },
  "identifier": [
    {
      "system": "urn:neotree:impilo-id",
      "value": "{impilo_neotree_id}"
    },
    {
      "system": "urn:impilo:uid",
      "value": "{patient_id}"
    },
    {
      "system": "urn:impilo:person-id",
      "value": "{person_id}"
    }
  ],
  "name": [{
    "use": "official",
    "family": "{lastname}",
    "given": ["{firstname}"]
  }],
  "gender": "{normalized_sex}",
  "birthDate": "{YYYY-MM-DD}",
  "managingOrganization": {
    "reference": "Organization/{facility_id}"
  }
}
```

### Identifier Priority Order

Identifiers are added in priority order (highest to lowest):

1. **Primary**: `impilo_neotree_id` → `urn:neotree:impilo-id`
   - Highest priority for patient matching
   - Format: `PP-DD-SS-YYYY-P-XXXXX` (e.g., `00-0A-34-2025-N-01031`)

2. **Secondary**: `patient_id` → `urn:impilo:uid`
   - OpenCR internal identifier
   - Used for cross-system matching

3. **Tertiary**: `person_id` → `urn:impilo:person-id`
   - Facility-specific identifier
   - Uniquely identifies patient at one facility

---

## Observation Resource Mapping

The Observation resource is created from the `NeonatalQuestionRow` interface, sourced from:
- `consultation.neonatal_question`
- `consultation.neonatal_care` (for admission date)

### Source Database Tables

| Table | Schema | Purpose |
|-------|--------|---------|
| `neonatal_question` | `consultation` | Question/answer data from Neotree app |
| `neonatal_care` | `consultation` | Linked encounter for admission date |

### Variable Mappings

| Database Variable | Source Table | FHIR Field | FHIR Path | Description | Transformation |
|-------------------|--------------|------------|-----------|-------------|----------------|
| `id` | `neonatal_question` | Resource ID | `id` | Unique question record ID | Format: `neonatal-question-{id}` |
| `patient_id` | `neonatal_question` | Subject Reference | `subject.reference` | Patient this observation belongs to | Format: `Patient/{patient_id}`<br/>Fallback: Uses `patientResourceId` parameter |
| `neonatal_care_id` | `neonatal_question` | Extension Reference | `extension[1].valueReference.reference` | Encounter/episode reference | Format: `Encounter/{neonatal_care_id}`<br/>Extension: `urn:neotree:neonatal-care-reference` |
| `data_key` | `neonatal_question` | Code | `code.coding[0].code` | Question data key identifier | System: `urn:neotree:data-key` |
| `display_key` | `neonatal_question` | Code Display | `code.coding[0].display` | Human-readable question label | Falls back to `data_key` if null |
| `category_id` | `neonatal_question` | Category Code | `category[0].coding[0].code` | Question category ID | System: `urn:neotree:question-category`<br/>Only included if `category_id` is not null |
| `category` | `neonatal_question` | Category Display | `category[0].coding[0].display` | Category name/label | Only included if `category_id` is not null |
| `type` | `neonatal_question` | Value Type | `value*` | Determines value field type | `"number"` → `valueInteger`<br/>`"boolean"` → `valueBoolean`<br/>`"datetime"`/`"date"` → `valueDateTime`<br/>`"id"`/`"string"` → `valueString`<br/>Multi-value → `component[]` |
| `data` | `neonatal_question` | Extension + Value | `extension[0].valueString`<br/>`value*` (parsed) | JSON string with question metadata | Parsed to extract `values[0].value`<br/>Stored as-is in extension |
| `display_value` | `neonatal_question` | Value Fallback | `value*` | Display text if JSON parsing fails | Used when `data.values[0]` is missing |
| `date_time_admission` | `neonatal_care` | Effective Date | `effectiveDateTime` | When observation was made | Format: ISO 8601 datetime<br/>Only included if not null |
| `clientId` (env) | Configuration | Meta Tag | `meta.tag[0].code` | OpenCR client ID | System: `http://openclientregistry.org/fhir/clientid` |

### Observation Resource Structure

```json
{
  "resourceType": "Observation",
  "id": "neonatal-question-{id}",
  "status": "final",
  "category": [{
    "coding": [{
      "system": "urn:neotree:question-category",
      "code": "{category_id}",
      "display": "{category}"
    }]
  }],
  "code": {
    "coding": [{
      "system": "urn:neotree:data-key",
      "code": "{data_key}",
      "display": "{display_key || data_key}"
    }]
  },
  "subject": {
    "reference": "Patient/{patient_id}"
  },
  "effectiveDateTime": "{ISO_8601_datetime}",
  "valueInteger": "{number}" | "valueString": "{string}" | "valueBoolean": "{boolean}" | "valueDateTime": "{datetime}",
  "extension": [
    {
      "url": "urn:neotree:question-metadata",
      "valueString": "{data_json_string}"
    },
    {
      "url": "urn:neotree:neonatal-care-reference",
      "valueReference": {
        "reference": "Encounter/{neonatal_care_id}"
      }
    }
  ],
  "meta": {
    "tag": [{
      "system": "http://openclientregistry.org/fhir/clientid",
      "code": "{clientId}"
    }]
  }
}
```

### Value Extraction Logic

The `type` field determines which value field is populated:

| Type | Value Field | Extraction Logic |
|------|-------------|------------------|
| `"number"` | `valueInteger` | Parses `data.values[0].value` as number, rounds to integer |
| `"boolean"` | `valueBoolean` | Converts `data.values[0].value` to boolean |
| `"datetime"` or `"date"` | `valueDateTime` | Formats `data.values[0].value` as ISO 8601 datetime |
| `"id"` or `"string"` | `valueString` | Uses `data.values[0].valueText` or `value` |
| Multi-value (`data.values.length > 1`) | `component[]` | Creates array of components, each with `code` and `valueString` |

**Fallback**: If `data.values[0]` is missing, uses `display_value` as `valueString`.

---

## Encounter References

Encounter resources are **not directly created** by this bridge. Instead, they are referenced by ID in Observation resources.

### Encounter Reference Structure

```json
{
  "url": "urn:neotree:neonatal-care-reference",
  "valueReference": {
    "reference": "Encounter/{neonatal_care_id}"
  }
}
```

### Variable Mapping

| Database Variable | Source | FHIR Reference | Description |
|-------------------|--------|----------------|-------------|
| `neonatal_care_id` | `neonatal_care.neonatal_care_id` | `Encounter/{neonatal_care_id}` | UUID of the neonatal care encounter/episode |

**Note**: The Encounter resource itself must exist in the FHIR server (OpenCR) before Observations can reference it. This bridge assumes Encounters are created by another system or process.

---

## Extension Definitions

### 1. `urn:neotree:question-metadata`

**Purpose**: Stores the complete original JSON data from the Neotree app for a question/answer.

**Structure**:
```json
{
  "url": "urn:neotree:question-metadata",
  "valueString": "{complete_json_string_from_data_column}"
}
```

**Source**: `neonatal_question.data` (raw JSON string)

**Example**:
```json
{
  "url": "urn:neotree:question-metadata",
  "valueString": "{\"values\":[{\"value\":false,\"confidential\":false,\"valueText\":\"No\",\"key\":\"BabyCryTriage\",\"label\":\"Baby is not crying\",\"type\":\"boolean\",\"dataType\":\"boolean\"}],\"screen\":{\"title\":\"EMERGENCY TRIAGE\",\"sectionTitle\":\"NEOTREE ADMISSION HARARE CENTRAL HOSPITAL\",\"id\":\"-MweiZc-ey0y8a8z1XIe\",\"screen_id\":\"-MweiZc-ey0y8a8z1XIe\",\"screenId\":\"-MweiZc-ey0y8a8z1XIe\",\"scriptId\":\"-ZO1TK4zMvLhxTw6eKia\",\"type\":\"yesno\",\"metadata\":{\"label\":\"Baby Crying\",\"dataType\":\"boolean\"}}}"
}
```

### 2. `urn:neotree:neonatal-care-reference`

**Purpose**: Links an Observation to its associated Encounter (episode of care).

**Structure**:
```json
{
  "url": "urn:neotree:neonatal-care-reference",
  "valueReference": {
    "reference": "Encounter/{neonatal_care_id}"
  }
}
```

**Source**: `neonatal_question.neonatal_care_id`

**Example**:
```json
{
  "url": "urn:neotree:neonatal-care-reference",
  "valueReference": {
    "reference": "Encounter/4206171e-8d44-400b-91c8-3aa5c667fca1"
  }
}
```

---

## Identifier Systems

### Patient Identifiers

| System URI | Purpose | Source Variable | Priority |
|------------|---------|-----------------|----------|
| `urn:neotree:impilo-id` | Primary unique identifier (IMPILO-NEOTREE-ID) | `impilo_neotree_id` | 1 (Highest) |
| `urn:impilo:uid` | OpenCR internal patient ID | `patient_id` | 2 |
| `urn:impilo:person-id` | Facility-specific patient identifier | `person_id` | 3 (Lowest) |

### Code Systems

| System URI | Purpose | Used In |
|------------|---------|---------|
| `urn:neotree:data-key` | Question/observation data key codes | Observation `code.coding[0].system` |
| `urn:neotree:question-category` | Question category classification | Observation `category[0].coding[0].system` |
| `http://openclientregistry.org/fhir/clientid` | OpenCR client/facility identifier | Patient/Observation `meta.tag[0].system` |

---

## Data Type Transformations

### Date/Time Formats

| Source Type | Target Format | Example |
|------------|---------------|---------|
| `birthdate` (Date) | `YYYY-MM-DD` | `2024-01-15` |
| `date_time_admission` (DateTime) | ISO 8601 | `2024-01-15T10:30:00.000Z` |

### Gender Normalization

| Source Value | Normalized Value |
|--------------|------------------|
| `"m"` or `"male"` | `"male"` |
| `"f"` or `"female"` | `"female"` |
| Other/Unknown | `"unknown"` |
| Null/Empty | `undefined` (omitted) |

### Name Handling

- **Given Names**: Array of strings, trimmed, only added if not empty
- **Family Name**: Single string, trimmed, only added if not empty
- **Name Use**: Always set to `"official"`

---

## Implementation Notes

### Conditional Fields

Many fields are **optional** and only included if they have values:

- `category` in Observation: Only if `category_id` is not null
- `effectiveDateTime` in Observation: Only if `date_time_admission` is not null
- `managingOrganization` in Patient: Only if `facility_id` or `clientId` is available
- `meta.tag` in Patient: Only if `clientId` is configured

### Resource ID Generation

- **Patient**: No explicit ID set (server assigns)
- **Observation**: Format `neonatal-question-{id}` where `{id}` is `neonatal_question.id`

### Reference Resolution

- Patient references in Observations use `patientResourceId` parameter if provided (from SHR), otherwise fall back to `row.patient_id`
- Encounter references use `neonatal_care_id` directly (assumes Encounter exists in FHIR server)



