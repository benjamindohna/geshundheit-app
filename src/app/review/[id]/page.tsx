'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ALL_CATEGORIES = [
  'Laborwerte', 'Bildgebung', 'Arztbrief',
  'Messwerte', 'Medikamente', 'Impfungen', 'Sonstiges',
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

type Group = {
  label: string
  categories: string[]
  page_start: number
  page_end: number
}

type ExtractionEntry = Group & {
  childId?: string
  status: 'pending' | 'extracting' | 'done' | 'error'
  count?: number
  error?: string
}

type Phase = 'analyzing' | 'reviewing' | 'extracting' | 'done'

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('analyzing')
  const [totalPages, setTotalPages] = useState(0)
  const [groups, setGroups] = useState<Group[]>([])
  const [entries, setEntries] = useState<ExtractionEntry[]>([])
  const [analyzeError, setAnalyzeError] = useState('')

  useEffect(() => {
    fetch(`/api/split/${id}`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setAnalyzeError(data.error); return }
        setTotalPages(data.total_pages)
        setGroups(data.groups)
        setPhase('reviewing')
      })
      .catch(() => setAnalyzeError('Analyse fehlgeschlagen'))
  }, [id])

  function updateGroup(index: number, patch: Partial<Group>) {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)))
  }

  function toggleCategory(groupIndex: number, cat: string) {
    const current = groups[groupIndex].categories
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat]
    updateGroup(groupIndex, { categories: next.length ? next : ['Sonstiges'] })
  }

  function mergeDown(index: number) {
    setGroups((prev) => {
      const next = [...prev]
      const merged: Group = {
        label: next[index].label,
        categories: [...new Set([...next[index].categories, ...next[index + 1].categories])],
        page_start: next[index].page_start,
        page_end: next[index + 1].page_end,
      }
      next.splice(index, 2, merged)
      return next
    })
  }

  async function confirm() {
    setPhase('extracting')
    const initial: ExtractionEntry[] = groups.map((g) => ({ ...g, status: 'pending' }))
    setEntries(initial)

    const confirmRes = await fetch(`/api/split/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    })
    const { children, error } = await confirmRes.json()
    if (error || !children) {
      setEntries((prev) => prev.map((e) => ({ ...e, status: 'error', error: error ?? 'Fehler' })))
      return
    }

    // Attach child IDs to entries
    setEntries((prev) =>
      prev.map((e, i) => ({ ...e, childId: children[i]?.id, status: 'extracting' }))
    )

    // Extract each child sequentially
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      try {
        const res = await fetch(`/api/extract/${child.id}`, { method: 'POST' })
        const data = await res.json()
        setEntries((prev) =>
          prev.map((e, j) =>
            j === i
              ? { ...e, status: res.ok ? 'done' : 'error', count: data.count, error: data.error }
              : e
          )
        )
      } catch {
        setEntries((prev) =>
          prev.map((e, j) => (j === i ? { ...e, status: 'error', error: 'Netzwerkfehler' } : e))
        )
      }
    }

    setPhase('done')
  }

  const pageLabel = (g: Group) =>
    g.page_start === g.page_end ? `S. ${g.page_start}` : `S. ${g.page_start}–${g.page_end}`

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          {phase === 'reviewing' && (
            <Link href="/upload" className="text-sm text-zinc-500 hover:text-zinc-700 py-2 pr-2 min-h-[44px] flex items-center">
              ← Zurück
            </Link>
          )}
          <h1 className="text-base font-semibold text-zinc-900">Dokumente prüfen</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">

        {/* ANALYZING */}
        {phase === 'analyzing' && !analyzeError && (
          <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center">
            <div className="text-4xl mb-4 animate-pulse">🔍</div>
            <p className="text-base font-semibold text-zinc-900 mb-1">Claude analysiert das PDF…</p>
            <p className="text-sm text-zinc-500">Dokumente werden erkannt und gruppiert</p>
          </div>
        )}

        {analyzeError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {analyzeError}
          </div>
        )}

        {/* REVIEWING */}
        {phase === 'reviewing' && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-zinc-600">
                <span className="font-semibold text-zinc-900">{groups.length} Dokument{groups.length !== 1 ? 'e' : ''}</span>
                {' '}erkannt in {totalPages} Seiten
              </p>
              <p className="text-xs text-zinc-400">Labels und Kategorien sind bearbeitbar</p>
            </div>

            {groups.map((group, i) => (
              <div key={i}>
                <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
                  {/* Label + pages */}
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-zinc-400 shrink-0 mt-2.5 w-14">{pageLabel(group)}</span>
                    <input
                      value={group.label}
                      onChange={(e) => updateGroup(i, { label: e.target.value })}
                      className="flex-1 text-sm font-medium text-zinc-900 bg-transparent border-b border-zinc-200 focus:border-zinc-900 focus:outline-none pb-0.5"
                    />
                  </div>

                  {/* Category selector */}
                  <div className="flex flex-wrap gap-1.5 pl-[4.25rem]">
                    {ALL_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(i, cat)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          group.categories.includes(cat)
                            ? categoryStyle[cat]
                            : 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Merge button between groups */}
                {i < groups.length - 1 && (
                  <div className="flex items-center gap-2 py-1 px-4">
                    <div className="flex-1 h-px bg-zinc-200" />
                    <button
                      onClick={() => mergeDown(i)}
                      className="text-xs text-zinc-400 hover:text-zinc-700 px-2 py-1 rounded border border-zinc-200 hover:border-zinc-400 transition-colors"
                      title="Diese und nächste Gruppe zusammenführen"
                    >
                      zusammenführen
                    </button>
                    <div className="flex-1 h-px bg-zinc-200" />
                  </div>
                )}
              </div>
            ))}

            <button
              onClick={confirm}
              className="w-full py-3 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors"
            >
              {groups.length} Dokument{groups.length !== 1 ? 'e' : ''} bestätigen und extrahieren
            </button>
          </div>
        )}

        {/* EXTRACTING */}
        {(phase === 'extracting' || phase === 'done') && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">
              {phase === 'done'
                ? 'Extraktion abgeschlossen'
                : 'Claude extrahiert Gesundheitswerte…'}
            </p>

            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              <div className="divide-y divide-zinc-100">
                {entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <ExtractionIcon status={entry.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{entry.label}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {pageLabel(entry)}
                        {entry.status === 'done' && entry.count !== undefined &&
                          ` · ${entry.count} Wert${entry.count !== 1 ? 'e' : ''} extrahiert`}
                        {entry.status === 'extracting' && ' · analysiert…'}
                        {entry.status === 'error' && ` · Fehler: ${entry.error}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1 shrink-0">
                      {entry.categories.map((cat) => (
                        <span key={cat} className={`text-xs px-2 py-0.5 rounded-full border ${categoryStyle[cat] ?? ''}`}>
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {phase === 'done' && (
              <button
                onClick={() => router.push('/')}
                className="w-full py-3 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors"
              >
                Zum Dashboard
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function ExtractionIcon({ status }: { status: ExtractionEntry['status'] }) {
  const map = {
    pending:    { icon: '○', color: 'text-zinc-300' },
    extracting: { icon: '⟳', color: 'text-blue-500 animate-spin' },
    done:       { icon: '✓', color: 'text-green-500' },
    error:      { icon: '✕', color: 'text-red-500' },
  }
  const { icon, color } = map[status]
  return <span className={`text-base w-5 text-center shrink-0 ${color}`}>{icon}</span>
}
