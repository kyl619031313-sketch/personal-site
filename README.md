# 个人网站

简体中文 Astro 静态网站，包含首页、服务、关于、联系和博客。个人文案位于 `src/data/zh-CN.json`，博客文章位于 `src/content/blog/**/*.md`。未填写的个人字段和空博客保持留白。

使用 Node >= 22.12。安装依赖后，`npm run dev` 启动公开网站预览，`npm run build` 构建，`npm run test:smoke` 验证构建产物。公开地址使用 `/personal-site/` 基础路径。

## 统一网站管理

管理服务在自己的 Node 进程中运行，不属于公开静态页面。通过终端静默输入密码，密码只保存在当前进程环境中，不要创建密码文件：

```bash
read -r -s -p '管理密码：' ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
npm run admin
unset ADMIN_PASSWORD
```

默认监听 `0.0.0.0:8787`，可通过 `PORT` 修改端口。浏览器访问 `http://localhost:8787/`，输入密码后使用侧边栏：概览 `/`（也支持 `/admin/`）、博客文章 `/posts`、网站内容 `/content` 和设置 `/settings`。网站内容包括首页、服务与流程、案例、常见问题、关于、联系和导航；首页也包含公共联系区块。列表支持添加、删除、上移和下移，操作后需点击保存并发布。空字段保持为空，未知 JSON 字段保留。设置映射到 `site` 的既有字段。文章可以新建、编辑、确认删除。正文支持 Markdown，分组可以留空。编辑保留文件名与公开 URL。服务重启后需要重新登录；会话最多持续十二小时。

运行服务的仓库需处于 `main` 分支，已安装并登录 `gh`，且有向 `origin main` 推送的权限。每次保存或删除后，服务仅提交对应 Markdown 或 `src/data/zh-CN.json` 文件，并使用运行时账户的 noreply 邮箱；不修改 git 配置，不提交其他已暂存文件。随后正常推送；遇到远端更新会先 pull --rebase 再重试，绝不强推。现有工作流负责更新公开网站，通常约 1–2 分钟。设置 `ADMIN_NO_GIT=1` 可仅保存、不执行任何 Git 或推送；`ADMIN_NO_PUSH=1` 可本地提交但跳过推送。发布失败时磁盘变更保留；保存失败提示页可以再次保存重试。删除后的发布失败需由运行服务的维护者处理仓库或网络问题，再发布该删除。

远程运行时，应在 HTTPS 反向代理后部署服务。仅当可信代理覆盖 `X-Forwarded-Proto` 且管理端口不直接暴露时设置 `ADMIN_TRUST_PROXY=1`，服务会根据 HTTPS 请求设置 Secure cookie。本地纯 HTTP 可正常登录。GitHub Pages 只托管公开静态网站，管理服务需在可运行 Node、可写入仓库的独立主机上持续运行。

`npm run test:admin` 使用临时内容副本与模拟发布检查全部后台页面、空字段和未知字段保留、登录、CSRF、路径保护、创建、编辑、删除和发布失败；不会提交或推送，也不在内容目录写入测试文章。
