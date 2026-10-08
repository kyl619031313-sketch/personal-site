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
const style = `*{box-sizing:border-box}body{margin:0;background:#F7F6F3;color:#20221f;font-family:Inter,"Noto Sans SC",sans-serif;line-height:1.7}main{max-width:900px;margin:64px auto;padding:0 24px}header,.actions{display:flex;align-items:center;justify-content:space-between;gap:16px}h1{font-size:32px;font-weight:500}a{color:inherit}button,.button{font:inherit;border:1px solid #373936;background:#373936;color:#fff;padding:10px 20px;border-radius:4px;cursor:pointer;text-decoration:none}label{display:block;margin:22px 0 6px}input,textarea{width:100%;font:inherit;border:1px solid #ccc;background:#fff;padding:12px;border-radius:4px}textarea{resize:vertical}article{padding:24px 0;border-bottom:1px solid #ddd}small,.muted{color:#666}.notice{padding:16px;border:1px solid #bbb;white-space:pre-wrap}.login{max-width:440px}.actions{justify-content:flex-start;margin-top:24px}.danger{background:transparent;color:#373936}form.inline{display:inline}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #373936;outline-offset:3px}@media(max-width:600px){main{margin:32px auto}header{flex-wrap:wrap}}`;
function page(content) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>博客管理</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Noto+Sans+SC:wght@400;500;600&amp;display=swap"><style>${style}</style><main>${content}</main></html>`;
}
const hidden = csrf => `<input type="hidden" name="csrf" value="${csrf}">`;
function editor(post, csrf, message = '') {
  return `<header><h1>${post.file ? '编辑文章' : '新建文章'}</h1><a href="/">返回文章列表</a></header>${message ? `<p class="notice" role="alert">${escape(message)}</p>` : ''}<form method="post" action="/save">${hidden(csrf)}<input type="hidden" name="file" value="${escape(post.file)}">${[
    ['title', '标题'],
    ['summary', '摘要'],
    ['date', '发布日期'],
    ['group', '分组'],
  ]
    .map(
      ([name, label]) =>
        `<label for="${name}">${label}</label><input id="${name}" name="${name}" ${name === 'date' ? 'type="date"' : ''} ${name !== 'group' ? 'required' : ''} value="${escape(post[name])}">`
    )
    .join(
      ''
    )}<label for="body">正文</label><textarea id="body" name="body" rows="20" required>${escape(post.body)}</textarea><p class="muted">正文支持 Markdown。分组可留空。保存后自动发布，公开网站更新需要稍等片刻。</p><div class="actions"><button>保存并发布</button><a href="/">取消</a></div></form>`;
}
export async function publish(file, action, cwd = root, execute = run) {
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
      ['commit', '--only', '-m', `${action} blog post`, '--', pathspec],
      { cwd, env, timeout: 60000, maxBuffer: 1024 * 1024 }
    );
  }
  await git(
    '-c',
    'credential.helper=!gh auth git-credential',
    'push',
    'origin',
    'main'
  );
}
export function createAdmin({
  password,
  directory = resolve(root, 'src/content/blog'),
  publisher = publish,
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
      res.end(page(html));
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
      const login = message =>
        send(
          `<div class="login"><h1>博客管理</h1><p class="muted">登录后撰写和管理文章。</p>${message ? '<p role="alert">密码不正确，请重试。</p>' : ''}<form method="post" action="/login">${hidden(session.csrf)}<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><div class="actions"><button>登录</button></div></form></div>`,
          message ? 401 : 200
        );
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
      if (req.method === 'GET' && url.pathname === '/') {
        const posts = await list();
        return send(
          `<header><h1>文章</h1><form method="post" action="/logout">${hidden(session.csrf)}<button class="danger">退出登录</button></form></header>${url.searchParams.has('published') ? '<p class="notice" role="status">已提交发布，公开网站稍后更新。</p>' : ''}<a class="button" href="/new">新建文章</a>${posts.length ? posts.map(p => `<article><small>${escape(p.date)}${p.group ? ` · ${escape(p.group)}` : ''}</small><h2><a href="/edit?file=${encodeURIComponent(p.file)}">${escape(p.title)}</a></h2><p>${escape(p.summary)}</p><form method="post" action="/delete" onsubmit="return confirm('确定删除这篇文章？删除后将自动发布。')">${hidden(session.csrf)}<input type="hidden" name="file" value="${escape(p.file)}"><button class="danger">删除文章</button></form></article>`).join('') : '<p class="muted">暂无文章。</p>'}`
        );
      }
      if (req.method === 'GET' && url.pathname === '/new')
        return send(
          editor({ date: new Date().toISOString().slice(0, 10) }, session.csrf)
        );
      if (req.method === 'GET' && url.pathname === '/edit')
        return send(
          editor(await readPost(url.searchParams.get('file')), session.csrf)
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
                  '请填写标题、摘要、正文和有效的发布日期。'
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
              relative(root, resolve(directory, file)),
              url.pathname === '/save' ? 'Update' : 'Delete'
            );
          } catch {
            return send(
              url.pathname === '/save'
                ? editor(
                    { ...post, file },
                    session.csrf,
                    '文章已保存到磁盘，但发布失败。请检查服务的登录、网络和仓库状态，再次保存可重试发布。'
                  )
                : '<h1>发布失败</h1><p role="alert">文章已从磁盘删除，但发布失败。请检查服务的登录、网络和仓库状态。</p><a href="/">返回文章列表</a>',
              502
            );
          }
          return redirect('/?published=1');
        };
        const pending = queue.then(task);
        queue = pending.catch(() => {});
        await pending;
        return;
      }
      send('页面不存在。', 404);
    } catch {
      send(
        '<h1>操作未完成</h1><p role="alert">无法读取或保存文章，请检查文件名、文章格式及目录权限。</p><a href="/">返回文章列表</a>',
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
      console.log('博客管理服务已启动。')
    );
  }
}
