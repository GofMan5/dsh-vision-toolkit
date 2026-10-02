# DSH Desktop 安装与更新指南

本指南说明如何在 **DSH Desktop（桌面版）** 中安装、验证和更新 `dsh-vision-toolkit`。

> 为什么需要单独一份指南？DSH Desktop 自带 `dsh` 命令行，但**不会写入系统 PATH**。在系统终端（PowerShell、cmd、macOS 终端）里运行 `dsh` 会提示找不到命令，这是桌面版的设计行为，不是插件问题。请始终使用桌面版托盘提供的 **DSH 终端**。

## 1. 打开 DSH 终端

1. 找到系统托盘中的 **DSH Desktop** 图标（Windows 在右下角，macOS 在右上角菜单栏）。
2. **右键**图标，选择 **Open DSH Terminal**（或 **打开 DSH 终端**）。
3. 打开的终端里先确认环境可用：

```sh
dsh --version
```

能看到版本号就说明终端环境正常。如果提示找不到命令，请确认应用版本是 v2.0+，并完全退出桌面版后重新打开再试。

## 2. 安装插件

在 **DSH 终端** 中运行以下命令：

```sh
dsh plugin --profile desktop add github:GofMan5/dsh-vision-toolkit
```

几点说明：

- `--profile desktop` 表示安装到桌面版默认的 `desktop` Profile；想装到 `web` Profile 时把 `desktop` 换成 `web`。
- 本 fork 以 `@gofman5/dsh-vision-toolkit` 包名从 GitHub 仓库安装。如果当前激活的 Profile 就是要装的 Profile，也可以省略 `--profile desktop`，直接运行 `dsh plugin add github:GofMan5/dsh-vision-toolkit`。
- 上游 npm 包（`@anionex/dsh-vision-toolkit`）的安装方式相同，只是不带 fork 功能。

## 3. 重启并验证

1. **完全退出 DSH Desktop**：托盘右键 → **退出**（关闭窗口只是隐藏，不算退出）。
2. 重新打开 DSH Desktop。
3. 进入 **设置 → 视觉工具**，点击**加载模型**从中继目录选择视觉模型，按需调整能力复选框后保存，再点击 **测试视觉模型** 确认服务可用。
4. 在会话中**粘贴一张图片直接提问**，或调用 `/vision-skills` 使用完整视觉工作流。

## 4. 更新到新版本

1. 在 [fork 仓库](https://github.com/GofMan5/dsh-vision-toolkit) 查看最新提交。
2. 在 **DSH 终端** 中重新执行安装命令，让依赖重新解析到当前 `main`：

```sh
dsh plugin --profile desktop add github:GofMan5/dsh-vision-toolkit
```

3. 再次**完全退出并重启 DSH Desktop**，新版本才会生效。

git 安装方式的插件内更新检查是有意禁用的：更新面板会提示更新源仓库，而不是从 npm 替换。

## 常见问题

| 问题 | 处理方式 |
| --- | --- |
| 系统终端里找不到 `dsh` 命令 | 正常。请从托盘打开 **DSH 终端**，不要用系统 PowerShell/cmd/终端 |
| 托盘菜单里没有 Open DSH Terminal | 确认应用是 v2.0+ 版本；v2 才开始提供该入口 |
| 内置插件市场安装失败，提示“无法确认操作结果” | DSH Desktop 2.0.1 的市场安装链路有已知问题，请改用本文的 DSH 终端命令安装 |
| 装完插件没生效 | 确认命令装到了正确的 Profile，并**完全退出后重启**桌面版 |
| 想装到 web Profile | 把命令中的 `desktop` 换成 `web`，重启桌面版后到 web Profile 使用 |

## 相关链接

- [Fork 仓库](https://github.com/GofMan5/dsh-vision-toolkit)
- [上游 npm 包](https://www.npmjs.com/package/@anionex/dsh-vision-toolkit)
- [DSH Desktop 用户指南](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/docs/user-guide.md)
