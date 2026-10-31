// Adds the CheaperInference provider to DSH's model list and turns the
// ci-kimi council seat on, in ~/.dsh/settings.yaml on this machine.
// Idempotent; backs the file up first. Written by Claude Opus 5.5, 2026-10-28.
//   node apply-cheaperinference-provider.mjs [settings.yaml path] [--check]
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const check = args.includes('--check')
const file = args.find((a) => !a.startsWith('--')) || join(homedir(), '.dsh', 'settings.yaml')

function loadYaml() {
  const repo = join(homedir(), 'Documents', 'claudecode', 'deepseek-harness')
  const pnpm = join(repo, 'node_modules', '.pnpm')
  const hit = existsSync(pnpm) && readdirSync(pnpm).find((d) => /^yaml@2\./.test(d))
  if (!hit) throw new Error(`yaml library not found under ${pnpm}`)
  return createRequire(import.meta.url)(join(pnpm, hit, 'node_modules', 'yaml'))
}

const MODELS = [
  ['kimi-k3', 'CI: Kimi K3', 1000000],
  ['kimi-k3.1-pro', 'CI: Kimi K3.1 Pro', 1048576],
  ['deepseek-v4-pro', 'CI: DeepSeek V4 Pro', 1000000],
  ['deepseek-v4.1-flash', 'CI: DeepSeek V4.1 Flash', 1048576],
  ['glm-5.3', 'CI: GLM 5.3', 1000000],
  ['qwen3.8-max', 'CI: Qwen3.8 Max', 1000000],
  ['minimax-m3.1-flash', 'CI: MiniMax M3.1 Flash', 1000000],
  ['gpt-6-luna', 'CI: GPT-6 Luna', 1050000],
  ['gpt-6.1-sol', 'CI: GPT-6.1 Sol', 1050000],
  ['claude-sonnet-5.5', 'CI: Claude Sonnet 5.5', 1000000],
]
const PROVIDER = {
  displayName: 'CheaperInference (paid, metered)',
  api: 'openai-completions',
  baseURL: 'https://api.cheaperinference.com/v1',
  apiKeyEnv: 'CHEAPERINFERENCE_API_KEY',
  models: MODELS.map(([id, name, contextWindow]) => ({ id, name, contextWindow })),
}
const SEAT = {
  name: 'CheaperInference Kimi K3',
  model: 'kimi-k3',
  baseUrl: 'https://api.cheaperinference.com/v1/chat/completions',
  apiKeyEnv: 'CHEAPERINFERENCE_API_KEY',
  enabled: true,
}

const YAML = loadYaml()
const before = readFileSync(file, 'utf8')
const doc = YAML.parseDocument(before)
const changes = []

if (!doc.hasIn(['llm-pi-ai', 'providers', 'cheaperinference'])) {
  doc.setIn(['llm-pi-ai', 'providers', 'cheaperinference'], doc.createNode(PROVIDER))
  changes.push('added provider cheaperinference (10 models)')
}
if (!doc.hasIn(['council', 'extraSeats', 'ci-kimi'])) {
  doc.setIn(['council', 'extraSeats', 'ci-kimi'], doc.createNode(SEAT))
  changes.push('added council.extraSeats.ci-kimi')
} else if (doc.getIn(['council', 'extraSeats', 'ci-kimi', 'enabled']) !== true) {
  doc.setIn(['council', 'extraSeats', 'ci-kimi', 'enabled'], true)
  changes.push('enabled council.extraSeats.ci-kimi')
}
if (doc.hasIn(['council', 'seats', 'ci-kimi']) && doc.getIn(['council', 'seats', 'ci-kimi', 'enabled']) !== true) {
  doc.setIn(['council', 'seats', 'ci-kimi', 'enabled'], true)
  changes.push('enabled council.seats.ci-kimi')
}

const credFile = join(homedir(), '.dsh', '.credentials.yaml')
const hasKey = existsSync(credFile) && /CHEAPERINFERENCE_API_KEY:\s*\S/.test(readFileSync(credFile, 'utf8'))

if (changes.length === 0) console.log('CheaperInference already in the model list; nothing to change.')
else if (check) console.log('Would change:\n  ' + changes.join('\n  '))
else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(file, `${file}.bak-ci-provider-${stamp}`)
  writeFileSync(file, doc.toString())
  YAML.parse(readFileSync(file, 'utf8'))
  console.log('Changed:\n  ' + changes.join('\n  ') + `\nBackup: ${file}.bak-ci-provider-${stamp}`)
}
console.log(hasKey ? 'CheaperInference key: present.' : 'CheaperInference key: MISSING on this machine - run "CheaperInference Key Setup.cmd" on the Desktop.')
console.log('DSH hot-reloads settings.yaml; the provider shows in the model picker under "CheaperInference".')
