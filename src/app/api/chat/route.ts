import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { anthropic } from '@/lib/anthropic'

export async function POST(request: NextRequest) {
  const { messages } = await request.json()

  const { data: observations } = await supabase
    .from('observations')
    .select('*')
    .order('measured_at', { ascending: false })

  const obsContext = observations && observations.length > 0
    ? observations
        .map((o) => {
          const val = o.value != null ? `${o.value} ${o.unit ?? ''}` : o.value_text
          return `- ${o.display_name}: ${val} [${o.status}, ${o.measured_at}]`
        })
        .join('\n')
    : 'Keine Messwerte vorhanden.'

  const systemPrompt = `Du bist ein kompetenter, offener Gesundheitsberater mit medizinischem Fachwissen. Antworte immer auf Deutsch.

Du hast Zugriff auf folgende Messwerte des Nutzers – nutze sie als Kontext, aber nur wenn sie für die Frage relevant sind:

${obsContext}

Verhalte dich so:
- Bei allgemeinen medizinischen Fragen ("Ist X möglich?", "Was bedeutet Y?", "Wie funktioniert Z?") → antworte mit echtem klinischen Wissen, unabhängig von den Nutzerwerten. Erkläre Physiologie, Referenzbereiche, medizinische Zusammenhänge.
- Bei nutzerspezifischen Fragen ("Wie sind meine Werte?", "Was bedeutet mein Ergebnis?") → beziehe die obigen Messwerte ein.
- Kombiniere beides wenn sinnvoll: allgemeine Erklärung + Einordnung der eigenen Werte.
- Sei direkt und informativ. Kein unnötiges Abschwächen jeder Aussage.
- Nur bei wirklich kritischen Befunden auf Arztbesuch hinweisen – nicht als Standardfloskel bei jeder Antwort.
- Formatiere Antworten mit Markdown (fett, Listen, Überschriften) wo es die Lesbarkeit verbessert.`

  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          controller.enqueue(encoder.encode(event.delta.text))
        }
      }
      controller.close()
    },
  })

  return new NextResponse(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  })
}
