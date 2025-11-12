#!/bin/bash

echo "🌐 Setting up ngrok tunnel for external access..."
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok not found. Please install it:"
    echo ""
    echo "   macOS: brew install ngrok/ngrok/ngrok"
    echo "   Or download from: https://ngrok.com/download"
    echo ""
    echo "   After installing, sign up at https://ngrok.com and run:"
    echo "   ngrok config add-authtoken YOUR_TOKEN"
    exit 1
fi

echo "🚀 Starting ngrok tunnel on port 80..."
echo ""
echo "⚠️  ngrok will open in a new window. Check the terminal for the public URL."
echo ""
echo "Press Ctrl+C to stop tunnel"
echo ""

# Start ngrok
ngrok http 80
