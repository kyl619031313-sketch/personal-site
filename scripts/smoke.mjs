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
 assert.doesNotMatch(html, /陈某|128%|12 小时|虚构案例|hello@example.com|t\.me\/placeholder/);
 assert.doesNotMatch(html, /ScrewFast|screwfast|hreflang=|buy this template/i);
 for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
  if (href.startsWith('/')) assert.ok(href.startsWith('/personal-site/'), `Unbased link: ${href}`);
 }
 assert.match(html, new RegExp(`href="/personal-site/${route}" aria-current="page"`));
 console.log(`OK /personal-site/${route}`);
}
const home = await readFile('dist/index.html', 'utf8');
assert.match(home, /"@type":"Person"/);
assert.match(home, /"@type":"ProfessionalService"/);
assert.equal((home.match(/<details>/g) || []).length, copy.faq.faqs.length);
assert.equal((home.match(/class="service-card"/g) || []).length, copy.services.length);
assert.equal((home.match(/class="case-card"/g) || []).length, copy.cases.length);
const contact = await readFile('dist/contact/index.html', 'utf8');
if (!copy.pages.contact.email.trim()) assert.doesNotMatch(contact, /href="mailto:/);
if (!copy.pages.contact.telegram.trim()) assert.doesNotMatch(contact, /href="https:\/\/t\.me\//);
for (const removed of ['fr', 'blog', 'products', 'insights', 'docs']) assert.ok(!(await readdir('dist')).includes(removed));
const sitemap = await readFile('dist/sitemap-0.xml', 'utf8');
assert.equal((sitemap.match(/<loc>/g) || []).length, 4);
for (const route of ['', 'services/', 'about/', 'contact/']) assert.ok(sitemap.includes(`<loc>${site}${route}</loc>`));
assert.ok((await readFile('dist/robots.txt', 'utf8')).includes(`${site}sitemap-index.xml`));
console.log('OK blank content, metadata, navigation, contact links and sitemap');
