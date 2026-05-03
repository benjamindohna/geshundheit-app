import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { supabase } from '@/lib/supabase'

type Group = {
  label: string
  categories: string[]
  page_start: number
  page_end: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { groups }: { groups: Group[] } = await req.json()

  if (!Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json({ error: 'Keine Gruppen übergeben' }, { status: 400 })
  }

  const { data: parent, error: parentError } = await supabase
    .from('documents')
    .select('storage_path, filename')
    .eq('id', id)
    .single()

  if (parentError || !parent) {
    return NextResponse.json({ error: 'Quelldokument nicht gefunden' }, { status: 404 })
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('health-docs')
    .download(parent.storage_path)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'PDF konnte nicht geladen werden' }, { status: 500 })
  }

  const pdfBytes = new Uint8Array(await fileData.arrayBuffer())
  const parentPdf = await PDFDocument.load(pdfBytes)

  const children: { id: string; label: string; page_start: number; page_end: number }[] = []

  for (const group of groups) {
    const childPdf = await PDFDocument.create()
    const pageIndices = Array.from(
      { length: group.page_end - group.page_start + 1 },
      (_, i) => group.page_start - 1 + i
    )
    const copiedPages = await childPdf.copyPages(parentPdf, pageIndices)
    copiedPages.forEach((p) => childPdf.addPage(p))
    const childBytes = await childPdf.save()

    const storagePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`

    const { error: uploadError } = await supabase.storage
      .from('health-docs')
      .upload(storagePath, childBytes, { contentType: 'application/pdf' })

    if (uploadError) {
      return NextResponse.json({ error: `Upload fehlgeschlagen: ${uploadError.message}` }, { status: 500 })
    }

    const { data: child, error: insertError } = await supabase
      .from('documents')
      .insert({
        filename: parent.filename,
        storage_path: storagePath,
        file_type: 'pdf',
        extraction_status: 'pending',
        parent_id: id,
        page_start: group.page_start,
        page_end: group.page_end,
        label: group.label,
        categories: group.categories,
      })
      .select('id, label, page_start, page_end')
      .single()

    if (insertError || !child) {
      return NextResponse.json({ error: insertError?.message }, { status: 500 })
    }

    children.push(child)
  }

  // Mark parent as split
  await supabase
    .from('documents')
    .update({ extraction_status: 'split' })
    .eq('id', id)

  return NextResponse.json({ children })
}
