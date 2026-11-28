#!/usr/bin/env node
// 测试用：接了活就一声不吭（模拟卡住的 Agent），看连接器会不会自己停掉
import readline from 'node:readline'
const out = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') return out({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  if (m.method === 'session/new') return out({ id: m.id, result: { sessionId: 's-hang' } })
  if (m.method === 'session/cancel') return // 不理取消
  if (m.method === 'session/prompt') return // 不回
})
