import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'

type AllergenInput = {
  name: string
  value: number | null
  unit: string | null
  status: string
}

export async function POST(request: NextRequest) {
  const { allergens } = await request.json() as { allergens: AllergenInput[] }
  if (!allergens || allergens.length === 0) return NextResponse.json({ foodNotes: {} })

  const names = allergens.map((a) => a.name)

  const { data: existing } = await supabase
    .from('allergen_food_notes')
    .select('display_name, food_note')
    .in('display_name', names)

  const result: Record<string, string> = {}
  const cached = new Set<string>()
  for (const row of existing ?? []) {
    result[row.display_name] = row.food_note
    cached.add(row.display_name)
  }

  const missing = allergens.filter((a) => !cached.has(a.name))
  if (missing.length === 0) return NextResponse.json({ foodNotes: result })

  const list = missing
    .map((a) => `- ${a.name} (Wert: ${a.value != null ? `${a.value}${a.unit ? ' ' + a.unit : ''}` : 'qualitativ'}, Status: ${a.status})`)
    .join('\n')

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Du bist Ernährungsberater und Allergologe. Für jeden der folgenden Allergen-/Unverträglichkeitstests mit Messwert und Status:

Schreibe eine kurze, klare Einschätzung auf Deutsch (max. 70 Wörter) die folgendes abdeckt:
1. Welche typischen Lebensmittel dieses Allergen enthalten (3–5 Beispiele)
2. Klare Empfehlung: komplett meiden oder ist gelegentlich (z.B. 1–2× pro Woche) tolerierbar?
3. Was passiert wenn man es trotzdem isst? (konkrete Symptome, ein Satz — je nach Schwere des Status)

Schreibe direkt und persönlich, kein medizinisches Kauderwelsch.

Antworte NUR mit einem JSON-Objekt: {"Testname": "Einschätzungstext", ...}
Kein Markdown, keine Einleitung.

Tests:
${list}`,
    }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '{}'
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  let generated: Record<string, string> = {}
  try {
    generated = JSON.parse(cleaned) as Record<string, string>
  } catch {
    return NextResponse.json({ foodNotes: result })
  }

  const rows = Object.entries(generated).map(([display_name, food_note]) => ({
    display_name,
    food_note,
    updated_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    await supabase.from('allergen_food_notes').upsert(rows, { onConflict: 'display_name' })
  }

  return NextResponse.json({ foodNotes: { ...result, ...generated } })
}
