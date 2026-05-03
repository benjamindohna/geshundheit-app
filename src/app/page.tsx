'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Observation = {
  id: string
  display_name: string
  value: number | null
  value_text: string | null
  unit: string | null
  status: string
  clinical_severity: number
  measured_at: string
  reference_range_low: number | null
  reference_range_high: number | null
  reference_range_text: string | null
  volatility: string
}

type Analysis = {
  id: string
  created_at: string
  summary: string
  sport_recommendations: Rec[]
  nutrition_recommendations: Rec[]
  supplement_recommendations: SupRec[]
  test_recommendations: TestRec[]
}

type Rec = { title: string; description: string; priority: string }
type SupRec = { title: string; description: string; dosage: string | null; priority: string }
type TestRec = { title: string; description: string; urgency: string }

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const statusColor = {
  normal: 'bg-green-50 text-green-700 border-green-200',
  borderline: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  abnormal: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
}

const statusLabel = {
  normal: 'Normal',
  borderline: 'Grenzwertig',
  abnormal: 'Abweichend',
  critical: 'Kritisch',
}

const priorityColor = {
  hoch: 'bg-red-100 text-red-700',
  mittel: 'bg-yellow-100 text-yellow-700',
  niedrig: 'bg-green-100 text-green-700',
}

const urgencyColor = {
  sofort: 'bg-red-100 text-red-700',
  bald: 'bg-yellow-100 text-yellow-700',
  routine: 'bg-blue-100 text-blue-700',
}

