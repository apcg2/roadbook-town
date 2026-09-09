# 发布用户的行程

先向用户展示已验收的HTML，并取得公开分享确认。私有草稿、来源与Key永不上传。

1. 注册Cloudflare账号并通过Wrangler登录；可安装 `wrangler@4.92.0` 作为已验证起点，升级后重新验证。
2. 使用 `wrangler pages project create 用户项目名 --production-branch main` 创建项目。用户自己选择名称，不复用他人的项目。
3. 读取render生成的report.json中的htmlHash，在用户确认后执行：

```bash
node src/cli.mjs deploy private/trip.json --project 用户项目名 --html-sha 已确认文件哈希 --user-confirmed
```

命令重新渲染并核对哈希，只把index.html复制到独立临时目录，调用Wrangler上传，最后核验生产URL。可通过WRANGLER_BIN指定现有安装位置。不把账号令牌写入网页。

如果上传成功但联网验证超时，工具会明确报告，不能宣称“未发布”或反复创建项目。先检查Cloudflare部署状态。正式域名一般为项目名.pages.dev，特殊情况以控制台为准。

网页公开可访问；浏览器清单数据不上传。使用同一域名和tripId保留清单，本地file地址与公网不会自动迁移。

需要网络首次加载公网页面；下载的单HTML断网可读，天气会显示不可用。未实现PWA或保证浏览器缓存离线访问。

官方说明：https://developers.cloudflare.com/pages/get-started/direct-upload/

## 发布工具仓库

这是另一项操作，不能与发布用户HTML混淆。先确认LICENSE分发授权及GitHub站内Fork边界，执行audit、测试和个人信息审查，再把白名单文件提交到新的干净仓库。当前开发目录不会自动push或创建公开仓库。
