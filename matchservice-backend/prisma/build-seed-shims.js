/* eslint-disable */
// Build helper for the seed scripts that live in prisma/ but import shared
// code from src/.
//
// `tsc prisma/seed.ts --outDir dist-seed` emits dist-seed/seed.js because the
// inferred rootDir is prisma/. The moment a seed script imports something from
// src/ (which seed-simulation.ts and seed-ai-courses.ts do, so that the admin
// route and the console script share one implementation), the inferred root
// becomes the project directory and the emit is mirrored as
// dist-seed/prisma/<name>.js + dist-seed/src/**. Raising the app's own
// tsconfig rootDir to fix that would move dist/main.js, which package.json's
// start:prod and the Docker CMD both depend on.
//
// So the compiled entry keeps its mirrored path and this writes a one-line
// flat entry point next to it, keeping the documented invocation working:
//
//   node dist-seed/seed-simulation.js 120
const fs = require('fs');
const path = require('path');

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('usage: node prisma/build-seed-shims.js <script-name> [...]');
  process.exit(1);
}

for (const name of names) {
  const target = path.join('dist-seed', 'prisma', `${name}.js`);
  if (!fs.existsSync(target)) {
    console.error(`build-seed-shims: expected compiled output at ${target}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join('dist-seed', `${name}.js`), `require('./prisma/${name}');\n`);
}
