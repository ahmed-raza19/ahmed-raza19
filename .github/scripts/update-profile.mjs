// Generates the self-hosted parts of the profile README. Run by .github/workflows/update-profile.yml.
//
//   1. activity-graph.svg: daily contributions for the last 31 days, written to OUT_DIR
//      (the workflow publishes OUT_DIR to the `profile-stats` branch).
//   2. README.md: rewrites the public repo count in the REPOS badge and the Quick Stats table.
//
// Only needs the workflow's built-in GITHUB_TOKEN, since everything it reads is public profile data.
// Local run:  GITHUB_TOKEN=$(gh auth token) OUT_DIR=out node .github/scripts/update-profile.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const USER = process.env.PROFILE_USER || "ahmed-raza19";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || "dist";
const README = process.env.README_PATH || "README.md";
const DAYS = 31;

// Matches the colors the README previously passed to github-readme-activity-graph.
const THEME = {
  bg: "#0d1117",
  title: "#A855F7",
  text: "#A855F7",
  muted: "#8b949e",
  grid: "#21262d",
  line: "#FF3CAC",
  point: "#06B6D4",
  area: "#784BA0",
};

if (!TOKEN) {
  console.error("GITHUB_TOKEN is not set");
  process.exit(1);
}

async function api(endpoint, body) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": `${USER}-profile-stats`,
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${endpoint} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchStats() {
  const [{ public_repos: publicRepos }, graph] = await Promise.all([
    api(`/users/${USER}`),
    api("/graphql", {
      query: `query ($login: String!) {
        user(login: $login) {
          name
          contributionsCollection {
            contributionCalendar { weeks { contributionDays { date contributionCount } } }
          }
        }
      }`,
      variables: { login: USER },
    }),
  ]);
  if (graph.errors?.length) throw new Error(`GraphQL: ${graph.errors.map((e) => e.message).join("; ")}`);
  const { name, contributionsCollection } = graph.data.user;
  const days = contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .slice(-DAYS);
  return { name: name || USER, publicRepos, days };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDate = (iso, opts) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

// "Nice" tick step so the y-axis reads 0, 5, 10… instead of 0, 4.6, 9.2…
function yScale(max) {
  const raw = Math.max(max, 1) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw));
  return { step, top: Math.max(step, Math.ceil(max / step) * step) };
}

function renderActivityGraph({ name, days }) {
  const plot = { left: 80, right: 1160, top: 90, bottom: 340 };
  const counts = days.map((d) => d.contributionCount);
  const total = counts.reduce((a, b) => a + b, 0);
  const { step, top } = yScale(Math.max(...counts));
  const x = (i) => plot.left + (i * (plot.right - plot.left)) / Math.max(days.length - 1, 1);
  const y = (v) => plot.bottom - (v / top) * (plot.bottom - plot.top);

  const pts = counts.map((c, i) => [x(i).toFixed(1), y(c).toFixed(1)]);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
  const area = `${line} L${pts.at(-1)[0]} ${plot.bottom} L${pts[0][0]} ${plot.bottom} Z`;

  const grid = [];
  for (let v = 0; v <= top; v += step) {
    const gy = y(v).toFixed(1);
    grid.push(
      `<line x1="${plot.left}" x2="${plot.right}" y1="${gy}" y2="${gy}" stroke="${THEME.grid}"${v ? ' stroke-dasharray="4 4"' : ""}/>`,
      `<text x="${plot.left - 14}" y="${(+gy + 4).toFixed(1)}" text-anchor="end" class="tick">${v}</text>`,
    );
  }
  const points = pts.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="4" fill="${THEME.point}"/>`);
  const xLabels = days.map(
    (d, i) => `<text x="${pts[i][0]}" y="${plot.bottom + 24}" text-anchor="middle" class="tick">${fmtDate(d.date, { day: "numeric" })}</text>`,
  );

  const title = `${name}'s Contribution Graph`;
  const first = fmtDate(days[0].date, { month: "short", day: "numeric" });
  const last = fmtDate(days.at(-1).date, { month: "short", day: "numeric", year: "numeric" });
  const subtitle = `${total} contributions · ${first} – ${last}`;
  const updated = new Date().toISOString().slice(0, 16).replace("T", " ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420" role="img" aria-labelledby="title desc">
  <title id="title">${esc(title)}</title>
  <desc id="desc">${esc(subtitle)}</desc>
  <defs>
    <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${THEME.area}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${THEME.area}" stop-opacity="0.05"/>
    </linearGradient>
  </defs>
  <style>
    text { font-family: 'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif; }
    .title { font-size: 22px; font-weight: 600; fill: ${THEME.title}; }
    .sub, .axis { font-size: 13px; fill: ${THEME.muted}; }
    .tick { font-size: 12px; fill: ${THEME.text}; }
    .stamp { font-size: 11px; fill: ${THEME.muted}; }
  </style>
  <rect width="1200" height="420" rx="6" fill="${THEME.bg}"/>
  <text x="600" y="42" text-anchor="middle" class="title">${esc(title)}</text>
  <text x="600" y="66" text-anchor="middle" class="sub">${esc(subtitle)}</text>
  ${grid.join("\n  ")}
  <path d="${area}" fill="url(#area-fill)"/>
  <path d="${line}" fill="none" stroke="${THEME.line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${points.join("\n  ")}
  ${xLabels.join("\n  ")}
  <text x="30" y="${(plot.top + plot.bottom) / 2}" text-anchor="middle" transform="rotate(-90 30 ${(plot.top + plot.bottom) / 2})" class="axis">Contributions</text>
  <text x="${(plot.left + plot.right) / 2}" y="${plot.bottom + 52}" text-anchor="middle" class="axis">Days</text>
  <text x="1184" y="408" text-anchor="end" class="stamp">Updated ${updated} UTC</text>
</svg>
`;
}

async function updateReadme(count) {
  const original = await readFile(README, "utf8");
  const rules = [
    ["REPOS badge", /(img\.shields\.io\/badge\/REPOS-)\d+(-)/g],
    ["Quick Stats 'Repos Built'", /(\*\*)\d+(\+?\*\*\s+Repos Built)/g],
  ];
  let text = original;
  for (const [label, pattern] of rules) {
    if (text.search(pattern) === -1) {
      console.log(`::warning::README: ${label} not found, skipped`);
      continue;
    }
    text = text.replace(pattern, (_, before, after) => `${before}${count}${after}`);
  }
  if (text === original) return console.log(`README: repo count already ${count}`);
  await writeFile(README, text);
  console.log(`README: repo count → ${count}`);
}

const stats = await fetchStats();
await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, "activity-graph.svg"), renderActivityGraph(stats));
console.log(`activity-graph.svg: ${stats.days.length} days → ${OUT_DIR}`);
await updateReadme(stats.publicRepos);
