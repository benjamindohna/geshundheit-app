import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { updateProfile } from '@/lib/profile'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data } = await supabase
    .from('health_profile')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ profile: data ?? null }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST() {
  void updateProfile().catch(console.error)
  return NextResponse.json({ generating: true })
}
