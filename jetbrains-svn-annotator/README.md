# SVN Annotator

SVN Annotator 是一个 IntelliJ IDEA / JetBrains 平台插件，用于在编辑器中直接查看当前代码行对应的 SVN 提交信息，并快速打开指定修订之间的差异对比。

## 主要功能

- 在当前光标所在行的行尾显示 SVN 标注信息
- 标注内容按“提交信息 | 作者 | 日期”的顺序展示
- 光标切换到其他行时，自动刷新当前行标注
- 提供 `View Changes` 操作，直接在 IDEA 内置 Diff 页面中查看修订差异
- 提供 `Login / Refresh / Toggle / View Changes` 菜单操作
- 支持从编辑器右键菜单直接打开 `View Changes`
- 登录状态会保存在插件设置中，重启 IDEA 后仍可继续使用

## 支持版本

- IntelliJ IDEA / JetBrains 平台构建范围：`231` 到 `254.*`
- 对应范围：**2023.1 ~ 2025.4**

## 安装方式

### 方式一：从打包结果安装

1. 打开 `Settings / Preferences`
2. 进入 `Plugins`
3. 点击右上角齿轮
4. 选择 `Install Plugin from Disk...`
5. 选择构建产物：
   - `build/distributions/svn-annotator-jetbrains-0.1.0.zip`
6. 安装后重启 IDEA

### 方式二：开发模式运行

在项目根目录执行：

```bash
./gradlew runIde
```

Windows 下可执行：

```powershell
.\gradlew.bat runIde
```

## 快速上手

如果你是第一次使用，建议按下面顺序操作：

1. 安装插件并重启 IDEA
2. 打开一个 SVN 工作副本中的源码文件
3. 执行 `Tools > SVN Annotator > SVN Annotator: Login`
4. 登录成功后，把光标移动到任意一行
5. 确认该行尾部出现 `提交信息 | 作者 | 日期` 标注
6. 将光标停留在想查看历史的代码行
7. 执行 `Tools > SVN Annotator > SVN Annotator: View Changes`
8. 在 IDEA 内置 Diff 页面中查看该行对应修订的前后变化

如果标注没有立即更新，执行一次 `SVN Annotator: Refresh` 即可。

## 界面预览

后续可以在这里补充实际截图，建议至少包含以下场景：

- 登录对话框
- 行尾标注效果
- `Tools > SVN Annotator` 子菜单
- 编辑器右键菜单中的 `View Changes`
- IDEA 内置 Diff 对比页

推荐截图命名：

- `docs/images/login-dialog.png`
- `docs/images/inline-annotation.png`
- `docs/images/tools-menu.png`
- `docs/images/editor-context-menu.png`
- `docs/images/diff-view.png`

## 使用说明

### 1. 登录 SVN

插件安装后，打开 IDEA 顶部菜单：

`Tools > SVN Annotator > SVN Annotator: Login`

输入 SVN 用户名和密码后确认即可。

适用场景：

- 需要访问受认证保护的 SVN 仓库
- 希望后续查看 blame、log、diff 时自动带上认证信息

### 2. 查看当前行标注

登录成功后，把光标移动到任意一行，插件会在该行末尾自动显示一段淡色标注信息。

显示格式：

`提交信息 | 作者 | 日期`

说明：

- 只显示当前光标所在行的标注
- 光标切换时自动更新
- 行尾信息过长时会自动截断，避免影响编辑体验

### 3. 手动刷新标注

如果刚更新了工作副本、切换了分支、或者希望重新请求 SVN 数据，可以使用：

`Tools > SVN Annotator > SVN Annotator: Refresh`

作用：

- 清理当前文件缓存
- 重新读取当前文件的 blame 信息
- 刷新当前行的行尾标注

### 4. 开关标注显示

如果暂时不想显示行尾信息，可以使用：

`Tools > SVN Annotator > SVN Annotator: Toggle`

作用：

- 再次点击可重新开启
- 关闭时会移除当前显示的行尾标注

### 5. 查看当前行对应修订的差异

把光标移动到目标行后，可通过以下任一方式打开差异页：

- `Tools > SVN Annotator > SVN Annotator: View Changes`
- 编辑器右键菜单中的 `SVN Annotator: View Changes`

行为说明：

- 插件会先读取当前行对应的 SVN 修订号
- 然后自动计算对比区间：
  - 数字修订：`N-1 ↔ N`
  - 非数字修订：`PREV ↔ 当前修订`
- 最终在 IDEA 内置 Diff 页面中打开左右版本对比

如果当前修订是新增文件或该修订区间没有内容差异，会给出明确提示。

