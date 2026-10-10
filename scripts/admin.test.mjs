import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  createAdmin,
  publish,
  formatChineseTime,
  describeChanges,
  latestPublication,
} from '../admin/server.mjs';

test('publication time uses Chinese labels and Shanghai calendar days', () => {
  const now = new Date('2026-10-09T02:30:00Z');
  assert.equal(formatChineseTime('2026-10-09T02:12:00Z', now), '18 分钟前');
  assert.equal(formatChineseTime('2026-10-09T01:30:00Z', now), '今天 09:30');
  assert.equal(formatChineseTime('2026-10-08T15:59:00Z', now), '昨天 23:59');
  assert.equal(formatChineseTime('2026-10-07T16:00:00Z', now), '昨天 00:00');
  assert.equal(
    formatChineseTime('2026-10-07T15:59:00Z', now),
    '2026-10-07 23:59'
  );
  assert.equal(formatChineseTime('invalid', now), '暂无发布记录');
});

test('publication describes changed files and tolerates missing Git or articles', async () => {
  const read = async () => '---\ntitle: "中文标题"\n---\n正文';
  const blog = status => [{ status, file: 'src/content/blog/example.md' }];
  assert.equal(
    await describeChanges(blog('A'), read),
    '发布了文章《中文标题》'
  );
  assert.equal(
    await describeChanges(blog('M'), read),
    '更新了文章《中文标题》'
  );
  assert.equal(await describeChanges(blog('D'), read), '删除了文章');
  assert.equal(
    await describeChanges(blog('A'), async () => {
      throw Error('missing');
    }),
    '发布了文章《example》'
  );
  assert.equal(
    await describeChanges(
      [{ status: 'M', file: 'src/data/zh-CN.json' }, ...blog('A')],
      read
    ),
    '更新了网站内容；发布了文章《中文标题》'
  );
  assert.equal(
    await describeChanges([{ status: 'M', file: 'other' }]),
    '网站更新'
  );
  const now = new Date('2026-10-09T02:30:00Z');
  assert.equal(
    await latestPublication(
      '/tmp',
      undefined,
      async () => ({
        stdout: '2026-10-09T10:12:00+08:00\0\nM\0src/data/zh-CN.json\0',
      }),
      now
    ),
    '18 分钟前 · 更新了网站内容'
  );
  const unavailable = async () => {
    throw Error('Git unavailable');
  };
  assert.equal(
    await latestPublication('/tmp', undefined, unavailable, now),
    '暂无发布记录'
  );
  assert.equal(
    await latestPublication('/tmp', '2026-10-08', unavailable, now),
    '昨天 08:00 · 网站更新'
  );
});

test('requires a runtime password', () =>
  assert.throws(() => createAdmin(), /ADMIN_PASSWORD/));
