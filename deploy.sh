#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== Insurance Platform - Deploy ==="

if [ ! -f .env ]; then
  echo "ERROR: .env file not found."
  exit 1
fi

echo "1/4 - Pulling latest code (always deploy from main)..."
git fetch origin
git checkout main
git pull --ff-only origin main

echo "2/4 - Stopping old container..."
docker rm -f insurance-platform-app-1 2>/dev/null || true

echo "3/4 - Building and starting..."
docker compose up -d --build

echo "4/4 - Checking logs..."
sleep 5
docker compose logs --tail 20 app

echo ""
echo "=== Deploy complete! ==="
echo ""
echo "Commands:"
echo "  docker compose logs -f app    # Live logs"
echo "  docker compose restart app    # Restart"
echo "  docker compose down           # Stop"
