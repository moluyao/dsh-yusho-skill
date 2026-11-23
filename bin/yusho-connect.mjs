#!/usr/bin/env node
// 鱼Sho 连接器
//   yusho-connect                 在后台启动连接器，并在浏览器里打开它的页面（二维码、核对指纹、开机自动运行都在页面上）
//   yusho-connect --no-open       同上，但不开浏览器，只打出页面链接（给 Agent 用）
//   yusho-connect status [--json] 看状态：在不在跑、领到的号、能用的 Agent、连着的手机
//   yusho-connect stop            停止后台的连接器
//   yusho-connect autostart on|off  开机自动运行（当前用户，不要管理员权限）
//   yusho-connect list | remove <指纹前几位>   看 / 断开连着的手机
//   yusho-connect serve           在前台运行（开机自启和上面的“后台启动”用的就是它）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BIN = fs.realpathSync(fileURLToPath(import.meta.url))
const HOME = process.env.YUSHO_HOME || path.join(os.homedir(), '.yusho-connect')
const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (f) => process.argv.includes(f)
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.join(HOME, f), 'utf8')) } catch { return null } }
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const AG = { codex: 'Codex', claude: 'Claude Code', dsh: 'DSH' }

/** 正在跑的后台服务（没有就是 null） */
async function running() {
  const s = readJ('service.json'); if (!s || !alive(s.pid)) return null
  try { await call(s, 'status'); return s } catch { return null }
}
async function call(s, name, body) {
  const r = await fetch(`http://127.0.0.1:${s.port}/api/${name}`, { method: body ? 'POST' : 'GET', headers: { cookie: 'yc=' + s.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) })
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j
}
async function ensure() {
  let s = await running(); if (s) return s
  const lk = readJ('running.json')
  if (lk && alive(lk.pid) && lk.owner !== '后台服务') throw new Error(`连接器已经在 ${lk.owner} 里运行，到 ${lk.owner} 的“🐟 鱼Sho”页面里管理就行。`)
  fs.mkdirSync(path.join(HOME, 'logs'), { recursive: true })
  const logf = path.join(HOME, 'logs', 'service.log'), out = fs.openSync(logf, 'a')
  const child = spawn(process.execPath, [BIN, 'serve'], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env: process.env })
  child.unref()
  for (let i = 0; i < 120; i++) { // 第一次要领号、连中继，最多等 60 秒
    await wait(500)
    s = readJ('service.json'); if (s?.pid === child.pid && (await running())) return s
    if (!alive(child.pid)) break
  }
  const tail = fs.readFileSync(logf, 'utf8').trim().split('\n').slice(-5).join('\n')
  throw new Error('连接器没起来。日志最后几行：\n' + tail)
}
function openBrowser(url) {
  if (process.platform === 'win32') execFile('rundll32', ['url.dll,FileProtocolHandler', url], () => {})
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {})
}
const say = (s) => console.log(s)
const fail = (e) => { console.error(e?.message ?? e); process.exit(1) }

