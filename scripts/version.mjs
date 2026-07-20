import { readFile, writeFile } from 'fs/promises';
import { execSync } from 'child_process';

const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const version = `${date}-${hash}`;

for (const file of ['public/dashboard/index.html', 'public/dashboard/sdk.js']) {
  let content = await readFile(file, 'utf-8');
  content = content.replace(/v\d{4}-\d{2}-\d{2}\.\d+/g, `v${version}`);
  content = content.replace(/v\d{8}-[a-f0-9]+/g, `v${version}`);
  content = content.replace(/<!-- v[\d.\-]+ -->/g, `<!-- v${version} -->`);
  content = content.replace(/v[\d.\-]+ [-—] UOMP Browser SDK/g, `v${version} — UOMP Browser SDK`);
  content = content.replace(/v[\d.\-]+ \*\/ UOMP Browser SDK/g, `v${version} — UOMP Browser SDK`);
  await writeFile(file, content);
}
console.log(`Version: v${version}`);
