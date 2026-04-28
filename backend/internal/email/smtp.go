package email

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

// Config holds SMTP configuration loaded from the settings table.
type Config struct {
	Enabled  bool
	Host     string
	Port     int
	Username string
	Password string
	From     string
	FromName string
}

// Service sends transactional emails via SMTP.
type Service struct {
	db *sqlx.DB
}

func NewService(database *sqlx.DB) *Service {
	return &Service{db: database}
}

// LoadConfig reads SMTP settings from the database.
func (s *Service) LoadConfig(ctx context.Context) (*Config, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT key, value FROM settings
		WHERE key IN ('smtp_enabled','smtp_host','smtp_port','smtp_username','smtp_password','smtp_from','smtp_from_name')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cfg := &Config{Port: 587, FromName: "CrownJukebox"}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		switch key {
		case "smtp_enabled":
			cfg.Enabled = value == "1"
		case "smtp_host":
			cfg.Host = value
		case "smtp_port":
			if p, err := strconv.Atoi(value); err == nil {
				cfg.Port = p
			}
		case "smtp_username":
			cfg.Username = value
		case "smtp_password":
			cfg.Password = value
		case "smtp_from":
			cfg.From = value
		case "smtp_from_name":
			cfg.FromName = value
		}
	}
	return cfg, rows.Err()
}

// SendInvitation sends a party invitation email with an access link.
func (s *Service) SendInvitation(ctx context.Context, toEmail, toName, accessURL string, expiresAt *time.Time) error {
	cfg, err := s.LoadConfig(ctx)
	if err != nil {
		return fmt.Errorf("load smtp config: %w", err)
	}
	if !cfg.Enabled || cfg.Host == "" || cfg.From == "" {
		return fmt.Errorf("SMTP ikke konfigureret — gå til Admin → Indstillinger → E-mail")
	}

	expiry := "uden udløb"
	if expiresAt != nil {
		expiry = "udløber " + expiresAt.Format("02. jan 2006 kl. 15:04")
	}

	subject := "Du er inviteret til CrownJukebox 🎶"
	body := buildInviteEmail(toName, accessURL, expiry, cfg.FromName)

	return s.send(cfg, toEmail, subject, body)
}

// TestConnection verifies the SMTP settings are working.
func (s *Service) TestConnection(ctx context.Context) error {
	cfg, err := s.LoadConfig(ctx)
	if err != nil {
		return err
	}
	if cfg.Host == "" {
		return fmt.Errorf("SMTP host ikke konfigureret")
	}
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", cfg.Host, cfg.Port), 5*time.Second)
	if err != nil {
		return fmt.Errorf("kunne ikke forbinde til %s:%d: %w", cfg.Host, cfg.Port, err)
	}
	conn.Close()
	return nil
}

