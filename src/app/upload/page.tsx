'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

type UploadState = 'idle' | 'uploading' | 'extracting' | 'done' | 'error'

export default function UploadPage() {
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState('')
  const [count, setCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function processFile(file: File) {
    setState('uploading')
    setError('')

    const formData = new FormData()
    formData.append('file', file)

    const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
    const uploadData = await uploadRes.json()

    if (!uploadRes.ok) {
      setError(uploadData.error ?? 'Upload fehlgeschlagen')
      setState('error')
      return
    }

    const docId = uploadData.document.id
    setState('extracting')

    const extractRes = await fetch(`/api/extract/${docId}`, { method: 'POST' })
    const extractData = await extractRes.json()

    if (!extractRes.ok) {
      setError(extractData.error ?? 'Extraktion fehlgeschlagen')
      setState('error')
      return
    }

    setCount(extractData.count)
    setState('done')
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    processFile(files[0])
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors">
            ← Zurück
          </Link>
          <h1 className="text-base font-semibold text-zinc-900">Dokument hochladen</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        {state === 'idle' || state === 'error' ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-16 text-center transition-colors ${
              dragOver
                ? 'border-zinc-400 bg-zinc-100'
                : 'border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div className="text-4xl mb-4">📄</div>
            <p className="text-sm font-medium text-zinc-700 mb-1">
              Datei hier ablegen oder klicken
            </p>
            <p className="text-xs text-zinc-400">PDF, JPEG oder PNG – Blutbilder, Messwerte, Befunde</p>
            {state === 'error' && (
              <p className="mt-4 text-sm text-red-600">{error}</p>
            )}
          </div>
        ) : state === 'uploading' ? (
          <StatusCard icon="⬆️" title="Datei wird hochgeladen…" subtitle="Bitte warten" />
        ) : state === 'extracting' ? (
          <StatusCard
            icon="🔬"
            title="Claude analysiert das Dokument…"
            subtitle="KI extrahiert Gesundheitswerte – das kann einen Moment dauern"
          />
        ) : (
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center">
            <div className="text-4xl mb-4">✅</div>
            <p className="text-base font-semibold text-zinc-900 mb-1">
              {count} Messwert{count !== 1 ? 'e' : ''} extrahiert
            </p>
            <p className="text-sm text-zinc-500 mb-6">Die Werte sind jetzt im Dashboard verfügbar.</p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/"
                className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Zum Dashboard
              </Link>
              <button
                onClick={() => setState('idle')}
                className="px-4 py-2 border border-zinc-300 text-zinc-700 text-sm rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Weiteres Dokument
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function StatusCard({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center">
      <div className="text-4xl mb-4 animate-pulse">{icon}</div>
      <p className="text-base font-semibold text-zinc-900 mb-1">{title}</p>
      <p className="text-sm text-zinc-500">{subtitle}</p>
    </div>
  )
}
