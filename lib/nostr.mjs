// Nostr 连接与 NIP-17 加密私聊：断线自己重连，重连后重新做 NIP-42 认证、重新订阅（库自带的重连不会重新认证）。
import { Relay } from 'nostr-tools/relay'
import * as nip17 from 'nostr-tools/nip17'
import { finalizeEvent } from 'nostr-tools/pure'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 连接中继，订阅发给自己的加密私聊。onMessage(rumor) 里 rumor.pubkey 是已验签的发送方 */
export async function openInbox(url, key, onMessage, { log = () => {}, slackSec = 5 } = {}) {
  const startedAt = Math.floor(Date.now() / 1000) - slackSec
  const seen = new Set()
  const signAuth = async (tmpl) => finalizeEvent(tmpl, key.skBytes)
  let relay = null, closedByUs = false
  function subscribe(r, authTries = 0) {
    r.subscribe([{ kinds: [1059], '#p': [key.pk], since: startedAt - 3 * 86400 }], { // gift wrap 的时间是随机往前挪的（最多 2 天）
      onevent(ev) {
        let rumor; try { rumor = nip17.unwrapEvent(ev, key.skBytes) } catch { return }
        if (rumor.kind !== 14 || seen.has(rumor.id) || rumor.created_at < startedAt) return
        seen.add(rumor.id); onMessage(rumor)
      },
      async onclose(reason) {
        if (String(reason).includes('auth-required') && authTries < 3 && r === relay) { try { await r.auth(signAuth) } catch (e) { log('中继认证失败', e.message) } subscribe(r, authTries + 1) }
      },
    })
  }
  async function connect() {
    for (let delay = 1000; !closedByUs; delay = Math.min(delay * 2, 30000)) {
      try {
        const r = await Relay.connect(url, { enablePing: true })
        r.publishTimeout = 15000; r.onauth = signAuth
        r.onclose = () => { if (closedByUs || r !== relay) return; log('和中继断开了，重连'); relay = null; connect() }
        relay = r; subscribe(r); log('连上中继了'); return r
      } catch (e) { log(`连不上中继（${e?.message ?? e}），${delay / 1000} 秒后再试`); await sleep(delay) }
    }
  }
  await Promise.race([connect(), sleep(8000)]) // 一时连不上也先往下走（页面要能显示“连不上中继”），后台接着重连
  return {
    get relay() { return relay },
    async send(toPk, payload) {
      const ev = nip17.wrapEvent(key.skBytes, { publicKey: toPk, relayUrl: url }, typeof payload === 'string' ? payload : JSON.stringify(payload))
      for (let i = 0; i < 5; i++) { try { if (relay) return await relay.publish(ev) } catch (e) { log('发送失败，重试', e?.message ?? e) } await sleep(1000 * (i + 1)) }
      throw new Error('发送失败：中继不可用')
    },
    async publish(ev) { for (let i = 0; i < 5; i++) { try { if (relay) return await relay.publish(ev) } catch (e) { log('发布失败，重试', e?.message ?? e) } await sleep(1000 * (i + 1)) } throw new Error('发布失败：中继不可用') },
    close() { closedByUs = true; relay?.close() },
  }
}

/** 我们的结构化消息是带 shoal 字段的 JSON；别的当纯文本 */
export function parseContent(content) {
  try { const o = JSON.parse(content); if (o && typeof o === 'object' && o.shoal) return o } catch {}
  return { shoal: 0, type: 'text', text: content }
}
