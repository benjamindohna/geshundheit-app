import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('storage_path, filename')
    .eq('id', id)
    .single()

  if (docError || !doc) {
    return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })
  }

  const { data, error } = await supabase.storage
    .from('health-docs')
    .createSignedUrl(doc.storage_path, 60)

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Fehler' }, { status: 500 })
  }

  return NextResponse.redirect(data.signedUrl)
}
