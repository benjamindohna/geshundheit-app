import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { anthropic } from '@/lib/anthropic'
import { generateMissingDescriptions } from '@/lib/descriptions'
import { classifyAndFlagAllergens } from '@/lib/allergen-classifier'
import { getCached, setCached } from '@/lib/extraction-cache'

const VALID_CATEGORIES = [
  'Laborwerte',
  'Bildgebung',
  'Arztbrief',
  'Messwerte',
  'Medikamente',
  'Impfungen',
  'Sonstiges',
] as const

const EXTRACTION_PROMPT = `Du bist ein medizinischer Datenextraktions-Assistent. Analysiere dieses Gesundheitsdokument und erfasse alle objektiven Gesundheitsmesswerte und Befunde.

Gib ein JSON-Objekt mit folgenden Feldern zurück:

"label": Ein präziser, beschreibender deutscher Titel für dieses Dokument (max. 60 Zeichen).
Beispiele: "Großes Blutbild – Hausarzt, März 2025", "MRT rechtes Knie – Radiologie Muster"

"categories": Array mit 1–3 passenden Kategorien aus dieser Liste (nur exakt diese Werte):
["Laborwerte", "Bildgebung", "Arztbrief", "Messwerte", "Medikamente", "Impfungen", "Sonstiges"]

"keywords": Array mit 6–12 deutschen Suchbegriffen

"observations": Nur klinisch anerkannte Messwerte und medizinische Befunde, die die allgemeine Gesundheit abbilden.

NICHT in observations erfassen (explizit ausschließen):
- Wellness-Scores, gerätespezifische Indizes ohne klinische Norm (z.B. Stoffwechselindex %, Zuckerverbrennung %, biologisches Alter, Fitness-Score, Stresslevel-Index)
- IgG-Nahrungsmittelpanel-Werte (IgG auf Lebensmittel wie IgG Hühnerei, IgG Weizen etc.) — diese Tests sind kommerziell, klinisch nicht validiert und von AAAAI und EAACI nicht anerkannt
- Medikamente, Supplements, Behandlungen, Massagen
- Ernährungsempfehlungen, Verhaltensanweisungen
- Rechnungen, administrative Daten, Versicherungsinformationen
- Nicht-medizinische Dokumente (wenn das Dokument kein Gesundheitsdokument ist: observations = [])

Erfasse in observations ausschließlich Werte mit anerkannten klinischen Referenzbereichen:
- Laborwerte: Blutbild (Hb, Hkt, Leukozyten, Thrombozyten etc.), Stoffwechsel (Glukose, HbA1c, Insulin), Lipide (LDL, HDL, Triglyzeride), Leber (GOT, GPT, GGT), Niere (Kreatinin, GFR, Harnstoff), Schilddrüse (TSH, fT3, fT4), Entzündung (CRP, BSG), Vitamine/Mineralien (Ferritin, Vitamin D, B12, Magnesium etc.), Hormone
- Klinisch anerkannte Allergietests: IgE-Werte (z.B. IgE Erdnuss, IgE Hausstaubmilbe), Prick-Test-Befunde, ärztlich diagnostizierte Nahrungsmittelallergien
- Vitalparameter: Blutdruck, Puls, Körpertemperatur, Sauerstoffsättigung
- Körpermessungen: Gewicht (kg), Größe (cm), BMI, Körperfettanteil (%), Muskelmasse (kg), Taillenumfang
- Medizinische Befunde und Diagnosen: Bildgebungsbefunde, Pathologiebefunde, ärztlich festgestellte Diagnosen

Für jeden observations-Eintrag:
- display_name: Klinische Bezeichnung
- loinc_code: LOINC code as string (e.g. "2160-0") — provide whenever a standard LOINC code exists for this measurement; null only if no LOINC code is defined for this type
- value: Zahl | null (null bei qualitativen Befunden)
- value_text: string | null (Befundtext, null bei Zahlenwerten)
- unit: string | null
- reference_range_low: number | null
- reference_range_high: number | null
- reference_range_text: string | null
- status: "normal" | "borderline" | "abnormal" | "critical"
  Priorität 1: Referenzbereich aus dem Dokument.
  Priorität 2: Anerkannte klinische Normen (z.B. LDL < 3,0 mmol/L, TSH 0,4–4,0 mU/L).
  "critical" nur bei Werten mit unmittelbarer klinischer Relevanz (weit außerhalb etablierter Normen).
  Interpretationstexte des Dokuments NICHT für die Statusbewertung verwenden.
- clinical_severity: 1–10 (1 = unauffällig, 10 = unmittelbar behandlungsbedürftig)
- measured_at: string (ISO-Datum aus dem Dokument; falls unbekannt: TODAY_DATE)
- volatility: "high" | "medium" | "low"

Antworte NUR mit dem JSON-Objekt, ohne Markdown oder Erklärungen.`

const TODAY = new Date().toISOString().split('T')[0]
const PROMPT_WITH_DATE = EXTRACTION_PROMPT.replace('TODAY_DATE', TODAY)

type DocumentRow = {
  id: string
  filename: string
  storage_path: string
  file_type: string
  extraction_status: string
  content_hash: string
}

type AllergenResult = {
  name: string
  severity: string
  common_foods: string[]
}

type ExtractionResult = {
  label: string
  categories: string[]
  keywords: string[]
  observations: Record<string, unknown>[]
  allergens?: AllergenResult[]
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
    let result: ExtractionResult

    const cached = getCached(doc.content_hash)
    if (cached) {
      result = cached
    } else {
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
          { type: 'text', text: PROMPT_WITH_DATE },
        ]
      } else {
        messageContent = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: PROMPT_WITH_DATE },
        ]
      }

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        messages: [{ role: 'user', content: messageContent }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      result = JSON.parse(cleaned) as ExtractionResult

      setCached(doc.content_hash, result)
    }

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
      measured_at: obs.measured_at ?? TODAY,
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

    void generateMissingDescriptions(rows.map((r) => r.display_name as string)).catch(console.error)
    void classifyAndFlagAllergens(id).catch(console.error)

    const allergenRows = (Array.isArray(result.allergens) ? result.allergens : [])
      .filter((a) => a.name && a.severity)
      .map((a) => ({
        document_id: id,
        name: String(a.name),
        severity: String(a.severity),
        common_foods: Array.isArray(a.common_foods) ? a.common_foods.map(String) : [],
        updated_at: new Date().toISOString(),
      }))

    if (allergenRows.length > 0) {
      await supabase.from('allergens').delete().eq('document_id', id)
      await supabase.from('allergens').insert(allergenRows)
    }

    return NextResponse.json({ count: rows.length, allergenCount: allergenRows.length, label, categories })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    await supabase
      .from('documents')
      .update({ extraction_status: 'error', extraction_error: message })
      .eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
