import { writeFileSync } from 'node:fs';
import { buildCopyMd } from '../lib/copy-md';

writeFileSync('COPY.md', buildCopyMd());
console.log('COPY.md written');
