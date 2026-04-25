package auth

import (
	"context"
	"net/http"
	"strings"
)

// RequireAuth is middleware that validates the session token from the
// Authorization header (Bearer token) or the X-Session-Token header.
// On success it stores SessionData in the request context.
func RequireAuth(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractToken(r)
			if token == "" {
				http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
				return
			}

			sd, err := svc.ValidateToken(r.Context(), token)
			if err != nil {
				http.Error(w, `{"error":"unauthorized: `+err.Error()+`"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), SessionContextKey, sd)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAdmin extends RequireAuth by also verifying the user has role "admin".
func RequireAdmin(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			RequireAuth(svc)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				sd, ok := GetSessionFromContext(r.Context())
				if !ok || sd.User.Role != "admin" {
					http.Error(w, `{"error":"forbidden: admin required"}`, http.StatusForbidden)
					return
				}
				next.ServeHTTP(w, r)
			})).ServeHTTP(w, r)
		})
	}
}

// RequirePermission checks a specific permission on the authenticated user.
func RequirePermission(svc *Service, perm string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			RequireAuth(svc)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				sd, ok := GetSessionFromContext(r.Context())
				if !ok {
					http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
					return
				}

				// Admins bypass all permission checks
				if sd.User.Role == "admin" {
					next.ServeHTTP(w, r)
					return
				}

				allowed := false
				switch perm {
				case "can_add_to_queue":
					allowed = sd.Permissions.CanAddToQueue
				case "can_search":
					allowed = sd.Permissions.CanSearch
				case "can_use_party_button":
					allowed = sd.Permissions.CanUsePartyButton
				case "can_view_queue":
					allowed = sd.Permissions.CanViewQueue
				}

				if !allowed {
					http.Error(w, `{"error":"forbidden: missing permission `+perm+`"}`, http.StatusForbidden)
					return
				}

				next.ServeHTTP(w, r)
			})).ServeHTTP(w, r)
		})
	}
}

// extractToken pulls the Bearer token from the Authorization header or
// the X-Session-Token header. Also accepts ?token= query param for SSE.
func extractToken(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); auth != "" {
		if strings.HasPrefix(auth, "Bearer ") {
			return strings.TrimPrefix(auth, "Bearer ")
		}
	}
	if t := r.Header.Get("X-Session-Token"); t != "" {
		return t
	}
	// Query param for SSE (EventSource cannot set headers)
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	return ""
}
