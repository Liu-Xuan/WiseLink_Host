import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { unlink } from 'node:fs/promises';
const output = new URL('../.mineru-reader-check.mjs', import.meta.url);
try {
  await build({
    entryPoints: [
      'client/src/pages/DocumentParsingPage/MineruMarkdownReader.tsx',
    ],
    outfile: output.pathname,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
  });
  const { MineruMarkdownReader, mineruImageUrl } = await import(output.href);
  const markdown =
    '# Scope\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Applicability\n\n<table><tr><td>A</td><td>B</td></tr></table>\n\n![Figure](images/figure.png)\n\n![External](https://example.org/tracker.png)\n\n<script>alert(1)</script>\n\n```mermaid\ngraph TD; A --> B\n```';
  const html = renderToStaticMarkup(
    createElement(MineruMarkdownReader, {
      markdown,
      assets: { 'images/figure.png': '/api/test/authorized-image' },
    }),
  );
  assert.match(html, /<h1[^>]*>Scope/);
  assert.match(html, /<h2[^>]*>Applicability/);
  assert.match(html, /<p[^>]*>First paragraph\.<\/p>/);
  assert.match(html, /<p[^>]*>Second paragraph\.<\/p>/);
  assert.match(html, /<td[^>]*>A<\/td>/);
  assert.match(html, /src="\/api\/test\/authorized-image"/);
  assert.ok(!html.includes('src="https://example.org'));
  assert.ok(!html.includes('<script'));
  const renderedImages = [];
  const customHtml = renderToStaticMarkup(createElement(MineruMarkdownReader, {
    markdown,
    assets: { 'images/figure.png': '/api/test/authorized-image' },
    renderImage: (image) => {
      renderedImages.push(image);
      return createElement('span', { role: 'status' }, 'Loading authorized image');
    },
  }));
  assert.deepEqual(renderedImages, [{ path: 'images/figure.png', src: '/api/test/authorized-image', alt: 'Figure' }]);
  assert.ok(customHtml.includes('data-mineru-image-src="/api/test/authorized-image"'));
  assert.ok(customHtml.includes('Loading authorized image'));
  assert.equal(mineruImageUrl('images/../secret', {}), undefined);
  assert.equal(
    mineruImageUrl('images/a.png', { 'images/a.png': '//example.org/a' }),
    undefined,
  );
  assert.equal(
    mineruImageUrl('images/a.png', { 'images/a.png': '/\\example.org/a' }),
    undefined,
  );
  console.log(
    'PASS: Markdown headings, paragraphs, HTML table, authorized image, blocked external image/script, resource paths. SSR only; browser interactions require separate verification.',
  );
} finally {
  await unlink(output).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
