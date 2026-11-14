// Writes the SYNTHETIC Samsung Health sample export used by the import wizard ("Try the synthetic sample")
// and by src/lib/samsungHealth.test.ts.
//
//   node tools/samsung-sample/generate.ts [--end=YYYY-MM-DD] [--days=45] [--out=public/samples/samsung-health-SYNTHETIC-sample.zip]
//
// --end defaults to today (local). Run it again before a demo if you want the sample to end "yesterday".
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildSample } from './sample.ts'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const end = arg('end') ?? today
const days = Number(arg('days') ?? 45)
const out = arg('out') ?? 'public/samples/samsung-health-SYNTHETIC-sample.zip'

if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !(days >= 7 && days <= 400)) {
  console.error('usage: node tools/samsung-sample/generate.ts [--end=YYYY-MM-DD] [--days=7..400] [--out=path.zip]')
  process.exit(2)
}

const s = buildSample({ end, days })
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, s.zip)
console.log(`${out}: ${(s.zip.length / 1024).toFixed(1)} KB, ${Object.keys(s.files).length} files, folder ${s.root}`)
console.log(`rows: ${JSON.stringify(s.counts)}`)
