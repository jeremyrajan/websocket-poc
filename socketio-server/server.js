const { Server } = require('socket.io');
const { createClient } = require('redis');

const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Socket.IO server
const io = new Server(PORT, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'], // WebSocket with polling fallback
});

// Create Redis subscriber client for pub/sub
const subscriber = createClient({ url: REDIS_URL });

// Create Redis client for state management (GET/SET with TTL)
const redisClient = createClient({ url: REDIS_URL });

subscriber.on('error', (err) => console.error('Redis Subscriber Error:', err));
subscriber.on('connect', () => console.log('Redis subscriber connected'));

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis client connected'));

// Track active subscriptions per socket
const socketSubscriptions = new Map();

// Statistics
let stats = {
  connectedClients: 0,
  messagesReceived: 0,
  messagesBroadcast: 0,
};

// Function to calculate delta between states
function calculateDelta(fullState, previousState) {
  if (!previousState) {
    // First update - return full state
    return fullState;
  }
  
  // Calculate delta by comparing fields
  const delta = {
    id: fullState.id,
    lastUpdated: fullState.lastUpdated,
  };
  
  // Only include fields that changed
  if (fullState.homeOdds !== previousState.homeOdds) {
    delta.homeOdds = fullState.homeOdds;
  }
  if (fullState.awayOdds !== previousState.awayOdds) {
    delta.awayOdds = fullState.awayOdds;
  }
  if (fullState.drawOdds !== previousState.drawOdds) {
    delta.drawOdds = fullState.drawOdds;
  }
  if (fullState.homeScore !== previousState.homeScore) {
    delta.homeScore = fullState.homeScore;
  }
  if (fullState.awayScore !== previousState.awayScore) {
    delta.awayScore = fullState.awayScore;
  }
  
  return delta;
}

// Connect both Redis clients
Promise.all([subscriber.connect(), redisClient.connect()]).then(() => {
  console.log('✅ Both Redis clients ready');
  
  // Subscribe to all game channels (game1, game2, game3)
  const gameChannels = ['game1', 'game2', 'game3'];
  
  gameChannels.forEach((channel) => {
    subscriber.subscribe(channel, async (message) => {
      try {
        const fullGameState = JSON.parse(message);
        stats.messagesReceived++;
        
        // Get previous state from Redis
        const stateKey = `game:state:${channel}`;
        const previousStateJson = await redisClient.get(stateKey);
        const previousState = previousStateJson ? JSON.parse(previousStateJson) : null;
        
        // Calculate delta
        const delta = calculateDelta(fullGameState, previousState);
        
        // Store new state in Redis with 60s TTL
        await redisClient.setEx(stateKey, 60, JSON.stringify(fullGameState));
        
        // Broadcast delta to all clients subscribed to this game
        io.to(channel).emit('delta', delta);
        stats.messagesBroadcast++;
      } catch (error) {
        console.error('Error processing Redis message:', error);
      }
    });
  });
  
  console.log(`✅ Subscribed to Redis channels: ${gameChannels.join(', ')}`);
  console.log('✅ Redis state management enabled with 60s TTL');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  stats.connectedClients++;
  console.log(`Client connected: ${socket.id} (Total: ${stats.connectedClients})`);
  
  // Initialize subscriptions for this socket
  socketSubscriptions.set(socket.id, new Set());
  
  // Handle subscribe requests
  socket.on('subscribe', (gameIds) => {
    if (!Array.isArray(gameIds)) {
      socket.emit('error', { message: 'gameIds must be an array' });
      return;
    }
    
    const subscriptions = socketSubscriptions.get(socket.id);
    
    gameIds.forEach((gameId) => {
      socket.join(gameId);
      subscriptions.add(gameId);
    });
    
    console.log(`Client ${socket.id} subscribed to: ${gameIds.join(', ')}`);
    
    // Send initial state
    socket.emit('subscribed', { gameIds });
  });
  
  // Handle unsubscribe requests
  socket.on('unsubscribe', (gameIds) => {
    if (!Array.isArray(gameIds)) {
      socket.emit('error', { message: 'gameIds must be an array' });
      return;
    }
    
    const subscriptions = socketSubscriptions.get(socket.id);
    
    gameIds.forEach((gameId) => {
      socket.leave(gameId);
      subscriptions.delete(gameId);
    });
    
    console.log(`Client ${socket.id} unsubscribed from: ${gameIds.join(', ')}`);
  });
  
  // Handle get initial state request
  socket.on('getInitialState', async (gameIds, callback) => {
    try {
      // In production, fetch from database or cache
      // For now, return mock data
      const initialStates = gameIds.map((gameId) => ({
        id: gameId,
        homeTeam: gameId === 'game1' ? 'Arsenal' : gameId === 'game2' ? 'Liverpool' : 'Barcelona',
        awayTeam: gameId === 'game1' ? 'Chelsea' : gameId === 'game2' ? 'Man United' : 'Real Madrid',
        homeScore: Math.floor(Math.random() * 3),
        awayScore: Math.floor(Math.random() * 3),
        homeOdds: 2.5,
        awayOdds: 2.8,
        drawOdds: 3.2,
        lastUpdated: Date.now(),
      }));
      
      callback({ success: true, data: initialStates });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', (reason) => {
    stats.connectedClients--;
    socketSubscriptions.delete(socket.id);
    console.log(`Client disconnected: ${socket.id} (Reason: ${reason}, Total: ${stats.connectedClients})`);
  });
});

// Stats endpoint
setInterval(() => {
  console.log(`[STATS] Clients: ${stats.connectedClients} | Msgs Received: ${stats.messagesReceived} | Msgs Broadcast: ${stats.messagesBroadcast}`);
}, 10000);

console.log(`Socket.IO server listening on port ${PORT}`);
console.log(`Waiting for Redis connection...`);
