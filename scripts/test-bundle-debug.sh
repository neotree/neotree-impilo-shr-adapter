#!/bin/bash
# Debug OpenCR bundle submission issues
# Load environment variables

set -e

# Load .env file if it exists
load_env_file() {
    local env_file=$1
    if [ -f "$env_file" ]; then
        echo "Loading environment variables from $env_file..."
        while IFS= read -r line || [ -n "$line" ]; do
            if [[ ! "$line" =~ ^[[:space:]]*# ]] && [[ -n "$line" ]]; then
                if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
                    key="${BASH_REMATCH[1]}"
                    value="${BASH_REMATCH[2]}"
                    value=$(echo "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
                    export "$key=$value"
                fi
            fi
        done < "$env_file"
        return 0
    fi
    return 1
}

if ! load_env_file .env; then
    load_env_file ../.env
fi

OPENHIM_URL="${OPENHIM_URL:-http://197.221.242.150:10343}"
USERNAME="${OPENHIM_USERNAME:-Neotree-Mobile}"
PASSWORD="${OPENHIM_PASSWORD}"
FACILITY_ID="${FACILITY_ID:-ZW000A42}"

if [ -z "$PASSWORD" ]; then
    echo "Error: OPENHIM_PASSWORD not set"
    exit 1
fi

AUTH=$(echo -n "$USERNAME:$PASSWORD" | base64)

echo "===================================================="
echo "OpenCR Bundle Debugging"
echo "===================================================="
echo ""

# Test 1: Check if Organization exists
echo "1. Checking if Organization/${FACILITY_ID} exists..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -H "Authorization: Basic $AUTH" \
    -H "Accept: application/fhir+json" \
    "$OPENHIM_URL/CR/fhir/Organization/${FACILITY_ID}")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✓ Organization exists"
    ORG_NAME=$(echo "$BODY" | jq -r '.name // "Unknown"')
    echo "   Organization name: $ORG_NAME"
elif [ "$HTTP_CODE" = "404" ]; then
    echo "   ✗ Organization NOT found (404)"
    echo "   This might cause the bundle to fail!"
    echo ""
    echo "   Creating Organization..."

    ORG_RESOURCE=$(cat <<EOF
{
  "resourceType": "Organization",
  "id": "${FACILITY_ID}",
  "identifier": [{
    "system": "http://health.gov.zw/fhir/organization",
    "value": "${FACILITY_ID}"
  }],
  "active": true,
  "name": "Western Triangle Primary Care Clinic",
  "type": [{
    "coding": [{
      "system": "http://terminology.hl7.org/CodeSystem/organization-type",
      "code": "prov",
      "display": "Healthcare Provider"
    }]
  }]
}
EOF
)

    CREATE_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
        -X PUT \
        -H "Authorization: Basic $AUTH" \
        -H "Content-Type: application/fhir+json" \
        -H "Accept: application/fhir+json" \
        -d "$ORG_RESOURCE" \
        "$OPENHIM_URL/CR/fhir/Organization/${FACILITY_ID}")

    CREATE_CODE=$(echo "$CREATE_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)

    if [ "$CREATE_CODE" = "200" ] || [ "$CREATE_CODE" = "201" ]; then
        echo "   ✓ Organization created successfully"
    else
        echo "   ✗ Failed to create Organization (HTTP $CREATE_CODE)"
        echo "$CREATE_RESPONSE" | grep -v "HTTP_CODE:"
    fi
else
    echo "   ⚠ Unexpected response (HTTP $HTTP_CODE)"
    echo "$BODY"
fi
echo ""

# Test 2: Try minimal Patient without managingOrganization
echo "2. Testing minimal Patient (without managingOrganization)..."
MINIMAL_PATIENT=$(cat <<'EOF'
{
  "resourceType": "Patient",
  "identifier": [{
    "system": "urn:neotree:impilo-id",
    "value": "TEST-MINIMAL-001"
  }],
  "name": [{
    "text": "Test Minimal Patient"
  }]
}
EOF
)

RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Authorization: Basic $AUTH" \
    -H "Content-Type: application/fhir+json" \
    -H "Accept: application/fhir+json" \
    -d "$MINIMAL_PATIENT" \
    "$OPENHIM_URL/CR/fhir/Patient")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "   ✓ Minimal Patient created (HTTP $HTTP_CODE)"
else
    echo "   ✗ Minimal Patient failed (HTTP $HTTP_CODE)"
    echo "   Response:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 3: Try Patient with meta tag and managingOrganization
echo "3. Testing Patient with OpenCR meta tag and managingOrganization..."
FULL_PATIENT=$(cat <<EOF
{
  "resourceType": "Patient",
  "meta": {
    "source": "neotree-mobile/${FACILITY_ID}",
    "tag": [{
      "system": "http://openclientregistry.org/fhir/clientid",
      "code": "${FACILITY_ID}"
    }]
  },
  "identifier": [{
    "use": "official",
    "system": "urn:neotree:impilo-id",
    "value": "TEST-FULL-002"
  }],
  "name": [{
    "use": "official",
    "family": "Test",
    "given": ["Full"],
    "text": "Full Test"
  }],
  "gender": "male",
  "birthDate": "2025-09-04",
  "managingOrganization": {
    "reference": "Organization/${FACILITY_ID}"
  }
}
EOF
)

RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Authorization: Basic $AUTH" \
    -H "Content-Type: application/fhir+json" \
    -H "Accept: application/fhir+json" \
    -d "$FULL_PATIENT" \
    "$OPENHIM_URL/CR/fhir/Patient")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "   ✓ Full Patient created (HTTP $HTTP_CODE)"
    PATIENT_ID=$(echo "$BODY" | jq -r '.id // "unknown"')
    echo "   Patient ID: $PATIENT_ID"
else
    echo "   ✗ Full Patient failed (HTTP $HTTP_CODE)"
    echo "   Response:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 4: Try the actual bundle from the error
echo "4. Testing actual bundle format from error..."
TEST_BUNDLE=$(cat <<EOF
{
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [{
    "fullUrl": "urn:uuid:test-patient-debug",
    "resource": {
      "resourceType": "Patient",
      "meta": {
        "source": "neotree-mobile/${FACILITY_ID}",
        "tag": [{
          "system": "http://openclientregistry.org/fhir/clientid",
          "code": "${FACILITY_ID}"
        }]
      },
      "identifier": [{
        "use": "official",
        "type": {
          "coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
            "code": "MR",
            "display": "Medical Record Number"
          }]
        },
        "system": "urn:neotree:impilo-id",
        "value": "TEST-BUNDLE-003"
      }],
      "active": true,
      "name": [{
        "use": "official",
        "family": "Bundle",
        "given": ["Test"],
        "text": "Test Bundle"
      }],
      "gender": "male",
      "birthDate": "2025-09-04",
      "managingOrganization": {
        "reference": "Organization/${FACILITY_ID}"
      }
    },
    "request": {
      "method": "POST",
      "url": "Patient"
    }
  }]
}
EOF
)

RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Authorization: Basic $AUTH" \
    -H "Content-Type: application/fhir+json" \
    -H "Accept: application/fhir+json" \
    -d "$TEST_BUNDLE" \
    "$OPENHIM_URL/CR/fhir")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
    ENTRY_COUNT=$(echo "$BODY" | jq -r '.entry | length')
    if [ "$ENTRY_COUNT" -gt 0 ]; then
        echo "   ✓ Bundle processed successfully"
        FIRST_STATUS=$(echo "$BODY" | jq -r '.entry[0].response.status // "unknown"')
        echo "   First entry status: $FIRST_STATUS"
    else
        echo "   ✗ Bundle returned empty response (same as your error!)"
        echo "   This is the issue you're experiencing"
    fi
elif [ "$HTTP_CODE" = "500" ]; then
    echo "   ✗ Bundle failed with HTTP 500"
    echo "   Response:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
    echo "   ✗ Bundle failed (HTTP $HTTP_CODE)"
    echo "   Response:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
fi
echo ""

echo "===================================================="
echo "Recommendations"
echo "===================================================="
echo ""
echo "If Test 1 failed (Organization not found):"
echo "  → The Organization/${FACILITY_ID} needs to exist before referencing it"
echo "  → Script attempted to create it automatically"
echo ""
echo "If Test 2 passed but Test 3 failed:"
echo "  → Issue with managingOrganization or meta tags"
echo "  → Consider removing managingOrganization temporarily"
echo ""
echo "If Test 4 failed with empty response:"
echo "  → Check OpenCR/HAPI server logs: docker logs opencr-fhir"
echo "  → May need to configure OpenCR to accept client registry tags"
echo ""
echo "Check OpenCR logs with:"
echo "  docker logs opencr-fhir 2>&1 | tail -50"
echo ""
