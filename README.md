# Personal Dashboard

Personal Dashboard 是一个无需安装的个人生活仪表盘。除自动天气、账号同步和音乐搜索播放需要联网外，其他模块都可离线使用。它把天气、当天待办、习惯打卡、重要日期、快捷链接、音乐、项目进度、每日记录和月度回顾放在一个页面中。

## 如何打开

1. 确保 `index.html`、`style.css` 和 `app.js` 位于同一文件夹。
2. 双击 `index.html`，使用现代浏览器（Chrome、Edge、Safari 或 Firefox）打开。
3. 页面主体无需服务器、账号或安装过程；天气模块需要网络连接。

如果双击后天气请求被浏览器的 `file://` 安全策略拦截，可使用 VS Code 的 **Live Server** 扩展打开 `index.html`，或在项目目录运行任意本地静态服务器。例如：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000`。

## 手机与局域网访问

让手机或同一局域网内的其他电脑访问时，在项目目录运行：

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

然后在其他设备浏览器中打开：

```text
http://这台Mac的局域网IP:8000
```

例如本机当前地址为 `http://192.168.171.108:8000`。Mac 与访问设备需要连接同一个 Wi-Fi，Mac 不能关机或休眠，运行服务器的终端也需要保持开启。如果 IP 发生变化，请重新查看 Mac 当前的局域网 IP。

修改项目文件后，其他设备刷新页面即可获取新版本；天气仍会每 30 分钟自动更新。未配置下述云端服务或未登录时，数据只存放在各浏览器自己的 localStorage 中，不同设备之间不会自动同步。

## 公共托管与账号同步

项目已支持 **GitHub Pages + Supabase**。未配置或未登录时仍使用本地模式；登录后，localStorage 继续作为离线缓存，修改会自动上传，页面也会每 30 秒检查其他设备的新数据。

### 1. 创建 Supabase 项目

1. 在 Supabase 创建项目。
2. 打开 **SQL Editor**，执行项目中的 `supabase-schema.sql`。
3. 在 **Settings → API Keys** 获取项目 URL 和 publishable/anon key。
4. 编辑 `cloud-config.js`：

```js
window.DASHBOARD_CLOUD_CONFIG = Object.freeze({
  supabaseUrl: 'https://你的项目.supabase.co',
  supabaseAnonKey: '你的 publishable 或 anon key'
});
```

publishable/anon key 本来就用于浏览器公开使用，数据安全由 `supabase-schema.sql` 中的 RLS 策略保证。**绝对不要把 service_role key 放进网页或 GitHub。**

本项目的邮箱确认已关闭，邮箱注册后可直接登录。账号区还提供手机号、微信和邮箱三种入口：

- **手机号**：网页已实现发送短信验证码和验证码登录流程。正式发送短信前，需在 Supabase **Authentication → Sign In / Providers → Phone** 中配置 Twilio 等短信服务商的账户 SID、令牌和消息服务 SID，再启用 Phone。手机确认应保持开启。
- **微信**：网页已预留微信绑定/登录入口。真正启用需要微信开放平台网站应用的 AppID、AppSecret、已备案回调域名，以及安全的服务端或 Supabase Edge Function 来完成 OAuth 换票；AppSecret 不能放进公开的前端代码。Supabase 没有内置微信服务商，因此当前按钮会明确提示“待配置”。
- **邮箱**：保留邮箱加密码的注册和登录；不再发送确认邮件。

部署完成后，请在 **Authentication → URL Configuration** 中把 GitHub Pages 地址设置为 Site URL，并加入 Redirect URLs。

### 2. 部署 GitHub Pages

1. 在 GitHub 创建一个仓库并上传本项目。
2. 使用 `main` 作为默认分支。
3. 打开仓库 **Settings → Pages**，将 Source 设为 **GitHub Actions**。
4. 推送后，`.github/workflows/pages.yml` 会自动发布网站。

以后每次推送 `main`，GitHub Pages 都会重新部署。首次发布或更新通常需要等待片刻。

### 3. 同步规则

- 同一账号登录不同设备后，修改会在约 1–30 秒内同步。
- 网络中断时继续写入 localStorage，联网后再上传。
- 第一次登录且本机、云端都有数据时，页面会要求选择“使用云端数据”或“上传本机数据”，避免静默覆盖。
- 当前采用整份仪表盘“最后写入优先”，适合个人使用，不适合多人同时编辑同一个账号。

> 注意：不同浏览器、不同浏览器用户配置以及普通/隐私窗口使用各自独立的本地数据。

## 模块使用说明

