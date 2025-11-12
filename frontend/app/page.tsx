'use client';

import { useEffect, useState, useCallback, memo } from 'react';
import { io, Socket } from 'socket.io-client';

interface GameState {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeOdds: number;
  awayOdds: number;
  drawOdds: number;
  lastUpdated: number;
}

interface GameDelta {
  id: string;
  homeOdds?: number;
  awayOdds?: number;
  drawOdds?: number;
  homeScore?: number;
  awayScore?: number;
  lastUpdated: number;
}

// Memoized GameCard component
const GameCard = memo(({ game, onUnsubscribe }: { game: GameState; onUnsubscribe: (id: string) => void }) => {
  return (
    <div className="bg-white rounded-lg shadow p-6 transition-all hover:shadow-lg">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-semibold">
            {game.homeTeam} vs {game.awayTeam}
          </h2>
          <p className="text-sm text-gray-500">
            Score: {game.homeScore} - {game.awayScore}
          </p>
        </div>
        <button
          onClick={() => onUnsubscribe(game.id)}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Unsubscribe
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded p-3">
          <p className="text-xs text-gray-600 mb-1">Home Win</p>
          <p className="text-2xl font-bold text-blue-600">
            {game.homeOdds.toFixed(2)}
          </p>
        </div>
        <div className="bg-gray-50 rounded p-3">
          <p className="text-xs text-gray-600 mb-1">Draw</p>
          <p className="text-2xl font-bold text-gray-600">
            {game.drawOdds.toFixed(2)}
          </p>
        </div>
        <div className="bg-red-50 rounded p-3">
          <p className="text-xs text-gray-600 mb-1">Away Win</p>
          <p className="text-2xl font-bold text-red-600">
            {game.awayOdds.toFixed(2)}
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Last updated: {new Date(game.lastUpdated).toLocaleTimeString()}
      </p>
    </div>
  );
}, (prevProps, nextProps) => {
  const prev = prevProps.game;
  const next = nextProps.game;
  
  return (
    prev.homeOdds === next.homeOdds &&
    prev.awayOdds === next.awayOdds &&
    prev.drawOdds === next.drawOdds &&
    prev.homeScore === next.homeScore &&
    prev.awayScore === next.awayScore &&
    prev.lastUpdated === next.lastUpdated
  );
});

GameCard.displayName = 'GameCard';

export default function Home() {
  const [games, setGames] = useState<Record<string, GameState>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [transport, setTransport] = useState('disconnected');
  const [subscribedGames] = useState<string[]>(['game1', 'game2', 'game3']);
  const [updateCount, setUpdateCount] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Apply delta immediately
  const applyDelta = useCallback((delta: GameDelta) => {
    setUpdateCount((prev) => prev + 1);
    
    setGames((prevGames) => {
      const game = prevGames[delta.id];
      if (!game) return prevGames;

      return {
        ...prevGames,
        [delta.id]: {
          ...game,
          homeOdds: delta.homeOdds ?? game.homeOdds,
          awayOdds: delta.awayOdds ?? game.awayOdds,
          drawOdds: delta.drawOdds ?? game.drawOdds,
          homeScore: delta.homeScore ?? game.homeScore,
          awayScore: delta.awayScore ?? game.awayScore,
          lastUpdated: delta.lastUpdated,
        },
      };
    });
  }, []);

  useEffect(() => {
    // Connect to Socket.IO server via nginx proxy
    const socketInstance = io('/', {
      path: '/socket/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    setSocket(socketInstance);

    // Connection events
    socketInstance.on('connect', () => {
      setIsConnected(true);
      setTransport(socketInstance.io.engine.transport.name);
      
      // Subscribe to games
      socketInstance.emit('subscribe', subscribedGames);
      
      // Get initial state
      socketInstance.emit('getInitialState', subscribedGames, (response: any) => {
        if (response.success) {
          const gamesMap: Record<string, GameState> = {};
          response.data.forEach((game: GameState) => {
            gamesMap[game.id] = game;
          });
          setGames(gamesMap);
        }
      });
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
      setTransport('disconnected');
    });

    // Track transport changes
    socketInstance.io.engine.on('upgrade', (transport: any) => {
      setTransport(transport.name);
    });

    // Listen for deltas
    socketInstance.on('delta', (delta: GameDelta) => {
      applyDelta(delta);
    });

    socketInstance.on('error', (error: any) => {
      console.error('Socket.IO error:', error);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [subscribedGames, applyDelta]);

  const handleUnsubscribe = useCallback((gameId: string) => {
    if (socket) {
      socket.emit('unsubscribe', [gameId]);
    }

    setGames((prev) => {
      const newGames = { ...prev };
      delete newGames[gameId];
      return newGames;
    });
  }, [socket]);

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">Live Game Odds (Socket.IO)</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-600">
                {isConnected ? `Connected (${transport})` : 'Disconnected'}
              </span>
            </div>
            <div className="text-sm text-gray-600">
              Updates: {updateCount}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {Object.values(games).map((game) => (
            <GameCard
              key={game.id}
              game={game}
              onUnsubscribe={handleUnsubscribe}
            />
          ))}
        </div>

        {Object.keys(games).length === 0 && (
          <div className="text-center text-gray-500 py-12">
            Connecting to Socket.IO server...
          </div>
        )}
      </div>
    </main>
  );
}
