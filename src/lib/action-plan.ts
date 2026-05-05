import { supabase } from './supabase'
import { anthropic } from './anthropic'
import { fetchObsText } from './profile'

const BIRTH_DATE = new Date('1975-07-11')

function getAge(): number {
  const today = new Date()
  let age = today.getFullYear() - BIRTH_DATE.getFullYear()
  const m = today.getMonth() - BIRTH_DATE.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < BIRTH_DATE.getDate())) age--
  return age
}

export type ActionPlanItem = {
  id?: string
  category: string
  title: string
  value: string | null
  label: string | null
  note: string | null
  prescription_required: boolean
  updated_at?: string
}

type RawItem = {
  title: string
  value?: string
  label?: string
  note?: string
  prescription_required?: boolean
}

function existingToText(items: ActionPlanItem[]): string {
  return items.map((i) =>
    `- ${i.title}: ${i.value ?? ''}${i.label ? ` (${i.label})` : ''}${i.prescription_required ? ' [Rx]' : ''} — ${i.note ?? ''}`
  ).join('\n')
}

function buildPrompt(
  category: 'exercises' | 'habits' | 'nutrition' | 'supplements',
  obs: string,
  age: number,
  existing: ActionPlanItem[]
): string {
  const hasExisting = existing.length > 0

  if (category === 'exercises') {
    const format = `[{"title": "Übungsname", "value": "Sets × Wdh. oder Dauer", "label": "z.B. 3× pro Woche", "note": "Hinweis"}]`
    if (hasExisting) return `Bestehender Trainingsplan für Nikolaus (${age} Jahre):
${existingToText(existing)}

Aktuelle Messwerte:
${obs}

Überprüfe diesen Plan: Passe einzelne Punkte an wenn die Messwerte es rechtfertigen, behalte ihn sonst.
Gleiche JSON-Struktur: ${format}
Nur das JSON-Array. Kein Markdown.`
    return `Du erstellst einen personalisierten Wochentrainingsplan für Nikolaus (geb. 11.07.1975, ${age} Jahre alt).

Erstelle 6–10 Übungen die gemeinsam einen kohärenten Wochenplan ergeben. Berücksichtige Ausdauer, Kraft, Mobilität und Gewichtsreduktion basierend auf den Messwerten.

Format: ${format}

Messwerte:
${obs}

Antworte NUR mit dem JSON-Array. Kein erklärender Text, kein Markdown.`
  }

  if (category === 'habits') {
    const format = `[{"title": "Gewohnheit", "value": "konkretes Ziel", "label": "Häufigkeit", "note": "kurze Begründung"}]`
    if (hasExisting) return `Bestehende Habit-Empfehlungen für Nikolaus (${age} Jahre):
${existingToText(existing)}

Aktuelle Messwerte:
${obs}

Überprüfe und passe an wo nötig. Gleiche JSON-Struktur: ${format}
Nur das JSON-Array. Kein Markdown.`
    return `Du erstellst Lifestyle-Empfehlungen für Nikolaus (geb. 11.07.1975, ${age} Jahre alt).

Fokus auf: Schlaf, Stressreduktion, tägliche Routinen, Erholung, Alltagsbewegung.
5–8 konkrete, messbare Gewohnheiten.

Format: ${format}

Messwerte:
${obs}

Nur das JSON-Array. Kein Markdown.`
  }

  if (category === 'nutrition') {
    const format = `[{"title": "Nährstoff oder Kategorie", "value": "konkreter Zielwert", "label": "z.B. pro Tag", "note": "kurze Begründung"}]`
    if (hasExisting) return `Bestehende Ernährungsempfehlungen für Nikolaus (${age} Jahre):
${existingToText(existing)}

Aktuelle Messwerte:
${obs}

Überprüfe und passe an wo nötig. Nur Lebensmittel, Makros und Ernährungsmuster — keine Supplements oder Medikamente.
Gleiche JSON-Struktur: ${format}
Nur das JSON-Array. Kein Markdown.`
    return `Du erstellst konkrete Ernährungsempfehlungen für Nikolaus (geb. 11.07.1975, ${age} Jahre alt).

Nur Lebensmittel, Makros und Ernährungsmuster — keine Supplements, keine Medikamente, keine Nahrungsergänzungsmittel.
Beispiele für gute Einträge: Proteinziel, Zuckerlimit, Ernährungsstil (z.B. mediterrane Diät), empfohlene Lebensmittel oder Lebensmittelgruppen, worauf er verzichten soll.
Keine allgemeinen Aussagen — nur messbare oder konkret umsetzbare Ziele.
5–8 Einträge.

Format: ${format}

Messwerte:
${obs}

Nur das JSON-Array. Kein Markdown.`
  }

  // supplements
  const format = `[{"title": "<Name des Supplements>", "value": "<Dosierung>", "label": "<Einnahmezeitpunkt>", "note": "<Begründung>", "prescription_required": false}]`
  if (hasExisting) return `Bestehende Supplement-Empfehlungen für Nikolaus (${age} Jahre):
${existingToText(existing)}

Aktuelle Messwerte:
${obs}

Überprüfe und passe an wo nötig.
JSON-Format (exakt diese Schlüsselnamen): ${format}
Nur das JSON-Array. Kein Markdown.`
  return `Du erstellst Supplement-Empfehlungen für Nikolaus (geb. 11.07.1975, ${age} Jahre alt).

OTC-Supplements UND verschreibungspflichtige Medikamente wenn klinisch indiziert.
Bei Rx-Mitteln: prescription_required: true und Hinweis auf ärztliche Rücksprache in der note.
4–8 Einträge.

JSON-Format (exakt diese Schlüsselnamen): ${format}

Messwerte:
${obs}

Nur das JSON-Array. Kein Markdown.`
}

