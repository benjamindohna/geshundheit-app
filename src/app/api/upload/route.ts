import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'Keine Datei gefunden' }, { status: 400 })
  }

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Nur PDF, JPEG und PNG werden unterstützt' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const contentHash = createHash('sha256').update(buffer).digest('hex')

  // Duplicate check
  const { data: existing } = await supabase
    .from('documents')
    .select('id, filename, extraction_status')
    .eq('content_hash', contentHash)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ document: existing, duplicate: true })
  }

  // For PDFs: check page count to decide if review is needed
  let needsReview = false
  if (file.type === 'application/pdf') {
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true })
      needsReview = pdfDoc.getPageCount() > 1
    } catch {
      // If we can't parse it, send to review to be safe
      needsReview = true
    }
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  let { error: uploadError } = await supabase.storage
    .from('health-docs')
    .upload(storagePath, buffer, { contentType: file.type })

  if (uploadError?.message?.includes('Bucket not found') || uploadError?.message?.includes('does not exist')) {
    await supabase.storage.createBucket('health-docs', { public: false })
    const retry = await supabase.storage
      .from('health-docs')
      .upload(storagePath, buffer, { contentType: file.type })
    uploadError = retry.error
  }

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const fileType = file.type.startsWith('image/') ? 'image' : 'pdf'

  const { data: doc, error: dbError } = await supabase
    .from('documents')
    .insert({
      filename: file.name,
      content_hash: contentHash,
      storage_path: storagePath,
      file_type: fileType,
      extraction_status: 'pending',
    })
    .select()
    .single()

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ document: doc, duplicate: false, needsReview })
}
