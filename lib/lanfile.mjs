// 手机 ↔ 电脑直连传文件（同一个 Wi-Fi 时不走服务器）：
//   · 电脑开一个只在本地网络能访问的 HTTP 口；每次传输一把一次性钥匙（AES-256-GCM），钥匙只放在端到端加密的消息里给手机
//   · 文件切成 1 MB 一块，每块单独加密（nonce = 块序号），断了从没收到的那块接着传
//   · 地址里还带一个一次性口令，别人扫到这个端口也读不到、写不进
// 手机发来：file.offer → 电脑回 file.lan（地址 + 钥匙）→ 手机一块块 PUT → 收齐、核对 SHA-256 → 放进“下载/鱼Sho”，回 file.saved
// 手机要拿：file.request（工作目录里的相对路径）→ 电脑回 file.lan（地址 + 钥匙 + 大小 + SHA-256）→ 手机一块块 GET
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export const CHUNK = 1024 * 1024
const MAX = 20 * 1024 * 1024 * 1024 // 单个文件最大 20 GB
const nonceOf = (i) => { const n = Buffer.alloc(12); n.writeUInt32BE(Math.floor(i / 2 ** 32), 4); n.writeUInt32BE(i % 2 ** 32, 8); return n }
export function sealChunk(key, i, plain) { const c = crypto.createCipheriv('aes-256-gcm', key, nonceOf(i)); return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]) }
export function openChunk(key, i, sealed) { const d = crypto.createDecipheriv('aes-256-gcm', key, nonceOf(i)); d.setAuthTag(sealed.subarray(sealed.length - 16)); return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]) }
const safeName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 180) || 'file'

/** 本机的局域网 IPv4 地址（私有网段），手机挨个试 */
export function lanAddrs() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) {
    if (a.family !== 'IPv4' || a.internal) continue
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address)
  }
  return out
}

