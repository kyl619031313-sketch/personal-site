import { getCollection } from 'astro:content';

export async function getPosts() {
  return (await getCollection('blog')).sort(
    (a, b) =>
      b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id)
  );
}

export function formatPostDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export async function getPostGroups() {
  const groups = new Map<string, Awaited<ReturnType<typeof getPosts>>>();
  for (const post of await getPosts()) {
    const label = post.data.group?.trim() || '';
    const entries = groups.get(label) || [];
    entries.push(post);
    groups.set(label, entries);
  }
  // getPosts is newest-first, so insertion order follows each group's newest post.
  return Array.from(groups, ([label, posts]) => ({ label, posts }));
}