// SendTest sends a test email to verify the full SMTP configuration.
func (s *Service) SendTest(ctx context.Context, toEmail string) error {
	cfg, err := s.LoadConfig(ctx)
	if err != nil {
		return fmt.Errorf("load smtp config: %w", err)
	}
	if !cfg.Enabled || cfg.Host == "" || cfg.From == "" {
		return fmt.Errorf("SMTP ikke konfigureret — udfyld og gem indstillingerne først")
	}

	subject := "CrownJukebox — SMTP test ✅"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html lang="da"><head><meta charset="UTF-8"></head>
<body style="background:#0d0520;color:#e0d4ff;font-family:sans-serif;padding:32px;">
  <div style="max-width:480px;margin:0 auto;background:#1a0a30;border-radius:12px;padding:32px;border:1px solid rgba(191,0,255,0.3)">
    <div style="text-align:center;font-size:2.5rem;margin-bottom:8px;">♛</div>
    <h1 style="text-align:center;font-size:1.2rem;letter-spacing:3px;text-transform:uppercase;color:#f0e6ff;">CrownJukebox</h1>
    <p style="text-align:center;color:#22d3a0;font-size:1.1rem;margin:24px 0;">✅ SMTP fungerer korrekt!</p>
    <p style="color:#8b6faa;font-size:0.9rem;text-align:center;">
      Denne testmail blev sendt fra <strong>%s</strong><br>via <strong>%s:%d</strong>
    </p>
  </div>
</body></html>`, cfg.From, cfg.Host, cfg.Port)

	return s.send(cfg, toEmail, subject, body)
}

func (s *Service) send(cfg *Config, to, subject, htmlBody string) error {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	msg := buildMIME(cfg.From, cfg.FromName, to, subject, htmlBody)

	// Port 465 → implicit TLS; port 587 → STARTTLS
	if cfg.Port == 465 {
		tlsCfg := &tls.Config{ServerName: cfg.Host}
		conn, err := tls.Dial("tcp", addr, tlsCfg)
		if err != nil {
			return fmt.Errorf("tls dial: %w", err)
		}
		defer conn.Close()

		client, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			return fmt.Errorf("smtp client: %w", err)
		}
		defer client.Close()

		if err := client.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
		if err := client.Mail(cfg.From); err != nil {
			return err
		}
		if err := client.Rcpt(to); err != nil {
			return err
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(msg))
		w.Close()
		return err
	}

	// STARTTLS (port 587 / 25)
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	return smtp.SendMail(addr, auth, cfg.From, []string{to}, []byte(msg))
}

func buildMIME(from, fromName, to, subject, htmlBody string) string {
	var sb strings.Builder
	sb.WriteString("MIME-Version: 1.0\r\n")
	sb.WriteString(fmt.Sprintf("From: %s <%s>\r\n", fromName, from))
	sb.WriteString(fmt.Sprintf("To: %s\r\n", to))
	sb.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	sb.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	sb.WriteString("\r\n")
	sb.WriteString(htmlBody)
	return sb.String()
}

func buildInviteEmail(toName, accessURL, expiry, senderName string) string {
	name := toName
	if name == "" {
		name = "Gæst"
	}
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8"><title>CrownJukebox Invitation</title></head>
<body style="background:#0d0520;color:#e0d4ff;font-family:sans-serif;padding:32px;">
  <div style="max-width:480px;margin:0 auto;background:#1a0a30;border-radius:12px;padding:32px;border:1px solid rgba(191,0,255,0.3)">
    <div style="text-align:center;font-size:2.5rem;margin-bottom:8px;">♛</div>
    <h1 style="text-align:center;font-size:1.4rem;letter-spacing:3px;text-transform:uppercase;color:#f0e6ff;margin-bottom:4px;">CrownJukebox</h1>
    <p style="text-align:center;color:#8b6faa;font-size:0.9rem;margin-bottom:28px;">Party Jukebox</p>

    <p style="margin-bottom:16px;">Hej %s 👋</p>
    <p style="margin-bottom:24px;">Du er blevet inviteret til at deltage i en CrownJukebox-fest!
       Klik på knappen nedenfor for at åbne jukeboxen og begynde at tilføje musik til køen.</p>

    <div style="text-align:center;margin:28px 0;">
      <a href="%s"
         style="display:inline-block;background:linear-gradient(135deg,#bf00ff,#7b00cc);
                color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;
                font-weight:700;font-size:1rem;letter-spacing:1px;">
        🎶 Åbn Jukeboxen
      </a>
    </div>

    <p style="font-size:0.8rem;color:#8b6faa;text-align:center;">
      Linket %s.<br>
      Del det ikke med andre.
    </p>

    <hr style="border:none;border-top:1px solid rgba(191,0,255,0.2);margin:24px 0;">
    <p style="font-size:0.75rem;color:#6b5f7a;text-align:center;">
      Sendt af %s via CrownJukebox
    </p>
  </div>
</body>
</html>`, name, accessURL, expiry, senderName)
}
