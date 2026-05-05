import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { updateActionPlan } from '@/lib/action-plan'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [{ data: itemsData }, { data: summaryData }] = await Promise.all([
    supabase.from('action_plan_items').select('*').order('updated_at', { ascending: false }),
    supabase.from('action_plan_summary').select('*').order('updated_at', { ascending: false }).limit(1),
  ])

  const items = itemsData ?? []
  const summaryRow = summaryData?.[0] ?? null
  // Use summary timestamp as the "done" signal — it's generated last
  // Fall back to items timestamp so legacy data (no summary) still works
  const itemsAt = items.length > 0 ? items[0].updated_at : null
  const summaryAt = summaryRow?.updated_at ?? null
  const updatedAt = summaryAt ?? itemsAt

  return NextResponse.json({ items, summary: summaryRow?.summary ?? null, updated_at: updatedAt })
}

export async function POST() {
  void updateActionPlan().catch(console.error)
  return NextResponse.json({ generating: true })
}
