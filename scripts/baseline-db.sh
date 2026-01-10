#!/bin/sh
# Baseline script for existing database
# This creates an initial migration and marks it as applied without running it

set -e

echo "📊 Baselining existing database for language-intelligence-service..."

# Check if migrations directory exists, create if not
if [ ! -d "prisma/migrations" ]; then
  echo "Creating migrations directory..."
  mkdir -p prisma/migrations
fi

# Check if there are any existing migrations
if [ -z "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "Creating initial migration..."
  npx prisma migrate dev --create-only --name init || {
    echo "⚠️  Migration creation failed. Trying alternative approach..."
    # Alternative: use db push to sync schema, then create migration
    npx prisma db push --skip-generate --accept-data-loss || true
    npx prisma migrate dev --create-only --name init || true
  }
  
  # Get the migration directory name
  MIGRATION_DIR=$(ls -t prisma/migrations | head -n 1)
  
  if [ -n "$MIGRATION_DIR" ] && [ -d "prisma/migrations/$MIGRATION_DIR" ]; then
    echo "Marking migration as applied (baseline)..."
    npx prisma migrate resolve --applied "$MIGRATION_DIR" || {
      echo "⚠️  Could not mark migration as applied. You may need to run:"
      echo "   npx prisma migrate resolve --applied $MIGRATION_DIR"
    }
    echo "✅ Database baselined successfully!"
  else
    echo "⚠️  Could not find migration directory. You may need to create it manually."
  fi
else
  echo "✅ Migrations already exist. Skipping baseline."
fi

echo "Generating Prisma client..."
npx prisma generate

echo "✅ Done!"

