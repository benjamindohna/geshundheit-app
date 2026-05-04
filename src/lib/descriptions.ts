import { supabase } from './supabase'
import { anthropic } from './anthropic'
import { getCachedDescriptions, setCachedDescriptions } from './descriptions-cache'

const BATCH_SIZE = 20

async function fetchDescriptionsFromClaude(names: string[]): Promise<Record<string, string>> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Du bist Arzt und erklärst einem Patienten kurz seine Gesundheitswerte.

Für jeden der folgenden Messwerte schreibe eine Erklärung auf Deutsch (max. 80 Wörter):
- Was misst oder beschreibt dieser Wert?
- Warum ist er medizinisch relevant?

Antworte mit einem JSON-Objekt: {"Messwertname": "Erklärung", ...}
Keine Markdown-Formatierung, kein Fettdruck, nur normaler Text.

Messwerte:
${names.map((n) => `- ${n}`).join('\n')}

Nur das JSON, keine Einleitung.`,
    }],
  })
  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(cleaned) as Record<string, string>
  } catch {
    return {}
  }
}

export async function generateMissingDescriptions(displayNames: string[]): Promise<void> {
  if (displayNames.length === 0) return

  const { data: existing } = await supabase
    .from('observation_descriptions')
    .select('display_name')
    .in('display_name', displayNames)

  const existingSet = new Set((existing ?? []).map((r) => r.display_name))
  const missing = [...new Set(displayNames)].filter((n) => !existingSet.has(n))

  if (missing.length === 0) return

  const fromCache = getCachedDescriptions(missing)
  const stillMissing = missing.filter((n) => !fromCache[n])

  const fromClaude: Record<string, string> = {}

  // Process in batches so JSON output never exceeds token limit
  for (let i = 0; i < stillMissing.length; i += BATCH_SIZE) {
    const batch = stillMissing.slice(i, i + BATCH_SIZE)
    try {
      const result = await fetchDescriptionsFromClaude(batch)
      Object.assign(fromClaude, result)
    } catch (e) {
      console.error(`descriptions batch ${i / BATCH_SIZE + 1} failed:`, e)
    }
  }

  if (Object.keys(fromClaude).length > 0) {
    setCachedDescriptions(fromClaude)
  }

  const allNew = { ...fromCache, ...fromClaude }
  const rows = Object.entries(allNew).map(([display_name, description]) => ({
    display_name,
    description,
  }))

  if (rows.length > 0) {
    await supabase
      .from('observation_descriptions')
      .upsert(rows, { onConflict: 'display_name' })
  }
}
