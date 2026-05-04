import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateMissingDescriptions } from '@/lib/descriptions'

export async function GET() {
  const { data } = await supabase
    .from('observation_descriptions')
    .select('display_name, description')

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    map[row.display_name] = row.description
  }

  return NextResponse.json({ descriptions: map })
}

// Backfill: generates descriptions for all observation display_names that don't have one yet
export async function POST() {
  const { data: obs } = await supabase
    .from('observations')
    .select('display_name')

  const allNames = [...new Set((obs ?? []).map((o) => o.display_name as string))]
  await generateMissingDescriptions(allNames)

  const { data } = await supabase
    .from('observation_descriptions')
    .select('display_name, description')

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    map[row.display_name] = row.description
  }

  return NextResponse.json({ descriptions: map })
}
