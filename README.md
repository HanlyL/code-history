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

## 快速入口

### IntelliJ IDEA 插件

- 项目目录：`jetbrains-svn-annotator`
- 详细说明：`jetbrains-svn-annotator/README.md`
- 打包命令（Windows）：

```powershell
cd jetbrains-svn-annotator
.\gradlew.bat clean buildPlugin
```

- 打包产物：
  - `jetbrains-svn-annotator/build/distributions/svn-annotator-jetbrains-0.1.0.zip`

### VSCode 插件

- 项目目录：`vscode-svn-annotator`
- 打包命令（Windows）：

```powershell
cd vscode-svn-annotator
npm run compile
npx @vscode/vsce package --allow-missing-repository
```

- 打包产物：
  - `vscode-svn-annotator/svn-annotator-0.1.0.vsix`

## 使用建议

建议先从 IntelliJ 插件验证完整流程：

1. 安装插件
2. 执行 `Tools > SVN Annotator > Login`
3. 在 SVN 工作副本里移动光标观察行尾标注
4. 执行 `View Changes` 打开内置 Diff 页面

确认流程稳定后，再发布对应的 VSCode 插件版本，保持两端能力一致。

## 发布建议

- 每次发布前统一更新两端版本号
- 为 IDEA 和 VSCode 分别保留 changelog
- 优先补充凭据安全存储和设置页能力
- 增加截图资源，提升插件页可读性
