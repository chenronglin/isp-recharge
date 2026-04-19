import { resolve } from 'node:path';
import { buildApp } from '@/app';

const outputPath = resolve(process.cwd(), 'api.json');

const runtime = await buildApp({ startWorkerScheduler: false });

try {
  const response = await runtime.app.handle(new Request('http://localhost/openapi/json'));

  if (!response.ok) {
    throw new Error(`openapi generation failed: ${response.status}`);
  }

  const json = await response.json();
  await Bun.write(outputPath, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`generated ${outputPath}`);
} finally {
  runtime.stop();
}
