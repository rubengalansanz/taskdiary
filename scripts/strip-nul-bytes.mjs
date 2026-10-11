import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
const NUL = String.fromCharCode(0)

const before = readFileSync(target)
const count = before.filter((byte) => byte === 0).length

if (count === 0) {
  console.log(`${target}: sin bytes NUL`)
  process.exit(0)
}

const fixed = before.toString('utf8').split(NUL).join('\\u0000')

writeFileSync(target, fixed)

const after = readFileSync(target).filter((byte) => byte === 0).length
console.log(`${target}: ${count} NUL(es) -> ${after}`)
