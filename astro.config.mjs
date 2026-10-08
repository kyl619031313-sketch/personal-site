import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import blogLinks from './src/utils/markdown-blog-links.mjs';
export default defineConfig({ site: 'https://kyl619031313-sketch.github.io', base: '/personal-site', trailingSlash: 'always', prefetch: true, markdown: { processor: satteri({ mdastPlugins: [blogLinks({ base: '/personal-site' })] }) }, integrations: [sitemap()], vite: { plugins: [tailwindcss()] } });
