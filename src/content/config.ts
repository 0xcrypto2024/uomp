import { defineCollection, z } from 'astro:content';

const tutorial = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
});

export const collections = { tutorial };
