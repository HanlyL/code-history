# code-history

一个同时包含 **IntelliJ IDEA 插件** 与 **VSCode 插件** 的 SVN 标注工具仓库。

核心目标：

- 在编辑器中显示当前行的 SVN 提交信息
- 快速查看当前行对应修订的差异
- 尽量减少在命令行与 IDE 之间来回切换

## 仓库结构

- `jetbrains-svn-annotator`：IntelliJ IDEA / JetBrains 平台插件（Kotlin + Gradle）
- `vscode-svn-annotator`：VSCode 插件（TypeScript + npm）

## 功能对齐

两端插件都覆盖了以下主要能力：

- SVN 登录
- 当前行注释信息展示
- 手动刷新
- 启用/禁用注释
- 当前行修订差异查看
