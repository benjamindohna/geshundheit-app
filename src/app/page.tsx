'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Observation = {
  id: string
  display_name: string
  loinc_code: string | null
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
  is_allergen: boolean
}

type Profile = {
  id: string
  summary: string
  body_age: number | null
  updated_at: string
}

type Allergen = {
  id: string
  name: string
  severity: string
  common_foods: string[]
}

type ActionPlanItem = {
  id: string
  category: string
  title: string
  value: string | null
  label: string | null
  note: string | null
  prescription_required: boolean
  updated_at: string
}

type Document = {
  id: string
  filename: string
  label: string | null
  categories: string[]
  keywords: string[] | null
  uploaded_at: string
  extraction_status: string
  file_type: string
  parent_id: string | null
  page_start: number | null
  page_end: number | null
  observations: { count: number }[]
}

const ALL_CATEGORIES = [
  'Laborwerte',
  'Bildgebung',
  'Arztbrief',
  'Messwerte',
  'Medikamente',
  'Impfungen',
  'Sonstiges',
] as const

const categoryStyle: Record<string, string> = {
  Laborwerte:  'bg-blue-50 text-blue-700 border-blue-200',
  Bildgebung:  'bg-purple-50 text-purple-700 border-purple-200',
  Arztbrief:   'bg-slate-50 text-slate-600 border-slate-200',
  Messwerte:   'bg-teal-50 text-teal-700 border-teal-200',
  Medikamente: 'bg-orange-50 text-orange-700 border-orange-200',
  Impfungen:   'bg-green-50 text-green-700 border-green-200',
  Sonstiges:   'bg-zinc-50 text-zinc-600 border-zinc-200',
}

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


const BIRTH_DATE = new Date('1975-07-11')

function getActualAge(): number {
  const today = new Date()
  let age = today.getFullYear() - BIRTH_DATE.getFullYear()
  const m = today.getMonth() - BIRTH_DATE.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < BIRTH_DATE.getDate())) age--
  return age
}