- **顶部区域**：显示今天的日期、星期和每秒更新的当前时间；每日提示语按日期从预设内容中选择。
- **天气**：输入中文城市名（例如“杭州”“上海”“北京”），点击“保存城市”或按 Enter；也可以直接点击北京、上海、杭州、南京、广州等热门城市。城市搜索使用 Open-Meteo 中文结果，再通过 Forecast API 获取当前天气。点击“刷新天气”可立即更新；页面打开时会后台更新，并每 30 分钟自动刷新一次。
- **备份与恢复**：`Export Data` 会下载一份包含所有 Personal Dashboard 数据的 JSON 文件；`Import Data` 可选择该文件恢复。导入前会检查备份版本和各模块的数据结构，成功后页面自动刷新。
- **今日待办**：输入内容后添加。勾选可标记完成，`×` 可删除单条，右上角可清空所有已完成项。
- **习惯追踪**：点击复选框完成今天的打卡；每项同时显示本周（周一至周日）累计次数。可添加或删除习惯。打卡按具体日期保存，第二天会显示新的当日状态。
- **重要日期**：填写事件名称、日期和可选备注。页面自动计算“还有 X 天”“就是今天”或“已过去 X 天”。
- **快捷链接**：填写名称和 URL 后添加。没有输入 `http://` 或 `https://` 时会自动补上 `https://`。点击卡片会在新标签页打开。
- **音乐点播**：音乐卡片位于天气右侧。输入歌曲名或歌手后搜索，点击结果即可使用页面内置播放器播放，不会跳转外部平台。搜索使用无需 API Key 的 iTunes Search API，播放内容是曲库提供的合法试听片段；受版权和地区限制，部分歌曲可能没有试听资源。
- **项目进度**：点击“新建项目”，填写名称、阶段、截止日期、进度和备注。卡片上的铅笔按钮用于编辑，`×` 用于删除。未完成且 3 天内截止的项目会显示黄色提醒样式。
- **每日记录**：默认打开今天。输入后约半秒自动保存；通过日期选择器可以查看和编辑过去某天的记录。
- **今日总结**：自动汇总今日待办、习惯、临近截止项目和 Daily Note 情况，并给出一句轻量评价。
- **月度回顾**：统计本月每个习惯的完成次数、写过 Daily Note 的天数和已完成 To-Do 数量。习惯进度条以本月已过去的天数为基准。

## 数据保存在哪里

所有数据都会先保存在当前浏览器的 `localStorage` 中。未登录时不会上传；登录云端账号后，仪表盘数据会同步到已配置的 Supabase 项目。刷新页面或关闭浏览器后本地缓存仍会保留，但清理浏览器网站数据、切换浏览器或使用隐私模式可能导致本地缓存不可见或被清除。

大部分数据键以 `personalDashboard.` 开头。天气模块使用以下独立键：

- `dashboardWeatherLocation`：保存城市、国家、经纬度和时区。
- `dashboardWeatherData`：保存最近一次完整天气数据。
- `dashboardWeatherUpdatedAt`：保存最近更新时间。

天气模块使用 [Open-Meteo](https://open-meteo.com/) 的 Geocoding API 和 Forecast API，不需要 API Key。城市和天气缓存只保存在浏览器 localStorage；断网或请求失败时会优先展示上一次缓存。

建议偶尔使用页面顶部的 `Export Data` 下载备份。天气城市和缓存也会包含在备份中；恢复操作只会写入本工具已知的数据键，不会覆盖其他网页的数据。

### 天气无法显示时

常见原因包括网络不可用、城市名无法识别、Open-Meteo 暂时不可用，或浏览器限制 `file://` 页面请求网络。请先确认城市拼写并点击“刷新天气”；仍失败时使用 VS Code Live Server 或本地静态服务器运行。

## 如何清空数据

如需只清空本仪表盘数据：

1. 打开页面后进入浏览器开发者工具。
2. 找到 **Application（应用）** 或 **Storage（存储）** → **Local Storage**。
3. 选择当前页面来源，删除所有以 `personalDashboard.` 或 `dashboardWeather` 开头的键。
4. 刷新页面。默认习惯和默认快捷链接会重新生成。

也可以在开发者工具 Console（控制台）运行下面的代码，只删除本工具的数据：

```js
Object.keys(localStorage)
  .filter(key => key.startsWith('personalDashboard.') || key.startsWith('dashboardWeather'))
  .forEach(key => localStorage.removeItem(key));
location.reload();
```

## 后续可扩展方向

- 天气预报、定位与多城市收藏
- 完成短信服务商配置和微信开放平台 OAuth 回调
- 主题颜色和卡片顺序自定义
- 待办优先级、分类和拖拽排序
- 习惯连续打卡天数与月历热力图
- 项目子任务和里程碑
- 更丰富的每周/每月趋势统计
- 可选的浏览器通知提醒
- PWA 离线安装与多设备同步（同步功能需要额外服务）

## 文件结构

```text
Personal Dashboard/
├── .github/workflows/pages.yml # GitHub Pages 自动部署
├── index.html   # 页面结构
├── style.css    # 深色主题、卡片布局与响应式样式
├── app.js       # 交互逻辑、日期计算和本地数据存储
├── cloud-config.js # Supabase 公共连接配置
├── cloud-sync.js   # 登录、离线缓存和云端同步
├── supabase-schema.sql # 数据表与 RLS 安全策略
└── README.md    # 使用说明
```
