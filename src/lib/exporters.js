/**
 * exporters.js — download the generated chord/lyric sheet as PDF or DOCX.
 *
 * Both libraries are imported dynamically so they only enter the bundle when the
 * user actually exports — keeping the app's initial load light.
 *
 * `lines` is the shape produced by buildSheet(): an array of
 *   { chords: [{ chord, col }], text: string }
 * where `col` is a character column for monospace chord-over-lyric alignment.
 */

/** Render a chord line as text with chords sitting above their lyric columns. */
function chordRow(line) {
  if (!line.chords?.length) return ''
  let row = ''
  for (const c of line.chords) {
    if (c.col > row.length) row += ' '.repeat(c.col - row.length)
    row += c.chord + ' '
  }
  return row.replace(/\s+$/, '')
}

export async function exportPDF(title, lines, meta = {}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 48
  let y = margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(title || 'CapoFlow Chord Sheet', margin, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(120)
  const sub = [meta.key && `Key: ${meta.key}`, meta.capo != null && `Capo: ${meta.capo}`]
    .filter(Boolean)
    .join('    ')
  if (sub) {
    doc.text(sub, margin, y)
    y += 18
  }
  doc.setTextColor(30)
  y += 8

  const pageH = doc.internal.pageSize.getHeight()
  const lineH = 14
  for (const line of lines) {
    if (y > pageH - margin - lineH * 2) {
      doc.addPage()
      y = margin
    }
    const crow = chordRow(line)
    if (crow) {
      doc.setFont('courier', 'bold')
      doc.setTextColor(124, 58, 237) // accent
      doc.text(crow, margin, y)
      y += lineH
    }
    doc.setFont('courier', 'normal')
    doc.setTextColor(20)
    doc.text(line.text || ' ', margin, y)
    y += lineH + (line.text ? 4 : 0)
  }

  doc.save(`${safe(title)}.pdf`)
}

export async function exportDOCX(title, lines, meta = {}) {
  const { Document, Packer, Paragraph, TextRun } = await import('docx')

  const children = [
    new Paragraph({
      children: [new TextRun({ text: title || 'CapoFlow Chord Sheet', bold: true, size: 32 })],
    }),
  ]
  const sub = [meta.key && `Key: ${meta.key}`, meta.capo != null && `Capo: ${meta.capo}`]
    .filter(Boolean)
    .join('    ')
  if (sub) {
    children.push(new Paragraph({ children: [new TextRun({ text: sub, color: '888888', size: 20 })] }))
  }
  children.push(new Paragraph({ text: '' }))

  for (const line of lines) {
    const crow = chordRow(line)
    if (crow) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: crow, font: 'Consolas', bold: true, color: '7C3AED', size: 20 })],
        }),
      )
    }
    children.push(
      new Paragraph({
        children: [new TextRun({ text: line.text || ' ', font: 'Consolas', size: 20 })],
      }),
    )
  }

  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  triggerDownload(blob, `${safe(title)}.docx`)
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safe = (s) => (s || 'capoflow-sheet').replace(/[^\w-]+/g, '_').slice(0, 60)