function extractJsonArray(text: string): RawItem[] {
  const stripped = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    const parsed = JSON.parse(stripped)
    if (Array.isArray(parsed)) return parsed as RawItem[]
  } catch {}
  // Claude sometimes outputs reasoning text before the array — find the first [
  const start = stripped.indexOf('[')
  const end = stripped.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed as RawItem[]
    } catch {}
  }
  return []
}

async function generateSummary(
  items: ActionPlanItem[],
  obs: string,
  age: number,
  profileSummary: string | null
): Promise<string> {
  const fmt = (cat: string) =>
    items.filter((i) => i.category === cat)
      .map((i) => `- ${i.title}${i.value ? `: ${i.value}` : ''}`)
      .join('\n') || '(keine)'

  const profileSection = profileSummary
    ? `Gesundheitsstatus, den Nikolaus bereits gelesen hat:
"${profileSummary}"

`
    : ''

  const prompt = `Du bist ein erfahrener Chefarzt mit Jahrzehnten klinischer Praxis. Du hast hunderte Patienten in dieser Lebenslage gesehen — du kennst die Verläufe, du weißt was passiert und was nicht passiert. Jetzt gibst du Nikolaus (${age} Jahre) eine ehrliche, nüchterne Einschätzung.

${profileSection}Messwerte:
${obs}

Sein Schlachtplan:

Übungen:
${fmt('exercises')}

Habits:
${fmt('habits')}

Ernährung:
${fmt('nutrition')}

Supplements:
${fmt('supplements')}

Schreibe einen Text mit drei Teilen — kein Markdown, keine Überschriften, Fließtext, max. 200 Wörter:

1. Deine Empfehlung: Was soll er aus diesem Plan konkret umsetzen? Nicht alles — wähle realistisch aus. Zum Beispiel: welche Kategorien sind am wichtigsten, was kann er täglich tun, was ist nice-to-have. Sprich direkt und konkret, nicht allgemein.

2. Wenn er es auf die leichte Schulter nimmt: Was passiert in 5, 10 und 20 Jahren? Realistisch, keine Übertreibung — aber klar und ohne Beschönigung.

3. Wenn er es ernst nimmt: Was passiert in 5, 10 und 20 Jahren? Gleiche Struktur, gleiche Nüchternheit.

Ton: trocken, direkt, erfahren. Kein Motivationsspeaker, kein erhobener Zeigefinger, keine leeren Phrasen. So wie ein Arzt der schon alles gesehen hat und dem es zu anstrengend ist, um den heißen Brei herumzureden.`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })
  return res.content[0].type === 'text' ? res.content[0].text.trim() : ''
}

async function generateItems(
  category: 'exercises' | 'habits' | 'nutrition' | 'supplements',
  obs: string,
  existing: ActionPlanItem[],
  age: number
): Promise<RawItem[]> {
  const prompt = buildPrompt(category, obs, age, existing)
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
  return extractJsonArray(text)
}

export async function updateActionPlan(): Promise<void> {
  const obs = await fetchObsText()
  if (!obs) return

  const age = getAge()
  const { data: existing } = await supabase.from('action_plan_items').select('*')
  const categories = ['exercises', 'habits', 'nutrition', 'supplements'] as const

  const results = await Promise.allSettled(categories.map(async (category) => {
    const existingForCat = ((existing ?? []) as ActionPlanItem[]).filter((i) => i.category === category)
    const items = await generateItems(category, obs, existingForCat, age)
    if (items.length === 0) return

    const now = new Date().toISOString()
    const { error: delErr } = await supabase.from('action_plan_items').delete().eq('category', category)
    if (delErr) { console.error(`action-plan delete [${category}]:`, delErr); return }
    const { error: insErr } = await supabase.from('action_plan_items').insert(
      items.map((item) => ({
        category,
        title: String(item.title ?? ''),
        value: item.value ? String(item.value) : null,
        label: item.label ? String(item.label) : null,
        note: item.note ? String(item.note) : null,
        prescription_required: Boolean(item.prescription_required ?? false),
        updated_at: now,
      }))
    )
    if (insErr) console.error(`action-plan insert [${category}]:`, insErr)
  }))

  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`action-plan [${categories[i]}] rejected:`, r.reason)
  })

  // Generate summary after all categories — needs the complete item list + profile context
  const { data: allItems } = await supabase.from('action_plan_items').select('*')
  const { data: profileRows } = await supabase
    .from('health_profile')
    .select('summary')
    .order('updated_at', { ascending: false })
    .limit(1)
  const profileSummary = profileRows?.[0]?.summary ?? null

  if (allItems && allItems.length > 0) {
    try {
      const summary = await generateSummary(allItems as ActionPlanItem[], obs, age, profileSummary)
      if (summary) {
        const now = new Date().toISOString()
        await supabase.from('action_plan_summary').delete().not('id', 'is', null)
        await supabase.from('action_plan_summary').insert({ summary, updated_at: now })
      }
    } catch (e) {
      console.error('action-plan summary generation failed:', e)
    }
  }
}
