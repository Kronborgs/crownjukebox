import { useState } from 'react'
import { setupApi } from '@/api/client'

type Step = 'admin' | 'smtp' | 'done'

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
    <div className="min-h-screen bg-[#0d0520] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1a0a30] border border-purple-900/40 rounded-2xl p-8 shadow-2xl">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">♛</div>
          <h1 className="text-xl font-bold tracking-widest text-purple-100 uppercase">CrownJukebox</h1>
          <p className="text-purple-400 text-sm mt-1">Første gangs opsætning</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {(['admin', 'smtp'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold
                ${step === s ? 'bg-purple-600 text-white' : step === 'done' || (s === 'admin' && step === 'smtp') ? 'bg-purple-900 text-purple-400' : 'bg-purple-900/30 text-purple-600'}`}>
                {i + 1}
              </div>
              <span className={`text-sm ${step === s ? 'text-purple-200' : 'text-purple-500'}`}>
                {s === 'admin' ? 'Admin' : 'E-mail'}
              </span>
              {i < 1 && <div className="w-8 h-px bg-purple-900/50" />}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-sm">
            {error}
          </div>
        )}

        {step === 'admin' && (
          <div className="space-y-4">
            <h2 className="text-purple-200 font-semibold mb-4">Opret administrator</h2>
            <div>
              <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">Brugernavn</label>
              <input
                type="text"
                value={adminUsername}
                onChange={e => setAdminUsername(e.target.value)}
                className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">Adgangskode</label>
              <input
                type="password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">Bekræft adgangskode</label>
              <input
                type="password"
                value={adminPasswordConfirm}
                onChange={e => setAdminPasswordConfirm(e.target.value)}
                className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500"
                onKeyDown={e => e.key === 'Enter' && handleAdminNext()}
              />
            </div>
            <button
              onClick={handleAdminNext}
              className="w-full bg-gradient-to-r from-purple-700 to-purple-500 text-white rounded-lg py-2.5 font-semibold hover:opacity-90 mt-2"
            >
              Næste →
            </button>
          </div>
        )}

        {step === 'smtp' && (
          <div className="space-y-4">
            <h2 className="text-purple-200 font-semibold mb-1">E-mail opsætning</h2>
            <p className="text-purple-500 text-sm mb-4">Valgfri — bruges til at sende invitationslinks til gæster.</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">SMTP Host</label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={e => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">Port</label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={e => setSmtpPort(e.target.value)}
                  className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">SMTP Brugernavn</label>
              <input
                type="text"
                value={smtpUser}
                onChange={e => setSmtpUser(e.target.value)}
                className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">SMTP Adgangskode</label>
              <input
                type="password"
                value={smtpPass}
                onChange={e => setSmtpPass(e.target.value)}
                className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-purple-400 text-xs uppercase tracking-wider mb-1">Afsender-adresse</label>
              <input
                type="email"
                value={smtpFrom}
                onChange={e => setSmtpFrom(e.target.value)}
                placeholder="jukebox@example.com"
                className="w-full bg-[#0d0520] border border-purple-900/60 rounded-lg px-3 py-2 text-purple-100 focus:outline-none focus:border-purple-500 text-sm"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => handleFinish(true)}
                disabled={loading}
                className="flex-1 bg-purple-900/40 border border-purple-700/40 text-purple-300 rounded-lg py-2.5 font-medium hover:bg-purple-900/60 text-sm"
              >
                Spring over
              </button>
              <button
                onClick={() => handleFinish(false)}
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-purple-700 to-purple-500 text-white rounded-lg py-2.5 font-semibold hover:opacity-90"
              >
                {loading ? '...' : 'Gem og start'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
