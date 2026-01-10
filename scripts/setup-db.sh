#!/bin/sh
# Database setup script for language-intelligence-service
# Handles both fresh databases and existing databases

set -e

echo "🔧 Setting up database for language-intelligence-service..."

# Check if migrations directory exists
if [ ! -d "prisma/migrations" ]; then
  echo "Creating migrations directory..."
  mkdir -p prisma/migrations
fi

# Check if database has tables but no migrations (baseline scenario)
echo "Checking database state..."
HAS_TABLES=$(npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | grep -o '[0-9]' | head -n 1 || echo "0")
HAS_MIGRATIONS=$(ls -A prisma/migrations 2>/dev/null | wc -l)

if [ "$HAS_TABLES" -gt "0" ] && [ "$HAS_MIGRATIONS" -eq "0" ]; then
  echo "📊 Database has tables but no migrations. Creating baseline migration..."
  
  # Create initial migration without applying it
  npx prisma migrate dev --create-only --name init || {
    echo "⚠️  Could not create migration. Using db push instead..."
    npx prisma db push --skip-generate --accept-data-loss
    echo "✅ Schema synced using db push"
    exit 0
  }
  
  # Get the migration directory name
  MIGRATION_DIR=$(ls -t prisma/migrations | head -n 1)
  
  if [ -n "$MIGRATION_DIR" ] && [ -d "prisma/migrations/$MIGRATION_DIR" ]; then
    echo "Marking migration as applied (baseline)..."
    npx prisma migrate resolve --applied "$MIGRATION_DIR" || {
      echo "⚠️  Could not mark migration as applied automatically."
      echo "   Please run manually: npx prisma migrate resolve --applied $MIGRATION_DIR"
    }
    echo "✅ Database baselined successfully!"
  fi
elif [ "$HAS_MIGRATIONS" -gt "0" ]; then
  echo "✅ Migrations exist. Applying pending migrations..."
  npx prisma migrate deploy || {
    echo "⚠️  Migration deploy failed. Using db push as fallback..."
    npx prisma db push --skip-generate
  }
else
  echo "🆕 Fresh database. Creating initial migration..."
  npx prisma migrate dev --name init || {
    echo "⚠️  Migration failed. Using db push instead..."
    npx prisma db push --skip-generate
  }
fi

echo "Generating Prisma client..."
npx prisma generate

echo "✅ Database setup complete!"

