import { getCollection } from 'astro:content';

export async function getPosts() {
  return (await getCollection('blog')).sort((a, b) =>
    b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id),
  );
}

export function formatPostDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(date);
}
