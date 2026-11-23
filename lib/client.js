/**
 * 鱼Sho 连接器的 DSH 网页版面板：侧栏“🐟 鱼Sho”，点开是整页。
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
    const Fish = (size = 14) => h('svg', { width: size * 1.6, height: size, viewBox: '0 0 24 14', fill: 'currentColor', 'aria-hidden': true }, h('path', { d: 'M1 7c3-5.2 10-6.2 15-1l6-4.5v11L16 8c-5 5.2-12 4.2-15-1z' }), h('circle', { cx: 6.5, cy: 6, r: 1.2, fill: 'var(--yc-bg, #fff)' }))

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
          ...((d.hints ?? []).length ? [h('span', { className: 'k', key: 'hk' }, '还差一步'), h('span', { className: 'v', key: 'hv' }, d.hints.join('
'))] : []),
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
