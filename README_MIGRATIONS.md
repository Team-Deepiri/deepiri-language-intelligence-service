# Database Migration Setup

## Baseline Existing Database

If your database already has tables but no migration history, you need to baseline it:

### Option 1: Using the baseline script (Recommended)

```bash
cd deepiri-platform/platform-services/backend/deepiri-language-intelligence-service
npm run prisma:baseline
```

Or directly:

```bash
cd deepiri-platform/platform-services/backend/deepiri-language-intelligence-service
bash scripts/baseline-migration.sh
```

### Option 2: Manual baseline

```bash
cd deepiri-platform/platform-services/backend/deepiri-language-intelligence-service

# Create migrations directory if it doesn't exist
mkdir -p prisma/migrations

# Create initial migration (without applying it)
npx prisma migrate dev --create-only --name init

# Get the migration directory name (it will be something like "20240110123456_init")
MIGRATION_DIR=$(ls -t prisma/migrations | grep -v "migration_lock.toml" | head -n 1)

# Mark it as applied (baseline)
npx prisma migrate resolve --applied "$MIGRATION_DIR"

# Generate Prisma client
npx prisma generate
```

### Option 3: Use db push for development (No migrations)

For development environments, you can use `db push` which doesn't require migrations:

```bash
npx prisma db push
npx prisma generate
```

## After Baseline

Once baselined, you can use normal migrations:

```bash
# Create a new migration
npm run prisma:migrate

# Deploy migrations (production)
npm run prisma:migrate:deploy
```

## Troubleshooting

### Error: "The database schema is not empty"

This means the database has tables but no migration history. Use one of the baseline options above.

### Error: "Migration already applied"

This is normal after baselining. The migration is marked as applied without actually running it.

### Error: "No migration found"

Make sure you've created the migrations directory and run the baseline script.

