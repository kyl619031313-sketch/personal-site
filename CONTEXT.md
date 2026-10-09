# 网站上下文

姓名占位为陈某。面向俄罗斯市场的海外社媒运营与跨境增长服务。案例为虚构示例数据，联系方式尚待替换。

统一中文后台通过 `ADMIN_PASSWORD` 环境变量及 `npm run admin` 启动（0.0.0.0，PORT 或 8787），管理现有 JSON 文案、列表、站点设置与 Markdown 博客。路径为 `/`、`/posts`、`/content`、`/content/{home,services,cases,faq,about,contact,nav}`、`/settings`。保存仅提交变更文件并正常推送 origin main；测试或本地编辑用 `ADMIN_NO_GIT=1`，仅跳过推送用 `ADMIN_NO_PUSH=1`。不保存密码，空字段保持为空。