export function createLanFiles({ workDir, saveDir = path.join(os.homedir(), 'Downloads', '鱼Sho'), log = () => {}, port = 0 }) {
  const xfers = new Map() // id → { dir: 'in'|'out', token, key, name, size, sha256, chunks, got:Set, file, tmp, from, done }
  let server = null, listening = null
  function ensureServer() {
    if (listening) return listening
    server = http.createServer(handle)
    listening = new Promise((ok, no) => { server.once('error', no); server.listen(port, '0.0.0.0', () => { log('直连传文件：在本地网络的 ' + server.address().port + ' 端口等手机'); ok(server.address().port) }) })
    return listening
  }
  const bad = (res, code, msg) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg) }
  async function handle(req, res) {
    const u = new URL(req.url, 'http://x'), m = /^\/x\/([\w-]{8,64})\/(status|\d+)$/.exec(u.pathname)
    const x = m && xfers.get(m[1])
    if (!x || u.searchParams.get('t') !== x.token) return bad(res, 404, 'not found')
    // 只接受本地网络来的连接
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    if (!/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:)/.test(ip)) return bad(res, 403, 'lan only')
    if (m[2] === 'status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ chunks: x.chunks, got: x.dir === 'in' ? [...x.got] : null, done: !!x.done })) }
    const i = Number(m[2]); if (!(i >= 0 && i < x.chunks)) return bad(res, 400, 'bad chunk')
    if (x.dir === 'out' && req.method === 'GET') {
      const len = Math.min(CHUNK, x.size - i * CHUNK), buf = Buffer.alloc(len), fd = fs.openSync(x.file, 'r')
      try { fs.readSync(fd, buf, 0, len, i * CHUNK) } finally { fs.closeSync(fd) }
      const sealed = sealChunk(x.key, i, buf); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': sealed.length }); return res.end(sealed)
    }
    if (x.dir === 'in' && req.method === 'PUT') {
      const parts = []; let n = 0
      for await (const d of req) { n += d.length; if (n > CHUNK + 16) return bad(res, 413, 'too big'); parts.push(d) }
      let plain; try { plain = openChunk(x.key, i, Buffer.concat(parts)) } catch { return bad(res, 400, 'decrypt failed') }
      const expect = Math.min(CHUNK, x.size - i * CHUNK); if (plain.length !== expect) return bad(res, 400, 'bad length')
      const fd = fs.openSync(x.tmp, 'r+'); try { fs.writeSync(fd, plain, 0, plain.length, i * CHUNK) } finally { fs.closeSync(fd) }
      x.got.add(i); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, got: x.got.size, chunks: x.chunks }))
      if (x.got.size === x.chunks && !x.done) finishIn(x).catch((e) => log('收文件出错', e.message))
      return
    }
    return bad(res, 405, 'method')
  }
  const fileSha = (p) => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no) })
  async function finishIn(x) {
    x.done = 'checking'
    const sha = await fileSha(x.tmp)
    if (sha !== x.sha256) { x.done = null; x.got.clear(); x.onEvent?.({ type: 'file.failed', id: x.id, reason: '收到的文件校验不对，重新传一次' }); return }
    fs.mkdirSync(saveDir, { recursive: true })
    let dst = path.join(saveDir, x.name), k = 1; const ext = path.extname(x.name), base = x.name.slice(0, x.name.length - ext.length)
    while (fs.existsSync(dst)) dst = path.join(saveDir, base + ' (' + k++ + ')' + ext)
    fs.renameSync(x.tmp, dst); x.done = true; x.file = dst
    log('收到手机发来的文件：' + dst)
    x.onEvent?.({ type: 'file.saved', id: x.id, name: path.basename(dst), path: dst, size: x.size })
  }
  /** 手机要发来一个文件：登记，回给它地址和钥匙 */
  async function offer(m, onEvent) {
    const size = Number(m.size); if (!(size > 0 && size <= MAX)) throw new Error('文件大小不对（最大 20 GB）')
    if (!/^[0-9a-f]{64}$/.test(String(m.sha256))) throw new Error('缺文件校验值')
    const id = /^[\w-]{8,64}$/.test(String(m.id)) ? String(m.id) : crypto.randomBytes(8).toString('hex')
    let x = xfers.get(id)
    if (!x) {
      const tmpDir = path.join(os.tmpdir(), 'yusho-lan'); fs.mkdirSync(tmpDir, { recursive: true })
      x = { id, dir: 'in', token: crypto.randomBytes(16).toString('hex'), key: crypto.randomBytes(32), name: safeName(m.name), size, sha256: String(m.sha256), chunks: Math.ceil(size / CHUNK), got: new Set(), tmp: path.join(tmpDir, id + '.part'), at: Date.now() }
      fs.writeFileSync(x.tmp, ''); fs.truncateSync(x.tmp, size)
      xfers.set(id, x)
    }
    x.onEvent = onEvent
    const p = await ensureServer()
    return { type: 'file.lan', id, dir: 'in', urls: lanAddrs().map((a) => 'http://' + a + ':' + p + '/x/' + id), token: x.token, key: x.key.toString('hex'), chunk: CHUNK, chunks: x.chunks, saveDir }
  }
  /** 手机要拿电脑上的一个文件（只限工作目录和“下载/鱼Sho”里的） */
  async function request(m) {
    const roots = [workDir, saveDir].map((r) => path.resolve(r))
    const p = path.resolve(path.isAbsolute(String(m.path)) ? String(m.path) : path.join(workDir, String(m.path)))
    if (!roots.some((r) => p === r || p.startsWith(r + path.sep))) throw new Error('只能拿工作目录和“下载/鱼Sho”里的文件')
    const st = fs.statSync(p); if (!st.isFile()) throw new Error('不是文件'); if (st.size > MAX) throw new Error('文件太大（最大 20 GB）')
    const id = crypto.randomBytes(8).toString('hex')
    const x = { id, dir: 'out', token: crypto.randomBytes(16).toString('hex'), key: crypto.randomBytes(32), name: path.basename(p), size: st.size, chunks: Math.max(1, Math.ceil(st.size / CHUNK)), file: p, at: Date.now() }
    x.sha256 = await fileSha(p); xfers.set(id, x)
    const port2 = await ensureServer()
    return { type: 'file.lan', id, dir: 'out', req: m.req ?? null, name: x.name, size: x.size, sha256: x.sha256, urls: lanAddrs().map((a) => 'http://' + a + ':' + port2 + '/x/' + id), token: x.token, key: x.key.toString('hex'), chunk: CHUNK, chunks: x.chunks }
  }
  // 一天没动静的传输清掉
  const gc = setInterval(() => { for (const [id, x] of xfers) if (Date.now() - x.at > 86400_000) { if (x.dir === 'in' && !x.done) fs.rmSync(x.tmp, { force: true }); xfers.delete(id) } }, 3600_000); gc.unref?.()
  return { offer, request, close: () => { clearInterval(gc); server?.close() }, saveDir }
}
