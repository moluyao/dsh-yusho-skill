// 开机自动运行连接器（后台服务，不弹窗口）。只写当前用户自己的启动项，不要管理员权限。
//   Windows：“启动”文件夹里放一个 .vbs（隐藏窗口运行）
//   macOS：~/Library/LaunchAgents/chat.yusho.connect.plist
//   Linux：~/.config/systemd/user/yusho-connect.service
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const LABEL = 'chat.yusho.connect'
function target() {
  const h = os.homedir()
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(h, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'yusho-connect.vbs')
  if (process.platform === 'darwin') return path.join(h, 'Library', 'LaunchAgents', LABEL + '.plist')
  return path.join(h, '.config', 'systemd', 'user', 'yusho-connect.service')
}
/** 从 npx 的临时缓存运行时，路径过几天可能被清掉；开机自启要用装好的（npm i -g） */
export const fromNpxCache = (bin) => /[\\/]_npx[\\/]/.test(bin)
export const autostartOn = () => fs.existsSync(target())

export function setAutostart(on, bin) {
  const t = target(), node = process.execPath
  if (!on) {
    if (process.platform === 'darwin') try { execFileSync('launchctl', ['unload', t], { stdio: 'ignore' }) } catch {}
    if (process.platform === 'linux') try { execFileSync('systemctl', ['--user', 'disable', 'yusho-connect'], { stdio: 'ignore' }) } catch {}
    fs.rmSync(t, { force: true }); return false
  }
  fs.mkdirSync(path.dirname(t), { recursive: true })
  if (process.platform === 'win32') {
    const q = (s) => '""' + s + '""'
    fs.writeFileSync(t, '\ufeff' + `' 鱼Sho 连接器：开机在后台运行（不弹窗口）。不想要了就删掉这个文件，或在连接器页面里关掉“开机自动运行”。\r\nCreateObject("WScript.Shell").Run "${q(node)} ${q(bin)} serve", 0, False\r\n`, 'utf16le') // 带 BOM 的 UTF-16：路径里有中文也不乱
  } else if (process.platform === 'darwin') {
    fs.writeFileSync(t, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>${node}</string><string>${bin}</string><string>serve</string></array><key>RunAtLoad</key><true/></dict></plist>\n`)
    try { execFileSync('launchctl', ['load', t], { stdio: 'ignore' }) } catch {}
  } else {
    fs.writeFileSync(t, `[Unit]\nDescription=鱼Sho 连接器\nAfter=network-online.target\n\n[Service]\nExecStart="${node}" "${bin}" serve\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`)
    try { execFileSync('systemctl', ['--user', 'enable', 'yusho-connect'], { stdio: 'ignore' }) } catch {}
  }
  return true
}
