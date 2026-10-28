// GitHub Pages has no SPA rewrites. Serving the same app shell as 404.html
// means any deep link (e.g. /<repo>/j/ABCD2345 or /<repo>/e/<id>/board) boots
// the client router directly, including after a hard refresh.
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';

copyFileSync('dist/index.html', 'dist/404.html');
// Stop Jekyll from ignoring files that start with an underscore.
writeFileSync('dist/.nojekyll', '');
if (process.env.CUSTOM_DOMAIN && !existsSync('dist/CNAME')) {
  writeFileSync('dist/CNAME', `${process.env.CUSTOM_DOMAIN.trim()}\n`);
}
console.log('postbuild: wrote 404.html fallback and .nojekyll');
