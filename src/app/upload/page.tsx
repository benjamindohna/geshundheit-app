'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

type FileStatus = 'pending' | 'uploading' | 'extracting' | 'done' | 'duplicate' | 'needs-review' | 'error'

type FileEntry = {
  file: File
  status: FileStatus
  error?: string
  count?: number
  reviewId?: string  // doc ID for PDFs that need review
}

export default function UploadPage() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [running, setRunning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
    const newEntries: FileEntry[] = Array.from(files)
      .filter((f) => allowed.includes(f.type))
      .map((f) => ({ file: f, status: 'pending' }))
    if (newEntries.length === 0) return
    setEntries((prev) => [...prev, ...newEntries])
  }

  function updateEntry(index: number, patch: Partial<FileEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  async function processAll() {
    setRunning(true)
    const currentEntries = entries.filter((e) => e.status === 'pending')

    for (let i = 0; i < entries.length; i++) {
      if (entries[i].status !== 'pending') continue

      updateEntry(i, { status: 'uploading' })

      const formData = new FormData()
      formData.append('file', entries[i].file)

      let uploadData: { document?: { id: string }; duplicate?: boolean; error?: string }
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData })
        uploadData = await res.json()
        if (!res.ok) {
          updateEntry(i, { status: 'error', error: uploadData.error ?? 'Upload fehlgeschlagen' })
          continue
        }
      } catch {
        updateEntry(i, { status: 'error', error: 'Netzwerkfehler' })
        continue
      }

      if (uploadData.duplicate) {
        updateEntry(i, { status: 'duplicate' })
        continue
      }

      // PDFs → review page, images → direct extraction
      const isPdf = entries[i].file.type === 'application/pdf'
      if (isPdf) {
        updateEntry(i, { status: 'needs-review', reviewId: uploadData.document!.id })
        continue
      }

      updateEntry(i, { status: 'extracting' })

      try {
        const extractRes = await fetch(`/api/extract/${uploadData.document!.id}`, { method: 'POST' })
        const extractData = await extractRes.json()
        if (!extractRes.ok) {
          updateEntry(i, { status: 'error', error: extractData.error ?? 'Extraktion fehlgeschlagen' })
        } else {
          updateEntry(i, { status: 'done', count: extractData.count })
        }
      } catch {
        updateEntry(i, { status: 'error', error: 'Extraktion fehlgeschlagen' })
      }
    }

    setRunning(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  const pendingCount = entries.filter((e) => e.status === 'pending').length
  const doneCount = entries.filter((e) => e.status === 'done').length
  const dupCount = entries.filter((e) => e.status === 'duplicate').length
  const errorCount = entries.filter((e) => e.status === 'error').length
  const totalExtracted = entries.reduce((s, e) => s + (e.count ?? 0), 0)
  const allFinished = entries.length > 0 && !running && pendingCount === 0

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors py-2 pr-2 min-h-[44px] flex items-center"
          >
            ← Zurück
          </Link>
          <h1 className="text-base font-semibold text-zinc-900">Dokumente hochladen</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed py-10 px-8 text-center transition-colors ${
            dragOver ? 'border-zinc-400 bg-zinc-100' : 'border-zinc-300 bg-white'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          {/* webkitdirectory via ref so TypeScript doesn't complain */}
          <input
            ref={folderRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <p className="text-sm font-medium text-zinc-700 mb-4">Dateien oder Ordner hinzufügen</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => inputRef.current?.click()}
              className="px-4 py-2.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Dateien wählen
            </button>
            <button
              onClick={() => {
                if (folderRef.current) {
                  folderRef.current.setAttribute('webkitdirectory', '')
                  folderRef.current.click()
                }
              }}
              className="px-4 py-2.5 border border-zinc-300 text-zinc-700 text-sm rounded-lg hover:bg-zinc-50 transition-colors"
            >
              Ordner wählen
            </button>
          </div>
          <p className="text-xs text-zinc-400 mt-3">PDF, JPEG, PNG · Bereits hochgeladene Dateien werden automatisch übersprungen</p>
        </div>

        {/* File list */}
        {entries.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="divide-y divide-zinc-100">
              {entries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <StatusIcon status={entry.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-800 truncate">{entry.file.name}</p>
                    {entry.error && <p className="text-xs text-red-500 mt-0.5">{entry.error}</p>}
                    {entry.status === 'done' && (
                      <p className="text-xs text-green-600 mt-0.5">{entry.count} Wert{entry.count !== 1 ? 'e' : ''} extrahiert</p>
                    )}
                    {entry.status === 'duplicate' && (
                      <p className="text-xs text-zinc-400 mt-0.5">Bereits hochgeladen – übersprungen</p>
                    )}
                    {entry.status === 'extracting' && (
                      <p className="text-xs text-zinc-400 mt-0.5">Claude analysiert…</p>
                    )}
                    {entry.status === 'needs-review' && (
                      <p className="text-xs text-blue-600 mt-0.5">PDF bereit zur Prüfung</p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="text-xs text-zinc-400">
                      {(entry.file.size / 1024).toFixed(0)} KB
                    </span>
                    {entry.status === 'needs-review' && entry.reviewId && (
                      <Link
                        href={`/review/${entry.reviewId}`}
                        className="text-xs px-2.5 py-1.5 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"
                      >
                        Prüfen →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary after completion */}
        {allFinished && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
            <p className="font-medium mb-1">Fertig</p>
            <p>{doneCount} neu verarbeitet · {dupCount} übersprungen · {totalExtracted} Werte extrahiert{errorCount > 0 ? ` · ${errorCount} Fehler` : ''}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          {pendingCount > 0 && !running && (
            <button
              onClick={processAll}
              className="flex-1 py-3 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors"
            >
              {pendingCount} Datei{pendingCount !== 1 ? 'en' : ''} verarbeiten
            </button>
          )}
          {running && (
            <div className="flex-1 py-3 bg-zinc-100 text-zinc-500 text-sm text-center rounded-xl">
              Verarbeite…
            </div>
          )}
          {allFinished && (
            <Link
              href="/"
              className="flex-1 py-3 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors text-center"
            >
              Zum Dashboard
            </Link>
          )}
          {entries.length > 0 && !running && (
            <button
              onClick={() => setEntries([])}
              className="px-4 py-3 border border-zinc-300 text-zinc-600 text-sm rounded-xl hover:bg-zinc-50 transition-colors"
            >
              Leeren
            </button>
          )}
        </div>
      </main>
    </div>
  )
}

function StatusIcon({ status }: { status: FileStatus }) {
  const icons: Record<FileStatus, string> = {
    pending: '○',
    uploading: '⬆',
    extracting: '🔬',
    done: '✓',
    duplicate: '↩',
    'needs-review': '📋',
    error: '✕',
  }
  const colors: Record<FileStatus, string> = {
    pending: 'text-zinc-300',
    uploading: 'text-blue-500',
    extracting: 'text-blue-500',
    done: 'text-green-500',
    duplicate: 'text-zinc-400',
    'needs-review': 'text-blue-500',
    error: 'text-red-500',
  }
  return (
    <span className={`text-base w-5 text-center shrink-0 ${colors[status]}`}>
      {icons[status]}
    </span>
  )
}