export default function Dashboard() {
  const router = useRouter()
  const [observations, setObservations] = useState<Observation[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [activeTab, setActiveTab] = useState<'werte' | 'analyse' | 'chat'>('werte')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/observations')
      .then((r) => r.json())
      .then((d) => setObservations(d.observations ?? []))
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const abnormal = observations.filter((o) => o.status !== 'normal')
    .sort((a, b) => b.clinical_severity - a.clinical_severity)

  const allSorted = [...observations].sort((a, b) => b.clinical_severity - a.clinical_severity)

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  async function generateAnalysis() {
    setLoadingAnalysis(true)
    try {
      const res = await fetch('/api/analyze', { method: 'POST' })
      const data = await res.json()
      if (data.analysis) setAnalysis(data.analysis)
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault()
    if (!chatInput.trim() || chatLoading) return

    const userMsg: ChatMessage = { role: 'user', content: chatInput }
    const newMessages = [...chatMessages, userMsg]
    setChatMessages(newMessages)
    setChatInput('')
    setChatLoading(true)

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setChatMessages([...newMessages, assistantMsg])

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: newMessages }),
    })

    const reader = res.body?.getReader()
    const decoder = new TextDecoder()

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        setChatMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: updated[updated.length - 1].content + chunk,
          }
          return updated
        })
      }
    }
    setChatLoading(false)
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-base font-semibold text-zinc-900">Gesundheits-Dashboard</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/upload"
              className="text-sm px-3 py-1.5 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Dokument hochladen
            </Link>
            <button
              onClick={logout}
              className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              Abmelden
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {observations.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-500 text-sm mb-4">Noch keine Messwerte vorhanden.</p>
            <Link
              href="/upload"
              className="text-sm px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Erstes Dokument hochladen
            </Link>
          </div>
        ) : (
          <>
            {abnormal.length > 0 && (
              <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-xl">
                <p className="text-sm font-medium text-orange-800 mb-2">
                  {abnormal.length} Wert{abnormal.length > 1 ? 'e' : ''} außerhalb des Referenzbereichs
                </p>
                <div className="flex flex-wrap gap-2">
                  {abnormal.slice(0, 5).map((o) => (
                    <span key={o.id} className={`text-xs px-2 py-1 rounded-full border ${statusColor[o.status as keyof typeof statusColor] ?? 'bg-zinc-100 text-zinc-600'}`}>
                      {o.display_name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex border-b border-zinc-200 mb-6 gap-1">
              {(['werte', 'analyse', 'chat'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'border-zinc-900 text-zinc-900'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {tab === 'werte' ? 'Messwerte' : tab === 'analyse' ? 'Analyse' : 'Chat'}
                </button>
              ))}
            </div>

            {activeTab === 'werte' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {allSorted.map((o) => {
                  const val = o.value != null
                    ? `${o.value}${o.unit ? ' ' + o.unit : ''}`
                    : o.value_text ?? '–'
                  const ref = o.reference_range_text
                    ? o.reference_range_text
                    : o.reference_range_low != null
                    ? `${o.reference_range_low}–${o.reference_range_high} ${o.unit ?? ''}`
                    : null
                  return (
                    <div key={o.id} className="bg-white rounded-xl border border-zinc-200 p-4">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-zinc-800 leading-tight">{o.display_name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ml-2 shrink-0 ${statusColor[o.status as keyof typeof statusColor] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>
                          {statusLabel[o.status as keyof typeof statusLabel] ?? o.status}
                        </span>
                      </div>
                      <p className="text-2xl font-semibold text-zinc-900">{val}</p>
                      {ref && <p className="text-xs text-zinc-400 mt-1">Ref: {ref}</p>}
                      <p className="text-xs text-zinc-400 mt-1">{o.measured_at}</p>
                    </div>
                  )
                })}
              </div>
            )}

            {activeTab === 'analyse' && (
              <div>
                {!analysis ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-zinc-500 mb-4">Noch keine Analyse erstellt.</p>
                    <button
                      onClick={generateAnalysis}
                      disabled={loadingAnalysis}
                      className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                    >
                      {loadingAnalysis ? 'Analysiere…' : 'Analyse erstellen'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="bg-white rounded-xl border border-zinc-200 p-5">
                      <h2 className="text-sm font-semibold text-zinc-700 mb-2">Zusammenfassung</h2>
                      <p className="text-sm text-zinc-700 leading-relaxed">{analysis.summary}</p>
                      <p className="text-xs text-zinc-400 mt-3">
                        Erstellt am {new Date(analysis.created_at).toLocaleDateString('de-DE')}
                      </p>
                    </div>

                    <RecommendationSection
                      title="Sport & Bewegung"
                      items={analysis.sport_recommendations}
                      badgeColor={(p) => priorityColor[p as keyof typeof priorityColor] ?? 'bg-zinc-100 text-zinc-600'}
                      badgeKey="priority"
                    />
                    <RecommendationSection
                      title="Ernährung"
                      items={analysis.nutrition_recommendations}
                      badgeColor={(p) => priorityColor[p as keyof typeof priorityColor] ?? 'bg-zinc-100 text-zinc-600'}
                      badgeKey="priority"
                    />
                    <RecommendationSection
                      title="Nahrungsergänzung"
                      items={(analysis.supplement_recommendations ?? []).map((s) => ({
                        ...s,
                        description: s.dosage ? `${s.description} (${s.dosage})` : s.description,
                      }))}
                      badgeColor={(p) => priorityColor[p as keyof typeof priorityColor] ?? 'bg-zinc-100 text-zinc-600'}
                      badgeKey="priority"
                    />
                    <RecommendationSection
                      title="Empfohlene Untersuchungen"
                      items={analysis.test_recommendations}
                      badgeColor={(u) => urgencyColor[u as keyof typeof urgencyColor] ?? 'bg-zinc-100 text-zinc-600'}
                      badgeKey="urgency"
                    />

                    <button
                      onClick={generateAnalysis}
                      disabled={loadingAnalysis}
                      className="text-sm text-zinc-500 hover:text-zinc-700 underline"
                    >
                      Neue Analyse erstellen
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'chat' && (
              <div className="flex flex-col h-[60vh]">
                <div className="flex-1 overflow-y-auto space-y-3 pb-4">
                  {chatMessages.length === 0 && (
                    <p className="text-sm text-zinc-400 text-center pt-8">
                      Stell mir Fragen zu deinen Gesundheitsdaten.
                    </p>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-zinc-900 text-white'
                          : 'bg-white border border-zinc-200 text-zinc-800'
                      }`}>
                        {msg.content || (msg.role === 'assistant' && chatLoading ? '…' : '')}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={sendChat} className="flex gap-2 pt-3 border-t border-zinc-200">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Frage stellen…"
                    className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-4 py-2.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                  >
                    Senden
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function RecommendationSection({
  title,
  items,
  badgeColor,
  badgeKey,
}: {
  title: string
  items: Record<string, string | null>[]
  badgeColor: (v: string) => string
  badgeKey: string
}) {
  if (!items?.length) return null
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5">
      <h2 className="text-sm font-semibold text-zinc-700 mb-3">{title}</h2>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium text-zinc-800">{item.title}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${badgeColor(item[badgeKey] ?? '')}`}>
                  {item[badgeKey]}
                </span>
              </div>
              <p className="text-sm text-zinc-500 leading-relaxed">{item.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
