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
func (s *Service) SendInvitation(ctx context.Context, toEmail, toName, username, pin, accessURL string, expiresAt *time.Time) error {
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
	body := buildInviteEmail(toName, username, pin, accessURL, expiry, cfg.FromName)

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

func buildInviteEmail(toName, username, pin, accessURL, expiry, senderName string) string {
	name := toName
	if name == "" {
		name = "Gæst"
	}
	pinDisplay := pin
	if pinDisplay == "" {
		pinDisplay = "(ingen kode sat)"
	}
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Du er inviteret til CrownJukebox!</title>
</head>
<body style="margin:0;padding:0;background:#0a0118;font-family:'Segoe UI',Arial,sans-serif;">

<!-- Outer wrapper -->
<table width="100%%" cellpadding="0" cellspacing="0" style="background:#0a0118;padding:32px 16px;">
<tr><td align="center">

<!-- Card -->
<table width="100%%" cellpadding="0" cellspacing="0" style="max-width:560px;background:linear-gradient(160deg,#130828 0%%,#0d0520 60%%,#0a011a 100%%);border-radius:16px;border:1px solid rgba(191,0,255,0.35);overflow:hidden;">

  <!-- Top glow bar -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#bf00ff,#7b2ff7,#22d3a0,#bf00ff);"></td></tr>

  <!-- Header -->
  <tr><td align="center" style="padding:36px 32px 20px;">
    <!-- Crown logo -->
    <div style="font-size:3rem;line-height:1;margin-bottom:6px;">♛</div>
    <div style="letter-spacing:5px;text-transform:uppercase;font-size:0.75rem;font-weight:700;color:#bf00ff;margin-bottom:2px;">CROWN</div>
    <div style="letter-spacing:8px;text-transform:uppercase;font-size:1.4rem;font-weight:900;color:#f0e6ff;">JUKEBOX</div>
    <div style="margin-top:10px;height:1px;background:linear-gradient(90deg,transparent,rgba(191,0,255,0.5),transparent);"></div>
  </td></tr>

  <!-- Party badge -->
  <tr><td align="center" style="padding:0 32px 28px;">
    <div style="display:inline-block;background:linear-gradient(135deg,rgba(191,0,255,0.2),rgba(34,211,160,0.15));border:1px solid rgba(191,0,255,0.4);border-radius:50px;padding:8px 22px;">
      <span style="font-size:1.1rem;">🎉</span>
      <span style="color:#e0d4ff;font-weight:700;font-size:0.95rem;letter-spacing:2px;text-transform:uppercase;margin:0 8px;">Du er inviteret!</span>
      <span style="font-size:1.1rem;">🎉</span>
    </div>
  </td></tr>

  <!-- Body text -->
  <tr><td style="padding:0 36px 28px;">
    <p style="color:#f0e6ff;font-size:1.05rem;margin:0 0 16px;">Hej <strong style="color:#bf00ff;">%s</strong> 👋</p>
    <p style="color:#c4b0d8;line-height:1.7;margin:0 0 20px;">
      Du er inviteret til at deltage i festen via <strong style="color:#f0e6ff;">CrownJukebox</strong> — den retro party jukebox!
      Vælg dine favoritnum&shy;re, tilføj dem til køen og hold festen kørende hele aftenen.
    </p>
    <p style="color:#c4b0d8;line-height:1.7;margin:0;">
      Tryk på knappen nedenfor for at åbne din personlige jukebox:
    </p>
  </td></tr>

  <!-- Login info -->
  <tr><td style="padding:0 36px 28px;">
    <div style="background:rgba(34,211,160,0.06);border:1px solid rgba(34,211,160,0.3);border-radius:10px;padding:18px 22px;">
      <p style="color:#22d3a0;font-weight:700;font-size:0.85rem;letter-spacing:2px;text-transform:uppercase;margin:0 0 14px;">🔐 Dine login-oplysninger</p>
      <p style="color:#8b6faa;font-size:0.82rem;margin:0 0 4px;">👤 Brugernavn (din e-mail adresse):</p>
      <p style="color:#f0e6ff;font-weight:700;font-size:0.95rem;margin:0 0 14px;">%s</p>
      <p style="color:#8b6faa;font-size:0.82rem;margin:0 0 4px;">🔑 Engangskode (skift den ved første login):</p>
      <p style="color:#bf00ff;font-weight:800;font-size:1.2rem;letter-spacing:6px;margin:0 0 12px;">%s</p>
      <p style="color:#6b50a0;font-size:0.78rem;margin:0;">⚠️ Husk at skifte din kode første gang du logger ind!</p>
    </div>
  </td></tr>

  <!-- CTA button -->
  <tr><td align="center" style="padding:4px 36px 32px;">
    <a href="%s"
       style="display:inline-block;background:linear-gradient(135deg,#bf00ff 0%%,#7b2ff7 50%%,#5500cc 100%%);
              color:#fff;text-decoration:none;padding:16px 40px;border-radius:10px;
              font-weight:800;font-size:1rem;letter-spacing:2px;text-transform:uppercase;
              box-shadow:0 0 24px rgba(191,0,255,0.5);">
      🎶 &nbsp;Åbn Jukeboxen
    </a>
  </td></tr>

  <!-- SKÅL section -->
  <tr><td style="padding:0 36px 28px;">
    <table width="100%%" cellpadding="0" cellspacing="0" style="background:rgba(34,211,160,0.07);border:1px solid rgba(34,211,160,0.25);border-radius:10px;padding:16px;">
    <tr>
      <td style="text-align:center;padding:12px;">
        <div style="font-size:2rem;margin-bottom:6px;">🥂</div>
        <div style="color:#22d3a0;font-weight:700;letter-spacing:3px;font-size:0.9rem;text-transform:uppercase;">SKÅL!</div>
        <div style="color:#8bd8c8;font-size:0.8rem;margin-top:6px;">Brug SKÅL-knappen i jukeboxen<br>til at sætte stemningen!</div>
      </td>
      <td style="text-align:center;padding:12px;">
        <div style="font-size:2rem;margin-bottom:6px;">🎵</div>
        <div style="color:#bf00ff;font-weight:700;letter-spacing:3px;font-size:0.9rem;text-transform:uppercase;">Kø</div>
        <div style="color:#b09dc8;font-size:0.8rem;margin-top:6px;">Søg og tilføj musik<br>direkte til køen</div>
      </td>
      <td style="text-align:center;padding:12px;">
        <div style="font-size:2rem;margin-bottom:6px;">👑</div>
        <div style="color:#f0c060;font-weight:700;letter-spacing:3px;font-size:0.9rem;text-transform:uppercase;">Fest</div>
        <div style="color:#c4aa70;font-size:0.8rem;margin-top:6px;">Retro stil &amp; gode<br>vibes hele aftenen</div>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- Access info -->
  <tr><td style="padding:0 36px 28px;">
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px 18px;">
      <p style="color:#8b6faa;font-size:0.8rem;margin:0 0 6px;">
        🔗 <strong style="color:#c4b0d8;">Dit adgangslink:</strong>
      </p>
      <p style="color:#6b50a0;font-size:0.75rem;word-break:break-all;margin:0 0 8px;">%s</p>
      <p style="color:#8b6faa;font-size:0.78rem;margin:0;">
        ⏱ Linket %s. Hold det privat.
      </p>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:0 36px 28px;">
    <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(191,0,255,0.3),transparent);margin-bottom:20px;"></div>
    <p style="color:#5a4870;font-size:0.75rem;text-align:center;margin:0;">
      Sendt af <strong style="color:#7b5fa0;">%s</strong> via CrownJukebox &nbsp;♛
    </p>
  </td></tr>

  <!-- Bottom glow bar -->
  <tr><td style="height:3px;background:linear-gradient(90deg,#22d3a0,#7b2ff7,#bf00ff,#22d3a0);"></td></tr>

</table>
<!-- /Card -->

</td></tr>
</table>
<!-- /Outer wrapper -->

</body>
</html>`, name, username, pinDisplay, accessURL, accessURL, expiry, senderName)
}
