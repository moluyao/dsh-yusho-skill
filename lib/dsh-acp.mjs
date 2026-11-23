// DSH（DeepSeek Harness）的 ACP 适配器：把 `dsh --profile headless --json` 包装成标准 ACP Agent（stdio）。
// 执行端用同一套 ACP 客户端代码即可驱动 DSH，和 Codex / Claude Code 一样。
//
// 映射：
//   session/new     → 记下工作目录，返回本地会话号（首次 prompt 后绑定 DSH 的 sessionId，后续轮次续用）
//   session/prompt  → 启动一次 dsh headless，任务从 stdin 传入；NDJSON 事件转成 session/update
//   session/cancel  → 结束 dsh 进程
// 限制：DSH headless 不能交互式审批，这里固定 --approval-policy never（超出权限预设的操作直接被拒），
//       所以 DSH 的审批暂时无法转给主人。
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acp from '@agentclientprotocol/sdk'

const DSH = process.env.DSH_BIN || 'dsh'
const PATCH = process.env.DSH_PATCH || fileURLToPath(new URL('./dsh-headless.patch.yml', import.meta.url)) // 随连接器带的补丁
const PERMISSION = process.env.DSH_PERMISSION_MODE // 可选：DSH 的权限预设名
const sessions = new Map() // 本地会话号 -> { cwd, dshSessionId, child }
let seq = 0

const kindOf = (tool) =>
  /read|glob|grep|list|ls|search|find/i.test(tool) ? 'read' : /write|edit|patch/i.test(tool) ? 'edit' : /web|fetch/i.test(tool) ? 'fetch' : /shell|pwsh|bash|exec|run/i.test(tool) ? 'execute' : 'other'

const app = acp
  .agent({ name: 'dsh-acp' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false } },
    agentInfo: { name: 'dsh-acp', version: '0.0.1' },
    authMethods: [],
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    const sessionId = `dsh-acp-${Date.now().toString(36)}-${seq++}`
    sessions.set(sessionId, { cwd: params.cwd, dshSessionId: null, child: null })
    return { sessionId }
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    sessions.get(params.sessionId)?.child?.kill()
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const s = sessions.get(params.sessionId)
    if (!s) throw acp.RequestError.invalidParams?.('unknown session') ?? new Error('unknown session')
    const text = params.prompt.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    const update = (u) => client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: u })

    const args = ['--profile', 'headless', '--patch', `"${PATCH}"`, '--json', '--approval-policy', 'never']
    if (s.dshSessionId) args.push('--session-id', s.dshSessionId)
    if (PERMISSION) args.push('--permission-mode', PERMISSION)
    args.push('-') // 任务从 stdin 读取，避免命令行转义问题

    const child = spawn(DSH, args, { cwd: s.cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    s.child = child
    child.stdin.end(text)
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d) })

    let stopReason = 'end_turn'
    let finalError = null
    const titles = new Map()
    for await (const line of createInterface({ input: child.stdout })) {
      let ev
      try { ev = JSON.parse(line) } catch { continue }
      switch (ev.type) {
        case 'session':
          s.dshSessionId = ev.sessionId
          break
        case 'thinking':
          await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: ev.text } })
          break
        case 'text':
          await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ev.text } })
          break
        case 'tool_call': {
          const title = `${ev.tool} ${JSON.stringify(ev.input ?? {})}`.slice(0, 200)
          titles.set(ev.callId, title)
          await update({ sessionUpdate: 'tool_call', toolCallId: ev.callId, title, kind: kindOf(ev.tool), status: 'in_progress', rawInput: ev.input })
          break
        }
        case 'tool_result':
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: ev.callId,
            title: titles.get(ev.callId),
            status: ev.status === 'completed' ? 'completed' : 'failed',
            content: typeof ev.result === 'string' ? [{ type: 'content', content: { type: 'text', text: ev.result.slice(0, 4000) } }] : undefined,
          })
          break
        case 'final':
          if (ev.reason?.kind === 'cancelled') stopReason = 'cancelled'
          else if (ev.reason?.kind === 'error') finalError = ev.reason.error?.message ?? 'DSH 运行出错'
          break
      }
    }
    const code = await new Promise((r) => (child.exitCode !== null ? r(child.exitCode) : child.on('close', r)))
    s.child = null
    if (finalError || (code !== 0 && stopReason !== 'cancelled')) {
      throw new Error(finalError ?? `dsh 退出码 ${code}：${stderr.trim().split('\n').at(-1) ?? ''}`)
    }
    return { stopReason }
  })

app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
