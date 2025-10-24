#!/bin/bash

echo "🚀 Starting WebSocket POC with Docker Compose..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# Build and start all services
echo "📦 Building and starting services..."
docker-compose up --build

# When user presses Ctrl+C, clean up
trap "echo ''; echo '🛑 Stopping services...'; docker-compose down; exit 0" INT TERM

wait
