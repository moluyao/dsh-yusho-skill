# 鱼Sho 连接器（dsh-yusho-skill）

让你电脑上**已经登录**的 Codex、Claude Code、DSH 出现在手机的鱼Sho 里：像好友一样直接和它们说话、派活，进度、要你批准的操作、结果和改动的文件都回到手机上。

- **端到端加密**：消息走 Nostr 中继（NIP-17），文件加密后才上传，服务器只看到密文。
- **只听你的**：只接受扫码配对过的手机；配对时你要在电脑上亲自核对手机的指纹。
- **只在工作目录里干活**：默认 `~/YushoWork`；Agent 要做超出权限的事，会先在手机上问你。
- **不碰账号**：只驱动这台电脑上你自己登录好的 CLI（经 [ACP](https://agentclientprotocol.com)），不保存、不转发任何密钥。

## 装法

### 最省事：让你的 Agent 帮你装

对电脑上的 Claude Code 或 Codex 说：

> 按 https://yusho.chat/connect.md 的步骤，帮我把这台电脑连上鱼Sho

它会装好连接器、在浏览器里打开连接页面。你用手机扫页面上的二维码，在页面上核对指纹、确认就行。不用碰终端。

同样的说明也是一个技能：[`skill/connect-yusho`](skill/connect-yusho/SKILL.md)。放进 Claude Code（`~/.claude/skills/`）或 Codex 的技能目录（也可以在鱼Sho App 的技能清单里装）后，说“帮我连上鱼Sho”就行。

### 用 DSH 网页版

```
dsh plugin --profile web add https://yusho.chat/connect/dsh-yusho-skill.tgz
```

重启 DSH 网页版，侧栏出现“鱼Sho”，点开就是连接页面。

### 自己装

```
npm install -g https://yusho.chat/connect/dsh-yusho-skill.tgz --registry=https://registry.npmmirror.com
yusho-connect
```

安装包放在鱼Sho 自己的网站上，依赖从国内镜像 npmmirror 下，不用 npm 账号、不用翻墙（海外把 `--registry=https://registry.npmmirror.com` 去掉也行）。要 Node.js 22 或更新。`yusho-connect` 在后台启动连接器，并在浏览器里打开连接页面，二维码、核对指纹、连着的手机、换手机恢复、开机自动运行都在页面上。

| 命令 | 作用 |
|---|---|
| `yusho-connect` | 启动并打开页面（已经在跑就只打开页面） |
| `yusho-connect status [--json]` | 看状态 |
| `yusho-connect stop` | 停止 |
| `yusho-connect autostart on` / `off` | 开 / 关开机自动运行（当前用户，不要管理员权限） |
| `yusho-connect pair` | 再连一部手机 |

Codex 的适配器带着一整份 Codex（几百 MB），不放进安装包：第一次让 Codex 干活时自动下载，之后就快了。

## 0.1.2 改了什么

- **手机和电脑直连传文件**：同一个 Wi-Fi 时，手机发来的文件直接存进“下载/鱼Sho”，手机也能从工作目录拿文件，不经过服务器；几个 GB 也行，断了接着传。每次传输一把一次性钥匙（AES-256-GCM，按 1 MB 一块加密），钥匙只在端到端加密的消息里给手机；只接受局域网连接。
- **连续的活接着同一个会话**：手机上直接和某个 Agent 聊、或者让助理“接着刚才那件改”时，会在上一件活留下的会话里接着做，Agent 记得前面做过什么；新的活照旧新开。空闲 30 分钟自动关，最多同时留 3 个。
- **换成新域名**：中继 `wss://relay.yusho.chat`、文件服务 `https://files.yusho.chat`。

## 0.1.1 修了什么

- DSH 网页版加载不了连接器面板（报 `1 entry did not activate`）：面板代码里有个语法错误，已修；打包前会自动做语法检查。
- 用 pnpm 装（不自动装 peer 依赖）时缺 `zod`：已经写进依赖。
- Linux 上手机派活给 DSH 报 `internal error`：调用 DSH 时补丁路径多加了引号；另外 DSH 现在会用你在网页版里选好的模型和密钥。出错时手机上能看到具体原因，不再只有一句 internal error。
- 侧栏图标换成鱼Sho 现在的标志。

## 已知问题（0.1.0）

- **电脑关着时手机派的活会丢**：连接器只处理它启动之后收到的消息（防止旧消息被重放执行），电脑关机、连接器没开时派的活不会补做，手机上会一直停在“等电脑接单”。先确认电脑开着、连接器在线再派。
- **还没做过独立的安全审查**：手机上的消息最终会让这台电脑上的 Agent 执行命令。设计上只听配对过的手机、只在工作目录里干活、超出权限的操作要你在手机上批，但这些还没经过第三方审查。介意的话先别在重要的电脑上用。
- **只在 Windows 上测过**：macOS（launchd 开机自启）、Linux（systemd）的代码写了但还没实测。
- **Claude Code 要命令行版的登录**：只在 Claude 桌面 App 里登录过不行（那个登录别的程序借不到）。装命令行版、在终端运行一次 `claude` 登录后再重启连接器。
- **鱼Sho App 还在内测**，暂时没有公开下载。

## 手机这边

鱼Sho → 圈子 → 右上角“+”→ 接入电脑上的 Agent → 扫一扫。连上后，这台电脑的 Agent 出现在联系人和会话里。

## 配置

第一次运行会在 `~/.yusho-connect/`（可用环境变量 `YUSHO_HOME` 改）生成：

| 文件 | 内容 |
|---|---|
| `identity.json` | 这台电脑的身份（私钥，只在本机，权限 600） |
| `config.json` | 名字、工作目录 `workDir`、中继 `relay`；`agents` 不写就自动检测 |
| `devices.json` | 配对过的手机 |
| `device-backups/` | 手机的身份备份（换手机时用） |
| `service.json` | 后台服务的端口和页面口令（每次启动换） |
| `logs/` | 后台服务和每件活的日志 |

同一台电脑上，DSH 插件和后台服务只会有一个在线（同一个身份收两遍消息，活会做两遍）。

连接页面只开在 127.0.0.1，只认本机地址，链接里带一次性口令，进来后换成只限本站的 Cookie。

## 工作原理

1. 第一次运行，连接器生成身份，并在号码服务领一个鱼Sho号。领了号，中继才放行发给它的加密消息，文件服务器也才收它上传的文件。
2. 配对：
   - 连接器在中继上发一条 5 分钟后过期的“配对邀请”，按连接码的哈希查找，里面只有名字和公钥。
   - 手机扫二维码（`yusho:pair?c=<码>&k=<电脑公钥>`），只认这台电脑发的邀请，再发加密的配对请求。
   - 你在电脑上核对指纹、确认后，这部手机就是主人。
3. 派活：
   - 手机发 `task.create`，连接器用 ACP 启动对应的 Agent。
   - 过程中回 `task.ack` / `task.progress` / `task.need_approval`，最后回 `task.result`。
   - 改动的文件用 AES-256-GCM 加密上传，钥匙只在给手机的加密消息里。

## 许可

MIT。随带的 `lib/dsh-acp.mjs` 是本项目写的 DSH ACP 适配器。依赖见 `package.json`。`test/fake-agent.mjs` 是测试用的假 Agent（每次先要权限），不进安装包。
