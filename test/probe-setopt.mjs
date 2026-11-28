// 验证：对真的 Codex 适配器调 session/set_config_option（不发任务），看当前值有没有变
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import os from 'node:os'
import * as acp from '@agentclientprotocol/sdk'
import { detectAgents } from '../lib/connector.mjs'
const ag = detectAgents().codex; if (!ag) { console.log('no codex'); process.exit(0) }
const child = spawn(ag.command, ag.args, { cwd: os.tmpdir(), env: { ...process.env, ...ag.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', windowsHide: true })
const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
const app = acp.client({ name: 'yusho-probe' }).onNotification(acp.methods.client.session.update, () => {})
const cur = (cfg, cat) => cfg.find((c) => c.category === cat)?.currentValue
await app.connectWith(stream, async (ctx) => {
  await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
  const s = await ctx.request(acp.methods.agent.session.new, { cwd: os.tmpdir(), mcpServers: [] })
  let cfg = s.configOptions
  console.log('before: model=' + cur(cfg, 'model') + ' thought=' + cur(cfg, 'thought_level'))
  const mid = cfg.find((c) => c.category === 'model'), tid = () => cfg.find((c) => c.category === 'thought_level')
  const target = mid.options.find((o) => o.value !== mid.currentValue && /astra/.test(o.value))?.value ?? mid.options.find((o) => o.value !== mid.currentValue).value
  let r = await ctx.request(acp.methods.agent.session.setConfigOption, { sessionId: s.sessionId, configId: mid.id, value: target }); cfg = r.configOptions ?? cfg
  r = await ctx.request(acp.methods.agent.session.setConfigOption, { sessionId: s.sessionId, configId: tid().id, value: 'low' }); cfg = r.configOptions ?? cfg
  console.log('after:  model=' + cur(cfg, 'model') + ' thought=' + cur(cfg, 'thought_level') + ' (asked ' + target + ', low)')
}).catch((e) => console.log('error', e?.message))
try { child.kill() } catch {}
if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
setTimeout(() => process.exit(0), 500)
