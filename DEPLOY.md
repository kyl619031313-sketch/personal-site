# 管理后台服务器部署

公开网站仍在 GitHub Pages：<https://kyl619031313-sketch.github.io/personal-site/>。服务器只运行 admin；保存后推送 main，由现有 Pages 工作流重新发布，通常约 1 分钟。后台页面、路由和字段保持原样。

## 准备

需要有仓库写权限的 GitHub 账号、Linux 服务器（建议 Ubuntu/Debian）、SSH/sudo、Git、Docker Engine 与 Compose v2。镜像为 Node 22 Bookworm slim，仅安装 Git、CA 证书和运行所需的 YAML 包，不需要 gh 或完整 Astro 依赖。

在 GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens 新建令牌：

- Resource owner 选择仓库所属账号。
- Repository access：Only select repositories → `kyl619031313-sketch/personal-site`。
- Repository permissions：Contents: Read and write；Metadata: Read-only 自动授予。
- 设置有效期，记录到期日期并及时轮换。不要提交令牌、密码或把令牌写进远程 URL。

参见 [GitHub 令牌文档](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

## 阿里云 ECS / 轻量应用服务器

1. 选择地域和 Linux 镜像。中国大陆地域用域名在 80/443 提供网站服务需 ICP 备案；香港及海外地域不需要中国大陆 ICP 备案。先确认地域及域名方案，参见 [阿里云备案说明](https://www.alibabacloud.com/help/en/icp-filing/basic-icp-service/product-overview/what-is-an-icp-filing)。
2. SSH 登录，安装 Git、curl 和 Docker。可按 [Docker 官方安装文档](https://docs.docker.com/engine/install/ubuntu/) 配置 apt 源；快速初始化可先下载、检查官方便利脚本再执行：

```sh
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
less /tmp/get-docker.sh
sudo sh /tmp/get-docker.sh
sudo docker compose version
```

也可使用阿里云的 Docker 软件源。大陆访问 Docker Hub 可能很慢，可在阿里云容器镜像服务控制台获取自己的镜像加速地址，在 `/etc/docker/daemon.json` 合并 `registry-mirrors` 配置后重启 Docker（不要覆盖现有配置）：

```json
{ "registry-mirrors": ["https://你的镜像加速地址"] }
```

3. 克隆部署目录并配置（下面命令在服务器执行；本仓库只提供示例文件）：

```sh
git clone https://github.com/kyl619031313-sketch/personal-site.git
cd personal-site
cp .env.example .env
chmod 600 .env
nano .env
sudo docker compose up -d
sudo docker compose logs -f
```

填写 `ADMIN_PASSWORD`、`GITHUB_TOKEN`、`GIT_AUTHOR_NAME`、`GIT_AUTHOR_EMAIL`。姓名和邮箱用于提交身份，可使用 GitHub noreply 邮箱。默认 `HOST=0.0.0.0`、`PORT=8787`、`GIT_REMOTE` 为本仓库 HTTPS 地址。Compose 将配置传入容器；命名卷保存 `/data/site` 的独立 checkout，后台实际编辑该 checkout，而非宿主机部署目录。首次启动 clone main；后续启动只允许干净工作区并 fast-forward 更新，分叉时停止并给出日志。

4. 阿里云安全组 / 轻量服务器防火墙和系统防火墙都需放行所用端口。临时直接访问时放行 TCP 8787（建议限自己的 IP），访问 `http://服务器IP:8787`。正式部署建议仅对外开放 80/443，Compose 的端口改成以下配置（容器 HOST 仍为 0.0.0.0）：

```yaml
ports:
  - '127.0.0.1:8787:8787'
```

## HTTPS 反向代理

将域名 A/AAAA 记录指向服务器，完成所需备案。以下示例使用宿主机上的代理，固定后台端口 8787。设置 `.env` 中 `ADMIN_TRUST_PROXY=1` 并重新执行 `docker compose up -d`；同时确保后台端口仅绑定 localhost。容器中的直连 peer 可能是 Docker 网桥地址，因此显式开启信任。可信代理的 HTTPS 请求自动设置 Secure cookie，本地纯 HTTP 仍能登录。代理必须覆盖转发头，避免客户端伪造。

### Caddy（最简单，自动 HTTPS）

安装 Caddy 后，在 `/etc/caddy/Caddyfile` 配置域名，放行 80/443 并 reload：

```caddyfile
admin.example.com {
    reverse_proxy 127.0.0.1:8787 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-For {remote_host}
    }
}
```

### Nginx

先为域名获取证书（例如用 Certbot），替换下列证书路径，执行 `nginx -t` 后 reload：

```nginx
server {
    listen 80;
    server_name admin.example.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name admin.example.com;
    ssl_certificate /etc/letsencrypt/live/admin.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

## 更新、密码与排错

更新宿主机部署目录（命名卷 checkout 在容器启动时单独更新）：

```sh
git pull && sudo docker compose up -d --build
```

修改密码或轮换令牌：编辑 `.env` 后执行 `sudo docker compose up -d`；后台重启后已有会话失效。不要运行 `docker compose down -v`，它会删除持久化 checkout。

- 推送认证失败：检查令牌是否过期、仓库选择是否正确、Contents 是否 Read and write，以及账号是否有仓库写权限。修正 `.env` 后重建容器；错误中的令牌会被遮盖。
- 端口不通：检查安全组、轻量服务器防火墙、系统防火墙、Compose 映射和代理监听。localhost 绑定的 8787 无法从外网直连。
- 保存冲突：看到“保存失败：线上内容已被其他人更新，且与本次修改冲突。请刷新页面后重新修改并保存。”时，刷新并基于最新内容重新编辑；后台会 abort rebase，撤回本次保存，避免遗留半完成修改。网络/认证失败会显示遮盖敏感信息的 Git 错误。
- 同一 IP 在 15 分钟内输错 5 次密码，会锁定 10 分钟（HTTP 429），等待后再试。
- 查看日志：`sudo docker compose logs -f admin`；启动时发现未提交修改或无法 fast-forward，需由维护者处理卷内仓库后重启，后台不会强推或自动丢弃已有改动。
