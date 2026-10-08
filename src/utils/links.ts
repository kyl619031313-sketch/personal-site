/** Resolve CMS navigation paths under the configured GitHub Pages base. */
export function internalHref(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return path;
  const base = `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/`;
  const [pathname, suffix = ''] = path.split(/(?=[?#])/s, 2);
  const relative = pathname.replace(/^\/+|\/+$/g, '');
  return `${base}${relative ? `${relative}/` : ''}${suffix}`;
}
