#!/bin/sh
# Baseline migration script for language-intelligence-service
# This creates an initial migration and marks it as applied without running it

set -e

echo "📊 Creating baseline migration for language-intelligence-service..."

# Navigate to the service directory
cd "$(dirname "$0")/.." || exit 1

# Check if migrations directory exists, create if not
if [ ! -d "prisma/migrations" ]; then
  echo "Creating migrations directory..."
  mkdir -p prisma/migrations
fi

# Check if there are any existing migrations
if [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "⚠️  Migrations directory is not empty. Existing migrations found:"
  ls -la prisma/migrations
  echo ""
  read -p "Do you want to continue and create a baseline anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Creating initial migration (without applying it)..."
npx prisma migrate dev --create-only --name init || {
  echo "❌ Failed to create migration. Trying alternative approach..."
  echo "Attempting to use db pull to introspect existing schema..."
  
  # Try to introspect the database and create migration from it
  npx prisma db pull --force || {
    echo "❌ Could not introspect database. Please ensure:"
    echo "   1. DATABASE_URL is set correctly"
    echo "   2. Database is accessible"
    echo "   3. You have proper permissions"
    exit 1
  }
  
  # Now create migration from the introspected schema
  npx prisma migrate dev --create-only --name init || {
    echo "❌ Could not create migration even after introspection."
    exit 1
  }
}

# Get the migration directory name (most recent one)
MIGRATION_DIR=$(ls -t prisma/migrations | grep -v "migration_lock.toml" | head -n 1)

if [ -z "$MIGRATION_DIR" ]; then
  echo "❌ Could not find migration directory. Migration creation may have failed."
  exit 1
fi

echo "✅ Created migration: $MIGRATION_DIR"

# Mark the migration as applied (baseline)
echo "Marking migration as applied (baseline)..."
npx prisma migrate resolve --applied "$MIGRATION_DIR" || {
  echo "⚠️  Could not mark migration as applied automatically."
  echo "   This might be because the migration was already applied or there's a connection issue."
  echo "   You can manually mark it as applied by running:"
  echo "   npx prisma migrate resolve --applied $MIGRATION_DIR"
  echo ""
  echo "   Or if the database already matches the schema, you can skip this step."
}

echo "Generating Prisma client..."
npx prisma generate

echo ""
echo "✅ Baseline migration complete!"
echo ""
echo "The database is now baselined. Future migrations will work normally."
echo "To verify, you can run: npx prisma migrate status"

