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
import { createAdmin, publish } from '../admin/server.mjs';

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
    assert.match(result.html, /&quot;引号&quot;/);
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
