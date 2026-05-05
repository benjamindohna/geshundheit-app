import { anthropic } from './anthropic'
import { supabase } from './supabase'

export async function classifyAndFlagAllergens(documentId: string): Promise<void> {
  const { data: rows } = await supabase
    .from('observations')
    .select('id, display_name')
    .eq('document_id', documentId)

  if (!rows || rows.length === 0) return

  const names = rows.map((r) => r.display_name as string)

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Du bekommst eine Liste von Messwert-Namen aus Gesundheitsdokumenten.
Für jeden Namen: antworte true wenn es ein Allergen- oder Unverträglichkeitstest ist (z.B. IgG, IgE, Nahrungsmittelreaktionen, Histamin, Lektine, Nahrungsmittelpanel-Werte), sonst false.
Klinische Standardwerte (Blutbild, Lipide, Hormone, Vitamine, Körpermessungen, Vitalparameter) sind KEIN Allergentest → false.

Antworte ausschließlich mit einem JSON-Objekt: {"Messwertname": true/false, ...}

Messwerte:
${names.map((n) => `- ${n}`).join('\n')}`,
    }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '{}'
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  let classification: Record<string, boolean> = {}
  try {
    classification = JSON.parse(cleaned) as Record<string, boolean>
  } catch {
    return
  }

  const allergenIds = rows
    .filter((r) => classification[r.display_name as string] === true)
    .map((r) => r.id as string)

  const nonAllergenIds = rows
    .filter((r) => classification[r.display_name as string] !== true)
    .map((r) => r.id as string)

  if (allergenIds.length > 0) {
    await supabase.from('observations').update({ is_allergen: true }).in('id', allergenIds)
  }
  if (nonAllergenIds.length > 0) {
    await supabase.from('observations').update({ is_allergen: false }).in('id', nonAllergenIds)
  }
}
