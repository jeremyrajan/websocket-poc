'use client';

import { useEffect, useState, useCallback, useRef, memo } from 'react';

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

interface Message {
  type: 'initial' | 'delta' | 'error';
  gameIds?: string[];
  data?: any;
}

interface BatchedDeltas {
  type: 'batch';
  deltas: GameDelta[];
}

// Memoized GameCard component - only re-renders when its game data changes
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
  // Custom comparison function - only re-render if game data actually changed
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

type ConnectionType = 'websocket' | 'polling' | 'disconnected';

export default function Home() {
  const [games, setGames] = useState<Record<string, GameState>>({});
  const [connectionType, setConnectionType] = useState<ConnectionType>('disconnected');
  const [subscribedGames, setSubscribedGames] = useState<Set<string>>(new Set(['game1', 'game2', 'game3']));
  const [updateCount, setUpdateCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<boolean>(false);
  const pollingTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const pollingFailuresRef = useRef(0);
  const clientIdRef = useRef<string>(`client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  // Apply delta - only update the specific game
  const applyDelta = useCallback((delta: GameDelta) => {
    setUpdateCount((prev) => prev + 1);
    
    setGames((prevGames) => {
      const game = prevGames[delta.id];
      if (!game) return prevGames;

      // Create new object only for the updated game
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

  // Long-polling loop
  const startPolling = useCallback(async () => {
    if (pollingRef.current) return;
    
    pollingRef.current = true;
    setConnectionType('polling');

    // Get initial state
    try {
      const gameIds = JSON.stringify(Array.from(subscribedGames));
      const response = await fetch(`http://localhost:8080/state?gameIds=${encodeURIComponent(gameIds)}`);
      const data = await response.json();
      
      if (data.type === 'initial') {
        const initialGames = data.data as GameState[];
        const gamesMap: Record<string, GameState> = {};
        initialGames.forEach((game) => {
          gamesMap[game.id] = game;
        });
        setGames(gamesMap);
      }
    } catch (error) {
      console.error('Error fetching initial state:', error);
    }

    // Start long-polling loop
    const poll = async () => {
      if (!pollingRef.current) return;

      try {
        // Long-polling: request waits on server until data available (up to 25s)
        const response = await fetch('http://localhost:8080/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientIdRef.current,
            gameIds: Array.from(subscribedGames),
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.type === 'batch' && data.deltas) {
            data.deltas.forEach((delta: GameDelta) => {
              applyDelta(delta);
            });
          }
          // Reset failures on success
          pollingFailuresRef.current = 0;
          
          // Immediately poll again (true long-polling pattern)
          if (pollingRef.current) {
            poll();
          }
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.error('Long-polling error:', error);
        pollingFailuresRef.current += 1;
        
        // Exponential backoff: 1s, 2s, 4s, 8s, up to 30s
        const delay = Math.min(1000 * Math.pow(2, pollingFailuresRef.current), 30000);
        console.log(`Long-polling failed, retrying in ${delay}ms (attempt ${pollingFailuresRef.current})`);
        
        // Continue polling with backoff
        if (pollingRef.current) {
          pollingTimeoutRef.current = setTimeout(poll, delay);
        }
      }
    };

    poll();
  }, [subscribedGames, applyDelta]);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    pollingFailuresRef.current = 0;
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Stop polling if active
    stopPolling();

    const ws = new WebSocket('ws://localhost:8080/ws');

    ws.onopen = () => {
      setConnectionType('websocket');
      reconnectAttemptsRef.current = 0;

      ws.send(JSON.stringify({
        type: 'subscribe',
        gameIds: Array.from(subscribedGames),
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'initial':
            const initialGames = data.data as GameState[];
            const gamesMap: Record<string, GameState> = {};
            initialGames.forEach((game) => {
              gamesMap[game.id] = game;
            });
            setGames(gamesMap);
            break;

          case 'batch':
            const batch = data as BatchedDeltas;
            if (batch.deltas && Array.isArray(batch.deltas)) {
              batch.deltas.forEach((delta) => {
                applyDelta(delta);
              });
            }
            break;

          case 'delta':
            const delta = data.data as GameDelta;
            applyDelta(delta);
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onerror = () => {
      setConnectionType('disconnected');
    };

    ws.onclose = () => {
      setConnectionType('disconnected');
      wsRef.current = null;

      reconnectAttemptsRef.current += 1;

      // After 3 failed WebSocket attempts, fallback to polling
      if (reconnectAttemptsRef.current >= 3) {
        console.log('WebSocket failed multiple times, falling back to long-polling');
        startPolling();
      } else {
        // Try reconnecting with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 5000);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    wsRef.current = ws;
  }, [subscribedGames, applyDelta, stopPolling, startPolling]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      stopPolling();
    };
  }, [connect, stopPolling]);


  const handleSubscribe = (gameId: string) => {
    setSubscribedGames((prev) => {
      const newSet = new Set(prev);
      newSet.add(gameId);
      return newSet;
    });

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        gameIds: [gameId],
      }));
    }
  };

  const handleUnsubscribe = useCallback((gameId: string) => {
    setSubscribedGames((prev) => {
      const newSet = new Set(prev);
      newSet.delete(gameId);
      return newSet;
    });

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'unsubscribe',
        gameIds: [gameId],
      }));
    }

    setGames((prev) => {
      const newGames = { ...prev };
      delete newGames[gameId];
      return newGames;
    });
  }, []);

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">Live Game Odds</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                connectionType === 'websocket' ? 'bg-green-500' : 
                connectionType === 'polling' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              <span className="text-sm text-gray-600">
                {connectionType === 'websocket' && 'WebSocket Connected'}
                {connectionType === 'polling' && 'Long-Polling'}
                {connectionType === 'disconnected' && 'Disconnected'}
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
            No games subscribed. Subscribe to games to see live odds.
          </div>
        )}
      </div>
    </main>
  );
}
