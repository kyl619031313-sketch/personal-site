import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const copy = JSON.parse(await readFile('src/data/zh-CN.json', 'utf8'));
const site = 'https://kyl619031313-sketch.github.io/personal-site/';
for (const route of ['', 'services/', 'about/', 'contact/']) {
  const html = await readFile(`dist/${route}index.html`, 'utf8');
  assert.match(html, /lang="zh-CN"/);
  assert.ok(html.includes(`rel="canonical" href="${site}${route}"`));
  assert.match(html, /property="og:description"/);
  assert.match(html, /在后台填写/);
  assert.doesNotMatch(
    html,
    /陈某|128%|12 小时|虚构案例|hello@example.com|t\.me\/placeholder/
  );
  assert.doesNotMatch(html, /ScrewFast|screwfast|hreflang=|buy this template/i);
  for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
    if (href.startsWith('/'))
      assert.ok(href.startsWith('/personal-site/'), `Unbased link: ${href}`);
  }
  assert.match(
    html,
    new RegExp(`href="/personal-site/${route}" aria-current="page"`)
  );
  console.log(`OK /personal-site/${route}`);
}
const home = await readFile('dist/index.html', 'utf8');
const nav = home.match(/<nav aria-label="主导航">([\s\S]*?)<\/nav>/)?.[1];
assert.ok(nav);
assert.deepEqual(
  [...nav.matchAll(/<a\b[^>]*>(.*?)<\/a>/g)].map(m => m[1]),
  ['首页', '服务', '关于', '博客', '联系']
);
assert.match(home, /"@type":"Person"/);
assert.match(home, /"@type":"ProfessionalService"/);
assert.equal((home.match(/<details>/g) || []).length, copy.faq.faqs.length);
assert.equal(
  (home.match(/class="service-card"/g) || []).length,
  copy.services.length
);
assert.equal(
  (home.match(/class="case-card"/g) || []).length,
  copy.cases.length
);
const contact = await readFile('dist/contact/index.html', 'utf8');
if (!copy.pages.contact.email.trim())
  assert.doesNotMatch(contact, /href="mailto:/);
if (!copy.pages.contact.telegram.trim())
  assert.doesNotMatch(contact, /href="https:\/\/t\.me\//);
for (const removed of ['fr', 'products', 'insights', 'docs'])
  assert.ok(!(await readdir('dist')).includes(removed));
const sitemap = await readFile('dist/sitemap-0.xml', 'utf8');
const postFiles = (await readdir('src/content/blog')).filter(file =>
  file.endsWith('.md')
);
assert.equal((sitemap.match(/<loc>/g) || []).length, 5 + postFiles.length);
for (const route of ['', 'services/', 'about/', 'contact/', 'blog/'])
  assert.ok(sitemap.includes(`<loc>${site}${route}</loc>`));
assert.ok(
  (await readFile('dist/robots.txt', 'utf8')).includes(
    `${site}sitemap-index.xml`
  )
);
console.log(
  'OK blank content, metadata, navigation, contact links and sitemap'
);

const blog = await readFile('dist/blog/index.html', 'utf8');
assert.match(blog, /lang="zh-CN"/);
assert.ok(blog.includes(`rel="canonical" href="${site}blog/"`));
assert.match(blog, /<h1\b[^>]*>博客<\/h1>/);
assert.match(blog, /property="og:locale" content="zh_CN"/);
assert.match(blog, /href="\/personal-site\/blog\/" aria-current="page"/);
assert.doesNotMatch(
  blog,
  /ScrewFast|screwfast|hreflang=|buy this template|陈某|hello@example.com|t\.me\/placeholder|作者简介|示例文章|演示文章/i
);
for (const [, href] of blog.matchAll(/href="([^"]*)"/g)) {
  if (href.startsWith('/'))
    assert.ok(href.startsWith('/personal-site/'), `Unbased blog link: ${href}`);
}
if (!postFiles.length) {
  assert.match(blog, /暂无文章。/);
  assert.doesNotMatch(blog, /class="blog-entry"/);
  assert.doesNotMatch(blog, /class="blog-group|未分组/);
  assert.deepEqual(await readdir('dist/blog'), ['index.html']);
}
console.log('OK public blog, empty state and blog sitemap');
