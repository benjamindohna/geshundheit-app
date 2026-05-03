import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { anthropic } from '@/lib/anthropic'

export async function POST() {
  const { data: observations, error } = await supabase
    .from('observations')
    .select('*')
    .order('measured_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!observations || observations.length === 0) {
    return NextResponse.json({ error: 'Keine Messwerte vorhanden' }, { status: 400 })
  }

  const observationText = observations
    .map((o) => {
      const val = o.value != null ? `${o.value} ${o.unit ?? ''}` : o.value_text
      const ref = o.reference_range_text
        ? `(Referenz: ${o.reference_range_text})`
        : o.reference_range_low != null
        ? `(Referenz: ${o.reference_range_low}–${o.reference_range_high} ${o.unit ?? ''})`
        : ''
      return `- ${o.display_name}: ${val} ${ref} [${o.status}, Datum: ${o.measured_at}]`
    })
    .join('\n')

  const prompt = `Du bist ein erfahrener Gesundheitsberater. Basierend auf folgenden Messwerten erstelle eine personalisierte Analyse:

${observationText}

Erstelle eine Analyse als JSON mit folgenden Feldern:
- summary: string (2-3 Sätze Gesamtübersicht auf Deutsch)
- sport_recommendations: Array von { title: string, description: string, priority: "hoch" | "mittel" | "niedrig" }
- nutrition_recommendations: Array von { title: string, description: string, priority: "hoch" | "mittel" | "niedrig" }
- supplement_recommendations: Array von { title: string, description: string, dosage: string | null, priority: "hoch" | "mittel" | "niedrig" }
- test_recommendations: Array von { title: string, description: string, urgency: "sofort" | "bald" | "routine" }

Antworte NUR mit dem JSON-Objekt, ohne Markdown oder Erklärungen.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const analysis = JSON.parse(cleaned)

  const { data: saved, error: saveError } = await supabase
    .from('analyses')
    .insert({
      summary: analysis.summary,
      sport_recommendations: analysis.sport_recommendations,
      nutrition_recommendations: analysis.nutrition_recommendations,
      supplement_recommendations: analysis.supplement_recommendations,
      test_recommendations: analysis.test_recommendations,
    })
    .select()
    .single()

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 })
  }

  return NextResponse.json({ analysis: saved })
}
