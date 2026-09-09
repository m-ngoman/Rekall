/**
 * Build the blog: content/blog/*.md -> public/blog/**.html
 *
 * Static generation on purpose. A client-rendered SPA route would produce no link
 * preview on HN, Slack, or X — none of those crawlers run JavaScript — and being
 * shared is the entire job of these pages. So: real HTML, real meta tags, no
 * runtime coupling to the React app. Vite copies public/ verbatim into dist/.
 *
 *   npm run blog     # generate once
 *   npm run build    # prebuild hook runs this first
 */

import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content", "blog");
const OUT = path.join(ROOT, "public", "blog");

const SITE = {
  origin: "https://rekall.study",
  name: "Rekall",
  author: "Adam Wendrich",
  blogTitle: "Rekall — engineering notes",
  blogDescription:
    "Notes on building an LLM grading pipeline: cost, latency, evaluation, and the things that only break in front of real users.",
};

/** Minimal front-matter parser. One dependency is enough for a blog. */
function parseFrontMatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

function head({ title, description, url, ogType = "article", published }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="stylesheet" href="/blog/style.css">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.blogTitle)}" href="/blog/feed.xml">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="${esc(SITE.name)}">
${published ? `<meta property="article:published_time" content="${esc(published)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<!-- TODO: add an OG image once you have one. A text-only preview still works, it just gets fewer clicks.
     <meta property="og:image" content="${SITE.origin}/blog/og/<slug>.png"> -->
</head>
<body>`;
}

const FOOTER = `
<footer>
  <p><a href="/blog/">All posts</a> · <a href="/">Rekall</a> · <a href="/blog/feed.xml">RSS</a></p>
</footer>
</body>
</html>
`;

function postPage(post) {
  const url = `${SITE.origin}/blog/${post.slug}/`;
  return (
    head({
      title: post.title,
      description: post.description,
      url,
      published: post.date,
    }) +
    `
<article>
  <p class="back"><a href="/blog/">← Rekall engineering notes</a></p>
  <header>
    <h1>${esc(post.title)}</h1>
    <p class="meta"><time datetime="${esc(post.date)}">${formatDate(post.date)}</time> · ${esc(SITE.author)}</p>
  </header>
  ${post.html}
</article>` +
    FOOTER
  );
}

function indexPage(posts) {
  const url = `${SITE.origin}/blog/`;
  const items = posts
    .map(
      (p) => `  <li>
    <a class="entry" href="/blog/${p.slug}/">
      <h2>${esc(p.title)}</h2>
      <p class="meta"><time datetime="${esc(p.date)}">${formatDate(p.date)}</time></p>
      <p class="excerpt">${esc(p.description)}</p>
    </a>
  </li>`
    )
    .join("\n");

  return (
    head({
      title: SITE.blogTitle,
      description: SITE.blogDescription,
      url,
      ogType: "website",
    }) +
    `
<article>
  <header>
    <h1>Engineering notes</h1>
    <p class="meta">Building <a href="/">Rekall</a> — grading free-recall answers with an LLM.</p>
  </header>
  <ul class="posts">
${items}
  </ul>
</article>` +
    FOOTER
  );
}

