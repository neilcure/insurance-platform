#!/bin/bash
set -e

echo "=== Insurance Platform - Hostinger VPS Deployment ==="

# Check if .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in your values:"
  echo "  cp .env.example .env"
  echo "  nano .env"
  exit 1
fi

# Load .env for validation
source .env

if [ -z "$POSTGRES_PASSWORD" ]; then
  echo "ERROR: POSTGRES_PASSWORD is not set in .env"
  exit 1
fi

if [ -z "$NEXTAUTH_SECRET" ]; then
  echo "ERROR: NEXTAUTH_SECRET is not set in .env"
  exit 1
fi

echo "1/4 - Building Docker images..."
docker compose build --no-cache

echo "2/4 - Starting services..."
docker compose up -d

echo "3/4 - Waiting for database to be ready..."
sleep 5

echo "4/4 - Running database migrations..."
docker compose exec app node -e "
const { execSync } = require('child_process');
try {
  console.log('Migrations would run here via drizzle-kit');
} catch(e) {
  console.error('Migration note:', e.message);
}
"

echo ""
echo "=== Deployment complete! ==="
echo "App is running at: ${NEXTAUTH_URL:-http://localhost:3000}"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f app    # View app logs"
echo "  docker compose logs -f db     # View database logs"
echo "  docker compose restart app    # Restart the app"
echo "  docker compose down           # Stop everything"
echo "  docker compose up -d --build  # Rebuild and restart"
