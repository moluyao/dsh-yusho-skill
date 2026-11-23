// 连接器的后台服务：连中继 + 在本机开一个只给自己看的网页（http://127.0.0.1:<端口>）。
// 网页上显示二维码、核对手机指纹、管理连着的手机、开机自动运行。用户不用碰终端。
// 安全：只听 127.0.0.1；只认 Host 是 127.0.0.1 / localhost（防 DNS 重绑定）；每次启动换一个口令，
// 打开网页的链接里带着它，进来后换成只限本站的 Cookie。口令写在 ~/.yusho-connect/service.json（只有本人能读）。
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createConnector } from './connector.mjs'
import { handleApi } from './api.mjs'
import { autostartOn, setAutostart, fromNpxCache } from './autostart.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const BIN = path.join(here, '..', 'bin', 'yusho-connect.mjs')
const PAGE = path.join(here, 'page.html')
const PORTS = [18765, 18766, 18767, 0]

export async function serve({ home } = {}) {
  const conn = await createConnector({ home, owner: '后台服务' })
  const svcFile = path.join(conn.info().home, 'service.json')
  await conn.start() // 已经有一个在跑会直接报错退出
  const token = crypto.randomBytes(18).toString('base64url')
  const J = (res, obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)) }
  let port = 0
  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host ?? '')
      if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) { res.writeHead(403); return res.end() }
      const u = new URL(req.url, 'http://x'), cookie = /(?:^|;\s*)yc=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1]
      if (u.pathname === '/' && u.searchParams.get('t') === token) { res.writeHead(302, { location: '/', 'set-cookie': `yc=${token}; HttpOnly; SameSite=Strict; Path=/` }); return res.end() }
      if (cookie !== token) { res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<meta charset="utf-8"><p style="font:16px system-ui;padding:40px">这个页面的链接过期了。重新运行 <b>yusho-connect</b>（或让 Agent 运行），会打开新的链接。</p>') }
      if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:" }); return res.end(fs.readFileSync(PAGE)) }
      if (!u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end() }
      if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) return J(res, { error: '只收 JSON' }, 415)
      let b = {}
      if (req.method === 'POST') { let s = ''; for await (const ch of req) { s += ch; if (s.length > 10000) break } try { b = JSON.parse(s || '{}') } catch {} }
      const name = u.pathname.slice(5)
      if (name === 'status') return J(res, { ...(await handleApi(conn, 'status')), autostart: autostartOn(), npxCache: fromNpxCache(BIN), pid: process.pid })
      if (name === 'autostart') return J(res, { autostart: setAutostart(!!b.on, BIN) })
      if (name === 'quit') { J(res, { ok: true }); return setTimeout(shutdown, 200) }
      const r = await handleApi(conn, name, b)
      return r ? J(res, r) : J(res, { error: '没有这个接口' }, 404)
    } catch (e) { J(res, { error: String(e?.message ?? e) }, 400) }
  })
  for (const p of PORTS) {
    try { await new Promise((ok, bad) => { server.once('error', bad); server.listen(p, '127.0.0.1', ok) }); port = server.address().port; break } catch {}
  }
  fs.writeFileSync(svcFile, JSON.stringify({ pid: process.pid, port, token, at: Date.now() }), { mode: 0o600 })
  console.log(`鱼Sho 连接器在后台运行：http://127.0.0.1:${port}/?t=${token}`)
  function shutdown() { try { if (JSON.parse(fs.readFileSync(svcFile, 'utf8')).pid === process.pid) fs.rmSync(svcFile, { force: true }) } catch {} conn.stop(); server.close(); process.exit(0) }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
  return { conn, port, token }
}