export default function Dashboard() {
  const router = useRouter()
  const [observations, setObservations] = useState<Observation[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [docSearch, setDocSearch] = useState('')
  const [docCategoryFilter, setDocCategoryFilter] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'werte' | 'schlachtplan' | 'dokumente'>('werte')
  const [schlachtplanSubTab, setSchlachtplanSubTab] = useState<'exercises' | 'habits' | 'nutrition' | 'supplements'>('exercises')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileGenerating, setProfileGenerating] = useState(false)
  const [allergens, setAllergens] = useState<Allergen[]>([])
  const [allergenExpanded, setAllergenExpanded] = useState(false)
  const [actionPlanItems, setActionPlanItems] = useState<ActionPlanItem[]>([])
  const [actionPlanSummary, setActionPlanSummary] = useState<string | null>(null)
  const [actionPlanGenerating, setActionPlanGenerating] = useState(false)
  const [descriptions, setDescriptions] = useState<Record<string, string>>({})
  const [descriptionsLoaded, setDescriptionsLoaded] = useState(false)
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set())
  const [foodNotes, setFoodNotes] = useState<Record<string, string>>({})
  const [foodNotesLoaded, setFoodNotesLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/observations')
      .then((r) => r.json())
      .then((d) => setObservations(d.observations ?? []))
    fetch('/api/documents')
      .then((r) => r.json())
      .then((d) => setDocuments(d.documents ?? []))
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => setProfile(d.profile ?? null))
      .finally(() => setProfileLoading(false))
    fetch('/api/action-plan')
      .then((r) => r.json())
      .then((d) => {
        setActionPlanItems(d.items ?? [])
        setActionPlanSummary(d.summary ?? null)
      })
    fetch('/api/allergens')
      .then((r) => r.json())
      .then((d) => setAllergens(d.allergens ?? []))
    fetch('/api/observation-descriptions')
      .then((r) => r.json())
      .then((d) => {
        setDescriptions(d.descriptions ?? {})
        setDescriptionsLoaded(true)
      })
    if (sessionStorage.getItem('profileGeneratingAt')) setProfileGenerating(true)
    if (sessionStorage.getItem('actionPlanGeneratingAt')) setActionPlanGenerating(true)
  }, [])

  // Poll every 2s while profile is generating; stop when profile is newer than the trigger timestamp
  useEffect(() => {
    if (!profileGenerating) return
    const triggerAt = parseInt(sessionStorage.getItem('profileGeneratingAt') ?? '0', 10)
    const interval = setInterval(() => {
      fetch('/api/profile')
        .then((r) => r.json())
        .then((d) => {
          if (d.profile && new Date(d.profile.updated_at).getTime() > triggerAt) {
            sessionStorage.removeItem('profileGeneratingAt')
            setProfile(d.profile)
            setProfileGenerating(false)
          }
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(interval)
  }, [profileGenerating])

  // Eager-load food notes as soon as critical allergen observations are available
  useEffect(() => {
    if (foodNotesLoaded || observations.length === 0) return
    const allergens = observations
      .filter((o) => o.is_allergen && (o.status === 'critical' || o.status === 'abnormal'))
      .map((o) => ({ name: o.display_name, value: o.value, unit: o.unit, status: o.status }))
    if (allergens.length === 0) { setFoodNotesLoaded(true); return }
    fetch('/api/allergen-foods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allergens }),
    })
      .then((r) => r.json())
      .then((d) => { setFoodNotes(d.foodNotes ?? {}); setFoodNotesLoaded(true) })
      .catch(() => setFoodNotesLoaded(true))
  }, [observations, foodNotesLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Backfill any missing descriptions once both observations and descriptions are loaded
  useEffect(() => {
    if (!descriptionsLoaded || observations.length === 0) return
    const uniqueNames = [...new Set(observations.map((o) => o.display_name))]
    const hasMissing = uniqueNames.some((name) => !descriptions[name])
    if (!hasMissing) return
    fetch('/api/observation-descriptions', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { if (d.descriptions) setDescriptions(d.descriptions) })
      .catch(() => {})
  }, [descriptionsLoaded, observations.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDescription(name: string) {
    setExpandedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Poll every 2s while action plan is generating
  // Stops when summary arrives (generated last); 90s fallback if summary fails
  useEffect(() => {
    if (!actionPlanGenerating) return
    const triggerAt = parseInt(sessionStorage.getItem('actionPlanGeneratingAt') ?? '0', 10)
    const interval = setInterval(() => {
      fetch('/api/action-plan')
        .then((r) => r.json())
        .then((d) => {
          const fresh = d.updated_at && new Date(d.updated_at).getTime() > triggerAt
          if (fresh) {
            setActionPlanItems(d.items ?? [])
            if (d.summary) {
              sessionStorage.removeItem('actionPlanGeneratingAt')
              setActionPlanSummary(d.summary)
              setActionPlanGenerating(false)
            }
            // else: items ready but summary still generating → keep polling
          }
        })
        .catch(() => {})
    }, 2000)
    const timeout = setTimeout(() => {
      sessionStorage.removeItem('actionPlanGeneratingAt')
      setActionPlanGenerating(false)
    }, 90000)
    return () => { clearInterval(interval); clearTimeout(timeout) }
  }, [actionPlanGenerating])

  // Deduplicate: prefer LOINC-code match first, fall back to exact display_name.
  // API returns newest first, so the first occurrence wins.
  const deduped = (() => {
    const seenLoinc = new Set<string>()
    const seenName = new Set<string>()
    return observations.filter((o) => {
      if (o.loinc_code && seenLoinc.has(o.loinc_code)) return false
      if (seenName.has(o.display_name)) return false
      if (o.loinc_code) seenLoinc.add(o.loinc_code)
      seenName.add(o.display_name)
      return true
    })
  })()

  const abnormal = deduped.filter((o) => o.status !== 'normal' && !o.is_allergen)
    .sort((a, b) => b.clinical_severity - a.clinical_severity)

  const allSorted = deduped.filter((o) => !o.is_allergen).sort((a, b) => b.clinical_severity - a.clinical_severity)

  const allergenObs = deduped.filter((o) => o.is_allergen).sort((a, b) => b.clinical_severity - a.clinical_severity)
  const criticalAllergenObs = allergenObs.filter((o) => o.status === 'critical' || o.status === 'abnormal')

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }


  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-base font-semibold text-zinc-900">Gesundheits-Dashboard</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/upload"
              className="text-sm px-3 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors min-h-[40px] flex items-center"
            >
              <span className="hidden sm:inline">Dokument hochladen</span>
              <span className="sm:hidden">+ Hochladen</span>
            </Link>
            <button
              onClick={logout}
              className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors px-2 py-2 min-h-[40px]"
            >
              <span className="hidden sm:inline">Abmelden</span>
              <span className="sm:hidden" aria-label="Abmelden">✕</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <p className="text-xl font-semibold text-zinc-900 mb-5">Hi Nikolaus!</p>

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
            {/* Profile widgets */}
            {(profile || profileLoading || profileGenerating) && (
              <div className="mb-6 space-y-3">
                {/* Row 1: Summary + Body Age */}
                <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                  {/* Summary */}
                  <div className="order-2 sm:order-1 flex-1 bg-white rounded-xl border border-zinc-200 p-5">
                    {profileGenerating || (profileLoading && !profile) ? (
                      <div className="space-y-2.5 py-1">
                        {profileGenerating
                          ? <><div className="shimmer h-3 rounded w-3/4" /><div className="shimmer h-3 rounded" /><div className="shimmer h-3 rounded w-5/6" /><div className="shimmer h-3 rounded w-2/3" /></>
                          : <><div className="h-3 bg-zinc-100 rounded animate-pulse w-3/4" /><div className="h-3 bg-zinc-100 rounded animate-pulse" /><div className="h-3 bg-zinc-100 rounded animate-pulse w-5/6" /><div className="h-3 bg-zinc-100 rounded animate-pulse w-2/3" /></>
                        }
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Gesundheitsstatus</p>
                        <p className="text-sm text-zinc-700 leading-relaxed">{profile?.summary}</p>
                        {profile?.updated_at && (
                          <p className="text-xs text-zinc-400 mt-3">
                            Aktualisiert {new Date(profile.updated_at).toLocaleDateString('de-DE')}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Body Age */}
                  <div className="order-1 sm:order-2 sm:w-36 sm:shrink-0 bg-white rounded-xl border border-zinc-200 px-4 py-6 flex items-center justify-center gap-12 sm:flex-col sm:gap-3">
                    {profileGenerating || (profileLoading && !profile) ? (
                      <div className="flex flex-col items-center gap-2 w-full">
                        {profileGenerating
                          ? <><div className="shimmer h-10 rounded w-16" /><div className="shimmer h-3 rounded w-20" /></>
                          : <><div className="h-10 bg-zinc-100 rounded animate-pulse w-16" /><div className="h-3 bg-zinc-100 rounded animate-pulse w-full" /></>
                        }
                      </div>
                    ) : profile?.body_age != null ? (() => {
                      const diff = profile.body_age! - getActualAge()
                      const numColor = diff <= -2 ? 'text-green-600' : diff >= 6 ? 'text-red-600' : diff >= 3 ? 'text-orange-600' : 'text-zinc-900'
                      return (
                        <>
                          <div className="flex flex-col items-center text-center">
                            <p className="text-sm sm:text-xs font-medium text-zinc-400 uppercase tracking-wide leading-none mb-0">Körperalter</p>
                            <p className={`text-[86px] sm:text-[42px] font-bold tabular-nums leading-none mt-1 ${numColor}`}>{profile.body_age}</p>
                            <p className="text-sm sm:text-xs text-zinc-500 mt-1">Jahre</p>
                          </div>
                          <BodyAgeSmiley diff={diff} className="w-24 h-24 sm:w-11 sm:h-11" />
                        </>
                      )
                    })() : (
                      <p className="text-2xl font-bold text-zinc-300">–</p>
                    )}
                  </div>
                </div>

              </div>
            )}

            {abnormal.length > 0 && (
              <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-xl">
                <p className="text-sm font-medium text-orange-800 mb-2">
                  {abnormal.length} Wert{abnormal.length > 1 ? 'e' : ''} außerhalb des Referenzbereichs
                </p>
                <div className="flex flex-wrap gap-2">
                  {abnormal.map((o) => (
                    <span key={o.id} className={`text-xs px-2 py-1 rounded-full border ${statusColor[o.status as keyof typeof statusColor] ?? 'bg-zinc-100 text-zinc-600'}`}>
                      {o.display_name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex border-b border-zinc-200 mb-6 gap-1 overflow-x-auto">
              {(['werte', 'schlachtplan', 'dokumente'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'border-zinc-900 text-zinc-900'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {tab === 'werte' ? 'Messwerte' : tab === 'schlachtplan' ? 'Schlachtplan' : 'Dokumente'}
                </button>
              ))}
            </div>

            {activeTab === 'werte' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {allSorted.map((o) => {
                  const hasNumber = o.value != null
                  const val = hasNumber
                    ? `${o.value}${o.unit ? ' ' + o.unit : ''}`
                    : o.value_text ?? '–'
                  const ref = o.reference_range_text
                    ? o.reference_range_text
                    : o.reference_range_low != null
                    ? `${o.reference_range_low}–${o.reference_range_high} ${o.unit ?? ''}`
                    : null
                  const desc = descriptions[o.display_name]
                  const isExpanded = expandedNames.has(o.display_name)
                  return (
                    <div key={o.id} className="bg-white rounded-xl border border-zinc-200 p-4">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-zinc-800 leading-tight">{o.display_name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ml-2 shrink-0 ${statusColor[o.status as keyof typeof statusColor] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>
                          {statusLabel[o.status as keyof typeof statusLabel] ?? o.status}
                        </span>
                      </div>
                      {hasNumber ? (
                        <>
                          <p className="text-2xl font-semibold text-zinc-900">{val}</p>
                          {ref && <p className="text-xs text-zinc-400 mt-1">Ref: {ref}</p>}
                        </>
                      ) : (
                        <p className="text-sm text-zinc-600 leading-snug">{val}</p>
                      )}
                      <p className="text-xs text-zinc-400 mt-1">{o.measured_at}</p>
                      {desc && (
                        <>
                          <button
                            onClick={() => toggleDescription(o.display_name)}
                            className="text-xs text-zinc-800 hover:text-zinc-500 mt-2 flex items-center gap-1 transition-colors"
                          >
                            Beschreibung
                            <svg
                              className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              viewBox="0 0 12 12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M2 4.5L6 8.5L10 4.5" />
                            </svg>
                          </button>
                          {isExpanded && (
                            <p className="text-xs text-zinc-500 mt-2 pt-2 border-t border-zinc-100 leading-relaxed">
                              {desc}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {activeTab === 'schlachtplan' && (
              <div className="min-h-[480px]">

                {/* Summary widget */}
                {(actionPlanGenerating || actionPlanSummary) && (
                  <div className="bg-white rounded-xl border border-zinc-200 p-5 mb-5">
                    {actionPlanGenerating ? (
                      <div className="space-y-2.5 py-1">
                        <div className="shimmer h-3 rounded w-3/4" />
                        <div className="shimmer h-3 rounded" />
                        <div className="shimmer h-3 rounded w-5/6" />
                        <div className="shimmer h-3 rounded w-2/3" />
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Dein Schlachtplan</p>
                        <p className="text-sm text-zinc-700 leading-relaxed">{actionPlanSummary}</p>
                      </>
                    )}
                  </div>
                )}

                {/* Sub-tabs */}
                <div className="flex gap-1 mb-5 overflow-x-auto">
                  {([
                    { key: 'exercises', label: 'Übungen' },
                    { key: 'habits', label: 'Habits' },
                    { key: 'nutrition', label: 'Ernährung' },
                    { key: 'supplements', label: 'Supplements' },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setSchlachtplanSubTab(key)}
                      className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                        schlachtplanSubTab === key
                          ? 'bg-zinc-900 text-white'
                          : 'bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Items grid */}
                {actionPlanGenerating ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
                        <div className="shimmer h-3 rounded w-2/3" />
                        <div className="shimmer h-6 rounded w-1/2" />
                        <div className="shimmer h-3 rounded w-full" />
                        <div className="shimmer h-3 rounded w-4/5" />
                      </div>
                    ))}
                  </div>
                ) : (() => {
                  const items = actionPlanItems.filter((i) => i.category === schlachtplanSubTab)

                  const itemCard = (item: ActionPlanItem) => (
                    <div key={item.id} className="bg-white rounded-xl border border-zinc-200 p-4">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <p className="text-sm font-medium text-zinc-800 leading-tight flex-1 min-w-0">{item.title}</p>
                        {item.prescription_required && (
                          <span className="text-xs px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 font-medium whitespace-nowrap shrink-0">Rezeptpflichtig</span>
                        )}
                      </div>
                      {item.label && (
                        <span className="inline-block text-xs px-2 py-0.5 rounded border bg-zinc-50 text-zinc-500 border-zinc-200 mb-2">{item.label}</span>
                      )}
                      {item.value && (
                        <p className="text-xl font-semibold text-zinc-900 mb-1">{item.value}</p>
                      )}
                      {item.note && (
                        <p className="text-xs text-zinc-500 leading-relaxed">{item.note}</p>
                      )}
                    </div>
                  )

                  if (schlachtplanSubTab === 'nutrition') {
                    return (
                      <>
                        {items.length === 0 ? (
                          <div className="flex flex-col items-center justify-center min-h-[200px]">
                            <p className="text-sm text-zinc-400">Noch keine Daten. Lade Dokumente hoch und drücke &quot;Zum Dashboard&quot;.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {items.map(itemCard)}
                          </div>
                        )}
                        <div className="mt-6">
                          <button
                            onClick={() => setAllergenExpanded((prev) => !prev)}
                            className="w-full flex items-center justify-between bg-white border border-zinc-200 rounded-xl px-5 py-4 text-left hover:bg-zinc-50 transition-colors"
                          >
                            <div>
                              <p className="text-sm font-semibold text-zinc-700">Allergene &amp; Unverträglichkeiten</p>
                              <p className="text-xs text-zinc-400 mt-0.5">Aus deinen Dokumenten extrahierte Allergenreaktionen</p>
                            </div>
                            <svg
                              className={`w-4 h-4 text-zinc-400 shrink-0 ml-4 transition-transform duration-200 ${allergenExpanded ? 'rotate-180' : ''}`}
                              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            >
                              <path d="M3 6l5 5 5-5" />
                            </svg>
                          </button>
                          {allergenExpanded && (
                            <div className="mt-3">
                              {criticalAllergenObs.length === 0 ? (
                                <p className="text-sm text-zinc-400 py-4 leading-relaxed">
                                  Keine klinisch relevanten Allergiewerte erkannt. IgG-Nahrungsmittelpanel-Tests werden nicht erfasst — sie sind kommerziell und von den großen Allergologie-Gesellschaften (AAAAI, EAACI) nicht als diagnostisches Instrument anerkannt.
                                </p>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {criticalAllergenObs.map((o) => {
                                    const hasNumber = o.value != null
                                    const val = hasNumber
                                      ? `${o.value}${o.unit ? ' ' + o.unit : ''}`
                                      : o.value_text ?? '–'
                                    const badgeColor = o.status === 'critical'
                                      ? 'bg-red-100 text-red-700 border-red-200'
                                      : 'bg-orange-100 text-orange-700 border-orange-200'
                                    const foods = foodNotes[o.display_name]
                                    return (
                                      <div key={o.id} className="bg-orange-50 rounded-xl border border-orange-200 p-4">
                                        <div className="flex items-start justify-between mb-2 gap-2">
                                          <p className="text-sm font-medium text-orange-900 leading-tight flex-1 min-w-0">{o.display_name}</p>
                                          <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${badgeColor}`}>
                                            {statusLabel[o.status as keyof typeof statusLabel] ?? o.status}
                                          </span>
                                        </div>
                                        <p className="text-xl font-semibold text-orange-900">{val}</p>
                                        {o.reference_range_text && (
                                          <p className="text-xs text-orange-500 mt-1">Ref: {o.reference_range_text}</p>
                                        )}
                                        {foods ? (
                                          <p className="text-xs text-orange-700 leading-relaxed mt-3 pt-3 border-t border-orange-200">{foods}</p>
                                        ) : !foodNotesLoaded ? (
                                          <div className="mt-3 pt-3 border-t border-orange-200">
                                            <div className="h-2.5 bg-orange-100 rounded animate-pulse w-full mb-1.5" />
                                            <div className="h-2.5 bg-orange-100 rounded animate-pulse w-4/5" />
                                          </div>
                                        ) : null}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )
                  }

                  if (items.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center min-h-[300px]">
                        <p className="text-sm text-zinc-400">Noch keine Daten. Lade Dokumente hoch und drücke &quot;Zum Dashboard&quot;.</p>
                      </div>
                    )
                  }
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {items.map(itemCard)}
                    </div>
                  )
                })()}
              </div>
            )}

            {activeTab === 'dokumente' && (
              <div className="space-y-4 min-h-[480px]">
                {/* Search */}
                <input
                  type="search"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Dokumente suchen…"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent bg-white"
                />

                {/* Category filter */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setDocCategoryFilter([])}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      docCategoryFilter.length === 0
                        ? 'bg-zinc-900 text-white border-zinc-900'
                        : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400'
                    }`}
                  >
                    Alle
                  </button>
                  {ALL_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() =>
                        setDocCategoryFilter((prev) =>
                          prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
                        )
                      }
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        docCategoryFilter.includes(cat)
                          ? categoryStyle[cat]
                          : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Document list */}
                {documents.length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-12">Noch keine Dokumente vorhanden.</p>
                ) : (() => {
                  const q = docSearch.toLowerCase().trim()
                  const filtered = documents.filter((doc) => {
                    if (doc.extraction_status === 'split') return false
                    const matchesSearch = !q || [
                      doc.label,
                      doc.filename,
                      ...(doc.keywords ?? []),
                    ].some((s) => s?.toLowerCase().includes(q))
                    const matchesCat =
                      docCategoryFilter.length === 0 ||
                      (doc.categories ?? []).some((c) => docCategoryFilter.includes(c))
                    return matchesSearch && matchesCat
                  })

                  if (filtered.length === 0) {
                    return <p className="text-sm text-zinc-400 text-center py-8">Keine Dokumente gefunden.</p>
                  }

                  const statusDot: Record<string, string> = {
                    done: 'bg-green-400',
                    processing: 'bg-blue-400 animate-pulse',
                    error: 'bg-red-400',
                    pending: 'bg-zinc-300',
                  }

                  return (
                    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                      <div className="divide-y divide-zinc-100">
                        {filtered.map((doc) => {
                          const obsCount = doc.observations?.[0]?.count ?? 0
                          const displayLabel = doc.label || doc.filename
                          const showFilename = doc.label && doc.label !== doc.filename

                          return (
                            <div key={doc.id} className="px-4 py-3">
                              <div className="flex items-start gap-3">
                                <span className="text-lg shrink-0 mt-0.5">
                                  {doc.file_type === 'image' ? '🖼️' : '📄'}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-zinc-900 leading-snug">
                                    {displayLabel}
                                  </p>
                                  {showFilename && (
                                    <p className="text-xs text-zinc-400 mt-0.5 truncate">{doc.filename}</p>
                                  )}
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                    {(doc.categories ?? []).map((cat) => (
                                      <span
                                        key={cat}
                                        className={`text-xs px-2 py-0.5 rounded-full border ${categoryStyle[cat] ?? 'bg-zinc-50 text-zinc-600 border-zinc-200'}`}
                                      >
                                        {cat}
                                      </span>
                                    ))}
                                    <span className="text-xs text-zinc-400">
                                      {new Date(doc.uploaded_at).toLocaleDateString('de-DE')}
                                      {obsCount > 0 && ` · ${obsCount} Wert${obsCount !== 1 ? 'e' : ''}`}
                                      {doc.page_start != null && ` · S. ${doc.page_start}${doc.page_end !== doc.page_start ? `–${doc.page_end}` : ''}`}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                                  <span className={`w-2 h-2 rounded-full ${statusDot[doc.extraction_status] ?? 'bg-zinc-300'}`} />
                                  <a
                                    href={`/api/documents/${doc.id}/download`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-zinc-500 hover:text-zinc-800 transition-colors px-2 py-1.5 rounded border border-zinc-200 hover:border-zinc-400"
                                  >
                                    Download
                                  </a>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function BodyAgeSmiley({ diff, className = 'w-11 h-11' }: { diff: number; className?: string }) {
  if (diff <= -5)
    return <img src="/SVGs/man-cartwheeling-medium-skin-tone.svg" className={className} aria-hidden="true" />
  if (diff >= 7)
    return <img src="/SVGs/old-man-medium-skin-tone.svg" className={className} aria-hidden="true" />
  if (diff >= 0 && diff <= 2)
    return <img src="/SVGs/MEH.svg" className={className} aria-hidden="true" />

  // diff -4 to -1: slight smile · diff 3 to 6: frown
  const isSmile = diff < 0
  const color = isSmile ? '#16a34a' : '#f97316'
  const mouth = isSmile ? 'M 13,29 Q 24,36 35,29' : 'M 13,30 Q 24,22 35,30'

  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill={color} />
      <circle cx="17" cy="19" r="2.5" fill="white" />
      <circle cx="31" cy="19" r="2.5" fill="white" />
      <path d={mouth} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

