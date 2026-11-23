---
name: connect-yusho
description: 帮用户把这台电脑连到手机上的“鱼Sho”App：装上开源的鱼Sho 连接器，打开它的网页让手机扫码，之后手机上就能直接和这台电脑上的 Codex、Claude Code、DSH 说话、派活。用户说“帮我连上鱼Sho”“装鱼Sho 连接器”“让手机能用我电脑上的 Codex”时用。
---

# 把这台电脑连上鱼Sho

你（Agent）要做的：装好鱼Sho 连接器，把它跑起来，打开它的网页。**扫码和核对指纹必须由用户本人做，你不能替他确认。**

鱼Sho 连接器是开源的（MIT，源码 https://github.com/moluyao/dsh-yusho-skill ，安装包放在 yusho.chat）。它在这台电脑后台运行，只听用户扫码配对过的手机，只在自己的工作目录（默认 `~/YushoWork`）里干活，只驱动这台电脑上**已经登录**的 Codex / Claude Code / DSH，不读、不存、不转发任何账号密钥。消息经中继端到端加密。

## 1. 先检查

- `node -v` 要 22 或更新。没有 Node 或版本太低：停下，告诉用户去 https://nodejs.org 装 LTS 版，别替他装系统软件。
- 这台电脑上至少有一个能用的 Agent：Codex（有 `codex` 命令或 `~/.codex/auth.json`）、Claude Code（命令行版：有 `claude` 命令，或 `~/.claude/.credentials.json`；只在 Claude 桌面 App 里登录过的不算）、DSH（有 `dsh` 命令）。一个都没有：停下，告诉用户先装好并登录一个。
- 用户手机上要有鱼Sho App（现在还在内测，没有公开下载）。没有的话告诉用户，先别装。

## 2. 装

用户在用 DSH 网页版（有 `dsh` 命令，而且平时在浏览器里用 DSH）：

```
dsh plugin --profile web add https://yusho.chat/connect/dsh-yusho-skill.tgz
```

装完让用户重启 DSH 网页版，侧栏会多一个“🐟 鱼Sho”，点开就是连接页面。然后跳到第 4 步。

其他情况：

```
npm install -g https://yusho.chat/connect/dsh-yusho-skill.tgz --registry=https://registry.npmmirror.com
```

安装包从鱼Sho 的网站下，依赖从国内镜像下，不需要 npm 账号、不用翻墙。在海外、镜像慢的话，去掉 `--registry=...` 再装一次。

## 3. 启动

```
yusho-connect
```

它会在后台启动连接器（几秒到半分钟），并在浏览器里打开连接页面，然后命令自己就结束了（连接器留在后台）。命令输出里有页面链接；如果浏览器没自己打开，把链接告诉用户。

没有图形界面的机器（比如远程服务器）用 `yusho-connect --no-open`，把输出的链接和 6 位连接码告诉用户。

## 4. 让用户在手机上扫码（这一步你只能说明，不能代做）

告诉用户：

1. 打开鱼Sho → 圈子 → 右上角“+” → 接入电脑上的 Agent → 扫一扫，对准电脑网页上的二维码（扫不了就输入页面上的 6 位连接码）。
2. 电脑网页上会出现手机的指纹。**核对和手机屏幕上显示的一样，再点“一样，确认连接”。**
3. 连上后，手机的圈子和会话里会出现这台电脑的 Codex、Claude Code、DSH，点进去就能直接说话、派活。

## 5. 确认连上了

```
yusho-connect status --json
```

`phones` 里出现用户的手机就成功了。`running` 是 false 就重新运行 `yusho-connect`；`online` 是 false 说明连不上中继，检查网络或代理。

## 6. 问用户要不要开机自动运行

连接器只在电脑开着、它在运行时才能干活。问用户：要不要开机自动在后台运行？用户同意才做：

```
yusho-connect autostart on
```

（用户自己也可以在连接页面上开关。只写当前用户自己的启动项，不要管理员权限。）

## 其他命令

| 命令 | 作用 |
|---|---|
| `yusho-connect` | 启动（已经在跑就只打开页面） |
| `yusho-connect status` | 看状态 |
| `yusho-connect stop` | 停止 |
| `yusho-connect autostart on` / `off` | 开 / 关开机自动运行 |
| `yusho-connect pair` | 再连一部手机 |

换手机、断开某部手机，都在连接页面上点。