## 菜单位置

### Tools 菜单

插件会在 `Tools` 下提供一个 `SVN Annotator` 子菜单，包含：

- `SVN Annotator: Login`
- `SVN Annotator: Refresh`
- `SVN Annotator: Toggle`
- `SVN Annotator: View Changes`

### 编辑器右键菜单

在编辑器中右键可看到：

- `SVN Annotator: View Changes`

适合在阅读代码时就地查看当前行对应变更。

## 工作机制

### 行尾标注来源

插件会调用 SVN 的以下命令获取数据：

- `svn blame --xml`
- `svn log -r <revision> --xml`

其中：

- `blame` 用于确定每一行对应的提交人、日期、修订号
- `log` 用于补充提交说明

### Diff 打开方式

插件不会仅仅弹出一段命令行 diff 文本，而是会：

1. 使用 `svn cat -r` 分别读取左右两个修订的文件内容
2. 将两侧内容交给 IDEA 的内置 Diff Viewer
3. 在 IDE 中打开标准对比页

这样可以获得更接近 VSCode/IDE 原生体验的查看方式。

### 缓存机制

为减少频繁请求 SVN，插件会对文件的 blame 结果与提交信息做短时缓存。

在以下情况下建议手动刷新：

- 本地文件刚更新
- 切换了分支
- 仓库内容刚同步
- 当前显示与预期不一致

## 常见问题

### 功能相关

### 1. 行尾没有显示标注

请检查：

- 是否已先执行 `Login`
- 当前文件是否属于 SVN 工作副本
- 是否已开启 `Toggle`
- 是否可以执行一次 `Refresh`

### 2. View Changes 没有打开内容

可能原因：

- 当前行没有可识别的修订号
- 对比区间没有差异
- 当前文件在某一侧修订中不存在
- SVN 命令在本机环境不可用

建议先确认：

- 本机命令行能正常执行 `svn`
- 当前文件确实来自 SVN 工作副本

### 3. 中文内容显示乱码

插件已优先按 UTF-8 解码，在检测到异常字符时会尝试回退到 GBK。

如果你的 SVN 输出编码比较特殊，仍可能出现显示异常。

### 菜单与交互相关

### 4. 为什么 Tools 菜单中会看到一个 SVN Annotator 子菜单

这是插件当前的标准入口。为了避免 `Login / Refresh / Toggle / View Changes` 四个动作平铺在 `Tools` 菜单下，插件会将它们收纳到同一个 `SVN Annotator` 子菜单里。

### 5. 为什么右键菜单里只有 View Changes

右键菜单主要用于“就地查看当前行变更”，因此只保留 `View Changes`。  
登录、刷新和开关属于全局操作，放在 `Tools > SVN Annotator` 中更清晰。

### 构建与兼容性相关

### 6. 支持哪些 IDEA 版本

当前构建支持 IntelliJ 平台 `231` 到 `254.*`，即 **2023.1 ~ 2025.4**。

### 7. 为什么构建时必须使用 JDK 17

当前项目使用的 IntelliJ Platform Gradle Plugin 与 Kotlin/IDE 平台版本要求使用 **JDK 17 或更高版本** 进行构建。

即使插件运行目标覆盖到 2023.x，构建环境本身仍然需要 JDK 17。

## 构建

### 打包插件

```powershell
.\gradlew.bat buildPlugin
```

### 完整构建

```powershell
.\gradlew.bat clean buildPlugin
```

打包产物位于：

- `build/distributions/svn-annotator-jetbrains-0.1.0.zip`

## 项目现状说明

当前版本重点覆盖以下能力：

- 当前行 SVN 标注展示
- 登录与持久化
- 手动刷新
- 标注开关
- IDEA 内置 Diff 查看
- Tools 子菜单与右键入口

## 已知限制

- 当前只展示“光标所在行”的行尾标注，不会一次性显示整文件所有行的 SVN 信息
- 目前仍使用登录弹窗，没有独立的插件设置页
- SVN 用户名密码仍通过当前实现进行保存，后续建议切换到更安全的存储方式
- 右键菜单当前只提供 `View Changes`，不包含完整管理动作
- 对一些特殊编码环境，虽然已做 UTF-8 / GBK 兼容，仍可能出现个别乱码情况

## 后续计划

如果后续继续演进，建议优先补充以下能力：

- 状态栏登录状态展示优化
- 设置页
- 自定义 svn 可执行文件路径 UI
- 更完整的错误提示与日志面板
- 凭据安全存储
- 更丰富的截图与插件市场页面素材
