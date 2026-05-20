# AI Image Web Studio

AI Image Web Studio 是一个适合 3-5 人小团队使用的私有 AI 图片生成工作台。

## 功能

- 支持 `gpt-image-2` 和 `Nano Banana 2`
- 支持文字生成图片、参考图修图和生成图继续编辑
- 生成记录保存到 PostgreSQL
- 图片、参考图、缩略图和备份包保存到服务器本地目录
- 支持图片查看、下载、标签、收藏、批量操作和记录详情页
- 支持数据备份、恢复、校验和自动备份
- 支持多 Key 轮询、Key 健康统计、系统健康检查、存储维护和审计日志

## 安装前准备

需要提前准备：

- 已安装并可连接的 PostgreSQL
- Provider Base URL 和 API Key
- 一个初始管理员账号和密码

## 数据目录

应用图片数据保存在应用目录下的 `./storage`，容器内路径为 `/app/storage`。

## 访问

安装后访问安装表单中填写的 Web 端口，默认 `3100`。

## 更新

项目会在 GitHub Release 中发布 1Panel 本地应用包。设置页提供“版本更新”检查入口，可查看最新 Release 和下载附件。
