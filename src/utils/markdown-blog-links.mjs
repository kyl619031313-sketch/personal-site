/** Resolve root-relative CMS media and article links for GitHub Pages. */
export default function blogLinks({ base }) {
  function resolve(node, ctx) {
    if (!node.url?.startsWith('/') || node.url.startsWith('//')) return;
    let url = node.url;
    if (url !== base && !url.startsWith(`${base}/`)) url = `${base}${url}`;
    if (node.type === 'link' || node.type === 'linkReference' || node.type === 'definition') {
      const [path, suffix = ''] = url.split(/(?=[?#])/s, 2);
      if (!path.split('/').at(-1).includes('.')) url = `${path.replace(/\/+$/, '')}/${suffix}`;
    }
    ctx.setProperty(node, 'url', url);
  }
  return { name: 'blog-base-links', image: resolve, link: resolve, definition: resolve };
}
