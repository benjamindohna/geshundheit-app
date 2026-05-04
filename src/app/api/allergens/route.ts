import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data } = await supabase
    .from('allergens')
    .select('*')
    .order('severity', { ascending: true })

  return NextResponse.json({ allergens: data ?? [] })
}
