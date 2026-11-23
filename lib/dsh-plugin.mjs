// 鱼Sho 连接器的 DSH 插件（宿主一侧）：在 DSH 里一直运行连接器；网页版侧栏“鱼Sho”面板用下面这些接口。
// 接口注册在 DSH 的 /api 通道上（connection.fetch），经过 DSH 自己的浏览器登录保护，只有你本人能调。
// 这台电脑上已经有独立的后台连接器在跑（yusho-connect 命令）时，这里不再连中继，免得同一个身份收两遍消息。
import os from 'node:os'
import { createConnector } from './connector.mjs'
import { handleApi } from './api.mjs'

export const name = 'dsh-yusho-skill'
export const inject = []

export function apply(ctx) {
  let conn = null, err = null
  const log = (...a) => ctx.logger?.info?.('[鱼Sho] ' + a.join(' ')) ?? console.log('[鱼Sho]', ...a)
  ctx.effect(() => {
    let stopped = false
    createConnector({ name: os.hostname(), log, owner: 'DSH' }).then(async (c) => { if (stopped) return; await c.start(); conn = c }).catch((e) => { err = e; log('连接器没起来：' + (e?.message ?? e)) })
    return () => { stopped = true; conn?.stop() }
  }, 'yusho-connect: 连接器')

  const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
  const need = () => { if (!conn) throw new Error(err ? '连接器没起来：' + err.message : '连接器还在启动'); return conn }
  for (const [n, methods] of [['status', ['GET']], ['pair', ['POST']], ['restore', ['POST']], ['answer', ['POST']], ['cancel', ['POST']], ['remove', ['POST']]]) {
    const path = '/api/yusho-connect/' + n
    ctx.inject(['connection'], (c) => {
      c.effect(() => c.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch: async (req) => { try { let b = {}; if (req.method === 'POST') { try { b = await req.json() } catch {} } return J(await handleApi(need(), n, b)) } catch (e) { return J({ error: String(e?.message ?? e) }, 400) } } }), 'yusho-connect: ' + path)
    })
  }
}
