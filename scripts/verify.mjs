import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173/'
const OUT = '/tmp'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--window-size=1440,1800',
    '--force-device-scale-factor=1',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
  defaultViewport: { width: 1440, height: 1700, deviceScaleFactor: 1 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text())
})
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message))

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
await sleep(1500) // let entrance animations settle

// --- Capo tab ---
await page.screenshot({ path: `${OUT}/verify-capo.png` })
const capoText = await page.evaluate(() => document.body.innerText)
console.log('CAPO has "Recommended":', capoText.includes('Recommended'))
console.log('CAPO has "BEST":', capoText.includes('BEST'))
console.log('CAPO has "Capo Comparison":', capoText.includes('Capo Comparison'))
console.log('CAPO SVG count:', await page.evaluate(() => document.querySelectorAll('svg').length))

// Add a chord via manual input to test the flow
await page.type('input[placeholder^="Type chords"]', 'Bb Dm')
await page.click('button[type="submit"]')
await sleep(600)

// --- Sheet tab ---
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find((b) => b.textContent.includes('Sheet Transposer'))?.click()
})
await sleep(2000)
await page.screenshot({ path: `${OUT}/verify-sheet.png` })
const sheetText = await page.evaluate(() => document.body.innerText)
console.log('SHEET has "Hallelujah":', sheetText.includes('Hallelujah'))
console.log('SHEET has "Key":', sheetText.includes('Key'))

// Test transpose +2
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const up = btns.find((b) => b.getAttribute('aria-label') === 'Transpose up')
  up?.click(); up?.click()
})
await sleep(600)
await page.screenshot({ path: `${OUT}/verify-sheet-transposed.png` })

// --- Tuner tab ---
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find((b) => b.textContent.includes('Pro Tuner'))?.click()
})
await sleep(2000)
await page.screenshot({ path: `${OUT}/verify-tuner.png` })
const tunerText = await page.evaluate(() => document.body.innerText)
console.log('TUNER has "Pro Tuner":', tunerText.includes('Pro Tuner'))
console.log('TUNER has "Strumming":', tunerText.includes('Strumming'))

// --- Strumming Studio tab (predefined + custom sequencer) ---
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find((b) => b.textContent.includes('Strumming Studio'))?.click()
})
await sleep(1500)
await page.screenshot({ path: `${OUT}/verify-strum.png`, fullPage: true })
const strumText = await page.evaluate(() => document.body.innerText)
console.log('STRUM has "Custom Strumming Studio":', strumText.includes('Custom Strumming Studio'))
console.log('STRUM has "step sequencer":', strumText.includes('step sequencer'))
// Program a couple of pads and start the sequencer
await page.evaluate(() => {
  const pads = [...document.querySelectorAll('button')].filter((b) => /^[↓↑—]$/.test(b.textContent.trim()))
  pads[0]?.click()
  pads[2]?.click(); pads[2]?.click() // → up
})
await sleep(400)
await page.screenshot({ path: `${OUT}/verify-strum-seq.png` })

// --- AR Studio tab (idle overlay; fake camera avoids a real device) ---
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find((b) => b.textContent.includes('AR Studio'))?.click()
})
await sleep(2500) // allow lazy chunk to load
await page.screenshot({ path: `${OUT}/verify-ar.png` })
const arText = await page.evaluate(() => document.body.innerText)
console.log('AR has "AR Studio":', arText.includes('AR Studio'))
console.log('AR has "Start Camera":', arText.includes('Start Camera'))

// --- Mobile viewport ---
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find((b) => b.textContent.includes('Capo Optimizer'))?.click()
})
await sleep(2000)
await page.screenshot({ path: `${OUT}/verify-mobile.png` })

console.log('\n=== ERRORS (' + errors.length + ') ===')
errors.forEach((e) => console.log(e))

await browser.close()
console.log('\nDone.')
