#!/usr/bin/env node
/**
 * fetch-guitar-samples.mjs — download a free acoustic-guitar sample set into
 * public/samples/guitar-acoustic/ and generate its manifest.json.
 *
 * Source: nbrosowsky/tonejs-instruments "guitar-acoustic" — the de-facto free
 * sample set for Tone.js projects (individual sustained notes, recorded from a
 * real acoustic guitar). We list the folder via the GitHub API so we never have
 * to hard-code filenames, then download each .mp3 and build the note→file map.
 *
 * Usage:  node scripts/fetch-guitar-samples.mjs
 *         npm run samples:fetch
 *
 * Re-runnable & idempotent: existing files are skipped. Delete the folder's
 * .mp3s and re-run to refresh.
 */
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REPO = 'nbrosowsky/tonejs-instruments'
const DIR = 'samples/guitar-acoustic'
const API = `https://api.github.com/repos/${REPO}/contents/${DIR}`

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'samples', 'guitar-acoustic')

// Filename (no ext) → Tone note key.  "Fs3" → "F#3",  "A2" → "A2"
const toNote = (base) => base.replace(/^([A-G])s(\d)$/, '$1#$2')

async function main() {
  await mkdir(OUT, { recursive: true })

  process.stdout.write(`Listing ${REPO}/${DIR} …\n`)
  const res = await fetch(API, { headers: { 'User-Agent': 'capoflow-sample-fetch' } })
  if (!res.ok) {
    console.error(`GitHub API error ${res.status}. Rate-limited? Try again in a bit, or download manually (see README).`)
    process.exit(1)
  }
  const items = await res.json()
  const mp3s = items.filter((i) => i.type === 'file' && /\.mp3$/i.test(i.name))
  if (!mp3s.length) {
    console.error('No .mp3 files found at source — the repo layout may have changed.')
    process.exit(1)
  }

  let got = 0
  for (const f of mp3s) {
    const dest = join(OUT, f.name)
    if (existsSync(dest) && (await stat(dest)).size > 0) {
      got++
      continue
    }
    const dl = await fetch(f.download_url, { headers: { 'User-Agent': 'capoflow-sample-fetch' } })
    if (!dl.ok) {
      console.warn(`  ! skip ${f.name} (${dl.status})`)
      continue
    }
    const buf = Buffer.from(await dl.arrayBuffer())
    await writeFile(dest, buf)
    got++
    process.stdout.write(`  ✓ ${f.name} (${(buf.length / 1024).toFixed(0)} KB)\n`)
  }

  // Build manifest from whatever .mp3s now exist in the folder.
  const files = (await readdir(OUT)).filter((n) => /\.mp3$/i.test(n))
  const manifest = {}
  for (const name of files) manifest[toNote(name.replace(/\.mp3$/i, ''))] = name
  // Sort by pitch for readability.
  const ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => {
      const pa = ORDER.indexOf(a.replace(/\d/, '')) + 12 * +a.replace(/\D/g, '')
      const pb = ORDER.indexOf(b.replace(/\d/, '')) + 12 * +b.replace(/\D/g, '')
      return pa - pb
    }),
  )
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(sorted, null, 2) + '\n')

  console.log(`\nDone. ${got} sample(s) present, manifest has ${Object.keys(sorted).length} notes.`)
  console.log('Reload the app and play — the engine auto-switches to the Tone.Sampler.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
