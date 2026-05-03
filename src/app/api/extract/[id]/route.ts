import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { anthropic } from '@/lib/anthropic'

const EXTRACTION_PROMPT = `Du bist ein medizinischer Datenextraktions-Assistent. Analysiere dieses Gesundheitsdokument und extrahiere alle messbaren Gesundheitswerte.

Gib die Daten als JSON-Array zurück. Jedes Objekt hat folgende Felder:
- display_name: string (deutscher Name des Wertes, z.B. "Hämoglobin", "Blutdruck systolisch", "Körpergewicht")
- loinc_code: string | null (LOINC-Code wenn bekannt)
- value: number | null (numerischer Wert)
- value_text: string | null (Text wenn kein numerischer Wert, z.B. "positiv", "negativ")
- unit: string | null (Einheit, z.B. "g/dL", "mmHg", "kg")
- reference_range_low: number | null
- reference_range_high: number | null
- reference_range_text: string | null (Referenzbereich als Text falls vorhanden)
- status: "normal" | "borderline" | "abnormal" | "critical" (basierend auf dem Referenzbereich)
- clinical_severity: number 1-10 (1=harmlos, 10=lebensbedrohlich, bewertet nach medizinischer Relevanz von Abweichungen)
- measured_at: string (ISO-Datum des Messzeitpunkts, falls nicht im Dokument: heute ${new Date().toISOString().split('T')[0]})
- volatility: "high" | "medium" | "low" (wie schnell ändert sich dieser Wert typischerweise)

Antworte NUR mit dem JSON-Array, ohne Markdown-Code-Blöcke oder Erklärungen.`

type DocumentRow = {
  id: string
  filename: string
  storage_path: string
  file_type: string
  extraction_status: string
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .single<DocumentRow>()

  if (docError || !doc) {
    return NextResponse.json({ error: 'Dokument nicht gefunden' }, { status: 404 })
  }

  await supabase
    .from('documents')
    .update({ extraction_status: 'processing' })
    .eq('id', id)

  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('health-docs')
      .download(doc.storage_path)

    if (downloadError || !fileData) {
      throw new Error(downloadError?.message ?? 'Download fehlgeschlagen')
    }

    const arrayBuffer = await fileData.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    type MessageParam = Parameters<typeof anthropic.messages.create>[0]['messages'][number]
    let messageContent: MessageParam['content']

    if (doc.file_type === 'image') {
      const mimeType = doc.storage_path.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg'
      messageContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]
    } else {
      messageContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: messageContent }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const observations = JSON.parse(cleaned) as Record<string, unknown>[]

    if (!Array.isArray(observations)) {
      throw new Error('Ungültiges Format von Claude')
    }

    const rows = observations.map((obs) => ({
      document_id: id,
      display_name: obs.display_name,
      loinc_code: obs.loinc_code ?? null,
      value: obs.value ?? null,
      value_text: obs.value_text ?? null,
      unit: obs.unit ?? null,
      reference_range_low: obs.reference_range_low ?? null,
      reference_range_high: obs.reference_range_high ?? null,
      reference_range_text: obs.reference_range_text ?? null,
      status: obs.status ?? 'normal',
      clinical_severity: obs.clinical_severity ?? 1,
      measured_at: obs.measured_at ?? new Date().toISOString().split('T')[0],
      volatility: obs.volatility ?? 'medium',
    }))

    const { error: insertError } = await supabase.from('observations').insert(rows)
    if (insertError) throw new Error(insertError.message)

    await supabase
      .from('documents')
      .update({ extraction_status: 'done', processed_at: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({ count: rows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    await supabase
      .from('documents')
      .update({ extraction_status: 'error', extraction_error: message })
      .eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