test('authenticated CRUD, CSRF, stable filename and failed publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blog-admin-'));
  const contentFile = join(directory, 'zh-CN.json');
  const original = JSON.parse(await readFile('src/data/zh-CN.json', 'utf8'));
  original.unknown = { keep: 'preserved' };
  await writeFile(contentFile, JSON.stringify(original));
  const calls = [];
  let fail = false;
  const password = randomUUID();
  const app = createAdmin({
    password,
    directory,
    contentFile,
    publisher: async (...args) => {
      calls.push(args);
      if (fail) throw Error('发布网络不可用');
    },
  });
  let cookie = '';
  let csrf = '';
  async function request(path, fields) {
    const headers = new Map();
    const result = await new Promise(resolve => {
      const req = Readable.from(
        fields ? [new URLSearchParams(fields).toString()] : []
      );
      Object.assign(req, {
        method: fields ? 'POST' : 'GET',
        url: path,
        socket: { encrypted: false },
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(fields
            ? { 'content-type': 'application/x-www-form-urlencoded' }
            : {}),
        },
      });
      const res = {
        setHeader: (k, v) => headers.set(k.toLowerCase(), v),
        writeHead: (status, values = {}) => {
          res.status = status;
          for (const [k, v] of Object.entries(values))
            headers.set(k.toLowerCase(), v);
        },
        end: html =>
          resolve({
            res: {
              status: res.status,
              headers: { get: k => headers.get(k.toLowerCase()) },
            },
            html: html || '',
          }),
      };
      app.emit('request', req, res);
    });
    if (headers.has('set-cookie'))
      cookie = headers.get('set-cookie').split(';')[0];
    const match = result.html.match(/name="csrf" value="([a-f0-9]+)"/);
    if (match) csrf = match[1];
    return result;
  }
  try {
    let result = await request('/edit?file=anything.md');
    assert.match(result.html, /登录后/);
    assert.doesNotMatch(result.html, /app.pagescms.org|github.com/);
    assert.match(
      result.res.headers.get('set-cookie'),
      /HttpOnly; SameSite=Lax/
    );
    assert.doesNotMatch(result.res.headers.get('set-cookie'), /Secure/);
    assert.equal(
      (await request('/login', { csrf, password: 'wrong' })).res.status,
      401
    );
    assert.equal((await request('/login', { csrf, password })).res.status, 303);
    for (const path of [
      '/',
      '/admin/',
      '/posts',
      '/new',
      '/content',
      '/content/home',
      '/content/services',
      '/content/cases',
      '/content/faq',
      '/content/about',
      '/content/contact',
      '/content/nav',
      '/settings',
    ]) {
      result = await request(path);
      assert.equal(result.res.status, 200, path);
      assert.match(result.html, /class="sidebar"/);
    }
    result = await request('/content/home');
    assert.match(result.html, /form="content-form"/);
    assert.match(result.html, /首屏/);
    assert.match(result.html, /<input[^>]+name="field:home.title"/);
    assert.match(result.html, /<textarea[^>]+name="field:home.description"/);
    const values = Object.fromEntries(
      [...result.html.matchAll(/name="(field:[^"]+)"/g)].map(m => [m[1], ''])
    );
    assert.equal(
      (await request('/content/home', { csrf, ...values })).res.status,
      303
    );
    const saved = JSON.parse(await readFile(contentFile, 'utf8'));
    assert.equal(saved.home.title, '');
    assert.equal(saved.cta.description, '');
    assert.deepEqual(saved.unknown, original.unknown);
    assert.deepEqual(saved.pages, original.pages);
    assert.equal(
      (
        await request('/content/home', {
          csrf,
          ...values,
          'field:site.name': 'bad',
        })
      ).res.status,
      400
    );
    result = await request('/content/cases');
    result = await request('/content/cases', { csrf, operation: 'add:cases' });
    assert.equal(result.res.status, 200);
    assert.match(result.html, /field:cases.0.title/);
    const caseValues = Object.fromEntries(
      [...result.html.matchAll(/name="(field:[^"]+)"/g)].map(m => [m[1], ''])
    );
    assert.equal(
      (await request('/content/cases', { csrf, ...caseValues })).res.status,
      303
    );
    assert.deepEqual(JSON.parse(await readFile(contentFile, 'utf8')).cases, [
      {
        title: '',
        tag: '',
        description: '',
        metric: '',
        metricLabel: '',
        detail: '',
      },
    ]);
    result = await request('/posts');
    assert.match(result.html, /暂无文章/);
    assert.doesNotMatch(result.html, /<article>/);
    assert.equal((await request('/save', { title: 'bad' })).res.status, 403);
    const fields = {
      csrf,
      title: '标题 "引号"\n新行',
      summary: '摘要: 安全',
      date: '2026-10-09',
      group: '',
      body: '# 正文\n\n内容',
    };
    assert.equal(
      (await request('/save', { ...fields, date: '2026-02-30' })).res.status,
      400
    );
    assert.equal((await request('/save', fields)).res.status, 303);
    const [file] = (await readdir(directory)).filter(f => f.endsWith('.md'));
    assert.match(file, /^2026-10-09-.*\.md$/);
    const content = await readFile(join(directory, file), 'utf8');
    assert.match(content, /group: ""/);
    assert.match(content, /title: "标题 \\"引号\\"\\n新行"/);
    result = await request('/edit?file=' + encodeURIComponent(file));
    assert.equal(result.res.status, 200);
    assert.match(result.html, /&quot;引号&quot;/);
    assert.match(result.html, /role="tab"/);
    assert.match(result.html, /id="post-groups"/);
    assert.equal(
      (await request('/delete?file=' + encodeURIComponent(file))).res.status,
      200
    );
    assert.equal(
      (
        await request('/save', {
          ...fields,
          csrf,
          file,
          date: '2026-10-08',
          group: '记录',
        })
      ).res.status,
      303
    );
    assert.deepEqual(
      (await readdir(directory)).filter(f => f.endsWith('.md')),
      [file]
    );
    assert.equal(
      (await request('/save', { ...fields, csrf, file: '../escape.md' })).res
        .status,
      400
    );
    await symlink(join(directory, file), join(directory, 'link.md'));
    assert.equal((await request('/edit?file=link.md')).res.status, 400);
    fail = true;
    result = await request('/save', { ...fields, csrf, file, title: '修改后' });
    assert.equal(result.res.status, 502);
    assert.match(result.html, /已保存到磁盘/);
    assert.match(result.html, /发布网络不可用/);
    assert.match(await readFile(join(directory, file), 'utf8'), /修改后/);
    fail = false;
    assert.equal((await request('/delete', { csrf, file })).res.status, 303);
    assert.equal(calls.at(-1)[1], 'Delete');
    await request('/logout', { csrf });
    assert.match((await request('/')).html, /登录后/);
  } finally {
    app.emit('close');
    await rm(directory, { recursive: true, force: true });
  }
});

