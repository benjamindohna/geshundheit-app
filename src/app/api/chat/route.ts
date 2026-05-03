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

  const systemPrompt = `Du bist ein persönlicher Gesundheitsberater. Du hast Zugriff auf folgende aktuelle Messwerte des Nutzers:

${obsContext}

Beantworte Fragen zu den Gesundheitsdaten sachlich und hilfreich auf Deutsch. Weise bei medizinisch kritischen Befunden auf einen Arztbesuch hin. Dies ist ein persönliches Tool und ersetzt keine medizinische Beratung.`

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
