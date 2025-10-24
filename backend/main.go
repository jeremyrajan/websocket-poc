package main

import (
	"context"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

type GameState struct {
	ID          string  `json:"id"`
	HomeTeam    string  `json:"homeTeam"`
	AwayTeam    string  `json:"awayTeam"`
	HomeScore   int     `json:"homeScore"`
	AwayScore   int     `json:"awayScore"`
	HomeOdds    float64 `json:"homeOdds"`
	AwayOdds    float64 `json:"awayOdds"`
	DrawOdds    float64 `json:"drawOdds"`
	LastUpdated int64   `json:"lastUpdated"`
}

// Backend now publishes full game state, Socket.IO server calculates deltas

type Metrics struct {
	deltasPublished int64
	publishErrors   int64
}

var (
	games   map[string]*GameState
	metrics Metrics
	ctx     = context.Background()
)

func initializeGames() {
	games = map[string]*GameState{
		"game1": {ID: "game1", HomeTeam: "Arsenal", AwayTeam: "Chelsea", HomeScore: 1, AwayScore: 1, HomeOdds: 2.5, AwayOdds: 2.8, DrawOdds: 3.2},
		"game2": {ID: "game2", HomeTeam: "Liverpool", AwayTeam: "Man United", HomeScore: 2, AwayScore: 0, HomeOdds: 1.8, AwayOdds: 4.2, DrawOdds: 3.5},
		"game3": {ID: "game3", HomeTeam: "Barcelona", AwayTeam: "Real Madrid", HomeScore: 0, AwayScore: 0, HomeOdds: 2.1, AwayOdds: 3.3, DrawOdds: 3.0},
	}

	for _, game := range games {
		game.LastUpdated = time.Now().UnixMilli()
	}
}

func publishOddsUpdates(rdb *redis.Client) {
	// High frequency updates (200ms)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	log.Println("Starting to publish game updates to Redis...")

	for range ticker.C {
		for gameID, game := range games {
			// 90% chance of update per game
			if rand.Float64() < 0.9 {
				// Update odds randomly
				if rand.Float64() < 0.6 {
					newOdds := game.HomeOdds + (rand.Float64()-0.5)*0.6
					if newOdds > 1.01 {
						game.HomeOdds = newOdds
					}
				}
				if rand.Float64() < 0.6 {
					newOdds := game.AwayOdds + (rand.Float64()-0.5)*0.6
					if newOdds > 1.01 {
						game.AwayOdds = newOdds
					}
				}
				if rand.Float64() < 0.6 {
					newOdds := game.DrawOdds + (rand.Float64()-0.5)*0.6
					if newOdds > 1.01 {
						game.DrawOdds = newOdds
					}
				}

				game.LastUpdated = time.Now().UnixMilli()

				// Publish full game state (Socket.IO server will calculate deltas)
				data, err := json.Marshal(game)
				if err != nil {
					atomic.AddInt64(&metrics.publishErrors, 1)
					log.Printf("Error marshaling game state: %v", err)
					continue
				}

				// Publish to Redis channel (named after the game)
				if err := rdb.Publish(ctx, gameID, data).Err(); err != nil {
					atomic.AddInt64(&metrics.publishErrors, 1)
					log.Printf("Error publishing to Redis: %v", err)
				} else {
					atomic.AddInt64(&metrics.deltasPublished, 1)
				}
			}
		}
	}
}

func printMetrics() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		published := atomic.LoadInt64(&metrics.deltasPublished)
		errors := atomic.LoadInt64(&metrics.publishErrors)
		log.Printf("[METRICS] Deltas Published: %d | Errors: %d", published, errors)
	}
}

func publishInitialDummyData(rdb *redis.Client) {
	log.Println("Publishing initial dummy data...")
	
	// Publish 10 updates immediately so frontend sees data right away
	for i := 0; i < 10; i++ {
		for gameID, game := range games {
			// Make some visible changes
			game.HomeOdds = game.HomeOdds + float64(i)*0.1
			game.AwayOdds = game.AwayOdds + float64(i)*0.1
			game.DrawOdds = game.DrawOdds + float64(i)*0.1
			game.LastUpdated = time.Now().UnixMilli()

			// Publish full game state
			data, _ := json.Marshal(game)
			if err := rdb.Publish(ctx, gameID, data).Err(); err != nil {
				log.Printf("Error publishing dummy data: %v", err)
			} else {
				log.Printf("Published dummy update #%d for %s", i+1, gameID)
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	
	log.Println("✅ Dummy data published successfully!")
}

func main() {
	// Connect to Redis
	redisAddr := "localhost:6379"
	if addr := os.Getenv("REDIS_URL"); addr != "" {
		redisAddr = addr
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: "", // no password
		DB:       0,  // default DB
	})

	// Test connection
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatal("Failed to connect to Redis:", err)
	}
	log.Println("✅ Connected to Redis at", redisAddr)

	// Initialize games
	initializeGames()
	log.Printf("✅ Initialized %d games", len(games))

	// Publish dummy data immediately
	publishInitialDummyData(rdb)

	// Start background jobs
	go publishOddsUpdates(rdb)
	go printMetrics()

	// HTTP health endpoint
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":           "healthy",
			"deltasPublished":  atomic.LoadInt64(&metrics.deltasPublished),
			"publishErrors":    atomic.LoadInt64(&metrics.publishErrors),
			"gamesCount":       len(games),
		})
	})

	// HTTP metrics endpoint
	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"deltasPublished": atomic.LoadInt64(&metrics.deltasPublished),
			"publishErrors":   atomic.LoadInt64(&metrics.publishErrors),
		})
	})

	port := ":8080"
	log.Printf("HTTP server listening on %s", port)
	log.Println("Publishing odds updates to Redis channels: game1, game2, game3")

	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatal("HTTP server error:", err)
	}
}
