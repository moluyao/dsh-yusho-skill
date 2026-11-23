// 连接器的网页接口（DSH 插件和独立的后台服务共用）：status / pair / restore / answer / cancel / remove
import { qrSvg } from './qr.mjs'

export async function handleApi(conn, name, b = {}) {
  switch (name) {
    case 'status': { const i = conn.info(); return { ...i, qrSvg: i.pairing ? await qrSvg(i.pairing.qr) : null, backups: conn.backups() } }
    case 'pair': await conn.startPairing(); return { ok: true }
    case 'restore': await conn.startRestore(String(b.pk ?? '')); return { ok: true }
    case 'answer': return conn.answerPairing(!!b.ok)
    case 'cancel': conn.cancelPairing(); return { ok: true }
    case 'remove': conn.removeDevice(String(b.pk ?? '')); return { ok: true }
    default: return null
  }
}
