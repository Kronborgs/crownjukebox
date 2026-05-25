package auth

import (
	"sync"
	"time"
)

const (
	loginMaxAttempts = 10 // requests in window before lockout
	loginWindow      = 10 * time.Minute
	loginLockout     = 15 * time.Minute
	// Hard cap on how many unique IPs the map may hold before new entries are
	// silently rejected. This prevents unbounded memory growth under a scan/probe.
	loginMaxEntries = 10_000
)

// LoginRateLimiter is a simple in-memory per-IP rate limiter for login endpoints.
// It tracks the number of attempts in a sliding window and locks out IPs that
// exceed the limit. Memory is pruned automatically in the background.
type LoginRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rlEntry
	stop    chan struct{}
}

type rlEntry struct {
	attempts    int
	windowStart time.Time
	lockedUntil time.Time
}

func NewLoginRateLimiter() *LoginRateLimiter {
	rl := &LoginRateLimiter{
		entries: make(map[string]*rlEntry),
		stop:    make(chan struct{}),
	}
	go rl.periodicCleanup()
	return rl
}

// Stop shuts down the background cleanup goroutine.
func (rl *LoginRateLimiter) Stop() {
	close(rl.stop)
}

// Check returns (true, 0) if the request is allowed, or (false, retryAfter) if
// the IP is rate-limited. Every call counts as one attempt.
func (rl *LoginRateLimiter) Check(ip string) (allowed bool, retryAfter time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.entries[ip]
	if !ok {
		// Drop the request rather than grow the map beyond the hard cap.
		if len(rl.entries) >= loginMaxEntries {
			return false, loginLockout
		}
		rl.entries[ip] = &rlEntry{attempts: 1, windowStart: now}
		return true, 0
	}

	// Still locked out from a previous burst.
	if !e.lockedUntil.IsZero() && now.Before(e.lockedUntil) {
		return false, e.lockedUntil.Sub(now)
	}

	// Window expired — start fresh.
	if now.After(e.windowStart.Add(loginWindow)) {
		e.attempts = 1
		e.windowStart = now
		e.lockedUntil = time.Time{}
		return true, 0
	}

	e.attempts++
	if e.attempts > loginMaxAttempts {
		e.lockedUntil = now.Add(loginLockout)
		return false, loginLockout
	}
	return true, 0
}

func (rl *LoginRateLimiter) periodicCleanup() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-rl.stop:
			return
		case <-ticker.C:
			rl.mu.Lock()
			now := time.Now()
			for ip, e := range rl.entries {
				expired := now.After(e.windowStart.Add(loginWindow))
				unlocked := e.lockedUntil.IsZero() || now.After(e.lockedUntil)
				if expired && unlocked {
					delete(rl.entries, ip)
				}
			}
			rl.mu.Unlock()
		}
	}
}