test('publication stages and commits only the literal Markdown path with runtime identity', async () => {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    return {
      stdout:
        command === 'gh'
          ? 'owner\n'
          : args[0] === 'branch'
            ? 'main\n'
            : args[0] === 'diff'
              ? 'changed'
              : '',
    };
  };
  await publish(
    'src/content/blog/article.md',
    'Update',
    '/temporary-repo',
    execute
  );
  const commit = calls.find(c => c.args[0] === 'commit');
  assert.deepEqual(commit.args, [
    'commit',
    '--only',
    '-m',
    'Update site content',
    '--',
    ':(literal)src/content/blog/article.md',
  ]);
  assert.equal(
    commit.options.env.GIT_AUTHOR_EMAIL,
    'owner@users.noreply.github.com'
  );
  assert.equal(
    commit.options.env.GIT_COMMITTER_EMAIL,
    'owner@users.noreply.github.com'
  );
  assert.deepEqual(calls.find(c => c.args[0] === 'add').args, [
    'add',
    '--',
    ':(literal)src/content/blog/article.md',
  ]);
  assert.deepEqual(calls.at(-1).args, [
    '-c',
    'credential.helper=!gh auth git-credential',
    'push',
    'origin',
    'main',
  ]);
  assert.ok(
    calls.every(
      c =>
        !c.args.includes('--force') &&
        !c.args.includes('--no-verify') &&
        !c.args.includes('config')
    )
  );
});

test('ADMIN_NO_GIT skips every git and network command', async () => {
  const before = process.env.ADMIN_NO_GIT;
  process.env.ADMIN_NO_GIT = '1';
  try {
    await publish('src/data/zh-CN.json', 'Update', '/unused', async () => {
      throw Error('must not execute');
    });
  } finally {
    if (before === undefined) delete process.env.ADMIN_NO_GIT;
    else process.env.ADMIN_NO_GIT = before;
  }
});

// Exercise requests without opening a network port or using a real Git checkout.
function testClient(
  app,
  socket = { remoteAddress: '127.0.0.1' },
  forwarded = {}
) {
  let cookie = '',
    csrf = '';
  return async (path = '/', fields) => {
    const headers = new Map();
    const result = await new Promise(resolve => {
      const req = Readable.from(
        fields ? [new URLSearchParams({ csrf, ...fields }).toString()] : []
      );
      Object.assign(req, {
        method: fields ? 'POST' : 'GET',
        url: path,
        socket,
        headers: {
          ...forwarded,
          cookie,
          ...(fields
            ? { 'content-type': 'application/x-www-form-urlencoded' }
            : {}),
        },
      });
      const res = {
        setHeader: (k, v) => headers.set(k.toLowerCase(), v),
        writeHead(status, values = {}) {
          this.status = status;
          for (const [k, v] of Object.entries(values))
            headers.set(k.toLowerCase(), v);
        },
        end(html = '') {
          resolve({ status: this.status, html, headers });
        },
      };
      app.emit('request', req, res);
    });
    if (headers.has('set-cookie'))
      cookie = headers.get('set-cookie').split(';')[0];
    csrf = result.html.match(/name="csrf" value="([a-f0-9]+)"/)?.[1] || csrf;
    return result;
  };
}

