#!/bin/bash
# Database Setup Script for Neotree FHIR Adapter
# Installs CDC (Change Data Capture) watermark tracking system
#
# IMPORTANT: Database Credentials
# --------------------------------
# This script is run ONCE by an administrator who has PostgreSQL access.
# It prompts for DB_USER to install the CDC tables and functions.
#
# The FHIR ADAPTER needs database credentials to poll for new sessions:
# - Uses ~/.pgpass file (recommended for security)
# - Or DB_PASSWORD environment variable in .env file
#
# How credentials are handled:
# - This setup script uses psql command which reads from:
#   • ~/.pgpass file (recommended for security)
#   • PGPASSWORD environment variable
#   • Peer authentication (if running as postgres user)
#   • Will prompt for password if none found
# - The adapter polls the sessions table using the same credentials
#
# Architecture:
#   FHIR Adapter polls PostgreSQL → processes new sessions → sends to OpenHIM
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Neotree FHIR Adapter - Database Setup${NC}"
echo ""

# Load environment variables from .env if it exists
if [ -f .env ]; then
    echo "Loading configuration from .env file..."
    export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)
    echo -e "${GREEN}✓ Configuration loaded${NC}"
    echo ""
fi

# Set defaults for CDC configuration
SOURCE_TABLE=${DB_SOURCE_TABLE:-sessions}
WATERMARK_START=${DB_WATERMARK_START:-'1970-01-01 00:00:00'}

echo "CDC Configuration:"
echo "  • Source table: $SOURCE_TABLE"
echo "  • Watermark start: $WATERMARK_START"
echo ""
echo "The adapter polls the database every 30 seconds for new sessions."
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}Error: psql is not installed${NC}"
    exit 1
fi

# Get database details
echo "Database connection (for setup only):"
read -p "Database name [neotree]: " DB_NAME
DB_NAME=${DB_NAME:-neotree}

read -p "Database user [postgres]: " DB_USER
DB_USER=${DB_USER:-postgres}

echo ""
echo "Note: psql will use credentials from ~/.pgpass or prompt for password"

# Ensure .pgpass has secure permissions if it exists
if [ -f ~/.pgpass ]; then
    chmod 600 ~/.pgpass
    echo -e "${GREEN}✓ Set ~/.pgpass permissions to 600${NC}"
fi

echo ""
echo -e "${YELLOW}Step 1: Installing CDC watermark tracking${NC}"

# Install CDC system with variables
psql -U $DB_USER -d $DB_NAME \
  -v source_table="$SOURCE_TABLE" \
  -v watermark_start="'$WATERMARK_START'" \
  -f src/fhir-adapter/database/setup-cdc.sql

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Database setup completed successfully!${NC}"
    echo ""
    echo "CDC Configuration Applied:"
    echo "  • Source table: $SOURCE_TABLE"
    echo "  • Watermark start: $WATERMARK_START"
    echo ""
    echo "Next steps:"
    echo "1. Ensure ~/.pgpass file exists with database credentials (chmod 600)"
    echo "2. Configure .env file with database and OpenHIM credentials"
    echo "   - DB_SOURCE_TABLE=$SOURCE_TABLE"
    echo "   - DB_WATERMARK_START=$WATERMARK_START"
    echo "3. Install dependencies: npm install"
    echo "4. Build the adapter: npm run build"
    echo "5. Start the FHIR Adapter: npm start"
    echo "6. The adapter will automatically poll for new $SOURCE_TABLE every 30 seconds"
    echo "7. Failed sessions retry automatically every 5 minutes"
    echo ""
    echo "Monitoring:"
    echo "  • Check watermark: SELECT * FROM cdc_watermark WHERE table_name='$SOURCE_TABLE';"
    echo "  • Check failed: SELECT * FROM cdc_failed_records;"
    echo "  • Health check: curl http://localhost:3001/health"
    echo "  • CDC stats: curl http://localhost:3001/api/monitoring/stats"
    echo ""
    echo -e "${YELLOW}IMPORTANT:${NC}"
    echo "  • The adapter needs database credentials (use .pgpass or DB_PASSWORD in .env)"
    echo "  • Sessions are processed in order by ingested_at timestamp"
    echo "  • Failed records don't block new data processing"
else
    echo -e "${RED}Database setup failed${NC}"
    exit 1
fi
