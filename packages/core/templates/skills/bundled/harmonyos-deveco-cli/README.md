<div align="center">
  <h1>DevEco CLI</h1>
  <p>一个面向 HarmonyOS 应用开发的统一命令行入口。</p>
  <p>
    <a href="https://www.npmjs.com/package/@deveco/deveco-cli"><img src="https://img.shields.io/npm/v/@deveco/deveco-cli.svg" alt="NPM Version" /></a>
    <a href="https://www.npmjs.com/package/@deveco/deveco-cli"><img src="https://img.shields.io/npm/dm/@deveco/deveco-cli.svg" alt="NPM Downloads" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D18-green.svg" alt="Node.js" /></a>
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue.svg" alt="Platform" />
    <a href="https://developer.huawei.com/consumer/cn/download/"><img src="https://img.shields.io/badge/DevEco%20Studio-%3E%3D6.1.0-orange.svg" alt="DevEco Studio" /></a>
    <img src="https://img.shields.io/badge/Command%20Line%20Tools-%3E%3D26.0.0-orange.svg" alt="Command Line Tools" />
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" /></a>
  </p>
</div>

`DevEco CLI` 将 `DevEco Studio` 工具链统一封装为一个 `CLI`，内置 `ohpm`、`hvigor`、`hdc`、`emulator`、`hilog`，同时集成 HarmonyOS 技能安装、项目脚手架、本地  HarmonyOS 文档检索和 `MCP` 服务。


## 快速开始

### 前置要求

