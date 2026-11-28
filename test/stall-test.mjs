// 卡住的 Agent 会不会被自动停：YUSHO_STALL_MS=60000，假 Agent 不回话；重发同一件不会做两遍
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { createConnector } from '../lib/connector.mjs'
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-stall-')), PK = 'ab'.repeat(32)
fs.writeFileSync(HOME + '/config.json', JSON.stringify({ name: 't', workDir: HOME, agents: { hang: { command: process.execPath, args: [new URL('./fake-hang.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')] } } }))
fs.writeFileSync(HOME + '/devices.json', JSON.stringify([{ pk: PK, label: '测试手机' }]))
const got = []
const c = await createConnector({ home: HOME, log: () => {}, sink: (to, p) => { got.push(p); console.log(Math.round((Date.now() - t0) / 1000) + 's', p.type, p.reason ?? p.note ?? '') } })
const t0 = Date.now()
c._rumor(PK, { type: 'task.create', task_id: 't_x1', agent: 'hang', instruction: '干点啥' })
setTimeout(() => c._rumor(PK, { type: 'task.create', task_id: 't_x1', agent: 'hang', instruction: '干点啥' }), 3000)
const end = await new Promise((ok) => { const i = setInterval(() => { const f = got.find((p) => p.type === 'task.failed'); if (f) { clearInterval(i); ok(f) } }, 500); setTimeout(() => { clearInterval(i); ok(null) }, 150_000) })
const acks = got.filter((p) => p.type === 'task.ack')
console.log(end && /没有任何动静/.test(end.reason) && acks.length === 2 && acks[1].resent ? 'PASS' : 'FAIL', acks.length)
process.exit(0)
