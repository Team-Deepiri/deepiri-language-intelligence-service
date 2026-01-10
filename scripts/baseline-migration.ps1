# Baseline migration script for language-intelligence-service (PowerShell)
# This creates an initial migration and marks it as applied without running it

Write-Host "📊 Creating baseline migration for language-intelligence-service..." -ForegroundColor Cyan

# Navigate to the service directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceDir = Join-Path $scriptPath ".."
Set-Location $serviceDir

# Check if migrations directory exists, create if not
if (-not (Test-Path "prisma/migrations")) {
    Write-Host "Creating migrations directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "prisma/migrations" -Force | Out-Null
}

# Check if there are any existing migrations
$existingMigrations = Get-ChildItem "prisma/migrations" -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "migration_lock.toml" }
if ($existingMigrations) {
    Write-Host "⚠️  Migrations directory is not empty. Existing migrations found:" -ForegroundColor Yellow
    $existingMigrations | ForEach-Object { Write-Host "  - $($_.Name)" }
    $response = Read-Host "Do you want to continue and create a baseline anyway? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Creating initial migration (without applying it)..." -ForegroundColor Yellow
$createResult = & npx prisma migrate dev --create-only --name init 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to create migration. Trying alternative approach..." -ForegroundColor Red
    Write-Host "Attempting to use db pull to introspect existing schema..." -ForegroundColor Yellow
    
    # Try to introspect the database and create migration from it
    & npx prisma db pull --force 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Could not introspect database. Please ensure:" -ForegroundColor Red
        Write-Host "   1. DATABASE_URL is set correctly" -ForegroundColor Yellow
        Write-Host "   2. Database is accessible" -ForegroundColor Yellow
        Write-Host "   3. You have proper permissions" -ForegroundColor Yellow
        exit 1
    }
    
    # Now create migration from the introspected schema
    & npx prisma migrate dev --create-only --name init 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Could not create migration even after introspection." -ForegroundColor Red
        exit 1
    }
}

# Get the migration directory name (most recent one)
$migrationDirs = Get-ChildItem "prisma/migrations" -Directory | Where-Object { $_.Name -ne "migration_lock.toml" } | Sort-Object LastWriteTime -Descending
$migrationDir = $migrationDirs | Select-Object -First 1

if (-not $migrationDir) {
    Write-Host "❌ Could not find migration directory. Migration creation may have failed." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Created migration: $($migrationDir.Name)" -ForegroundColor Green

# Mark the migration as applied (baseline)
Write-Host "Marking migration as applied (baseline)..." -ForegroundColor Yellow
& npx prisma migrate resolve --applied $migrationDir.Name 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Could not mark migration as applied automatically." -ForegroundColor Yellow
    Write-Host "   This might be because the migration was already applied or there's a connection issue." -ForegroundColor Yellow
    Write-Host "   You can manually mark it as applied by running:" -ForegroundColor Yellow
    Write-Host "   npx prisma migrate resolve --applied $($migrationDir.Name)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   Or if the database already matches the schema, you can skip this step." -ForegroundColor Yellow
} else {
    Write-Host "✅ Migration marked as applied" -ForegroundColor Green
}

Write-Host "Generating Prisma client..." -ForegroundColor Yellow
& npx prisma generate 2>&1 | Out-Null

Write-Host ""
Write-Host "✅ Baseline migration complete!" -ForegroundColor Green
Write-Host ""
Write-Host "The database is now baselined. Future migrations will work normally." -ForegroundColor Cyan
Write-Host "To verify, you can run: npx prisma migrate status" -ForegroundColor Cyan

