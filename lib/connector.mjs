// 鱼Sho 连接器：让这台电脑上的 Agent（Codex、Claude Code、DSH）出现在你手机的鱼Sho 里，可以直接和它们说话、派活。
//   · 身份：第一次运行自动生成，存在 ~/.yusho-connect（或 YUSHO_HOME）；自动领一个鱼Sho号，中继和文件服务器就放行它的消息
//   · 配对：显示二维码和 6 位码，手机扫码（或输入码）后，在电脑上核对指纹、点确认，这部手机就是主人
//   · 干活：主人派来的活，经 ACP 驱动本机已经登录的 Agent；进度、要批的操作、结果、改动的文件（加密上传）都回给手机
// 原则：只驱动本机已经登录的 CLI，绝不代管任何账号或密钥；只听配对过的主人；只在工作目录里干活。
import { spawn, spawnSync, execFile } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import * as acp from '@agentclientprotocol/sdk'
import { openInbox, parseContent } from './nostr.mjs'
import { createLanFiles } from './lanfile.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
/** 把 Agent 那边的错误说清楚：ACP 把真正的原因放在 data.details 里，只看 message 就只剩“Internal error” */
const errText = (e) => { const d = e?.data?.details ?? e?.data?.message ?? (typeof e?.data === 'string' ? e.data : null); const m = String(e?.message ?? e); return (d && !m.includes(d) ? m.replace(/^Internal error:?s*/i, '') + (m.match(/^Internal error:?s*$/i) ? '' : '：') + d : m).slice(0, 800) }
export const DEFAULTS = { relay: 'wss://relay.yusho.chat', idService: 'https://yusho.chat', blossom: 'https://files.yusho.chat' }
export const pairTag = (code) => 'shoal-pair:' + crypto.createHash('sha256').update('shoal-pair-v0:' + code).digest('hex') // 和手机 App 一致
export const fingerprint = (pk) => pk.slice(0, 8).toUpperCase().replace(/(....)(....)/, '$1 $2')
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

