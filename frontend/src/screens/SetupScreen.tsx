import { useMemo, useState } from 'react'
import { setupApi } from '@/api/client'
import '@/styles/setup-screen.css'

type Step = 'admin' | 'smtp'

interface Props {
  onComplete: () => void
}

export function SetupScreen({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('admin')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Admin step state
  const [adminUsername, setAdminUsername] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('')

  // SMTP step state
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpFrom, setSmtpFrom] = useState('')
  const [smtpFromName, setSmtpFromName] = useState('CrownJukebox')
  const stepIndex = useMemo(() => (step === 'admin' ? 1 : 2), [step])

  const handleAdminNext = () => {
    setError(null)
    if (!adminUsername.trim()) { setError('Brugernavn er påkrævet'); return }
    if (adminPassword.length < 6) { setError('Adgangskode skal være mindst 6 tegn'); return }
    if (adminPassword !== adminPasswordConfirm) { setError('Adgangskoderne matcher ikke'); return }
    setStep('smtp')
  }

  const handleFinish = async (skipSmtp: boolean) => {
    setError(null)
    setLoading(true)
    try {
      await setupApi.complete({
        admin_username: adminUsername,
        admin_password: adminPassword,
        smtp: !skipSmtp && smtpHost ? {
          host: smtpHost,
          port: parseInt(smtpPort) || 587,
          username: smtpUser,
          password: smtpPass,
          from: smtpFrom,
          from_name: smtpFromName || 'CrownJukebox',
        } : undefined,
      })
      onComplete()
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="setup-page">
      <div className="setup-halo setup-halo-left" />
      <div className="setup-halo setup-halo-right" />

      <main className="setup-jukebox-shell">
        <section className="setup-jukebox-top">
          <div className="setup-neon-crown">♛</div>
          <h1 className="setup-title">CrownJukebox</h1>
          <p className="setup-subtitle">Backpanel Setup</p>
        </section>

        <section className="setup-progress">
          <div className={`setup-step ${stepIndex >= 1 ? 'is-active' : ''}`}>
            <span>1</span>
            <label>Admin</label>
          </div>
          <div className={`setup-step ${stepIndex >= 2 ? 'is-active' : ''}`}>
            <span>2</span>
            <label>E-mail</label>
          </div>
        </section>

        {error && <div className="setup-error">{error}</div>}

        {step === 'admin' && (
          <section className="setup-panel">
            <h2>Opret administrator</h2>

            <label>Brugernavn</label>
            <input
              className="setup-input"
              type="text"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              autoFocus
            />

            <label>Adgangskode</label>
            <input
              className="setup-input"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />

            <label>Bekræft adgangskode</label>
            <input
              className="setup-input"
              type="password"
              value={adminPasswordConfirm}
              onChange={(e) => setAdminPasswordConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdminNext()}
            />

            <div className="setup-actions">
              <button className="setup-btn setup-btn-primary" onClick={handleAdminNext}>
                Næste
              </button>
            </div>
          </section>
        )}

        {step === 'smtp' && (
          <section className="setup-panel">
            <h2>E-mail opsætning</h2>
            <p className="setup-helper">Valgfri. Bruges til invitationslinks til gæster.</p>

            <div className="setup-grid-2">
              <div>
                <label>SMTP Host</label>
                <input
                  className="setup-input"
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div>
                <label>Port</label>
                <input
                  className="setup-input"
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                />
              </div>
            </div>

            <label>SMTP Brugernavn</label>
            <input
              className="setup-input"
              type="text"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
            />

            <label>SMTP Adgangskode</label>
            <input
              className="setup-input"
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
            />

            <label>Afsender-adresse</label>
            <input
              className="setup-input"
              type="email"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="jukebox@example.com"
            />

            <label>Afsender-navn</label>
            <input
              className="setup-input"
              type="text"
              value={smtpFromName}
              onChange={(e) => setSmtpFromName(e.target.value)}
            />

            <div className="setup-actions">
              <button className="setup-btn setup-btn-ghost" onClick={() => setStep('admin')}>
                Tilbage
              </button>
              <button className="setup-btn setup-btn-ghost" onClick={() => handleFinish(true)} disabled={loading}>
                Spring over
              </button>
              <button className="setup-btn setup-btn-primary" onClick={() => handleFinish(false)} disabled={loading}>
                {loading ? 'Gemmer...' : 'Gem og start'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