if (cmd === 'serve') {
  const { serve } = await import('../lib/service.mjs')
  await serve({ home: HOME }).catch(fail)
} else if (cmd === 'stop') {
  const s = await running(); if (!s) { say('连接器没在后台运行。'); process.exit(0) }
  await call(s, 'quit', {}).catch(() => {})
  for (let i = 0; i < 40 && alive(s.pid); i++) await wait(250) // 等它真的退出，紧接着再启动才不会撞上旧的
  say('已停止。手机暂时连不上这台电脑。')
} else if (cmd === 'status') {
  const s = await running(), st = s ? await call(s, 'status') : null
  const lk = readJ('running.json'), elsewhere = !s && lk && alive(lk.pid) ? lk.owner : null
  if (flag('--json')) { say(JSON.stringify({ running: !!s || !!elsewhere, where: s ? 'service' : elsewhere, url: s ? `http://127.0.0.1:${s.port}/?t=${s.token}` : null, number: st?.number ?? null, online: st?.online ?? null, agents: st?.agents ?? [], phones: st?.devices.filter((d) => !d.revoked).map((d) => d.label) ?? [], pairing: st?.pairing ? { code: st.pairing.code, waitingForConfirm: !!st.pairing.request } : null, autostart: st?.autostart ?? null }, null, 1)); process.exit(0) }
  if (elsewhere) { say(`连接器在 ${elsewhere} 里运行。`); process.exit(0) }
  if (!st) { say('连接器没在运行。运行 yusho-connect 启动。'); process.exit(0) }
  say(`连接器在后台运行（${st.online ? '在线' : '连不上中继'}），鱼Sho号 ${st.number ?? '还没领到'}`)
  say(`能用的 Agent：${st.agents.map((a) => AG[a] ?? a).join('、') || '没找到'}`)
  say(`连着的手机：${st.devices.filter((d) => !d.revoked).map((d) => d.label).join('、') || '还没有'}`)
  say(`开机自动运行：${st.autostart ? '开' : '关'}`)
  say(`页面：http://127.0.0.1:${s.port}/?t=${s.token}`)
} else if (cmd === 'autostart') {
  const { setAutostart } = await import('../lib/autostart.mjs')
  const on = setAutostart(arg !== 'off', BIN)
  say(on ? '已设为开机自动运行（后台，不弹窗口）。' : '已关掉开机自动运行。')
} else if (cmd === 'list' || cmd === 'remove') {
  const d = readJ('devices.json') ?? []
  if (cmd === 'list') { say(d.length ? d.map((x) => `${x.revoked ? '（已断开）' : '●'} ${x.label}  公钥 ${x.pk.slice(0, 12)}…  连上于 ${new Date(x.added).toLocaleString('zh-CN', { hour12: false })}`).join('\n') : '还没有连上的手机。'); process.exit(0) }
  const s = await running()
  if (s) { await call(s, 'remove', { pk: String(arg ?? '') }).then(() => say('已断开。'), fail) }
  else { const x = d.find((y) => arg && y.pk.startsWith(String(arg).toLowerCase())); if (!x) fail('没有这部手机'); x.revoked = Date.now(); fs.writeFileSync(path.join(HOME, 'devices.json'), JSON.stringify(d, null, 1)); say('已断开 ' + x.label + '。') }
} else if (!cmd || cmd === 'open' || cmd === 'pair') {
  say('正在启动鱼Sho 连接器…')
  let s = await ensure().catch(fail), st
  try { st = await call(s, 'status') } catch { s = await ensure().catch(fail); st = await call(s, 'status').catch(fail) } // 刚好碰上旧的在退出：再起一次
  if (!st.pairing && (cmd === 'pair' || !st.devices.some((d) => !d.revoked)) && st.number) { await call(s, 'pair', {}).catch(() => {}); st = await call(s, 'status') }
  const url = `http://127.0.0.1:${s.port}/?t=${s.token}`
  if (!flag('--no-open')) openBrowser(url)
  say(`鱼Sho 连接器在后台运行${st.online ? '' : '（还没连上中继，检查网络）'}。`)
  say(`能用的 Agent：${st.agents.map((a) => AG[a] ?? a).join('、') || '没找到（先装好并登录 Codex 或 Claude Code）'}`)
  if (st.pairing) say(`手机扫页面上的二维码，或输入连接码 ${st.pairing.code}（5 分钟内有效）；指纹要在页面上由你本人确认。`)
  else say(`已连着：${st.devices.filter((d) => !d.revoked).map((d) => d.label).join('、')}`)
  say(`页面${flag('--no-open') ? '' : '已在浏览器打开'}：${url}`)
  process.exit(0)
} else {
  say('不认识的命令：' + cmd + '。可用：yusho-connect [status|stop|autostart on|off|list|remove|pair]')
  process.exit(1)
}