test('Secure cookies respect TLS and trusted proxy peers; five failures lock only the client IP', async () => {
  const app = createAdmin({ password: 'test-only' });
  const previous = process.env.ADMIN_TRUST_PROXY;
  delete process.env.ADMIN_TRUST_PROXY;
  try {
    const plain = testClient(app);
    assert.doesNotMatch((await plain()).headers.get('set-cookie'), /; Secure/);
    const localProxy = testClient(
      app,
      { remoteAddress: '::1' },
      { 'x-forwarded-proto': 'https' }
    );
    assert.match((await localProxy()).headers.get('set-cookie'), /; Secure/);
    const untrusted = testClient(
      app,
      { remoteAddress: '203.0.113.1' },
      { 'x-forwarded-proto': 'https' }
    );
    assert.doesNotMatch(
      (await untrusted()).headers.get('set-cookie'),
      /; Secure/
    );
    const tls = testClient(app, {
      encrypted: true,
      remoteAddress: '203.0.113.2',
    });
    assert.match((await tls()).headers.get('set-cookie'), /; Secure/);
    const bad = testClient(
      app,
      { remoteAddress: '127.0.0.1' },
      { 'x-forwarded-for': '192.0.2.10, 192.0.2.1' }
    );
    await bad();
    for (let i = 0; i < 4; i++)
      assert.equal((await bad('/login', { password: 'wrong' })).status, 401);
    const fifth = await bad('/login', { password: 'wrong' });
    assert.equal(fifth.status, 429);
    assert.match(fifth.html, /密码错误次数过多，请 10 分钟后再试。/);
    assert.equal((await bad('/login', { password: 'test-only' })).status, 429);
    const other = testClient(
      app,
      { remoteAddress: '127.0.0.1' },
      { 'x-forwarded-for': '192.0.2.11' }
    );
    await other();
    assert.equal(
      (await other('/login', { password: 'test-only' })).status,
      303
    );
    process.env.ADMIN_TRUST_PROXY = '1';
    assert.match(
      (
        await testClient(
          app,
          { remoteAddress: '192.0.2.1' },
          { 'x-forwarded-proto': 'https' }
        )()
      ).headers.get('set-cookie'),
      /; Secure/
    );
  } finally {
    app.emit('close');
    if (previous === undefined) delete process.env.ADMIN_TRUST_PROXY;
    else process.env.ADMIN_TRUST_PROXY = previous;
  }
});

