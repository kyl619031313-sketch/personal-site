import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
export default defineConfig({ site: 'https://kyl619031313-sketch.github.io', base: '/personal-site', trailingSlash: 'always', prefetch: true, integrations: [sitemap()], vite: { plugins: [tailwindcss()] } });
