import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { anthropic } from '@/lib/anthropic'

const VALID_CATEGORIES = [
  'Laborwerte',
  'Bildgebung',
  'Arztbrief',
  'Messwerte',
  'Medikamente',
  'Impfungen',
  'Sonstiges',
] as const

const EXTRACTION_PROMPT = `Du bist ein medizinischer Datenextraktions-Assistent. Analysiere dieses Gesundheitsdokument vollständig.

Gib ein JSON-Objekt mit folgenden Feldern zurück:

"label": Ein präziser, beschreibender deutscher Titel für dieses Dokument (max. 60 Zeichen).
Beispiele: "Großes Blutbild – Hausarzt, März 2025", "MRT rechtes Knie – Radiologie Muster", "Arztbrief Kardiologie – Entlassung Jan 2025"

"categories": Array mit 1–3 passenden Kategorien aus dieser Liste (nur exakt diese Werte):
["Laborwerte", "Bildgebung", "Arztbrief", "Messwerte", "Medikamente", "Impfungen", "Sonstiges"]
- Laborwerte: Blutbilder, Urin, alle Labor-PDFs mit Messwerten
- Bildgebung: Röntgen, MRT, CT, Ultraschall, Szintigrafie
- Arztbrief: Befundberichte, Entlassungsbriefe, Überweisungen, Atteste
- Messwerte: Selbst gemessene Werte (Blutdruckprotokoll, Gewichtsverlauf)
- Medikamente: Rezepte, Medikationspläne, Packungsbeilagen
- Impfungen: Impfausweis, Impfbescheinigungen
- Sonstiges: Alles andere

"keywords": Array mit 6–12 deutschen Suchbegriffen (Fachbegriffe, Messwerte, Arztname, Körperteil, Datum, Institution – was zum Wiederfinden hilft)

"observations": Array aller messbaren Gesundheitswerte. Jedes Objekt hat:
- display_name: string (deutscher Name, z.B. "Hämoglobin")
- loinc_code: string | null
- value: number | null
- value_text: string | null (z.B. "positiv", "unauffällig")
- unit: string | null
- reference_range_low: number | null
- reference_range_high: number | null
- reference_range_text: string | null
- status: "normal" | "borderline" | "abnormal" | "critical"
- clinical_severity: number 1–10 (Relevanz bei Abweichung; 1=harmlos, 10=lebensbedrohlich)
- measured_at: string (ISO-Datum; falls unbekannt: ${new Date().toISOString().split('T')[0]})
- volatility: "high" | "medium" | "low"

Antworte NUR mit dem JSON-Objekt, ohne Markdown oder Erklärungen.`

type DocumentRow = {
  id: string
  filename: string
  storage_path: string
  file_type: string
  extraction_status: string
}

type ExtractionResult = {
  label: string
  categories: string[]
  keywords: string[]
  observations: Record<string, unknown>[]
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
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]
    } else {
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
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
    const result = JSON.parse(cleaned) as ExtractionResult

    // Validate categories – keep only known values
    const categories = Array.isArray(result.categories)
      ? result.categories.filter((c) => (VALID_CATEGORIES as readonly string[]).includes(c))
      : ['Sonstiges']

    const keywords = Array.isArray(result.keywords) ? result.keywords : []
    const label = typeof result.label === 'string' && result.label.trim()
      ? result.label.trim()
      : doc.filename

    const observations = Array.isArray(result.observations) ? result.observations : []

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

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('observations').insert(rows)
      if (insertError) throw new Error(insertError.message)
    }

    await supabase
      .from('documents')
      .update({
        extraction_status: 'done',
        processed_at: new Date().toISOString(),
        label,
        categories,
        keywords,
      })
      .eq('id', id)

    return NextResponse.json({ count: rows.length, label, categories })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    await supabase
      .from('documents')
      .update({ extraction_status: 'error', extraction_error: message })
      .eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