- 操作系统为 `macOS` 、 `Windows` 或 `Linux`（需配置对应环境变量）
- Node.js >= 18，推荐使用22及以上版本
- [DevEco Studio](https://developer.huawei.com/consumer/cn/download/) >= 6.1.0 或 [Command Line Tools](https://developer.huawei.com/consumer/cn/download/)  >= 26.0.0
  - **macOS**：必须安装在 `~/Applications` 或 `/Applications` 目录下。

### 安装

```bash
npm install -g @deveco/deveco-cli@latest
```

安装后可以通过以下命令更新到最新版本：

```bash
devecocli update
```

### 最短工作流

```bash
devecocli create --app-name MyApp
cd MyApp
devecocli run
devecocli log --level E
```

### 文档检索

```bash
devecocli docs search List
devecocli docs read harmonyos-guides/application-models/arkts-page-start-overview
```

更多命令和参数可通过 `devecocli --help` 或各子命令的 `--help` 查看。

## 环境变量

`devecocli` 当需要使用非默认安装路径、多版本并存时固定选型，Command Line Tools或在Linux下运行时，可通过以下环境变量显式指定工具链根：

| 名称                     | 说明                                                   |
| ------------------------ | ------------------------------------------------------ |
| `DEVECO_CLI_STUDIO_PATH` | 显式指定 DevEco Studio 安装根，优先级最高              |
| `DEVECO_CLI_CLT_PATH`    | 显式指定 Command Line Tools 安装根 |

完整优先级链：

```text
DEVECO_CLI_STUDIO_PATH > DEVECO_CLI_CLT_PATH > Auto_Detect
```

### 平台与版本约束

| 平台    | DevEco Studio Auto_Detect                     | Command Line Tools | 最低版本                      |
| ------- | --------------------------------------------- | ------------------ | ----------------------------- |
| Windows | 支持                                          | 可选               | Studio `6.1.0` / CLT `26.0.0` |
| macOS   | 支持                                          | 可选               | 同上                          |
| Linux   | 不支持                                        | 必选               | CLT `26.0.0`                  |

### 使用示例

```bash
# 设置 DevEco Studio
export DEVECO_CLI_STUDIO_PATH="/Applications/DevEco-Studio.app" （可带或不带尾部 Contents）
devecocli device list

# 设置 CLT
export DEVECO_CLI_CLT_PATH=/opt/command-line-tools
devecocli device list
```

## AI Agent 集成

`DevEco CLI` 支持通过命令行将自身技能添加到 `Agent` 中。下面以 `opencode` 为例展示最短流程：

```bash
# 1. 给 opencode 安装 deveco-cli 技能
devecocli init --agent opencode

# 2. 给 opencode 在当前 HarmonyOS 项目配置 MCP
devecocli init --mcp --agent opencode --project ./MyApp

# 3. 进入项目并启动 opencode
cd MyApp
opencode
```

也支持 `atomcode`等 Agent，使用方式相同：

```bash
# 给 atomcode 安装技能
devecocli init --agent atomcode
```

如果 `Agent` 不在 `--agent` 参数取值范围内，可使用 `--path` 参数进行添加，参考如下命令：

```bash
devecocli init --path D:\work\ARKTS\NewData
```

进入 `Agent` 后可以直接描述任务，例如：

- `Build this project in release mode and run it on my emulator`
- `Tail the last error logs from this app`
- `Check for syntax errors in src/main/ets/pages/Index.ets`

## 常用命令

| 命令                        | 用途                                        |
| ------------------------- | ----------------------------------------- |
| `devecocli create`        | 创建新的 HarmonyOS 项目                         |
| `devecocli build`         | 构建项目并产出 `.hap` / `.hsp` / `.har` / `.app` |
| `devecocli check lint`    | 检查代码规范并输出实践建议与报告                      |
| `devecocli run`           | 安装并运行应用                                   |
| `devecocli device list`   | 查看当前连接设备                                  |
| `devecocli emulator list` | 查看本地模拟器实例                                 |
| `devecocli ui layout`    | 导出设备屏幕上的 UI 节点树（布局、坐标、节点 ID）           |
| `devecocli ui window list` | 查看设备窗口列表（为 `ui layout` / `ui click` 等提供窗口 ID） |
| `devecocli ui screenshot` | 对真机或模拟器执行 UI 截图                          |
| `devecocli ui click`      | 点击指定坐标或节点 ID                             |
| `devecocli ui swipe`      | 自定义滑动（指定起点、终点和速度）                   |
| `devecocli ui text`       | 输入文本到焦点或指定位置                            |
| `devecocli log`           | 查看 `hilog` 或崩溃日志                          |
| `devecocli docs search`   | 搜索本地 HarmonyOS 文档                         |
| `devecocli init`          | 安装内置技能或配置 `MCP`                           |
| `devecocli skills`        | 管理 HarmonyOS 技能市场中的技能                     |
| `devecocli signature generate` | 自动生成调试签名材料并配置到项目     |
| `devecocli check compat`  | 扫描源代码在两个 `SDK` 版本之间的 `API` 变更         |

## 命令集

### `help`

查看版本、帮助信息以及所有子命令

**命令格式：**

```bash
devecocli help
```

```text
# 返回结果
Usage: devecocli [options] [command]

HarmonyOS application development command line tool

Options:
  -V, --version          output the version number
  -h, --help             display help for command

Commands:
  build [options]        Build the HarmonyOS project
  run [options]          Build and run the project on a connected device
  update                 Update deveco-cli to the latest version
  device                 Manage connected devices
  emulator               Manage emulator instances
  auth                   Authentication commands (login, logout, status, team)
  ui                     Inspect and interact with UI on a connected device
  skills                 Manage HarmonyOS skills
  log [options]          Obtain device application logs
  create [options]       Scaffold a new HarmonyOS application project
  init [options]         Install the deveco-cli skill or configure the deveco-mcp server into AI agents
  serve                  Host bundled auxiliary protocol servers
  docs [options]         Search and read HarmonyOS documentation from local docs directory
  check                  Run DevEco project checks
  signature              Generate application signature
  help [command]         display help for command
```

### `init`

将`deveco-cli` `Skill` 或者 `MCP` 服务配置到智能体中

**命令格式：**

```bash
devecocli init --agent <agents> --project <path> --path <path> --skill --mcp --force
```

**参数：**

| 参数名         | 说明                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------- |
| --agent     | 可选，智能体名称，多个智能体名称以英文逗号分隔。缺省时配置到所有已检测到的智能体中                                                 |
| --project   | 可选，指定工程路径，将`deveco-cli` `Skill` 或 `MCP` 服务安装到该工程项目中                                       |
| --path      | 可选，指定 `deveco-cli` `Skill` 的配置路径。不可与 `--project` 、`--agent` 、 `--mcp` 同时使用                |
| --skill     | 可选，安装 `deveco-cli` `Skill`。不可与 `--mcp` 同时使用。`--mcp` 与 `--skill` 都缺省时，执行 `--skill`         |
| --mcp       | 可选，配置 `MCP` 服务，与 `--project` 一起使用表示配置工程级 `MCP` 服务，独立使用表示配置用户级 `MCP` 服务。不可与 `--skill` 同时使用 |
| -f, --force | 可选，当目标位置已存在 `deveco-cli` `Skill` 或 `MCP` 服务时，覆盖重装                                         |

**示例：**

```bash
# 配置Skill
devecocli init -f   # 安装或更新deveco-cli Skill
devecocli init --skill
devecocli init --agent agentname    # agentname需替换为实际的智能体名称
devecocli init --path D:\work\ARKTS\NewData -f

# 配置MCP
devecocli init --mcp
devecocli init --mcp --agent agentname    # agentname需替换为实际的智能体名称   
devecocli init --mcp --project D:\work\ARKTS\NewData -f
```

### `docs search`

将关键词搜索版本说明、指南、API参考、最佳实践、`FAQ` 、变更预告等中的内容

**命令格式：**

```bash
devecocli docs search <keywords...> --catalog <name> --format <fmt> --limit <n>
```

**参数：**

| 参数名         | 说明                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| keywords... | 必选，搜索关键词，多个关键词用空格隔开                                                                                                                                                                |
| --catalog   | 可选，文档类别，取值包含`harmonyos-releases`（版本说明）、 `harmonyos-guides`（指南）、`harmonyos-references`（API参考）、`best-practices`（最佳实践）、`harmonyos-faqs`（FAQ）、`harmonyos-roadmap`（变更预告）、`all`（所有分类，默认） |
| --format    | 可选，控制输出格式，取值包括 `default` 、`json` ，默认为`default` ，输出结果包括文档ID、标题、文档的概括内容                                                                                                              |
| --limit     | 可选，设置搜索结果返回条数，默认为10                                                                                                                                                                |

**示例：**

```bash
devecocli docs search 沉浸光感
devecocli docs search '@State' '@Prop' --catalog best-practices --limit 10
devecocli docs search Row Column --format json
```

### `docs read`

按文档ID查询文档的完整内容

**命令格式：**

```bash
devecocli docs read <documentId> 
```

**参数：**

| 参数名        | 说明      |
| ---------- | ------- |
| documentId | 必选，文档ID |

**示例：**

```bash
devecocli docs read 开发指南/应用框架/UI_Design_Kit_UI设计套件/沉浸光感/ui-design-hds-component-material
```

### `docs catalog`

查询文档分类和分类名称

**命令格式：**

```bash
devecocli docs catalog --format <fmt> 
```

**参数：**

| 参数名      | 说明                                        |
| -------- | ----------------------------------------- |
| --format | 可选，输出格式，`default` 或 `json` ，默认为 `default` |

**示例：**

```bash
devecocli docs catalog 
devecocli docs catalog --format json
```

### `create`

创建 HarmonyOS 应用工程，仅支持创建工程模板中的 `Empty Ability` 模板

**命令格式：**

```bash
devecocli create --app-name <name> --project-path <path> --bundle-name <bundle> --api-level <level> 
```

**参数：**

| 参数名            | 说明                                                                |
| -------------- | ----------------------------------------------------------------- |
| --app-name     | 必选，应用名称                                                           |
| --project-path | 可选，工程路径，默认为：`./<appname>`                                         |
| --bundle-name  | 可选，包名，默认为：`com.example.<appname>` ，`appname` 自动转为小写               |
| --api-level    | 可选，API级别，最小值为17，最大值从安装的 `Deveco Studio` 的 `HarmonyOS` `SDK` 中自动获取 |

**示例：**

```bash
devecocli create --project-path ./MyApp --app-name MyApp
devecocli create --project-path ./MyApp --app-name MyApp --bundle-name com.acme.myapp --api-level 23
devecocli create --app-name MyApp
```

### `auth login`

登录华为开发者账号，打开浏览器完成授权。

**命令格式：**

```bash
devecocli auth login
```

**说明：**

- 海外账户暂不支持

### `auth logout`

登出并清除本地存储的凭据

**命令格式：**

```bash
devecocli auth logout
```

### `auth status`

显示当前登录的用户

**命令格式：**

```bash
devecocli auth status
```

### `auth team list`

列出当前用户已加入的团队

**命令格式：**

```bash
devecocli auth team list
```

**示例：**

```bash
devecocli auth team list
```

### `build`

编译并打包 HarmonyOS 工程或工程中的模块

**命令格式：**

```bash
devecocli build --product <product> --modules <modules> --build-mode <mode>
```

**参数：**

| 参数名          | 说明                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| --product    | 可选，产品的名称，默认为 `default`                                                                                  |
| --modules    | 可选，模块的名称。如需指定模块的 `target` 信息，使用 `module@target` 形式。当工程中只有一个模块时，可缺省；当工程中存在多个模块，且仅存在一个 `entry` 类型的模块时，可缺省 |
| --build-mode | 可选，构建模式，默认为 `debug`                                                                                     |

**示例：**

```bash
devecocli build --build-mode release
devecocli build --modules entry library
devecocli build --modules library@phone
devecocli build --product oversea --modules entry --build-mode release
```

**说明：**

- 选定模块的依赖会被自动解析和构建
- 执行`devecocli build --product <name>`命令后，产物为 `.app`
- 执行`devecocli build --product <name> --modules <m1>`命令后，产物为 `.hap` / `.hsp` / `.har`

### `build clean`

清理 HarmonyOS 项目的构建产物

**命令格式：**

```bash
devecocli build clean
```

### `check lint`

检查代码规范并输出实践建议与报告。

**命令格式：**

```bash
devecocli check lint [path]
```

**参数：**

| 参数名                        | 说明                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `[path]`                     | 可选，待检查的文件或目录；默认使用 `build-profile.json5` 所在的项目根目录，否则使用当前目录 |
| `--config-path <path>`       | Code Linter 配置文件路径，仅支持 `.json` 或 `.json5`；默认使用待检查项目根目录下的 `code-linter.json5`，显式指定时必须与待检查路径属于同一项目 |
| `--fix`                      | 自动修复可修复的问题                                                  |
| `--incremental`              | 仅检查 Git 未提交文件                                                 |
| `--product <name>`           | `build-profile.json5` 中定义的 product，默认为 `default`              |
| `--format <default\|json>`   | 完整报告格式；`default` 输出 Markdown，`json` 输出 JSON                |
| `--output-path <path>`       | 完整报告文件或目录；目录形式会自动生成带时间戳的报告文件               |
| `--limit <number>`           | 未指定 `--output-path` 时，限制终端显示的问题数量                      |

### `emulator list`

查看模拟器实例

**命令格式：**

```bash
devecocli emulator list [--format <table|json>]
```

**参数：**

| 参数名 | 说明 |
| --- | --- |
| `--format` | 可选，控制终端输出格式，取值为 `table` 或 `json`，默认为 `table` |

**示例：**

```bash
devecocli emulator list
devecocli emulator list --format json
```

### `emulator start`

启动模拟器。首次使用时，需要签署 HarmonyOS 软件许可与服务协议，具体请参考 `emulator license`

**命令格式：**

```bash
devecocli emulator start [names...]
```

**参数：**

| 参数名         | 说明                                        |
| ----------- | ----------------------------------------- |
| \[names...] | 必选，模拟器实例名称，多个名称用空格隔开。若名称中带有空格，则名称需要添加英文引号 |

**示例：**

```bash
devecocli emulator start Phone
devecocli emulator start Phone1 Phone2
```

**说明：**

- `emulator start` 命令仅支持启动 `release` 版本的模拟器

### `emulator stop`

关闭模拟器

**命令格式：**

```bash
devecocli emulator stop [names...]
```

**参数：**

| 参数名         | 说明                                        |
| ----------- | ----------------------------------------- |
| \[names...] | 必选，模拟器实例名称，多个名称用空格隔开。若名称中带有空格，则名称需要添加英文引号 |

**示例：**

```bash
devecocli emulator stop Phone
devecocli emulator stop 127.0.0.1:5555
```

### `emulator` 场景操作

控制运行中的模拟器实例，直接映射 DevEco Studio 内置 Emulator 公开命令行参数。新增场景控制命令要求 Emulator 7.0 或更高版本；低版本会直接提示升级。截图不属于模拟器场景操作，统一通过 `devecocli ui screenshot` 执行。

**示例：**

```bash
devecocli emulator shake --target Phone
devecocli emulator power --target Phone
devecocli emulator rotate left --target Phone
devecocli emulator volume up --target Phone
devecocli emulator fold half-open --target Phone
devecocli emulator battery --target Phone --level 90
devecocli emulator battery --target Phone --status charging
devecocli emulator geolocation --target Phone --longitude 116.400244
devecocli emulator scene outdoorRunning --target Phone
devecocli emulator sensor --target Phone --heartrate 80
```

**说明：**

- `--target` 支持模拟器名称或 `127.0.0.1:<port>` 序列号。
- `battery --level` 会自动查询模拟器当前充电状态：充电时取值范围为整数 `[0, 100]`，未充电时为 `[1, 100]`。
- `battery --status` 取值为 `charging` 或 `discharging`。
- `geolocation` 支持 `--longitude`、`--latitude`、`--altitude`、`--direction`。
- `scene` 取值为 `outdoorRunning`、`outdoorCycling`、`drivingNavigation`。
- `sensor` 支持 `--light-intensity`、`--humidity`、`--temperature`、`--steps`、`--heartrate`。
- `fold <state>` 会根据目标模拟器的设备类型校验状态，设备与参数必须匹配：

  | 设备类型 | 支持的 `state` |
  | --- | --- |
  | `foldable` | `open`、`half-open`、`close` |
  | `2in1_foldable` | `open`、`vertical-open`、`half-open`、`close` |
  | `triplefold` | `single`、`double`、`triple`、`left-folded-right-half-folded`、`left-half-folded-right-expanded`、`left-expanded-right-folded`、`left-half-folded-right-folded`、`left-expanded-right-half-folded`、`left-half-folded-right-half-folded` |

  校验以目标模拟器实际返回的 `deviceType` 为准。非上述三种设备类型以及不属于目标设备类型的状态会在命令下发前被拒绝。校验通过后，底层映射为 `Emulator -instance <name> -foldedState <state>`。
- 设置 `DEVECO_CLI_DEBUG=1` 可查看底层命令映射，例如 `Emulator -instance <name> -shake`。

### `emulator create`

创建模拟器

**命令格式：**

```bash
devecocli emulator create <name> --device-type <type> --os-version <version> --force
```

**参数：**

| 参数名           | 说明                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| name          | 必选，模拟器名称                                                                                                                        |
| --device-type | 必选，模拟器设备类型，支持 `phone` ， `foldable` ， `widefold` ， `triplefold` ， `tablet` ， `2in1` ， `2in1 foldable` ， `tv` ， `wearable` ，全小写 |
| --os-version  | 必选，模拟器镜像版本                                                                                                                      |
| --force       | 可选，覆盖已有同名的模拟器                                                                                                                   |

**示例：**

```bash
devecocli emulator create MyPhone --device-type phone --os-version "HarmonyOS 6.0.1(21)"
```

### `emulator delete`

创建模拟器

**命令格式：**

```bash
devecocli emulator delete <name>
```

**参数：**

| 参数名  | 说明             |
| ---- | -------------- |
| name | 必选，模拟器实例名称或序列号 |

**示例：**

```bash
devecocli emulator delete MyPhone
```

### `emulator image list`

查询模拟器镜像列表

**命令格式：**

```bash
devecocli emulator image list --device-type <type> --all --format <format>
```

**参数：**

| 参数名           | 说明                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| --device-type | 可选，模拟器设备类型，支持 `phone` ， `foldable` ， `widefold` ， `triplefold` ， `tablet` ， `2in1` ， `2in1 foldable` ， `tv` ， `wearable` |
| --all         | 可选，查询已下载和未下载的所有镜像                                                                                                          |
| --format      | 可选，控制输出格式，取值为 `table` 或 `json` ，默认为 `table`                                                                                |

**示例：**

```bash
devecocli emulator image list
devecocli emulator image list --all
devecocli emulator image list --device-type phone
devecocli emulator image list --format json
```

### `emulator image download`

下载模拟器镜像。首次使用时，需要签署 HarmonyOS `SDK` 许可协议，具体请参考 `emulator license`

**命令格式：**

```bash
devecocli emulator image download --device-type <type> --os-version <version> --force
```

**参数：**

| 参数名           | 说明                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| --device-type | 必选，模拟器设备类型，支持 `phone` ， `foldable` ， `widefold` ， `triplefold` ， `tablet` ， `2in1` ， `2in1 foldable` ， `tv` ， `wearable` ，全小写 |
| --os-version  | 必选，模拟器镜像版本                                                                                                                      |
| --force       | 可选，覆盖已有的模拟器镜像                                                                                                                   |

**示例：**

```bash
devecocli emulator image download --device-type phone --os-version "HarmonyOS 6.0.1(21)" --force
```

**说明：**

- `emulator image download` 命令仅支持下载 `release` 版本的模拟器镜像

### `emulator image remove`

删除模拟器镜像

**命令格式：**

```bash
devecocli emulator image remove --device-type <type> --os-version <version>
```

**参数：**

| 参数名           | 说明                             |
| ------------- | ------------------------------ |
| --device-type | 必选，模拟器设备类型，与下载镜像的device-type一致 |
| --os-version  | 必选，模拟器镜像版本，与下载镜像的os-version一致  |

**示例：**

```bash
devecocli emulator image remove --device-type phone --os-version "HarmonyOS 6.0.1(21)"
```

### `emulator license view`

查看协议文本（只读）

**命令格式：**

```bash
devecocli emulator license view
```

### `emulator license`

交互式查看并接受协议。打印完整协议文本后提示 y/N 确认。使用模拟器需要同意 HarmonyOS 软件许可与服务协议，下载镜像需要同意 HarmonyOS `SDK` 许可协议。若已同意则直接提示已接受。非交互终端下会报错，请改用 `emulator license accept`

**命令格式：**

```bash
devecocli emulator license
```

### `emulator license accept`

非交互式同意模拟器所有协议，直接写入同意记录，跳过协议展示和确认提示。适用于自动化脚本、CI 或非交互终端环境。若已同意则直接提示已接受

**命令格式：**

```bash
devecocli emulator license accept
```

### `device list`

查询所有已连接的设备，包括真机设备和运行中的模拟器

**命令格式：**

```bash
devecocli device list
```

### `device view`

查询已连接的设备的详细信息，包括设备序列号、设备名称、设备类型、 `OS` 版本等

**命令格式：**

```bash
devecocli device view --target <serialOrName>
```

**参数：**

| 参数名         | 说明                                    |
| ----------- | ------------------------------------- |
| -t，--target | 可选，目标设备名称或序列号。多设备缺省时，会列出所有已连接设备序列号和名称 |

**示例：**

```bash
devecocli device view
devecocli device view --target 127.0.0.1:5555
devecocli device view -t "My Device Name"
```

### `ui screenshot`

对真机或模拟器执行 UI 截图。

**命令格式：**

```bash
devecocli ui screenshot --device <name|serial> --display <displayId> --path <path>
```

**参数：**

| 参数                       | 说明                       | 默认值       |
| ------------------------ | ------------------------ | ---------- |
| --device \<name\|serial> | 真机或模拟器名称/序列号；多设备时必填     | 单设备自动选择 |
| --display \<displayId>   | 目标屏幕 ID，可选                | 默认屏幕     |
| --path \<path>           | 必填，文件夹路径或 PNG 文件路径；支持相对于当前目录的路径，目录必须存在且可写，目标文件不能已存在 | 无 |

**示例：**

```bash
mkdir -p screenshots
devecocli ui screenshot --device Phone --path ./screenshots
devecocli ui screenshot --device Phone --display 0 --path ./screenshots/phone.png
```

**说明：**

- `ui screenshot` 支持真机和模拟器。
- 仅有一个可用设备时可省略 `--device`，多个设备同时连接时必须指定。
- `--path` 可以使用相对于当前目录的路径。可以指定已存在的文件夹并自动生成 PNG 文件名，也可以指定完整的 PNG 文件路径；不会自动创建目录或覆盖已有文件。
- 截图能力统一通过 `ui screenshot` 提供，不放在模拟器场景操作命令中。
- 截图统一使用 `hdc shell snapshot_display` 和 `hdc file recv` 实现；设置 `DEVECO_CLI_DEBUG=1` 可查看实际执行命令。

### `ui click`

点击指定坐标或节点 ID 的中心位置。

**命令格式：**

```bash
devecocli ui click [x] [y] --device <name|serial> --id <id> --window <windowId>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `[x] [y]` | 可选，目标坐标。缺省时需配合 `--id` 使用 |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --id \<id> | 节点 ID，自动解析为中心坐标。不可与 `[x] [y]` 同时使用 |
| --window \<windowId> | 目标窗口 ID，需与 `--id` 配合使用 |

**示例：**

```bash
devecocli ui click 100 200
devecocli ui click 100 200 --device Phone
devecocli ui click --id submit_button
devecocli ui click --id submit_button --window main_window
```

### `ui doubleclick`

双击指定坐标或节点 ID 的中心位置。

**命令格式：**

```bash
devecocli ui doubleclick [x] [y] --device <name|serial> --id <id> --window <windowId>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `[x] [y]` | 可选，目标坐标。缺省时需配合 `--id` 使用 |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --id \<id> | 节点 ID，自动解析为中心坐标。不可与 `[x] [y]` 同时使用 |
| --window \<windowId> | 目标窗口 ID，需与 `--id` 配合使用 |

**示例：**

```bash
devecocli ui doubleclick 100 200
devecocli ui doubleclick 100 200 --device Phone
devecocli ui doubleclick --id photo_thumb
devecocli ui doubleclick --id photo_thumb --window main_window
```

### `ui longclick`

长按指定坐标或节点 ID 的中心位置。

**命令格式：**

```bash
devecocli ui longclick [x] [y] --device <name|serial> --id <id> --window <windowId>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `[x] [y]` | 可选，目标坐标。缺省时需配合 `--id` 使用 |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --id \<id> | 节点 ID，自动解析为中心坐标。不可与 `[x] [y]` 同时使用  |
| --window \<windowId> | 目标窗口 ID，需与 `--id` 配合使用 |

**示例：**

```bash
devecocli ui longclick 100 200
devecocli ui longclick 100 200 --device Phone
devecocli ui longclick --id menu_item
devecocli ui longclick --id menu_item --window main_window
```

### `ui swipe`

自定义滑动（指定起点、终点和速度）。

**命令格式：**

```bash
devecocli ui swipe <x1> <y1> <x2> <y2> --device <name|serial> --speed <n>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `<x1> <y1> <x2> <y2>` | 必选，起点和终点坐标 |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --speed \<n> | 可选，滑动速度（像素/秒），范围 `200` ~ `40000` |

**示例：**

```bash
devecocli ui swipe 100 500 100 200
devecocli ui swipe 100 500 100 200 --device Phone
devecocli ui swipe 100 500 100 200 --speed 1000
```

### `ui fling`

快速滑动（Fling）。

**命令格式：**

```bash
devecocli ui fling <x1> <y1> <x2> <y2> --device <name|serial> --speed <n>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `<x1> <y1> <x2> <y2>` | 必选，起点和终点坐标 |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --speed \<n> | 可选，滑动速度（像素/秒），范围 `200` ~ `40000` |

**示例：**

```bash
devecocli ui fling 100 800 100 200
devecocli ui fling 100 800 100 200 --device Phone
devecocli ui fling 100 800 100 200 --speed 3000
```

### `ui drag`

拖拽操作。

**命令格式：**

```bash
devecocli ui drag <x1> <y1> <x2> <y2> --device <name|serial> --speed <n>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `<x1> <y1> <x2> <y2>` | 必选，起点和终点坐标 |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --speed \<n> | 可选，滑动速度（像素/秒），范围 `200` ~ `40000` |

**示例：**

```bash
# 拖拽操作
devecocli ui drag 100 500 100 200
devecocli ui drag 100 500 100 200 --device Phone
devecocli ui drag 100 500 100 200 --speed 1500
```

### `ui dircfling`

向指定方向快速滑动。

**命令格式：**

```bash
devecocli ui dircfling <direction> --device <name|serial>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `<direction>` | 必选，方向，取值为 `up`, `down`, `left`, `right` |
| --device \<name\|serial> | 目标设备，多设备时必填 |

**示例：**

```bash
devecocli ui dircfling up
devecocli ui dircfling down --device Phone
devecocli ui dircfling left
devecocli ui dircfling right
```

**与 `ui swipe` 的区别：**

- `ui swipe` 需要指定精确的起点和终点坐标，支持自定义速度，适用于特定区域滑动。
- `ui dircfling` 仅需指定方向，使用系统默认速度，适用于页面滚动或列表快速滑动。

### `ui text`

输入文本到当前焦点、指定坐标或指定节点位置。

**命令格式：**

```bash
devecocli ui text <text> [x] [y] --device <name|serial> --id <id> --window <windowId>
```

**参数：**

| 参数 | 说明 |
| --- | --- |
| `<text>` | 必选，待输入的文本 |
| `[x] [y]` | 可选，目标坐标 |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --id \<id> | 节点 ID，自动解析为中心坐标。不可与 `[x] [y]`同时使用 |
| --window \<windowId> | 目标窗口 ID，需与 `--id` 配合使用 |

**示例：**

```bash
devecocli ui text "Hello World"
devecocli ui text "Hello World" --device Phone
devecocli ui text "Hello World" 100 200
devecocli ui text "Hello World" --id search_box
devecocli ui text "Hello World" --id search_box --window main_window
```

### `ui layout`

导出设备屏幕上的 UI 节点树，输出每个节点的类型、节点 ID、坐标边界 `[left,top,right,bottom]`、文本及可交互标志（`clickable` / `longClickable` / `scrollable` / `checkable`）。

**命令格式：**

```bash
devecocli ui layout --device <name|serial> --id <id> --window <windowId> --all-windows --depth <n> --format <fmt> --mode <full|simplified>
```

**参数：**

| 参数名 | 说明 |
| --- | --- |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --id \<id> | 节点 ID，筛选树中匹配节点（仅输出匹配节点，不带子节点，强制 JSON）。不可与未筛选的全树输出同时视为列表查询 |
| --window \<windowId> | 目标窗口 ID，与 `--all-windows` 互斥 |
| --all-windows | 包含所有窗口，与 `--window` 互斥 |
| --depth \<n> | 树深度限制，`0`=不限制（默认），`1`=仅根，`2`=根+子节点 |
| --format | 输出格式，`default` 或 `json`，默认 `default` |
| --mode | 输出模式：`full`=完整原始树；`simplified`（默认）=折叠无 ID、无文本、无可交互标志的包装节点 |

**示例：**

```bash
devecocli ui layout
devecocli ui layout --device Phone
devecocli ui layout --device Phone --format json
devecocli ui layout --mode full --depth 2
devecocli ui layout --id submit_button
devecocli ui layout --window 15 --format json
```

**说明：**

- `--mode simplified`（默认）会折叠无 `id`、无 `text`、无任何可交互标志的包装节点，使输出聚焦于有意义的可操作节点；根节点始终保留。`--depth` 在折叠后截断。
- `--id` 用于按节点 ID 查询，返回所有匹配节点（`children` 置空），常配合 `ui click --id` / `ui text --id` 定位坐标。
- 节点 `bounds` 为 `[left, top, right, bottom]`，`ui click --id` 等交互命令据此取中心坐标点击。
- `--window` 的窗口 ID 可通过 `devecocli ui window list` 获取。

### `ui window list`

查看设备上的窗口列表，输出窗口 ID、名称、PID、所属屏幕 ID 及是否聚焦。为 `ui layout --window`、`ui click --window` 等命令提供窗口 ID。

**命令格式：**

```bash
devecocli ui window list --device <name|serial> --format <fmt> --all
```

**参数：**

| 参数名 | 说明 |
| --- | --- |
| --device \<name\|serial> | 目标设备，多设备时必填 |
| --format | 输出格式，`default` 或 `json`，默认 `default` |
| --all | 显示包含系统窗口在内的所有窗口；缺省时仅显示应用窗口（`type === 1`） |

**示例：**

```bash
devecocli ui window list
devecocli ui window list --device Phone
devecocli ui window list --format json
devecocli ui window list --all
```

**说明：**

- 聚焦窗口在 `default` 格式下高亮显示。
- 缺省时仅列出应用窗口；加 `--all` 可查看系统窗口，用于排查多窗口场景。

### `run`

构建应用后，将应用安装到真机设备或模拟器上，并启动执行

**命令格式：**

```bash
devecocli run --module <module> --device <device> --product <product> --build-mode <mode> --ability <ability> --uninstall --skip-build --apply <txtFile>
```

**参数：**

| 参数名          | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ |------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| --module     | 可选，模块名称。如需指定模块的 `target` 信息，使用 `module@target` 形式。当工程中只有一个可运行模块（ `entry` / `feature` / `shared` ）时，可缺省                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --device     | 设备名称或设备序列号，单设备时可选，多设备时必选                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --product    | 可选，产品的名称，默认为 `default`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --build-mode | 可选，构建模式名称，默认为 `debug`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --ability    | 可选，待启动的 `Ability` ，默认：模块 `module.json5` 中的`mainElement`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --uninstall  | 可选，安装前先卸载已有应用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --skip-build | 可选，跳过构建操作，直接安装应用 。\*\*说明：\*\*使用该参数时，需确保对应模块已有构建产物                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --apply \<fileName\> | 可选，**快速增量部署**：仅重编改动文件 → signed hqf → `bm quickfix -a -f -o` 安装 → 重启，比全量 `run` 快。`<fileName>` 是工程 `.hvigor/` 目录下的**纯文件名**（调用方把清单写到此目录，文件名做安全校验防穿越）；内容为本轮改动的源文件路径清单（每行一个相对工程根路径；`#`/空行忽略；`.ets`/`.ts`/`.cpp`/资源文件；changeFileList 增量累积，只需列本轮改的，历史文件自动保留）。模块从清单路径自动识别（无需 `--module`）。**前提**：DevEco Studio ≥6.1.1（hvigor `assembleDevHqf` 支持，低于拒绝并提示升级）；先 `devecocli run` 全量构建部署一次（生成 buildConfig.json 缓存）；**没生效排查**：检查 `<module>/build/config/buildConfig.json` 有无内容（空/无 = 没跑过 `devecocli run`）；**失败兜底**：直接 `devecocli run`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --hotreload [action] | 可选，**热重载 watch 会话**（须作为**后台进程**启动，该进程持久持有到 hvigor daemon 的 socket）：以热重载模式构建 hap（`hotReload=true debuggable=true`）、部署+拉起应用，然后进程自身连 socket 到 daemon 发 `CommonBuild assembleHap --hot-reload-build --watch` 并**保持连接**，保活 daemon 的 watch worker（rollup watch）供 `--hotreload-apply` 复用。进程常驻（onBuildOutput 流式到其 stdout）。**热重载调试结束必须 kill 此后台进程**（否则 watch worker/daemon 泄漏）；`stop` 同时关闭 hvigor daemon。用法：后台起 `devecocli run --module <m> --hotreload`，等 `.hotreload-mode` marker（或 stdout 出现 "watch session active"）即就绪，再跑 `--hotreload-apply`；结束 kill 后台进程 + `--hotreload stop`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --hotreload-apply \<fileName\> | 可选，**热重载（不重启应用）**：读取 `.hvigor/<fileName>` 改动清单（格式与 `--apply` 相同），开**短连接** socket 到 daemon（由后台 `--hotreload` 进程保活），发 `CommonBuild assembleDevHqf --hot-compile` → watch worker 增量 hot 编译改动 `.ets`/`.ts` 为 abc（HotReloadArkTS；输出/报错经 WatchLog 实时流式），再**手搓** pack+sign：`app_packing_tool.jar` 打包 + `hap-sign-tool.jar` 签名（DevEco material 密码经 `DecipherUtil` 解密），最后 `bm quickfix -a -f -o` 安装，**应用不重启即生效**。**前提**：后台 `--hotreload` 进程在跑（持有 watch 会话）；超时即 watch 会话没活，重启后台 `--hotreload`。**范围（重要）**：热重载目标是**单个模块**（`--module` 必填，目标可为 entry/hsp/feature；`har` 依赖并入、OK）；**`feature`/`hsp` 依赖模块**（非目标）的改动不支持热重载（检测并 warn，需全量 `devecocli run` 重部署）；资源/native 改动需全量 run。编译报错经 WatchLog 路由到后台 `--hotreload` 进程、落盘 **`.hvigor/hotreload-watch.log`**（+其 stdout），apply 失败时读该文件把报错打出来（~15s 超时快速失败）。**`.hvigor/` 产物**：`.hvigor/<fileName>`=改动清单（入参）、`.hvigor/hotreload-watch.log`=watch 会话的 onBuildOutput/编译报错（后台进程写，可读/可删）。 |

**示例：**

```bash
devecocli run
devecocli run --module entry --device 127.0.0.1:5555
devecocli run --module library@phone --device 127.0.0.1:5555
devecocli run --product oversea --module entry --ability EntryAbility
devecocli run --build-mode release
devecocli run --uninstall
devecocli run --apply changes.txt
devecocli run --hotreload
devecocli run --hotreload stop
devecocli run --hotreload-apply changes.txt
```

### `log`

查看`hilog`普通日志或崩溃日志

**命令格式：**

```bash
devecocli log --device <device> --crash --level <level> --bundle-name <bundle-name> --keyword <keyword> --tail <num> --from <start> --to <end> --follow
```

**参数：**

| 参数名           | 说明                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| --device      | 设备名称或设备序列号，单设备时可选，多设备时必选                                                                                                   |
| --crash       | 可选，查看崩溃日志                                                                                                                  |
| --level       | 可选，日志级别，取值包括`D`（ `Debug` ）、`I`（ `Info` ）、`W`（ `Warn` ）、`E`（ `Error` ）、`F`（ `Fatal` ）                                       |
| --bundle-name | 可选，根据包名查看日志                                                                                                                |
| --keyword     | 可选，根据关键词查看日志，关键词区分大小写                                                                                                      |
| --tail        | 可选，显示最新的N行日志，取值为正整数                                                                                                        |
| --from        | 可选，起始时间，单位为`m`和`s`，`m`和`s`为小写，默认为`s`，`start`的取值需要大于等于`end`                                                                 |
| --to          | 可选，结束时间，单位为`m`和`s`，`m`和`s`为小写，默认为`s` 。不可与--follow同时使用。**说明：** 如当前时间为05：00，`start`设置为30s，`end`设置为10s，则起始时间为04：30，结束时间为04：50 |
| --follow      | 可选，实时输出日志。不可与--to同时使用                                                                                                      |

**示例：**

```bash
devecocli log --level E
devecocli log --crash --bundle-name com.example.app
devecocli log --device 127.0.0.1:5555 --level W --keyword Init
devecocli log --tail 100 --from 5m --to 2m
devecocli log --follow --bundle-name com.example.app
```

### `skills list`

查询可用的 `Skill`

**命令格式：**

```bash
devecocli skills list --long
```

**参数：**

| 参数名       | 说明                                              |
| --------- | ----------------------------------------------- |
| -l，--long | 可选，`Skill` 详情，包括描述和已安装的智能体列表。缺省时，仅显示 `Skill` 名称 |

**示例：**

```bash
devecocli skills list
devecocli skills list --long
devecocli skills list -l
```

### `skills find`

按关键词搜索 `Skill`

**命令格式：**

```bash
devecocli skills find <keyword>
```

**参数：**

| 参数名     | 说明       |
| ------- | -------- |
| keyword | 必选，搜索关键词 |

**示例：**

```bash
devecocli skills find deveco
```

### `skills add`

将 `Skill` 添加到智能体中

**命令格式：**

```bash
devecocli skills add --all --agent <agents> --skill <skill-name> --project <path> --path <path> --force
```

**参数：**

| 参数名        | 说明                                                        |
| ---------- | --------------------------------------------------------- |
| --all      | 可选，添加所有可用的 `Skill` ，与 `--skill` 二选一                       |
| --agent    | 可选，智能体名称，多个智能体时以英文逗号分隔。缺省时，添加到已检测到的智能体中                   |
| --skill    | 可选，待添加的 `Skill` 名称，与 `--all` 二选一                          |
| --project  | 可选，指定项目路径，将 `Skill` 添加到该工程项目中                             |
| --path     | 可选，指定路径，将 `Skill` 添加到该路径，不可与 `--project` 或 `--agent` 同时使用 |
| -f，--force | 可选，当目标位置已有同名 `Skill` 时，覆盖重添加                              |

**示例：**

```bash
devecocli skills add --all
devecocli skills add --skill skillname --agent agentname --force # skillname需替换成实际的Skill名称
devecocli skills add --skill skillname --project ./my-app  # skillname需替换成实际的Skill名称
```

### `skills remove`

从智能体中删除已添加的 `Skill`

**命令格式：**

```bash
devecocli skills remove --skill <skill-name> --agent <agents> --project <path> --path <path>
```

**参数：**

| 参数名       | 说明                                                       |
| --------- | -------------------------------------------------------- |
| --skill   | 必选，待删除的 `Skill` 名称                                       |
| --agent   | 可选，智能体名称，多个智能体时以英文逗号分隔。缺省时，删除到已检测到的智能体中的 `Skill`         |
| --project | 可选，指定项目路径，删除该项目中的 `Skill`                                |
| --path    | 可选，指定路径，删除该项目中的 `Skill`，不可与 `--project` 或 `--agent` 同时使用 |

**示例：**

```bash
devecocli skills remove --skill skillname  # skillname需替换成实际的Skill名称
devecocli skills remove --skill skillname --agent agentname  # skillname需替换成实际的Skill名称
```

### `serve mcp`

启动本地 `MCP` 服务。智能体配置 `MCP` 服务后，可通过 `MCP` 协议调用下方列出的代码分析与语言特性工具。不同智能体平台配置 `MCP` 服务的界面不一样，一个智能体平台的配置示例如下。
推荐通过 `devecocli init --mcp` 自动配置

```bash
{
  "mcp": {
    "deveco-mcp": {
      "type": "local",
      "command": [
        "devecocli",
        "serve",
        "mcp"
      ],
      "environment":{
        "PROJECT_PATH": "D:\\code\\sample_project", // 工程路径
        "NODE_MAX_OLD_SPACE_SIZE": "8192", // 可选，设置内部node进程最大的老生代内存大小，默认为8192
        "DEVECO_PATH": "D:\\Application\\DevEco Studio" // 可选，Deveco Studio的路径
      },
      "enbale": true
    }
  }
}
```

#### MCP 工具

`deveco-mcp` 服务遵循 [MCP](https://modelcontextprotocol.io) 规范，通过 `tools/list` 暴露工具、由模型经 `tools/call` 调用。每个工具由**名称**、**描述**和 **JSON Schema 入参**定义；返回值为 `content` 文本数组，`isError: true` 表示执行错误。

**工具总览：**

| 工具名 | 用途 | 支持语言 |
| --- | --- | --- |
| `check` | 静态语法分析，返回结构化诊断信息 | ArkTS、C/C++ |
| `hover` | 获取指定位置的悬浮信息（类型、文档） | ArkTS、C/C++ |
| `definition` | 查找符号定义位置 | ArkTS、C/C++ |
| `declaration` | 查找符号声明位置（ArkTS 中可能与定义不同） | ArkTS、C/C++ |
| `references` | 查找符号在全工程中的所有引用 | ArkTS、C/C++ |
| `implementation` | 查找符号的实现（如接口实现） | ArkTS、C/C++ |
| `workspaceSymbol` | 按名称在全工程搜索符号 | ArkTS、C/C++ |
| `documentSymbol` | 获取单文件的符号树（函数、类、变量及范围） | ArkTS、C/C++ |
| `callHierarchy` | 查询函数调用关系（incoming=调用方，outgoing=被调用方） | ArkTS 双向、C/C++ 仅 incoming |
| `restart` | 原地重启（重置状态 + 重新 sync/init），不杀进程、客户端不断开；ERROR 态可用 | ArkTS、C/C++（可按 target 单选） |

**可用性说明：**

- `check` 与 `restart` 始终注册；其余 7 个语言特性工具仅在 DevEco Studio 附带标准 LSP 服务入口（`standardIndex/index.js`）时注册，老版本将不暴露这些工具。
- 所有语言特性工具需项目进入 `READY` 状态（`ohpm install` + `hvigor sync` + LSP 初始化完成）后才可用；未就绪时返回 `please retry in N seconds`，模型可稍后重试。`restart` 例外：它正是用于把 server 从 `ERROR` 态拉回，调用后返回"约 10 秒后重试"，后台异步重置并重新 sync/init。
- C/C++ 工具需要工程包含 C++ 模块；无 C++ 代码时返回 `No C++ code`。
- 支持的文件扩展名：ArkTS 为 `.ets`；C/C++ 为 `.c` `.cc` `.cpp` `.cxx` `.c++` `.h` `.hh` `.hpp` `.hxx` `.h++` `.ipp` `.ixx` `.inl` `.inc` `.tpp`。
- 不属于当前工程的路径会被拒绝。

**入参定义：**

##### `check`

对传入的源文件进行静态语法分析并返回诊断信息，支持 ArkTS 与 C/C++ 在同一次调用中混合传入。

| 参数 | 类型 | 必选 | 说明 |
| --- | --- | --- | --- |
| `files` | string[] | 是 | 待检查的源文件路径列表，相对工程根目录，至少 1 个 |

##### `hover` / `definition` / `declaration` / `references` / `implementation`

位置类语言特性，共享同一入参结构。返回该位置符号的类型/文档信息、定义/声明位置、引用列表或实现列表。

| 参数 | 类型 | 必选 | 说明 |
| --- | --- | --- | --- |
| `file` | string | 是 | 源文件路径，相对工程根目录，支持 `.ets` 与 C/C++ 扩展名 |
| `line` | number | 是 | 行号，0-based |
| `character` | number | 是 | 列号（字符偏移），0-based |

##### `workspaceSymbol`

按名称在全工程搜索符号，无需打开具体文件。

| 参数 | 类型 | 必选 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 符号名称或片段，非空 |

##### `documentSymbol`

获取单个文件的符号树，适合文件概览、结构化拆解和大文件切片。

| 参数 | 类型 | 必选 | 说明 |
| --- | --- | --- | --- |
| `file` | string | 是 | 源文件路径，相对工程根目录，支持 `.ets` 与 C/C++ 扩展名 |

##### `callHierarchy`

查询某位置函数的调用关系。

| 参数 | 类型 | 必选 | 说明 |
| --- | --- | --- | --- |
| `file` | string | 是 | 源文件路径，相对工程根目录，支持 `.ets` 与 C/C++ 扩展名 |
| `line` | number | 是 | 行号，0-based |
| `character` | number | 是 | 列号（字符偏移），0-based |
| `direction` | enum | 是 | `incoming`=谁调用了该函数；`outgoing`=该函数调用了谁。ArkTS 支持双向，C/C++（clangd）仅 `incoming` |

##### `restart`

原地重启 MCP server：重置双侧状态并重新 sync/init（ohpm install + hvigor sync + compileNative + LSP 握手），不杀进程、客户端连接保持。用于 sync/init 失败导致 server 停在 `ERROR` 态时（免去退出并重开 agent）。fire-and-forget：立即返回"约 10 秒后重试"，重置在后台异步进行。**注意：`restart` 仅在修复根因后用于恢复，不能修复错误的工程配置。若重启后再次失败，说明是持久性配置问题（oh-package.json5/build-profile.json5 无效、ohpm install 或 hvigor sync 失败、SDK 版本不符等），不要循环调用 `restart`，应请用户排查并修复工程后再重试。**

| 参数 | 类型 | 必选 | 说明 |
| --- | --- | --- | --- |
| `target` | enum | 否 | 重启哪一侧：`arkts`（ArkTS ace-server）、`cpp`（C++ clangd）、`all`（双侧，默认）。省略等同 `all` |

### `serve lsp`

启动本地 `LSP` 语言服务。智能体配置 `LSP` 服务后，可通过 `LSP` 协议获取代码补全、跳转定义、悬浮提示、引用查找、诊断等语言特性。当前支持 `ArkTS`和 `clangd`。

```bash
{
  "lsp": {
    "ArkTS": {
      "command": [
        "devecocli",
        "serve",
        "lsp",
        "--arkts"
      ],
      "extensions": [
        ".ets"
      ]
    },
    "clangd": {
      "command": [
        "devecocli",
        "serve",
        "lsp",
        "--cpp"
      ],
      "extensions": [
        ".c",
        ".cpp",
        ".cc",
        ".cxx",
        ".h",
        ".hpp",
        ".hxx",
        ".hh"
      ]
    }
  }
}
```

**参数：**

| 参数名 | 说明 |
| --- | --- |
| `--arkts` | 与 `--cpp` 二选一，启动 ArkTS 语言服务（ace-server） |
| `--cpp` | 与 `--arkts` 二选一，启动 C/C++ 语言服务（clangd） |
| `--project-path <path>` | 可选，工程根路径，默认为当前工作目录 |
| `--auto-detect` | 可选，当前目录向下查找工程根（检查当前目录自身及其子目录，最多 3 层子目录）；适用于 `--arkts` 和 `--cpp`；指定了 `--project-path` 则忽略 |

### `signature generate`

自动生成调试签名材料（包括p12密钥库、csr证书请求文件、p7b配置文件、cer证书文件），并将签名配置写入项目的 `build-profile.json5` 中。

**命令格式：**

```bash
devecocli signature generate  --product <product> --team-id <team-id> --force --help
``` 

**参数：**

| 参数名                   | 说明                                      |
|-----------------------|-----------------------------------------|
| --product \<product\> | 可选，指定product生成签名，默认为 `default`          |
| --team-id \<team-id\> | 可选，指定生效的team-id,默认使用自身作为团队信息            |
| --force               | 可选，强制覆盖已存在的证书文件 |
| --help,--h            | 可选，查看帮助信息                               |

**示例：**

```bash
# 自动生成签名并写入工程配置
devecocli signature generate

# 指定product
devecocli signature generate --product default

# 指定team-id
devecocli signature generate --team-id 1222

# 强制覆盖已存在的证书文件
devecocli signature generate --force

# 查询帮助信息
devecocli signature generate --help
```

### `check compat`

基于 `DevEco Studio` 自带的 `apkanalyzer-apiscan` 插件，扫描源代码在两个 `SDK` 版本之间的 `API` 变更情况。

**子命令：**

| 子命令 | 说明 |
| --- | --- |
| `devecocli check compat` | 默认执行工程级扫描 |
| `devecocli check compat --modules <m1> [m2...]` | 按模块扫描 |
| `devecocli check compat <file1> [file2...]` | 按文件扫描（仅支持 `.ets`/`.c`/`.cpp`） |
| `devecocli check compat versions` | 列出可用的目标 `SDK` 版本 |

**命令格式：**

```bash
devecocli check compat [files...] --source-version <ver> --target-version <ver> [--modules <m...>] [--format <default|csv|json>] [--output-path <path>] [--limit <n>]
```

**参数：**

| 参数名 | 说明 |
| --- | --- |
| `--source-version` | 必填，当前工程 `SDK` 版本 |
| `--target-version` | 必填，目标 `SDK` 版本 |
| `--modules` | 可选，指定扫描的模块（多个以空格分隔）。与文件参数互斥 |
| `--format` | 可选，输出格式。`default`/`csv`/`json`。默认 `default`（控制台输出文本，文件输出 `csv`） |
| `--output-path` | 可选，报告输出路径。目录或文件（扩展名必须与 `--format` 匹配） |
| `--limit` | 可选，控制台显示的最大记录数，默认 `100` |

**版本号说明：**

- 可用版本可通过 `devecocli check compat versions` 查看
- `zsh` 环境下版本号需用引号包裹（包含括号），例如 `"<source_version>"`、`"<target_version>"`

**`compat versions` 参数：**

| 参数名 | 说明 |
| --- | --- |
| `--format` | 可选，输出格式。`default` 或 `json`。默认 `default`（文本输出，每行一个版本号） |

**格式与输出组合：**

| 场景 | 允许的 `--format` | 行为 |
| --- | --- | --- |
| 控制台输出（无 `--output-path`） | `default` / `json` | `default` 输出文本表格，`json` 输出 `JSON` |
| 文件输出（`--output-path <file>`，扩展名必须匹配 `--format`） | `default` / `csv` / `json` | `default`/`csv` 写 `.csv` 文件；`json` 写 `.json` 文件 |
| 目录输出（`--output-path <dir>`，无扩展名） | `default` / `csv` / `json` | `default`/`csv` 生成 `apiChange-res{N}.csv`；`json` 生成 `apiChange-res{N}.json` |

**示例：**

```bash
# 工程级扫描，输出到控制台
devecocli check compat --source-version "<source_version>" --target-version "<target_version>"

# 输出 JSON 到控制台
devecocli check compat --format json --source-version "<source_version>" --target-version "<target_version>"

# 输出报告到目录（默认 csv）
devecocli check compat --output-path ./report --source-version "<source_version>" --target-version "<target_version>"

# 输出 JSON 报告到目录（生成 apiChange-res{N}.json）
devecocli check compat --output-path ./report --format json --source-version "<source_version>" --target-version "<target_version>"

# 输出报告到指定文件
devecocli check compat --output-path ./report.json --format json --source-version "<source_version>" --target-version "<target_version>"

# 文件级扫描
devecocli check compat ./entry/src/main/ets/pages/Index.ets --source-version "<source_version>" --target-version "<target_version>"

# 模块级扫描
devecocli check compat --modules entry har1 --source-version "<source_version>" --target-version "<target_version>"
```

## 常见问题

[FAQ](https://gitcode.com/openharmony-sig/deveco-cli/wiki/FAQ.md)

## 开发

```bash
npm install
npm run dev
npm start -- <command>
npm run lint
npm run format
npm run build
```

- 架构与目录说明见 [`AGENTS.md`](./AGENTS.md)
- 如需参与维护，建议先阅读 `AGENTS.md` 中的约定与架构说明

## 许可证

[MIT](./LICENSE)
