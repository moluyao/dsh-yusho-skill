#!/usr/bin/env node
// 测试用的假 Agent（说 ACP）：收到活先请求一次权限（“删除 old-logs 文件夹”这种高风险的说法），再按选择回一句话。
// 只给连接器的自动测试用：在测试用的 config.json 里加 agents.fake = { command: process.execPath, args: [这个文件] }
import readline from 'node:readline'
const out = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n')
let nextId = 1000
const waiting = new Map()
const call = (method, params) => new Promise((res) => { const id = nextId++; waiting.set(id, res); out({ id, method, params }) })
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.id != null && !m.method && waiting.has(m.id)) { waiting.get(m.id)(m.result ?? m.error); waiting.delete(m.id); return }
  if (m.method === 'initialize') return out({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? 1, agentCapabilities: {} } })
  if (m.method === 'session/new') return out({ id: m.id, result: { sessionId: 's-fake' } })
  if (m.method === 'session/cancel') return
  if (m.method === 'session/prompt') {
    const text = (m.params?.prompt ?? []).map((p) => p.text ?? '').join('')
    const action = /审查|接着/.test(text) ? '读一下交接卡里的结果' : 'rm -rf ./old-logs（删除 old-logs 文件夹）'
    const r = await call('session/request_permission', { sessionId: 's-fake', toolCall: { toolCallId: 'tc1', title: action, kind: 'execute' }, options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] })
    const picked = r?.outcome?.optionId ?? 'cancelled'
    out({ method: 'session/update', params: { sessionId: 's-fake', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '假 Agent 收到的选择：' + picked + '。交给我的话开头：' + text.slice(0, 40) } } } })
    return out({ id: m.id, result: { stopReason: 'end_turn' } })
  }
  if (m.id != null) out({ id: m.id, error: { code: -32601, message: 'not supported: ' + m.method } })
})
