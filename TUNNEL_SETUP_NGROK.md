# ngrok Tunnel Setup

## Why ngrok?

ngrok supports **WebSocket** natively (unlike LocalTunnel), making it perfect for Socket.IO connections.

## Setup

1. **Install ngrok**:
   ```bash
   brew install ngrok/ngrok/ngrok
   ```

2. **Sign up** at [ngrok.com](https://ngrok.com) (free tier is fine)

3. **Add your authtoken**:
   ```bash
   ngrok config add-authtoken YOUR_TOKEN
   ```

## Usage

1. **Start your services**:
   ```bash
   docker-compose up
   ```

2. **In a new terminal, start ngrok**:
   ```bash
   ./tunnel.sh
   ```

3. **Copy the ngrok URL** from the terminal output (e.g., `https://abc123.ngrok.io`)

4. **Access from any device**:
   - Frontend: `https://YOUR_URL.ngrok.io/`
   - Socket.IO: Auto-proxied at `/socket`
   - API: Auto-proxied at `/api`
   - Opera Mini: `https://YOUR_URL.ngrok.io/opera-mini`

## Benefits

- ✅ Full WebSocket support
- ✅ HTTPS by default
- ✅ Stable connections
- ✅ Web UI for inspecting traffic (http://localhost:4040)
- ✅ Works with Opera Mini (will use polling fallback)

## Free Tier Limits

- 1 online ngrok process
- 40 connections/minute
- Random URLs (or 1 custom domain on paid plan)

Perfect for demos and testing!
