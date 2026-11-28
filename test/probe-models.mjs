// 探测：连上这台电脑上的 Claude Code / Codex 适配器，只建会话、不发任务（不花额度），看它们报上来的模型、思考等级、模式
// 用法：node test/probe-models.mjs [claude|codex]
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import os from 'node:os'
import * as acp from '@agentclientprotocol/sdk'
import { detectAgents } from '../lib/connector.mjs'

const want = process.argv[2]
const agents = detectAgents()
console.log('detected:', Object.keys(agents).join(', ') || 'none')
for (const [key, ag] of Object.entries(agents)) {
  if (want && key !== want) continue
  if (key === 'dsh') continue
  console.log('\n=== ' + key + ' ===')
  const win = process.platform === 'win32'
  const child = spawn(ag.command, ag.args, { cwd: os.tmpdir(), env: { ...process.env, ...ag.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: win, windowsHide: true })
  let err = ''; child.stderr.on('data', (d) => { err += d })
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
  const app = acp.client({ name: 'yusho-probe' }).onNotification(acp.methods.client.session.update, () => {})
  const done = new Promise((ok) => {
    const timer = setTimeout(() => { console.log('timeout; stderr tail:', err.slice(-600)); ok() }, 240000)
    app.connectWith(stream, async (ctx) => {
      const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
      console.log('agentInfo:', JSON.stringify(init.agentInfo ?? null), 'caps:', JSON.stringify(init.agentCapabilities ?? {}).slice(0, 300))
      const s = await ctx.request(acp.methods.agent.session.new, { cwd: os.tmpdir(), mcpServers: [] })
      const { sessionId, ...rest } = s
      console.log('session/new keys:', Object.keys(rest).join(', '))
      if (rest.models) console.log('models: current=' + rest.models.currentModelId + '\n  ' + (rest.models.availableModels ?? []).map((m) => m.modelId).join('  '))
      if (rest.modes) console.log('modes:', JSON.stringify(rest.modes).slice(0, 1500))
      if (rest.configOptions) console.log('configOptions:', JSON.stringify(rest.configOptions, null, 1).slice(0, 5000))
      clearTimeout(timer); ok()
    }).catch((e) => { console.log('error:', e?.message, '\nstderr tail:', err.slice(-600)); clearTimeout(timer); ok() })
  })
  await done
  try { child.kill() } catch {}
  if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
}
process.exit(0)
