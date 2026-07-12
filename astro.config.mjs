import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://0xcrypto2024.github.io',
  base: '/uomp',
  integrations: [mdx()],
  output: 'static',
});
