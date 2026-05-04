import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { updateProfile } from '@/lib/profile'

export async function GET() {
  const { data } = await supabase
    .from('health_profile')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ profile: data ?? null })
}

export async function POST() {
  void updateProfile().catch(console.error)
  return NextResponse.json({ generating: true })
}
