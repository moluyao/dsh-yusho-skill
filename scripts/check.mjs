// 打包前检查：每个 .js / .mjs 都要能被解析（0.1.0 就是因为 client.js 里一个字符串断了行，整个面板加载不了）
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
let bad = 0
for (const d of ['lib', 'bin']) for (const f of readdirSync(d)) if (/\.(m?js)$/.test(f)) { const r = spawnSync(process.execPath, ['--check', d + '/' + f], { encoding: 'utf8' }); if (r.status) { bad++; console.error('语法错误：' + d + '/' + f + '\n' + r.stderr) } }
if (bad) process.exit(1)
console.log('语法检查通过')