// ── 这台电脑上有哪些 Agent：登录过（有登录文件）或者装了命令就算有。只用你本机已经登录的，连接器不碰账号
//    Codex 的 ACP 适配器随连接器带（它自带 Codex）；Claude Code 的适配器用 npx 现取；DSH 用随带的适配器
function has(cmd) { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return r.status === 0 }
const homeHas = (...p) => fs.existsSync(path.join(os.homedir(), ...p))
/** 没检测到、但看得出装过的 Agent：告诉用户差什么 */
export function agentHints(found) {
  const h = []
  if (!found.claude && homeHas('.claude.json')) h.push('Claude Code：看起来只在 Claude 桌面 App 里登录过，那个登录连接器用不了。装命令行版（npm i -g @anthropic-ai/claude-code）后在终端运行一次 claude 登录，再重启连接器。')
  if (!found.codex && has('npx') && homeHas('.codex')) h.push('Codex：没找到登录信息。在终端运行一次 codex 登录，再重启连接器。')
  return h
}
export function detectAgents() {
  const out = {}
  if (has('codex') || homeHas('.codex', 'auth.json')) { let entry = null; try { entry = require.resolve('@agentclientprotocol/codex-acp/package.json') } catch {} ; const env = { INITIAL_AGENT_MODE: 'workspace-write', NO_BROWSER: '1' }; if (!entry) out.codex = { command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@2.9.0'], env } /* 适配器带着一整份 Codex（几百 MB），不放进安装包，第一次派活时再下载 */; else { const pkg = JSON.parse(fs.readFileSync(entry, 'utf8')); const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0]; out.codex = { command: process.execPath, args: [path.join(path.dirname(entry), bin)], env } } }
  // Claude Code：要有命令行版的登录（claude 命令，或 ~/.claude/.credentials.json），或者设了 ANTHROPIC_API_KEY。
  // 只在 Claude 桌面 App 里登录过的不算：桌面 App 的登录只给它自己用，连接器借不到（会报“需要登录”）
  if (has('claude') || homeHas('.claude', '.credentials.json') || process.env.ANTHROPIC_API_KEY) out.claude = { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@0.107.0'], env: {} }
  if (has('dsh')) out.dsh = { command: process.execPath, args: [path.join(here, 'dsh-acp.mjs')], env: {} }
  return out
}

/** 怎么启动一个 Agent：command 是 npx 时，换成“Node + npm 的 npx-cli.js”（找不到才退回系统的 npx） */
function launcher(ag) {
  if (ag.command !== 'npx') return [ag.command, ag.args]
  const cli = path.join(path.dirname(process.execPath), process.platform === 'win32' ? '' : '..', process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'npm', 'bin', 'npx-cli.js')
  return fs.existsSync(cli) ? [process.execPath, [cli, ...ag.args]] : [ag.command, ag.args]
}
/** 结束一个 Agent 和它开的所有子进程（npx → node → 真正的 Agent） */
function killTree(child) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
  else try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() }
}
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

export async function createConnector({ home = process.env.YUSHO_HOME || path.join(os.homedir(), '.yusho-connect'), name = os.hostname(), log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a), onChange = () => {}, owner = '后台服务', sink = null /* 测试用：不经中继，消息直接交给它 */ } = {}) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const F = (n) => path.join(home, n)
  const readJ = (n, d) => { try { return JSON.parse(fs.readFileSync(F(n), 'utf8')) } catch { return d } }
  const writeJ = (n, v, mode) => fs.writeFileSync(F(n), JSON.stringify(v, null, 1), mode ? { mode } : undefined)

  // 配置：中继、号码服务、文件服务、工作目录、Agent（没写就自动检测）。用户可以改 config.json
  const cfg = { ...DEFAULTS, workDir: path.join(os.homedir(), 'YushoWork'), name, ...readJ('config.json', {}) }
  if (!fs.existsSync(F('config.json'))) writeJ('config.json', { name: cfg.name, workDir: cfg.workDir })
  fs.mkdirSync(cfg.workDir, { recursive: true })
  const agents = cfg.agents ?? detectAgents()

  // 身份
  let id = readJ('identity.json', null)
  if (!id) { const sk = generateSecretKey(); id = { sk: bytesToHex(sk), pk: getPublicKey(sk), created: Date.now() }; writeJ('identity.json', id, 0o600); log('生成了这台电脑的身份') }
  const key = { pk: id.pk, skBytes: hexToBytes(id.sk) }

  // 领鱼Sho号（NIP-98 签名）：领了号，中继就放行发给这台电脑的加密消息，文件服务器也收它上传的文件
  async function claimNumber() {
    if (id.number) return id.number
    const url = cfg.idService + '/api/id/claim'
    const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'POST']], content: '' }, key.skBytes)
    const r = await fetch(url, { method: 'POST', headers: { authorization: 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64') }, signal: AbortSignal.timeout(15000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.pk !== id.pk || !/^\d{6,15}$/.test(String(j.number))) throw new Error('领号失败：' + (j.error || 'HTTP ' + r.status))
    id.number = String(j.number); writeJ('identity.json', id, 0o600); log('领到了鱼Sho号', id.number); return id.number
  }

  // 主人的设备（配对过的手机）
  const devices = () => readJ('devices.json', [])
  const owners = () => new Map(devices().filter((d) => !d.revoked).map((d) => [d.pk, d.label]))
  const revoked = () => new Set(devices().filter((d) => d.revoked).map((d) => d.pk))

  // ── 连中继
  let inbox = null
  const send = (to, payload) => (sink ? Promise.resolve(sink(to, { shoal: 1, from: 'runner', ...payload })) : inbox.send(to, { shoal: 1, from: 'runner', ...payload }))
  const tasks = new Map() // task_id -> { pendingApprovals, cancel, agent, title, started }
  // 手机 ↔ 电脑直连传文件（同一个 Wi-Fi 时）：见 lanfile.mjs
  const lan = createLanFiles({ workDir: cfg.workDir, log })
  const results = new Map(readJ('results.json', []))
  const saveResult = (id2, p) => { results.set(id2, p); writeJ('results.json', [...results].slice(-200)) }

  // ── 配对（同时只开一个）：发一条“配对邀请”（kind 30078，按连接码的哈希找，5 分钟过期，只含名字和公钥），等手机来
  let pairing = null
  async function startPairing({ restore = null } = {}) {
    if (!id.number) await claimNumber()
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), ttl = 300, expires = Math.floor(Date.now() / 1000) + ttl
    const offer = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', pairTag(code)], ['expiration', String(expires)]], content: JSON.stringify({ v: 0, name: cfg.name, agents: Object.keys(agents), ...(restore ? { restore: true } : {}) }) }, key.skBytes)
    await inbox.publish(offer)
    pairing = { code, expires: expires * 1000, restore, request: null }
    onChange()
    log('配对码 ' + code + '（5 分钟内有效）')
    return { code, expires: pairing.expires, qr: 'yusho:pair?c=' + code + '&k=' + id.pk, fingerprint: fingerprint(id.pk) }
  }
  function cancelPairing() { pairing = null; onChange() }
  /** 电脑上的人核对完指纹：确认或拒绝 */
  async function answerPairing(ok) {
    const p = pairing; if (!p?.request) throw new Error('没有等确认的手机')
    const { pk, label } = p.request; pairing = null; onChange()
    if (!ok) { await send(pk, { type: p.restore ? 'restore.failed' : 'pair.failed', reason: '电脑上取消了' }); return { ok: false } }
    if (p.restore) {
      const b = p.restore, d = devices().filter((x) => x.pk !== b.pk); d.push({ pk: b.pk, label: b.label, added: Date.now(), restoredTo: label }); writeJ('devices.json', d)
      await send(pk, { type: 'restore.ok', sk: b.sk, pk: b.pk, label: b.label, members: b.members ?? [], name: cfg.name, agents: Object.keys(agents) })
      log('把身份交给了新手机：' + b.label); return { ok: true }
    }
    const d = devices().filter((x) => x.pk !== pk); d.push({ pk, label, number: p.request.number ?? null, added: Date.now() }); writeJ('devices.json', d)
    await send(pk, { type: 'pair.ok', name: cfg.name, agents: Object.keys(agents) })
    log('连上了：' + label); onChange(); return { ok: true }
  }
  async function onPairRequest(rumor, m) {
    const p = pairing, restoreMode = !!p?.restore
    if (!p || p.request || Date.now() > p.expires || m.type !== (restoreMode ? 'restore.request' : 'pair.request')) return
    if (m.code !== p.code) return send(rumor.pubkey, { type: restoreMode ? 'restore.failed' : 'pair.failed', reason: '连接码不对或已经过期，看一眼电脑上的新码' })
    // 手机要领过鱼Sho号（中继才会放行发给它的消息），并且号码真是这部手机的
    let number = /^\d{6,15}$/.test(String(m.number ?? '')) ? String(m.number) : null
    if (number) { try { const j = await (await fetch(`${cfg.idService}/.well-known/nostr.json?name=${number}`, { signal: AbortSignal.timeout(10000) })).json(); if (j?.names?.[number] !== rumor.pubkey) number = null } catch { number = null } }
    if (!number && !restoreMode) return send(rumor.pubkey, { type: 'pair.failed', reason: '这部手机还没领到鱼Sho号（联网后会自动领），稍等一下再试' })
    p.request = { pk: rumor.pubkey, label: String(m.label || '手机').slice(0, 40), number, fingerprint: fingerprint(rumor.pubkey), at: Date.now() }
    log(`「${p.request.label}」想连上这台电脑，指纹 ${p.request.fingerprint}，等你确认`)
    onChange()
  }

  // ── 收消息
  async function onRumor(rumor) {
    const from = rumor.pubkey, m = parseContent(rumor.content)
    if (m.type === 'pair.request' || m.type === 'restore.request') return onPairRequest(rumor, m)
    const own = owners()
    if (!own.has(from)) { if (revoked().has(from)) return send(from, { type: 'pair.revoked', task_id: m.task_id }); return } // 只听主人的；断开过的告诉它一声
    try { await route(m, from) } catch (e) { log('处理出错', e?.message ?? e); await send(from, { type: 'error', message: String(e?.message ?? e) }) }
  }
  async function route(m, from) {
    if (m.type === 'backup.store') { // 手机的身份备份：换手机时用“从电脑恢复”（只收它自己的钥匙）
      let ok = false; try { ok = getPublicKey(hexToBytes(String(m.sk))) === from } catch {}
      if (!ok) return send(from, { type: 'error', message: '备份里的钥匙和发件人对不上，没存' })
      fs.mkdirSync(F('device-backups'), { recursive: true, mode: 0o700 })
      fs.writeFileSync(F('device-backups/' + from + '.json'), JSON.stringify({ pk: from, label: owners().get(from), sk: m.sk, members: m.members ?? [], at: Date.now() }), { mode: 0o600 })
      return send(from, { type: 'backup.ok', at: Date.now() })
    }
    if (m.type === 'file.offer') { try { return send(from, await lan.offer(m, (ev) => send(from, ev))) } catch (e) { return send(from, { type: 'file.failed', id: m.id, reason: e.message }) } }
    if (m.type === 'file.request') { try { return send(from, await lan.request(m)) } catch (e) { return send(from, { type: 'file.failed', id: m.id ?? null, req: m.req ?? null, reason: e.message }) } }
    if (m.type === 'task.create') return runTask(m, from)
    if (m.type === 'task.approve') return resolveApproval(m.task_id, m.request_id, m.option_id)
    if (m.type === 'task.cancel') return tasks.get(m.task_id)?.cancel()
    if (m.type === 'task.query') return send(from, results.has(m.task_id) ? { ...results.get(m.task_id), resent: true } : { type: 'task.status', task_id: m.task_id, state: tasks.has(m.task_id) ? 'running' : 'unknown' })
    if (m.type === 'ping') return send(from, { type: 'pong', nonce: m.nonce, agents: Object.keys(agents), busy: [...tasks.keys()], opts: agentOpts })
    if (m.type === 'agents.query') return send(from, { type: 'agents.opts', name: cfg.name, opts: agentOpts })
    if (m.type === 'presence.query') return send(from, { type: 'presence.state', who: 'runner', nonce: m.nonce, state: tasks.size ? '工作中' : '空闲', agents: Object.keys(agents) })
  }

  // ── 干活：改动的文件加密上传（文件服务器只存密文，钥匙只在给手机的加密消息里）
  const ART = { maxFiles: 10, maxBytes: 50 * 1024 * 1024, maxDepth: 4, maxScan: 2000, skip: new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', 'build']) }
  function snapshot(dir) {
    const files = new Map()
    const walk = (d, depth) => { if (depth > ART.maxDepth || files.size >= ART.maxScan) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return } for (const e of es) { if (e.name.startsWith('.') || ART.skip.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (e.isFile()) { try { const st = fs.statSync(p); files.set(p, st.size + ':' + st.mtimeMs) } catch {} } } }
    walk(dir, 0); return files
  }
  async function upload(plain, name) {
    const k = crypto.randomBytes(32), nonce = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, nonce)
    const cipher = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]), ch = sha256(cipher), now = Math.floor(Date.now() / 1000)
    const auth = finalizeEvent({ kind: 24242, created_at: now, content: 'upload ' + ch, tags: [['t', 'upload'], ['expiration', String(now + 300)], ['x', ch]] }, key.skBytes)
    const r = await fetch(cfg.blossom + '/upload', { method: 'PUT', headers: { authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64'), 'content-type': 'application/octet-stream', 'x-sha-256': ch }, body: cipher })
    if (!r.ok) throw new Error('上传失败 HTTP ' + r.status)
    const d = await r.json(); if (d.sha256 !== ch) throw new Error('服务器返回的哈希对不上')
    const ext = path.extname(name).toLowerCase(), MIME = { '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp4': 'video/mp4' }
    return { name, size: plain.length, type: MIME[ext] ?? 'application/octet-stream', sha256: sha256(plain), url: d.url, cipher_sha256: ch, key: k.toString('hex'), nonce: nonce.toString('hex'), alg: 'aes-256-gcm' }
  }
  async function collectArtifacts(cwd, before) {
    const after = snapshot(cwd), changed = [...after.entries()].filter(([p, s]) => before.get(p) !== s).map(([p]) => p), out = []
    for (const p of changed.slice(0, ART.maxFiles)) { try { if (fs.statSync(p).size > ART.maxBytes) continue; out.push(await upload(fs.readFileSync(p), path.relative(cwd, p).split(path.sep).join('/'))) } catch (e) { log('文件上传失败', p, e?.message ?? e) } }
    return out
  }

  // ── 连续的活接着同一个会话：手机派活时带 thread（同一串活的编号）。同一个 thread、同一个 Agent 的下一件活，
  //    直接在上一件活留下的 Agent 进程和会话里接着说，Agent 记得前面做过什么；新的活（没带 thread）照旧新开会话。
  //    空闲 30 分钟的会话自动关掉；最多同时留 3 个，多了先关最久没用的
  const lives = new Map() // thread → { agent, child, ctx, sessionId, cur, idle, dead, ready, exited, lastUsed }
  const LIVE_IDLE = 30 * 60_000, LIVE_MAX = 3
  // ── 模型、思考等级、快速模式：Agent 在建会话时经 ACP 的 configOptions 报上来（Codex 有；Claude Code 的适配器有就用）。
  //    记在 agent-opts.json 里，跟着 hello / pong 告诉手机；派活时手机带上选择，发任务前用 session/set_config_option 设好
  const OPT_CATS = ['model', 'thought_level', 'speed']
  let agentOpts = (() => { try { return JSON.parse(fs.readFileSync(F('agent-opts.json'), 'utf8')) } catch { return {} } })()
  function noteOpts(agentKey, config) {
    const xs = (config ?? []).filter((c) => OPT_CATS.includes(c.category) && c.type === 'select' && Array.isArray(c.options)).map((c) => ({ id: c.id, category: c.category, name: c.name, current: c.currentValue, options: c.options.slice(0, 40).map((o) => ({ value: o.value, name: o.name, description: String(o.description ?? '').slice(0, 120) })) }))
    if (!xs.length) return
    const sig = JSON.stringify(xs.map((x) => [x.category, x.options.map((o) => o.value)]))
    if (JSON.stringify((agentOpts[agentKey] ?? []).map((x) => [x.category, x.options.map((o) => o.value)])) === sig) return
    agentOpts = { ...agentOpts, [agentKey]: xs }; try { fs.writeFileSync(F('agent-opts.json'), JSON.stringify(agentOpts)) } catch {}
    for (const pk of owners().keys()) send(pk, { type: 'agents.opts', name: cfg.name, opts: agentOpts }).catch(() => {})
  }
  /** 按手机的选择设好这一轮的模型、思考等级、快速模式（先设模型，因为换模型后思考等级的可选项可能变） */
  async function applyOpts(live, want) {
    if (!want || !live.config?.length) return []
    const done = []
    for (const [cat, val] of [['model', want.model], ['thought_level', want.thought], ['speed', want.speed]]) {
      if (val == null || val === '') continue
      const o = live.config.find((c) => c.category === cat); if (!o || o.currentValue === val || !o.options?.some((x) => x.value === val)) continue
      try {
        const r = await live.ctx.request(acp.methods.agent.session.setConfigOption, { sessionId: live.sessionId, configId: o.id, value: val })
        if (Array.isArray(r?.configOptions)) live.config = r.configOptions; else o.currentValue = val
        done.push((o.name || cat) + '：' + (o.options.find((x) => x.value === val)?.name ?? val))
      } catch (e) { log('设置' + (o.name || cat) + '没成：', e?.message ?? e) }
    }
    return done
  }
  function closeLive(thread) { const l = lives.get(thread); if (!l) return; lives.delete(thread); clearTimeout(l.idle); l.dead = true; try { l.close?.() } catch {} killTree(l.child); onChange() }
  function openLive(agentKey, ag, cwd, logName) {
    fs.mkdirSync(F('logs'), { recursive: true })
    const logFile = fs.createWriteStream(F('logs/' + logName + '.' + agentKey + '.log'))
    // 不经过 cmd：npx 直接用 Node 跑 npm 自带的 npx-cli.js（cmd 包一层时，结束一个会把 Ctrl-C 波及同一控制台里的别的 Agent）。
    // 结束时连它开的子进程一起结束（killTree）。非 Windows 单独一个进程组，好整组结束
    const [cmd, args] = launcher(ag)
    const win = process.platform === 'win32'
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...ag.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: win && cmd !== process.execPath, detached: !win, windowsHide: true })
    child.stderr.pipe(logFile)
    const live = { agent: agentKey, child, ctx: null, sessionId: null, cur: null, idle: null, dead: false, lastUsed: Date.now() }
    live.exited = new Promise((_, rej) => child.on('exit', (code, sig) => { live.dead = true; rej(new Error(`Agent 进程退出（code=${code}${sig ? ', ' + sig : ''}）`)) }))
    live.exited.catch(() => {})
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
    const app = acp.client({ name: 'yusho-connect' })
      .onNotification(acp.methods.client.session.update, ({ params }) => live.cur?.onUpdate(params.update))
      .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => (live.cur ? live.cur.onPermission(params) : { outcome: { outcome: 'cancelled' } }))
    live.ready = new Promise((ok, no) => {
      app.connectWith(stream, async (ctx) => {
        await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
        const sNew = await ctx.request(acp.methods.agent.session.new, { cwd, mcpServers: [] }), { sessionId } = sNew
        live.config = Array.isArray(sNew.configOptions) ? sNew.configOptions : []; noteOpts(agentKey, live.config)
        live.ctx = ctx; live.sessionId = sessionId; ok()
        await new Promise((r) => { live.close = r }) // 会话一直开着，直到关掉
      }).catch(no)
      live.exited.catch(no)
    })
    live.ready.catch(() => {})
    return live
  }

  let seq = 0
  const STALL_MS = Math.max(60_000, Number(process.env.YUSHO_STALL_MS) || 10 * 60_000)
  async function runTask(t, from) {
    const task_id = t.task_id ?? 't_' + Date.now().toString(36) + (seq++).toString(36)
    // 手机重发同一件活（之前没收到接单）：在做就再回一次接单，做完了就把结果再发一遍，不重复做
    if (tasks.has(task_id)) return send(from, { type: 'task.ack', task_id, agent: t.agent, note: '已经在做了', resent: true })
    if (results.has(task_id)) return send(from, { ...results.get(task_id), resent: true })
    const reply = (p) => { if (p.type === 'task.result' || p.type === 'task.failed') saveResult(task_id, p); return send(from, p) }
    const ag = agents[t.agent]
    if (!ag) return reply({ type: 'task.failed', task_id, reason: `这台电脑上没有 ${t.agent}（有：${Object.keys(agents).join('、') || '无'}）` })
    const cwd = cfg.workDir // 只在工作目录里干活
    const thread = /^[\w:.-]{4,80}$/.test(String(t.thread ?? '')) ? from.slice(0, 8) + ':' + t.thread : null
    let live = thread ? lives.get(thread) : null
    if (live && (live.dead || live.agent !== t.agent || live.cur)) live = null // 进程没了、换了 Agent、或者上一件还在做：新开
    const continued = !!live
    if (!live) {
      if (thread) { closeLive(thread); const idle = [...lives.entries()].filter(([, l]) => !l.cur).sort((a, b) => a[1].lastUsed - b[1].lastUsed); while (lives.size >= LIVE_MAX && idle.length) closeLive(idle.shift()[0]) }
      live = openLive(t.agent, ag, cwd, task_id)
      if (thread) lives.set(thread, live)
    }
    clearTimeout(live.idle); live.lastUsed = Date.now()
    const state = { pendingApprovals: new Map(), cancel: () => {}, agent: t.agent, title: t.title ?? String(t.instruction).slice(0, 20), started: Date.now(), thread }
    tasks.set(task_id, state); onChange()
    const before = snapshot(cwd), started = Date.now()
    await reply({ type: 'task.ack', task_id, agent: t.agent, cwd, instruction: t.instruction, note: continued ? '已接单，接着上次的会话做' : '已接单，开始执行', session: continued ? 'continued' : 'new' })
    let progress = [], finalText = '', preamble = ''
    const titles = new Map(), short = (s) => (s.length > 80 ? s.slice(0, 77) + '…' : s)
    const flush = async () => { if (progress.length) { const lines = progress; progress = []; await reply({ type: 'task.progress', task_id, lines }) } }
    const timer = setInterval(flush, 4000)
    let limitTimer, stallTimer, lastAct = Date.now()
    const overtime = new Promise((_, rej) => {
      limitTimer = setTimeout(() => { state.cancel(); rej(new Error('超过 30 分钟，已取消')) }, 30 * 60_000)
      // 卡住了：Agent 一直没有任何输出、也不在等你批，10 分钟就停掉，免得白白耗额度
      stallTimer = setInterval(() => { if (!state.pendingApprovals.size && Date.now() - lastAct > STALL_MS) { state.cancel(); rej(new Error(Math.round(STALL_MS / 60000) + ' 分钟没有任何动静，自动停了（防止卡住白耗额度）')) } }, 30_000)
    })
    // 叫停：先请它停（ACP 的 session/cancel），6 秒还没停就直接结束进程——有的 Agent 不理取消，会把活做完
    let stopNow, killed = false
    const stopped = new Promise((_, rej) => { stopNow = () => rej(new Error('手机上叫停了')) })
    state.cancel = () => { if (live.ctx) live.ctx.notify(acp.methods.agent.session.cancel, { sessionId: live.sessionId }).catch(() => {}); setTimeout(() => { if (!tasks.has(task_id)) return; killed = true; stopNow(); if (thread) closeLive(thread); else killTree(live.child) }, 6000).unref?.() }
    overtime.catch(() => {}); stopped.catch(() => {})
    live.cur = {
      onUpdate(u) {
        lastAct = Date.now()
        if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') finalText += u.content.text
        else if (u.sessionUpdate === 'tool_call') { if (finalText.trim()) { preamble = finalText; finalText = '' } titles.set(u.toolCallId, short(u.title ?? u.kind ?? '工具调用')); progress.push('▶ ' + titles.get(u.toolCallId)) }
        else if (u.sessionUpdate === 'tool_call_update') { if (u.title) titles.set(u.toolCallId, short(u.title)); if (u.status === 'completed' || u.status === 'failed') progress.push((u.status === 'completed' ? '✓ ' : '✗ ') + (titles.get(u.toolCallId) ?? u.toolCallId)) }
        else if (u.sessionUpdate === 'plan') progress.push('计划：' + (u.entries ?? []).map((e) => `[${e.status === 'completed' ? 'x' : ' '}] ${e.content}`).join('；'))
      },
      async onPermission(params) {
        // Agent 要权限：一律转给主人（派活的那部手机）批，10 分钟没人批就算拒绝
        const request_id = 'r' + (state.pendingApprovals.size + 1)
        const options = params.options.map((o, i) => ({ n: i + 1, id: o.optionId, name: o.name, kind: o.kind }))
        await flush()
        await reply({ type: 'task.need_approval', task_id, request_id, action: params.toolCall?.title ?? '未知操作', options })
        onChange()
        const optionId = await new Promise((res) => { state.pendingApprovals.set(request_id, { res, options }); setTimeout(() => res(null), 600_000) })
        state.pendingApprovals.delete(request_id); lastAct = Date.now(); onChange()
        return optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }
      },
    }
    // 新开的会话：手机附带的“之前说过的”放在前面让它接得上；接着原来的会话就不用了（它自己记得）
    const text = (!continued && t.context ? '[我们之前说过的（只作参考，不用再做）]\n' + String(t.context) + '\n\n[现在]\n' : '') + String(t.instruction)
    try {
      await Promise.race([live.exited, overtime, stopped, live.ready])
      const set = await applyOpts(live, t.opts); if (set.length) { progress.push('用 ' + set.join('，')); await flush() }
      const stopReason = await Promise.race([live.exited, overtime, stopped, live.ctx.request(acp.methods.agent.session.prompt, { sessionId: live.sessionId, prompt: [{ type: 'text', text }] }).then((r) => r.stopReason)])
      await flush()
      const seconds = Math.round((Date.now() - started) / 1000), artifacts = await collectArtifacts(cwd, before)
      if (stopReason === 'end_turn') await reply({ type: 'task.result', task_id, agent: t.agent, seconds, text: finalText.trim() || preamble.trim() || '（Agent 没有输出文字）', ...(artifacts.length ? { artifacts } : {}) })
      else await reply({ type: 'task.failed', task_id, reason: stopReason === 'cancelled' ? '手机上叫停了' : '停止原因：' + stopReason, seconds, text: (finalText.trim() || preamble.trim()) })
    } catch (e) {
      await flush(); await reply({ type: 'task.failed', task_id, reason: errText(e) })
    } finally {
      clearInterval(timer); clearTimeout(limitTimer); clearInterval(stallTimer); tasks.delete(task_id); live.cur = null; live.lastUsed = Date.now()
      // 连续的活：会话留着等下一件（30 分钟没动静就关）；单件的活：做完就关
      if (thread && !live.dead && !killed) live.idle = setTimeout(() => closeLive(thread), LIVE_IDLE)
      else if (thread) closeLive(thread)
      else { try { live.close?.() } catch {} killTree(live.child) }
      onChange()
    }
  }
  function resolveApproval(task_id, request_id, option_id) {
    const st = tasks.get(task_id); if (!st) return
    const [, p] = request_id ? [request_id, st.pendingApprovals.get(request_id)] : [...st.pendingApprovals.entries()].at(-1) ?? []
    if (!p) return
    const chosen = option_id === 'reject' ? p.options.find((o) => o.kind?.startsWith('reject')) : p.options.find((o) => o.id === option_id)
    p.res(chosen?.id ?? null)
  }

  return {
    async start() {
      // 同一台电脑同一个身份只能有一个连接器在线（DSH 插件和后台服务二选一），不然手机发一次活会做两遍
      const lk = readJ('running.json', null)
      if (lk && lk.pid !== process.pid && alive(lk.pid)) throw new Error('连接器已经在' + lk.owner + '里运行（进程 ' + lk.pid + '），到那边管理')
      writeJ('running.json', { pid: process.pid, owner, at: Date.now() })
      try { await claimNumber() } catch (e) { log(e.message + '。没有号，手机连不上；每分钟再试一次'); const t = setInterval(() => claimNumber().then(() => { clearInterval(t); onChange() }).catch(() => {}), 60000); t.unref?.() }
      inbox = await openInbox(cfg.relay, key, (r) => onRumor(r).catch((e) => log('出错', e?.message ?? e)), { log })
      // 告诉连着的手机：现在这台电脑能用哪些 Agent（装了 / 卸了 / 登录了，手机上的列表跟着变）
      for (const pk of owners().keys()) send(pk, { type: 'hello', name: cfg.name, agents: Object.keys(agents), opts: agentOpts }).catch(() => {})
      // 还不知道某个 Agent 有哪些模型、思考等级：开一次会话读一下就关（不发任务，不花额度），读到了会告诉手机
      setTimeout(async () => {
        for (const k of Object.keys(agents)) {
          if (k === 'dsh' || agentOpts[k]) continue
          try { const l = openLive(k, agents[k], cfg.workDir, 'probe'); await Promise.race([l.ready, l.exited, new Promise((_, no) => setTimeout(() => no(new Error('3 分钟没连上')), 180_000))]); try { l.close?.() } catch {} ; killTree(l.child) } catch (e) { log('读 ' + k + ' 的模型列表没成：', e?.message ?? e) }
        }
      }, 15_000)
      log(`连接器在线：${cfg.name}（鱼Sho号 ${id.number ?? '没领到'}），Agent：${Object.keys(agents).join('、') || '没找到'}，工作目录 ${cfg.workDir}`)
      onChange()
    },
    ...(sink ? { _rumor: (pubkey, m) => onRumor({ pubkey, content: JSON.stringify({ shoal: 1, ...m }) }) } : {}), // 测试用：不经中继直接收一条
    info: () => ({ hints: cfg.agents ? [] : agentHints(agents), name: cfg.name, pk: id.pk, fingerprint: fingerprint(id.pk), number: id.number ?? null, agents: Object.keys(agents), workDir: cfg.workDir, home, online: !!inbox?.relay, devices: devices().map(({ pk, label, number, added, revoked: rv }) => ({ pk, label, number, added, revoked: rv ?? null, fingerprint: fingerprint(pk) })), tasks: [...tasks].map(([tid, s]) => ({ id: tid, agent: s.agent, title: s.title, started: s.started, waiting: s.pendingApprovals.size > 0 })), pairing: pairing ? { code: pairing.code, expires: pairing.expires, qr: 'yusho:pair?c=' + pairing.code + '&k=' + id.pk, request: pairing.request, restore: !!pairing.restore } : null }),
    startPairing, cancelPairing, answerPairing,
    /** 换手机：把这台电脑上存的某部手机的身份备份交给新手机 */
    backups: () => { const d = F('device-backups'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))).map(({ pk, label, at }) => ({ pk, label, at, fingerprint: fingerprint(pk) })) : [] },
    startRestore(pk) { const p = F('device-backups/' + pk + '.json'); if (!fs.existsSync(p)) throw new Error('没有这部手机的备份'); return startPairing({ restore: JSON.parse(fs.readFileSync(p, 'utf8')) }) },
    removeDevice(pk) { const d = devices(), x = d.find((y) => y.pk === pk || y.pk.startsWith(String(pk).toLowerCase())); if (!x) throw new Error('没有这台设备'); x.revoked = Date.now(); writeJ('devices.json', d); onChange(); return x },
    _runTaskForTest: (t, from) => runTask(t, from),
    stop() { for (const k of [...lives.keys()]) closeLive(k); inbox?.close(); if (readJ('running.json', null)?.pid === process.pid) fs.rmSync(F('running.json'), { force: true }) },
  }
}
