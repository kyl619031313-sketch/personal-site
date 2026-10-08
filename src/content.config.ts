import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    date: z.coerce.date(),
  }),
});

export const collections = { blog };
