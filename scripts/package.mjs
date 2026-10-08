import { cp, mkdir } from 'node:fs/promises';
await mkdir(new URL('../dist/extension/', import.meta.url), { recursive: true });
await cp(new URL('../extension/', import.meta.url), new URL('../dist/extension/', import.meta.url), { recursive: true });
console.log('Extensão pronta em dist/extension. Carregue essa pasta ou extension/ no Chrome.');