test('saves pull before writing and committing, use env credentials, and abort conflicts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'admin-sync-'));
  const contentFile = join(directory, 'content.json');
  const original = JSON.parse(await readFile('src/data/zh-CN.json', 'utf8'));
  await writeFile(contentFile, JSON.stringify(original));
  const keys = [
    'GITHUB_TOKEN',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'ADMIN_NO_GIT',
    'ADMIN_NO_PUSH',
  ];
  const previous = keys.map(k => process.env[k]);
  Object.assign(process.env, {
    GITHUB_TOKEN: 'synthetic-test-token',
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
  });
  delete process.env.ADMIN_NO_GIT;
  delete process.env.ADMIN_NO_PUSH;
  const calls = [];
  let checkpoint;
  let conflict = false,
    retry = false,
    network = false;
  const execute = async (command, args) => {
    calls.push({ command, args });
    assert.equal(command, 'git');
    assert.ok(args.every(a => !a.includes(process.env.GITHUB_TOKEN)));
    if (args[0] === 'rev-parse')
      checkpoint = await readFile(contentFile, 'utf8');
    if (args[0] === 'reset') await writeFile(contentFile, checkpoint);
    if (args.includes('pull')) {
      if (conflict)
        throw Object.assign(Error('git failed'), {
          stderr: 'CONFLICT: could not apply',
        });
      if (network)
        throw Object.assign(Error('auth failed'), {
          stderr: process.env.GITHUB_TOKEN,
        });
      const latest = JSON.parse(await readFile(contentFile, 'utf8'));
      latest.remoteOnly = 'preserved';
      await writeFile(contentFile, JSON.stringify(latest));
    }
    if (args.includes('push') && retry) {
      conflict = true;
      throw Object.assign(Error('push failed'), {
        stderr: 'rejected non-fast-forward',
      });
    }
    return {
      stdout:
        args[0] === 'branch'
          ? 'main\n'
          : args[0] === 'rev-parse'
            ? 'abc123\n'
            : args[0] === 'diff'
              ? 'changed'
              : '',
    };
  };
  const app = createAdmin({
    password: 'test-only',
    directory,
    contentFile,
    repository: directory,
    execute,
  });
  const request = testClient(app);
  try {
    await request();
    await request('/login', { password: 'test-only' });
    const settings = await request('/settings');
    const fields = Object.fromEntries(
      [...settings.html.matchAll(/name="(field:[^"]+)"/g)].map(m => [
        m[1],
        'new value',
      ])
    );
    assert.equal((await request('/settings', fields)).status, 303);
    assert.ok(
      calls.findIndex(c => c.args.includes('pull')) <
        calls.findIndex(c => c.args[0] === 'commit')
    );
    assert.equal(
      JSON.parse(await readFile(contentFile, 'utf8')).remoteOnly,
      'preserved'
    );
    assert.ok(
      calls
        .find(c => c.args.includes('pull'))
        .args.includes('credential.helper=')
    );
    conflict = true;
    calls.length = 0;
    const before = await readFile(contentFile, 'utf8');
    const result = await request('/settings', fields);
    assert.match(
      result.html,
      /保存失败：线上内容已被其他人更新，且与本次修改冲突。请刷新页面后重新修改并保存。/
    );
    assert.ok(
      calls.some(c => c.args[0] === 'rebase' && c.args[1] === '--abort')
    );
    assert.ok(!calls.some(c => c.args[0] === 'commit'));
    assert.equal(await readFile(contentFile, 'utf8'), before);
    conflict = false;
    retry = true;
    calls.length = 0;
    const changing = { ...fields, 'field:site.name': 'should be rolled back' };
    const retryConflict = await request('/settings', changing);
    assert.match(retryConflict.html, /线上内容已被其他人更新/);
    assert.equal(
      JSON.parse(await readFile(contentFile, 'utf8')).site.name,
      'new value'
    );
    conflict = false;
    calls.length = 0;
    const post = await request('/save', {
      title: 'Test',
      summary: 'Test',
      date: '2026-10-10',
      body: 'Test',
      operation: 'ignored',
    });
    assert.ok(
      calls.findIndex(c => c.args.includes('pull')) <
        calls.findIndex(c => c.args[0] === 'commit')
    );
    assert.match(post.html, /线上内容已被其他人更新/);
    assert.ok(calls.some(c => c.args[0] === 'reset' && c.args[1] === '--hard'));
    assert.ok(
      calls.some(c => c.args[0] === 'rebase' && c.args[1] === '--abort')
    );
    assert.deepEqual(
      (await readdir(directory)).filter(f => f.endsWith('.md')),
      []
    );
    conflict = false;
    retry = false;
    network = true;
    const failed = await request('/settings', fields);
    assert.match(failed.html, /无法同步线上内容/);
    assert.doesNotMatch(failed.html, /synthetic-test-token/);
    process.env.ADMIN_NO_PUSH = '1';
    calls.length = 0;
    assert.equal((await request('/settings', fields)).status, 303);
    assert.ok(
      !calls.some(c => c.args.includes('pull') || c.args.includes('push'))
    );
  } finally {
    app.emit('close');
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
    await rm(directory, { recursive: true, force: true });
  }
});
