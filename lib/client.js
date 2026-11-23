/**
 * 鱼Sho 连接器的 DSH 网页版面板：侧栏“鱼Sho”（Sho 酱的小脸），点开是整页。
 *   连接手机：显示二维码和 6 位码；手机扫了以后，这里显示它的指纹，你核对和手机上一样就点“确认”。
 *   连着的手机：可以断开；换手机恢复：把旧手机的身份交给新手机。
 * 数据来自宿主侧 /api/yusho-connect/*（经过 DSH 的浏览器登录保护）。颜色取 DSH 自己的主题变量，跟随浅色 / 深色。
 */
window.__ModuleLoader__.load({
  id: 'dsh-yusho-skill',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React
    const PANEL = 'yusho-connect'
    const url = (p) => new URL('api/yusho-connect/' + p, document.baseURI).href
    const get = async (p) => { const r = await fetch(url(p)); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j }
    const post = async (p, b = {}) => { const r = await fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j }
    const AG = { codex: 'Codex', claude: 'Claude Code', dsh: 'DSH' }
    // 鱼Sho 的标志：Sho 酱的小脸（和 App 图标同一套形象；内嵌，不用联网取）
    const LOGO = 'data:image/webp;base64,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'
    const Fish = (size = 14) => h('img', { src: LOGO, width: Math.round(size * 1.4), height: Math.round(size * 1.4), alt: '', 'aria-hidden': true, style: { borderRadius: '50%', display: 'block' } })

    const CSS = `
.yc { --yc-text: var(--dsw-alias-label-primary, #1f2328); --yc-text2: var(--dsw-alias-label-secondary, #59636e); --yc-text3: var(--dsw-alias-label-tertiary, #8b949e);
  --yc-bg: var(--dsw-alias-bg-base, #fff); --yc-layer: var(--dsw-alias-bg-layer-1, #f6f8fa); --yc-line: var(--dsw-alias-border-l1, rgba(127,127,127,.18));
  --yc-brand: var(--dsw-alias-state-business-primary, #2f6fe4); --yc-danger: var(--dsw-alias-state-error-primary, #d1242f); --yc-ok: #1E9A52; --yc-r: var(--dsw-radius-lg, 12px);
  height: 100%; overflow: auto; color: var(--yc-text); background: var(--yc-bg); font: 14px/1.6 var(--dsw-font-ui, system-ui); }
.yc-wrap { max-width: 760px; margin: 0 auto; padding: 28px 24px 48px; }
.yc h1 { display: flex; align-items: center; gap: 10px; font-size: 22px; margin: 0 0 4px; color: var(--yc-brand); } .yc h1 span { color: var(--yc-text); }
.yc .sub { color: var(--yc-text2); margin: 0 0 20px; }
.yc-card { border: 1px solid var(--yc-line); border-radius: var(--yc-r); padding: 18px 20px; margin-bottom: 16px; background: var(--yc-bg); }
.yc-card h2 { font-size: 15px; margin: 0 0 10px; }
.yc-kv { display: grid; grid-template-columns: 96px 1fr; gap: 6px 12px; font-size: 13px; } .yc-kv .k { color: var(--yc-text3); } .yc-kv .v { word-break: break-all; }
.yc-btn { border: 1px solid var(--yc-line); background: var(--yc-layer); color: var(--yc-text); border-radius: 10px; padding: 8px 16px; font: inherit; cursor: pointer; }
.yc-btn.pri { background: var(--yc-brand); color: #fff; border-color: transparent; font-weight: 600; } .yc-btn.bad { color: var(--yc-danger); } .yc-btn:disabled { opacity: .5; cursor: default; }
.yc-pair { display: grid; grid-template-columns: 220px 1fr; gap: 24px; align-items: center; }
.yc-qr { width: 220px; height: 220px; background: #fff; border-radius: 12px; padding: 8px; box-sizing: border-box; } .yc-qr svg { width: 100%; height: 100%; display: block; }
.yc-code { font: 600 30px/1.2 var(--dsw-font-mono, monospace); letter-spacing: .12em; margin: 6px 0; }
.yc-steps { margin: 8px 0 0; padding-left: 18px; color: var(--yc-text2); font-size: 13px; }
.yc-ask { border: 2px solid var(--yc-brand); }
.yc-fp { font: 600 22px/1.3 var(--dsw-font-mono, monospace); letter-spacing: .06em; margin: 8px 0 14px; }
.yc-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--yc-line); } .yc-row:first-of-type { border-top: 0; } .yc-row .t { flex: 1; min-width: 0; } .yc-row small { color: var(--yc-text3); display: block; }
.yc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--yc-ok); display: inline-block; margin-right: 6px; } .yc-dot.off { background: var(--yc-text3); }
.yc-err { color: var(--yc-danger); margin: 8px 0 0; }
.yc-icon { display: inline-flex; color: var(--dsw-alias-state-business-primary, #2f6fe4); }
@media (max-width: 640px) { .yc-pair { grid-template-columns: 1fr; } }`
    const useCss = () => useEffect(() => { if (!document.getElementById('yc-css')) { const s = document.createElement('style'); s.id = 'yc-css'; s.textContent = CSS; document.head.appendChild(s) } }, [])

    function usePoll(ms) {
      const [d, setD] = useState(null), [err, setErr] = useState('')
      const load = useCallback(() => get('status').then((j) => { setD(j); setErr('') }).catch((e) => setErr(e.message)), [])
      useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t) }, [load])
      return [d, err, load]
    }
    const left = (ms) => { const s = Math.max(0, Math.round((ms - Date.now()) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }

    function Page() {
      useCss()
      const [d, err, load] = usePoll(1500), [busy, setBusy] = useState(false), [e2, setE2] = useState(''), [arm, setArm] = useState(null)
      const act = async (fn) => { setBusy(true); setE2(''); try { await fn(); await load() } catch (e) { setE2(e.message) } setBusy(false) }
      if (!d) return h('div', { className: 'yc' }, h('div', { className: 'yc-wrap' }, err ? '读取失败：' + err : '加载中…'))
      const p = d.pairing, live = d.devices.filter((x) => !x.revoked)
      return h('div', { className: 'yc' }, h('div', { className: 'yc-wrap' },
        h('h1', null, Fish(18), h('span', null, '鱼Sho')),
        h('p', { className: 'sub' }, '让手机上的鱼Sho 直接和这台电脑上的 ' + (d.agents.map((a) => AG[a] ?? a).join('、') || 'Agent') + ' 说话、派活。消息端到端加密；只听连上的手机，只在工作目录里干活，不碰你的账号。'),
        p?.request ? h('div', { className: 'yc-card yc-ask' },
          h('h2', null, '「' + p.request.label + '」想连上这台电脑' + (p.request.number ? '（鱼Sho号 ' + p.request.number + '）' : '')),
          h('div', null, '它的指纹：'), h('div', { className: 'yc-fp' }, p.request.fingerprint),
          h('p', { className: 'sub' }, '和手机上“接入电脑”页面显示的指纹一样，才点确认。不一样说明不是你的手机，点取消。'),
          h('div', { style: { display: 'flex', gap: 10 } }, h('button', { className: 'yc-btn pri', disabled: busy, onClick: () => act(() => post('answer', { ok: true })) }, '一样，确认连接'), h('button', { className: 'yc-btn', disabled: busy, onClick: () => act(() => post('answer', { ok: false })) }, '不一样，取消')))
        : p ? h('div', { className: 'yc-card' },
          h('h2', null, p.restore ? '把旧手机的身份交给新手机' : '连接手机'),
          h('div', { className: 'yc-pair' },
            h('div', { className: 'yc-qr', dangerouslySetInnerHTML: { __html: d.qrSvg ?? '' }, role: 'img', 'aria-label': '连接二维码' }),
            h('div', null,
              h('div', null, '用手机的鱼Sho 扫左边的二维码'),
              h('ol', { className: 'yc-steps' }, h('li', null, '打开鱼Sho → 圈子 → 右上角“+”→ 接入电脑上的 Agent'), h('li', null, p.restore ? '新手机上点“从电脑找回原来的身份”，再点“扫一扫”' : '点“扫一扫”对准二维码'), h('li', null, '这里会出现手机的指纹，核对一样就确认')),
              h('div', { style: { marginTop: 12 } }, '扫不了就输入连接码：'), h('div', { className: 'yc-code' }, p.code.slice(0, 3) + ' ' + p.code.slice(3)),
              h('div', { className: 'sub', style: { margin: 0 } }, '还剩 ' + left(p.expires) + ' 有效 · ', h('button', { className: 'yc-btn', style: { padding: '2px 10px' }, onClick: () => act(() => post('cancel')) }, '不连了')))))
        : h('div', { className: 'yc-card' }, h('h2', null, live.length ? '再连一部手机' : '还没有连上手机'), h('p', { className: 'sub' }, '点下面的按钮，用手机扫出现的二维码。'), h('button', { className: 'yc-btn pri', disabled: busy || !d.number, onClick: () => act(() => post('pair')) }, '连接手机'), !d.number ? h('p', { className: 'yc-err' }, '这台电脑还没领到鱼Sho号（要联网），领到才能连') : null),
        h('div', { className: 'yc-card' }, h('h2', null, '连着的手机'),
          live.length ? live.map((x) => h('div', { key: x.pk, className: 'yc-row' }, h('div', { className: 't' }, h('b', null, x.label), h('small', null, '指纹 ' + x.fingerprint + (x.number ? ' · 鱼Sho号 ' + x.number : '') + ' · ' + new Date(x.added).toLocaleDateString('zh-CN') + ' 连上')),
            h('button', { className: 'yc-btn bad', onClick: () => (arm === x.pk ? act(() => post('remove', { pk: x.pk })).then(() => setArm(null)) : setArm(x.pk)) }, arm === x.pk ? '确认断开' : '断开'))) : h('div', { className: 'sub', style: { margin: 0 } }, '还没有')),
        d.backups.length ? h('div', { className: 'yc-card' }, h('h2', null, '换手机恢复'), h('p', { className: 'sub' }, '手机重装或换了新手机：选原来那部，把它的身份交给新手机（新手机上点“从电脑找回原来的身份”）。'),
          d.backups.map((b) => h('div', { key: b.pk, className: 'yc-row' }, h('div', { className: 't' }, h('b', null, b.label), h('small', null, '指纹 ' + b.fingerprint + ' · 备份于 ' + new Date(b.at).toLocaleString('zh-CN', { hour12: false }))), h('button', { className: 'yc-btn', disabled: busy || !!p, onClick: () => act(() => post('restore', { pk: b.pk })) }, '交给新手机')))) : null,
        h('div', { className: 'yc-card' }, h('h2', null, '这台电脑'), h('div', { className: 'yc-kv' },
          h('span', { className: 'k' }, '状态'), h('span', { className: 'v' }, h('span', { className: 'yc-dot' + (d.online ? '' : ' off') }), d.online ? '在线' : '连不上中继'),
          h('span', { className: 'k' }, '名字'), h('span', { className: 'v' }, d.name),
          h('span', { className: 'k' }, '鱼Sho号'), h('span', { className: 'v' }, d.number ?? '还没领到'),
          h('span', { className: 'k' }, '指纹'), h('span', { className: 'v' }, d.fingerprint),
          h('span', { className: 'k' }, 'Agent'), h('span', { className: 'v' }, d.agents.map((a) => AG[a] ?? a).join('、') || '没找到（先装好并登录 Codex 或 Claude Code）'),
          ...((d.hints ?? []).length ? [h('span', { className: 'k', key: 'hk' }, '还差一步'), h('span', { className: 'v', key: 'hv' }, d.hints.join('\n'))] : []),
          h('span', { className: 'k' }, '工作目录'), h('span', { className: 'v' }, d.workDir),
          h('span', { className: 'k' }, '在做'), h('span', { className: 'v' }, d.tasks.length ? d.tasks.map((t) => (AG[t.agent] ?? t.agent) + '：' + t.title + (t.waiting ? '（等手机上批）' : '')).join('；') : '空闲'))),
        e2 ? h('p', { className: 'yc-err' }, e2) : null))
    }
    function Icon() { return h('span', { className: 'yc-icon', title: '鱼Sho' }, Fish(12)) }
    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 31, label: '鱼Sho' }, Icon))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Page))
    }
    exports.name = 'dsh-yusho-skill'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
