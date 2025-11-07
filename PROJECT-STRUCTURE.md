# Project Structure

Clean, minimal structure focused on PostgreSQL HTTP trigger solution.

```
neotree-impilo-shr-adapter/
│
├── src/
│   ├── fhir-adapter/                  # Main FHIR Adapter (Node.js)
│   │   ├── clients/
│   │   │   └── openhim-client.ts      # OpenHIM communication & auth
│   │   ├── database/
│   │   │   └── setup-triggers.sql     # PostgreSQL HTTP trigger
│   │   ├── mappers/
│   │   │   └── neotree-mapper.ts      # Extract Neotree fields
│   │   ├── services/
│   │   │   ├── adapter-service.ts     # Main orchestration
│   │   │   └── bundle-builder.ts      # FHIR bundle creation
│   │   ├── translators/               # FHIR resource translators
│   │   │   ├── condition-translator.ts
│   │   │   ├── encounter-translator.ts
│   │   │   ├── observation-translator.ts
│   │   │   ├── patient-translator.ts
│   │   │   └── related-person-translator.ts
│   │   └── index.ts                   # HTTP API entry point
│   │
│   └── shared/                        # Shared utilities
│       ├── config/
│       │   └── index.ts               # Configuration management
│       ├── types/
│       │   ├── fhir.types.ts          # FHIR type definitions
│       │   └── neotree.types.ts       # Neotree type definitions
│       └── utils/
│           ├── errors.ts              # Error classes
│           └── logger.ts              # Structured logging
│
├── scripts/
│   └── setup-database.sh              # Database setup script
│
├── .env.example                       # Configuration template
├── .gitignore                         # Git ignore rules
├── ARCHITECTURE.md                    # Technical architecture
├── package.json                       # Dependencies & scripts
├── README.md                          # Main documentation
├── SampleData.json                    # Sample Neotree data
└── tsconfig.json                      # TypeScript configuration
```

## Key Files

### Database
- **`src/fhir-adapter/database/setup-triggers.sql`** - PostgreSQL HTTP trigger that calls adapter automatically

### FHIR Adapter
- **`src/fhir-adapter/index.ts`** - Express HTTP API (port 3001)
- **`src/fhir-adapter/services/adapter-service.ts`** - Main orchestration logic
- **`src/fhir-adapter/clients/openhim-client.ts`** - OpenHIM authentication & submission

### Configuration
- **`.env.example`** - Environment configuration template
- **`src/shared/config/index.ts`** - Config validation with Zod

### Documentation
- **`README.md`** - Quick start guide
- **`ARCHITECTURE.md`** - Technical deep-dive

