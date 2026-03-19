#!/bin/bash
set -e

echo "=== Insurance Platform - Hostinger VPS Deployment ==="

# Detect docker compose command
if docker compose version > /dev/null 2>&1; then
  DC="docker compose"
elif docker-compose --version > /dev/null 2>&1; then
  DC="docker-compose"
else
  echo "Docker Compose not found. Installing..."
  apt-get update && apt-get install -y docker-compose-plugin
  DC="docker compose"
fi

echo "Using: $DC"

# Check if .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in your values:"
  echo "  cp .env.example .env"
  echo "  nano .env"
  exit 1
fi

# Load .env for validation
source .env

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set in .env"
  exit 1
fi

if [ -z "$NEXTAUTH_SECRET" ]; then
  echo "ERROR: NEXTAUTH_SECRET is not set in .env"
  exit 1
fi

echo "1/3 - Building Docker images..."
$DC build

echo "2/3 - Starting services..."
$DC up -d

echo "3/3 - Waiting for services to be ready..."
sleep 10

echo ""
echo "=== Deployment complete! ==="
echo "App is running at: ${NEXTAUTH_URL:-http://localhost:3000}"
echo ""
echo "Check logs with: $DC logs -f app"
echo ""
echo "Useful commands:"
echo "  $DC logs -f app       # View app logs"
echo "  $DC restart app       # Restart the app"
echo "  $DC down              # Stop everything"
echo "  $DC up -d --build     # Rebuild and restart"
