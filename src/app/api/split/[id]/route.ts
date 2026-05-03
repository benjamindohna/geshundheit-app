import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { anthropic } from '@/lib/anthropic'

const SPLIT_PROMPT = `Du bist ein Assistent der hilft, gescannte medizinische Dokumente zu sortieren.

Analysiere dieses mehrseitige PDF und identifiziere alle einzelnen Dokumente darin.
Ein "Dokument" ist z.B. ein Laborbefund, ein Arztbrief, ein Röntgenbefund, ein Rezept etc.

Gib ein JSON-Objekt zurück:
{
  "total_pages": number (Gesamtseitenanzahl des PDFs),
  "groups": [
    {
      "label": string (beschreibender Titel, max. 60 Zeichen, z.B. "Großes Blutbild – Dr. Müller, März 2025"),
      "categories": string[] (1–3 aus: Laborwerte, Bildgebung, Arztbrief, Messwerte, Medikamente, Impfungen, Sonstiges),
      "page_start": number (erste Seite, 1-basiert),
      "page_end": number (letzte Seite, 1-basiert)
    }
  ]
}

Regeln:
- Jede Seite gehört zu genau einer Gruppe
- Gruppen müssen alle Seiten lückenlos abdecken
- Seiten die eindeutig zusammengehören (gleicher Befund, gleiches Datum, gleicher Arzt) → eine Gruppe
- Wenn du dir bei Seitenzugehörigkeit unsicher bist, tendiere eher zu kleineren Gruppen

Antworte NUR mit dem JSON-Objekt, ohne Markdown oder Erklärungen.`

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: doc, error } = await supabase
    .from('documents')
    .select('storage_path, filename, file_type')
    .eq('id', id)
    .single()

  if (error || !doc) {
    return NextResponse.json({ error: 'Dokument nicht gefunden' }, { status: 404 })
  }

  if (doc.file_type !== 'pdf') {
    return NextResponse.json({ error: 'Nur PDFs können aufgeteilt werden' }, { status: 400 })
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('health-docs')
    .download(doc.storage_path)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'PDF konnte nicht geladen werden' }, { status: 500 })
  }

  const arrayBuffer = await fileData.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: SPLIT_PROMPT },
      ],
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const result = JSON.parse(cleaned) as {
    total_pages: number
    groups: { label: string; categories: string[]; page_start: number; page_end: number }[]
  }

  return NextResponse.json(result)
}