function feed(posts) {
  const items = posts
    .map(
      (p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE.origin}/blog/${p.slug}/</link>
    <guid isPermaLink="true">${SITE.origin}/blog/${p.slug}/</guid>
    <pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
  </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(SITE.blogTitle)}</title>
  <link>${SITE.origin}/blog/</link>
  <description>${esc(SITE.blogDescription)}</description>
  <language>en</language>
${items}
</channel></rss>
`;
}

const STYLE = `/* Generated by scripts/build-blog.mjs — edit the STYLE constant there, not this file. */
:root {
  --bg: #fbfaf8;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --rule: #e4e1dc;
  --accent: #1c4f8b;
  --code-bg: #f0eeea;
  --measure: 34rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141414;
    --fg: #e6e4e0;
    --muted: #9a9691;
    --rule: #2e2c29;
    --accent: #86b3e8;
    --code-bg: #232220;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 400 18px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
  font-feature-settings: "kern", "liga";
}
article, footer { max-width: var(--measure); margin: 0 auto; padding: 0 1.25rem; }
article { padding-top: 3.5rem; }
.back { margin: 0 0 2.5rem; font-size: .9rem; }
.back a { color: var(--muted); text-decoration: none; }
.back a:hover { color: var(--accent); }
h1 { font-size: 2rem; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 .6rem; }
h2 { font-size: 1.3rem; line-height: 1.25; letter-spacing: -0.01em; margin: 3rem 0 .8rem; }
h3 { font-size: 1.05rem; margin: 2rem 0 .6rem; }
p, ul, ol { margin: 0 0 1.15rem; }
li { margin-bottom: .5rem; }
.meta { color: var(--muted); font-size: .92rem; margin-bottom: 2.5rem; }
a { color: var(--accent); text-underline-offset: 2px; }
strong { font-weight: 600; }
hr { border: none; border-top: 1px solid var(--rule); margin: 3rem 0; }
blockquote {
  margin: 1.5rem 0; padding-left: 1rem;
  border-left: 3px solid var(--rule); color: var(--muted);
}
code {
  background: var(--code-bg); padding: .12em .35em; border-radius: 3px;
  font: 0.86em/1.4 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
pre {
  background: var(--code-bg); padding: 1rem; border-radius: 6px;
  overflow-x: auto; margin: 0 0 1.15rem;
}
pre code { background: none; padding: 0; font-size: .82rem; }
/* Wide tables must scroll inside themselves, never the page. */
.table-wrap { overflow-x: auto; margin: 0 0 1.5rem; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; }
th, td { text-align: left; padding: .6rem .8rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-weight: 600; white-space: nowrap; }
em { color: var(--muted); }
h1 + .meta em, article > p:first-of-type em { font-style: italic; }
.posts { list-style: none; padding: 0; margin: 2rem 0 0; }
.posts li { margin-bottom: .5rem; }
.entry {
  display: block; text-decoration: none; color: inherit;
  padding: 1.4rem 0; border-top: 1px solid var(--rule);
}
.entry:hover h2 { color: var(--accent); }
.entry h2 { margin: 0 0 .3rem; font-size: 1.15rem; }
.entry .meta { margin: 0 0 .4rem; font-size: .85rem; }
.entry .excerpt { margin: 0; color: var(--muted); font-size: .95rem; }
footer {
  margin-top: 4rem; padding-top: 1.5rem; padding-bottom: 4rem;
  border-top: 1px solid var(--rule); color: var(--muted); font-size: .9rem;
}
footer a { color: var(--muted); }
footer a:hover { color: var(--accent); }
@media (max-width: 34rem) {
  body { font-size: 17px; }
  article { padding-top: 2.5rem; }
  h1 { font-size: 1.6rem; }
}
`;

async function main() {
  if (!existsSync(CONTENT)) {
    console.error(`No content directory at ${CONTENT}`);
    process.exit(1);
  }

  const files = (await readdir(CONTENT)).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.error("No posts found.");
    process.exit(1);
  }

  const posts = [];
  for (const file of files) {
    const raw = await readFile(path.join(CONTENT, file), "utf8");
    const { data, body } = parseFrontMatter(raw);

    for (const required of ["title", "description", "date"]) {
      if (!data[required]) {
        console.error(`${file}: missing front-matter field "${required}"`);
        process.exit(1);
      }
    }

    // No options object: `mangle` and `headerIds` were deprecated in marked 5 and
    // removed in 7, and passing them behaves differently across versions. Defaults
    // are what we want anyway.
    let html = marked.parse(body);
    // Tables need their own scroll container or they blow out the page on mobile.
    html = html.replace(/<table>/g, '<div class="table-wrap"><table>')
               .replace(/<\/table>/g, "</table></div>");

    posts.push({
      slug: data.slug || file.replace(/\.md$/, ""),
      title: data.title,
      description: data.description,
      date: data.date,
      html,
    });
  }

  posts.sort((a, b) => b.date.localeCompare(a.date));

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  for (const post of posts) {
    const dir = path.join(OUT, post.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), postPage(post), "utf8");
    console.log(`  /blog/${post.slug}/`);
  }

  await writeFile(path.join(OUT, "index.html"), indexPage(posts), "utf8");
  await writeFile(path.join(OUT, "style.css"), STYLE, "utf8");
  await writeFile(path.join(OUT, "feed.xml"), feed(posts), "utf8");

  console.log(`  /blog/ (${posts.length} post${posts.length === 1 ? "" : "s"}), style.css, feed.xml`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
