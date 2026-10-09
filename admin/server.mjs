import { style, editor, bar, card } from './views.mjs';
import { client } from './client.mjs';
import { sections, groupedFields, update, validFields } from './content.mjs';
import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  readFile,
  readdir,
  writeFile,
  unlink,
  lstat,
  mkdir,
  realpath,
} from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
// Use Astro's existing YAML parser; no additional npm dependency.
const require = createRequire(import.meta.url);
const YAML = createRequire(require.resolve('astro/package.json'))('yaml');
const run = promisify(execFile);
const root = resolve(new URL('../', import.meta.url).pathname);
const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
const token = () => randomBytes(32).toString('hex');
const equal = (a, b) =>
  timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest()
  );
function page(content) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>网站管理</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Noto+Sans+SC:wght@400;500;600&amp;display=swap"><style>${style}</style><main>${content}</main><script>(${client.toString()})()</script></html>`;
}
const hidden = csrf => `<input type="hidden" name="csrf" value="${csrf}">`;
export async function publish(file, action, cwd = root, execute = run) {
  if (process.env.ADMIN_NO_GIT === '1') return;
  const pathspec = `:(literal)${file}`;
  const git = (...args) =>
    execute('git', args, { cwd, timeout: 60000, maxBuffer: 1024 * 1024 });
  const { stdout: branch } = await git('branch', '--show-current');
  if (branch.trim() !== 'main') throw new Error('请在 main 分支启动管理服务。');
  const { stdout: login } = await execute(
    'gh',
    ['api', 'user', '--jq', '.login'],
    { cwd, timeout: 15000 }
  );
  const name = login.trim();
  if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error('无法确认发布身份。');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_COMMITTER_NAME: name,
    GIT_AUTHOR_EMAIL: `${name}@users.noreply.github.com`,
    GIT_COMMITTER_EMAIL: `${name}@users.noreply.github.com`,
  };
  const { stdout: diff } = await git('diff', 'HEAD', '--', pathspec);
  if (diff || (await git('ls-files', '--', pathspec)).stdout.trim() === '') {
    await execute('git', ['add', '--', pathspec], { cwd, env, timeout: 15000 });
    await execute(
      'git',
      ['commit', '--only', '-m', `${action} site content`, '--', pathspec],
      { cwd, env, timeout: 60000, maxBuffer: 1024 * 1024 }
    );
  }
  if (process.env.ADMIN_NO_PUSH === '1') return;
  try {
    await git(
      '-c',
      'credential.helper=!gh auth git-credential',
      'push',
      'origin',
      'main'
    );
  } catch (error) {
    if (!/non-fast-forward|fetch first|rejected/.test(error.stderr || ''))
      throw error;
    await git('pull', '--rebase', 'origin', 'main');
    await git(
      '-c',
      'credential.helper=!gh auth git-credential',
      'push',
      'origin',
      'main'
    );
  }
}
export function createAdmin({
  password,
  directory = resolve(root, 'src/content/blog'),
  publisher = publish,
  contentFile = resolve(root, 'src/data/zh-CN.json'),
  repository = root,
} = {}) {
  if (!password) throw new Error('缺少 ADMIN_PASSWORD，管理服务未启动。');
  const sessions = new Map();
  const attempts = new Map();
  let queue = Promise.resolve();
  const safeFile = async file => {
    if (
      !file ||
      !file.endsWith('.md') ||
      file.includes('\\') ||
      file.split('/').some(p => !p || p === '.' || p === '..')
    )
      throw new Error('文章文件名无效。');
    const path = resolve(directory, file);
    if (!path.startsWith(resolve(directory) + sep))
      throw new Error('文章路径无效。');
    let current = resolve(directory);
    if (
      (await realpath(current)) !== current ||
      (await lstat(current)).isSymbolicLink()
    )
      throw new Error('文章目录不能是符号链接。');
    for (const part of file.split('/')) {
      current = resolve(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error('文章路径不能是符号链接。');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    return path;
  };
  const readPost = async file => {
    const source = await readFile(await safeFile(file), 'utf8');
    const match = source.match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/
    );
    if (!match) throw new Error('文章格式无法读取。');
    const data = YAML.parse(match[1]);
    return {
      ...data,
      date: String(data.date).slice(0, 10),
      group: data.group ?? '',
      body: match[2],
      file,
    };
  };
  const list = async (folder = '') => {
    const posts = [];
    for (const entry of await readdir(resolve(directory, folder), {
      withFileTypes: true,
    })) {
      const file = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) posts.push(...(await list(file)));
      else if (entry.isFile() && file.endsWith('.md'))
        posts.push(await readPost(file));
    }
    return posts.sort(
      (a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file)
    );
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    const send = (html, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      const links = [
        ['/', '概览'],
        ['/posts', '博客文章'],
        ['/content', '网站内容'],
        ['/settings', '设置'],
      ];
      const sidebar = `<aside class="sidebar" aria-label="后台导航"><h2>网站管理</h2>${links.map(([href, label]) => `<a href="${href}" ${(href === '/content' ? req.url.startsWith('/content') : href === '/posts' ? /^\/(posts|new|edit|delete)/.test(req.url) : req.url.split('?')[0] === href) ? 'aria-current="page"' : ''}>${label}</a>`).join('')}<form method="post" action="/logout">${hidden(session?.csrf || '')}<button class="secondary">退出登录</button></form></aside>`;
      res.end(
        page(
          session?.authenticated
            ? `${sidebar}<div class="workspace"><div class="workspace-inner">${session.notice ? `<p class="notice" role="status">${escape(session.notice)}</p>` : ''}${html}</div></div>`
            : html
        )
      );
      if (session) session.notice = '';
    };
    const redirect = path => {
      res.writeHead(303, { Location: path });
      res.end();
    };
    const secure =
      Boolean(req.socket.encrypted) ||
      (process.env.ADMIN_TRUST_PROXY === '1' &&
        req.headers['x-forwarded-proto'] === 'https');
    const cookie = (value, maxAge) =>
      res.setHeader(
        'Set-Cookie',
        `admin_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
      );
    for (const [key, value] of sessions)
      if (value.expires < Date.now()) sessions.delete(key);
    for (const [key, value] of attempts)
      if (value.until < Date.now()) attempts.delete(key);
    const id = (req.headers.cookie || '').match(
      /(?:^|;\s*)admin_session=([a-f0-9]{64})(?:;|$)/
    )?.[1];
    let session = sessions.get(id);
    if (session && session.expires < Date.now()) {
      sessions.delete(id);
      session = undefined;
    }
    let form;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST') {
        if (
          req.headers.origin &&
          req.headers.origin !==
            `${secure ? 'https' : 'http'}://${req.headers.host}`
        )
          return send('请求来源无效。', 403);
        if (
          !(req.headers['content-type'] || '').startsWith(
            'application/x-www-form-urlencoded'
          )
        )
          return send('请求格式无效。', 415);
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024 * 1024)
            return send('文章内容过长。', 413);
        }
        form = new URLSearchParams(body);
      }
      if (!session) {
        if (sessions.size >= 10000) return send('服务繁忙，请稍后重试。', 503);
        const guest = token();
        sessions.set(guest, {
          csrf: token(),
          expires: Date.now() + 3600000,
          authenticated: false,
        });
        session = sessions.get(guest);
        cookie(guest, 3600);
      }
      const login = async message => {
        let name = '网站管理';
        try {
          name =
            JSON.parse(
              await readFile(contentFile, 'utf8')
            ).site?.name?.trim() || name;
        } catch {}
        return send(
          `<div class="login card"><h1>${escape(name)}</h1><p class="muted">登录后管理网站内容与博客文章。</p>${message ? '<p role="alert">密码不正确，请重试。</p>' : ''}<form method="post" action="/login">${hidden(session.csrf)}<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="请输入管理密码" required><div class="actions"><button>登录</button></div></form></div>`,
          message ? 401 : 200
        );
      };
      if (req.method === 'POST' && !equal(form.get('csrf') || '', session.csrf))
        return send('请求已失效，请刷新页面后重试。', 403);
      if (!session.authenticated) {
        if (req.method === 'POST' && url.pathname === '/login') {
          const address = req.socket.remoteAddress || 'local';
          const attempt = attempts.get(address) || {
            count: 0,
            until: Date.now() + 15 * 60000,
          };
          if (attempt.count >= 20)
            return send('登录尝试过多，请十五分钟后再试。', 429);
          if (!equal(form.get('password') || '', password)) {
            attempt.count++;
            attempts.set(address, attempt);
            return login(true);
          }
          attempts.delete(address);
          sessions.delete(id);
          const next = token();
          sessions.set(next, {
            csrf: token(),
            expires: Date.now() + 12 * 3600000,
            authenticated: true,
          });
          cookie(next, 43200);
          return redirect('/');
        }
        return login(false);
      }
      if (req.method === 'POST' && url.pathname === '/logout') {
        sessions.delete(id);
        cookie('', 0);
        return redirect('/');
      }
      const content = async () =>
        JSON.parse(await readFile(contentFile, 'utf8'));
      const renderContent = (key, data, drafted = false) =>
        `${bar(sections[key].label, ['services', 'about', 'contact'].includes(key) ? key + '/' : '', 'content-form')}<form id="content-form" data-editor ${drafted ? 'data-draft' : ''} method="post" action="${key === 'settings' ? '/settings' : '/content/' + key}">${hidden(session.csrf)}${groupedFields(key, data)}</form>`;
      if (req.method === 'GET' && ['/', '/admin/'].includes(url.pathname)) {
        const posts = await list();
        let latest = posts[0]?.date || '暂无发布记录';
        try {
          const { stdout } = await run(
            'git',
            [
              'log',
              '-1',
              '--format=%cI %s',
              '--',
              'src/data/zh-CN.json',
              'src/content/blog',
            ],
            { cwd: repository, timeout: 5000 }
          );
          if (stdout.trim()) latest = stdout.trim();
        } catch {}
        return send(
          `${bar('概览')}<div class="stats">${card('文章数量', '已保存的博客文章', `<p class="stat-value">${posts.length}</p>`)}${card('最近发布', '最近一次内容更新记录', `<p class="stat-value small">${escape(latest)}</p>`)}${card('线上网站', '打开已发布的公开网站', '<p><a href="https://kyl619031313-sketch.github.io/personal-site/" target="_blank" rel="noopener">查看网站 ↗</a></p>')}</div>${card(
            '快速编辑',
            '选择需要更新的内容。',
            `<div class="quick-links"><a class="quick-link" href="/posts">博客文章 ↗</a>${Object.entries(
              sections
            )
              .map(
                ([k, v]) =>
                  `<a class="quick-link" href="${k === 'settings' ? '/settings' : '/content/' + k}">${v.label} ↗</a>`
              )
              .join('')}</div>`
          )}`
        );
      }
      if (req.method === 'GET' && url.pathname === '/content')
        return send(
          `${bar('网站内容')}${card(
            '内容区块',
            '选择页面，编辑文字与列表。',
            `<div class="quick-links">${Object.entries(sections)
              .filter(([k]) => k !== 'settings')
              .map(
                ([k, v]) =>
                  `<a class="quick-link" href="/content/${k}">${v.label} ↗</a>`
              )
              .join('')}</div>`
          )}`
        );
      const sectionKey =
        url.pathname === '/settings'
          ? 'settings'
          : url.pathname.startsWith('/content/')
            ? url.pathname.slice(9)
            : '';
      if (
        sections[sectionKey] &&
        (sectionKey === 'settings' ? url.pathname === '/settings' : true)
      ) {
        if (req.method === 'GET') {
          if (session.drafts) delete session.drafts[sectionKey];
          return send(renderContent(sectionKey, await content()));
        }
        if (req.method === 'POST') {
          const task = async () => {
            const data = session.drafts?.[sectionKey] || (await content());
            const schema = sections[sectionKey].schema;
            const allowed = validFields(schema, data);
            for (const key of form.keys())
              if (!['csrf', 'operation'].includes(key) && !allowed.has(key))
                throw Error('无效的内容字段。');
            if (form.has('operation')) {
              const [action, path, index] = form.get('operation').split(':');
              if (
                !['add', 'remove', 'up', 'down'].includes(action) ||
                !allowed.has('list:' + path) ||
                (action !== 'add' && !/^\d+$/.test(index ?? ''))
              )
                throw Error('无效的列表操作。');
            }
            const next = update(schema, data, form);
            if (form.has('operation')) {
              session.drafts ??= {};
              session.drafts[sectionKey] = next;
              return send(renderContent(sectionKey, next, true));
            }
            await writeFile(contentFile, JSON.stringify(next, null, 2) + '\n');
            if (session.drafts) delete session.drafts[sectionKey];
            try {
              await publisher(
                relative(repository, contentFile),
                'Update',
                repository
              );
            } catch (error) {
              return send(
                `<h1>发布失败</h1><p class="notice" role="alert">已保存到磁盘，但发布失败：${escape(error.message)} ${escape(error.stderr || '')}</p>`,
                502
              );
            }
            session.notice =
              process.env.ADMIN_NO_GIT === '1'
                ? '已保存（发布已禁用）'
                : process.env.ADMIN_NO_PUSH === '1'
                  ? '已保存并提交（推送已禁用）'
                  : '已保存，正在发布，约 1 分钟后线上更新';
            return redirect(url.pathname);
          };
          const pending = queue.then(task);
          queue = pending.catch(() => {});
          await pending;
          return;
        }
      }
      if (req.method === 'GET' && url.pathname === '/posts') {
        const posts = await list();
        return send(
          `${bar('博客文章', 'blog/')}<p><a class="button" href="/new">＋ 新建文章</a></p>${posts.length ? card('文章列表', '管理文章内容、发布日期与分组。', `<div class="table-wrap"><table><thead><tr><th>标题</th><th>发布日期</th><th>分组</th><th>操作</th></tr></thead><tbody>${posts.map(p => `<tr><td><a href="/edit?file=${encodeURIComponent(p.file)}">${escape(p.title)}</a></td><td>${escape(p.date)}</td><td>${p.group ? `<span class="pill">${escape(p.group)}</span>` : '<span class="muted">未分组</span>'}</td><td><a href="/edit?file=${encodeURIComponent(p.file)}">编辑</a><a href="/delete?file=${encodeURIComponent(p.file)}">删除</a></td></tr>`).join('')}</tbody></table></div>`) : card('开始写作', '发布第一篇文章，与读者分享你的想法。', '<div class="empty"><h2>暂无文章</h2><p>从一个标题开始，记录值得分享的内容。</p><a class="button" href="/new">新建第一篇文章</a></div>')}`
        );
      }
      if (req.method === 'GET' && url.pathname === '/delete') {
        const post = await readPost(url.searchParams.get('file'));
        return send(
          `${bar('删除文章', 'blog/')}<form method="post" action="/delete">${hidden(session.csrf)}<input type="hidden" name="file" value="${escape(post.file)}">${card('确认删除', '删除后将自动发布，请确认文章标题。', `<p>确定删除「${escape(post.title)}」？</p><button>确认删除</button> <a href="/posts">取消</a>`)}</form>`
        );
      }
      if (req.method === 'GET' && url.pathname === '/new')
        return send(
          editor(
            { date: new Date().toISOString().slice(0, 10) },
            session.csrf,
            '',
            (await list()).map(p => p.group)
          )
        );
      if (req.method === 'GET' && url.pathname === '/edit')
        return send(
          editor(
            await readPost(url.searchParams.get('file')),
            session.csrf,
            '',
            (await list()).map(p => p.group)
          )
        );
      if (
        req.method === 'POST' &&
        ['/save', '/delete'].includes(url.pathname)
      ) {
        const task = async () => {
          let file = form.get('file');
          let post;
          if (url.pathname === '/save') {
            post = Object.fromEntries(
              ['title', 'summary', 'date', 'group', 'body'].map(k => [
                k,
                (form.get(k) || '').trim(),
              ])
            );
            if (
              !post.title ||
              !post.summary ||
              !post.body ||
              !/^\d{4}-\d{2}-\d{2}$/.test(post.date) ||
              !Number.isFinite(Date.parse(post.date)) ||
              new Date(post.date).toISOString().slice(0, 10) !== post.date
            )
              return send(
                editor(
                  { ...post, file },
                  session.csrf,
                  '请填写标题、摘要、正文和有效的发布日期。',
                  (await list()).map(p => p.group)
                ),
                400
              );
            if (file) await readPost(file);
            else {
              const slug =
                post.title
                  .normalize('NFKC')
                  .toLowerCase()
                  .replace(/[^\p{L}\p{N}]+/gu, '-')
                  .replace(/^-|-$/g, '')
                  .slice(0, 60) || 'post';
              file = `${post.date}-${slug}-${randomBytes(4).toString('hex')}.md`;
            }
            const path = await safeFile(file);
            const frontmatter = ['title', 'summary', 'date', 'group']
              .map(k => `${k}: ${JSON.stringify(post[k])}`)
              .join('\n');
            await writeFile(
              path,
              `---\n${frontmatter}\n---\n\n${post.body}\n`,
              { flag: form.get('file') ? 'w' : 'wx' }
            );
          } else await unlink(await safeFile(file));
          try {
            await publisher(
              relative(repository, resolve(directory, file)),
              url.pathname === '/save' ? 'Update' : 'Delete',
              repository
            );
          } catch (error) {
            return send(
              url.pathname === '/save'
                ? editor(
                    { ...post, file },
                    session.csrf,
                    `文章已保存到磁盘，但发布失败：${error.message} ${error.stderr || ''}`,
                    (await list()).map(p => p.group)
                  )
                : `<h1>发布失败</h1><p class="notice error" role="alert">文章已从磁盘删除，但发布失败：${escape(error.message)} ${escape(error.stderr || '')}</p><a href="/posts">返回文章列表</a>`,
              502
            );
          }
          session.notice =
            process.env.ADMIN_NO_GIT === '1'
              ? '已保存（发布已禁用）'
              : process.env.ADMIN_NO_PUSH === '1'
                ? '已保存并提交（推送已禁用）'
                : '已保存，正在发布，约 1 分钟后线上更新';
          return redirect('/posts');
        };
        const pending = queue.then(task);
        queue = pending.catch(() => {});
        await pending;
        return;
      }
      send('页面不存在。', 404);
    } catch (error) {
      send(
        '<h1>操作未完成</h1><p class="notice error" role="alert">无法读取或保存文章，请检查文件名、文章格式及目录权限。</p><a href="/posts">返回文章列表</a>',
        400
      );
    }
  });
  server.on('close', () => {
    sessions.clear();
    attempts.clear();
  });
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  if (!process.env.ADMIN_PASSWORD) {
    console.error('缺少 ADMIN_PASSWORD，管理服务未启动。');
    process.exitCode = 1;
  } else {
    await mkdir(resolve(root, 'src/content/blog'), { recursive: true });
    const server = createAdmin({ password: process.env.ADMIN_PASSWORD });
    server.listen(Number(process.env.PORT || 8787), '0.0.0.0', () =>
      console.log('网站管理服务已启动。')
    );
  }
}
