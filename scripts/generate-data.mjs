import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const generatedDir = path.join(dataDir, "generated");
const rawDir = path.join(dataDir, "raw");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");
const EXCLUDED_PAIRS = new Set([
  "AQ",
  "BM",
  "CI",
  "DE",
  "FL",
  "GX",
  "HR",
  "JP",
  "KU",
  "NT",
  "OV",
  "SW",
]);

const GOOGLE_URL =
  "https://docs.google.com/spreadsheets/d/1Fi4xgUz5b23UXMlHq7Tt5C8Ak8-U3XdbeQ9Anw68BQc/export?format=csv&gid=0";
const WIKI_URL =
  "https://www.speedsolving.com/wiki/index.php?title=List_of_letter_pairs&action=raw";

await fs.mkdir(generatedDir, { recursive: true });
await fs.mkdir(rawDir, { recursive: true });

const [googleResponse, wikiResponse] = await Promise.all([fetch(GOOGLE_URL), fetch(WIKI_URL)]);

if (!googleResponse.ok) {
  throw new Error(`Failed to fetch Google sheet: ${googleResponse.status}`);
}

if (!wikiResponse.ok) {
  throw new Error(`Failed to fetch wiki data: ${wikiResponse.status}`);
}

const googleCsv = await googleResponse.text();
const wikiRaw = await wikiResponse.text();

await fs.writeFile(path.join(rawDir, "google.csv"), googleCsv);
await fs.writeFile(path.join(rawDir, "wiki.txt"), wikiRaw);

const validPairs = buildValidPairs();
const sourceMap = Object.fromEntries(validPairs.map((pair) => [pair, []]));

mergeSourceMap(sourceMap, parseGoogleCandidates(googleCsv), "google");
mergeSourceMap(sourceMap, parseWikiCandidates(wikiRaw), "wiki");

const output = {
  generatedAt: new Date().toISOString(),
  alphabet: ALPHABET,
  excludedPairs: [...EXCLUDED_PAIRS],
  validPairs,
  sources: sourceMap,
};

await fs.writeFile(
  path.join(generatedDir, "pairs.json"),
  JSON.stringify(output, null, 2) + "\n",
);
await fs.writeFile(path.join(generatedDir, "google-options.md"), buildMarkdown(sourceMap, "google"));
await fs.writeFile(path.join(generatedDir, "wiki-options.md"), buildMarkdown(sourceMap, "wiki"));

console.log(`Generated ${validPairs.length} valid pairs`);

function buildValidPairs() {
  const pairs = [];

  for (const first of ALPHABET) {
    for (const second of ALPHABET) {
      const pair = `${first}${second}`;
      if (first === second) continue;
      if (EXCLUDED_PAIRS.has(pair)) continue;
      pairs.push(pair);
    }
  }

  return pairs;
}

function mergeSourceMap(target, incoming, source) {
  for (const [pair, values] of Object.entries(incoming)) {
    if (!(pair in target)) continue;

    const existingTexts = new Set(target[pair].map((candidate) => candidate.text.toLowerCase()));
    for (const value of values) {
      const text = normalizeCandidate(value);
      if (!text) continue;
      const key = text.toLowerCase();
      if (existingTexts.has(key)) continue;
      existingTexts.add(key);
      target[pair].push({ text, source });
    }
  }
}

function parseGoogleCandidates(csv) {
  const rows = parseCsv(csv);
  const result = {};
  const header = rows[0] ?? [];

  const pairColumns = [];
  for (let index = 0; index < header.length; index += 3) {
    const pair = normalizePair(header[index]);
    if (pair) {
      pairColumns.push({ pair, start: index });
      result[pair] = [];
    }
  }

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (const { pair, start } of pairColumns) {
      for (const value of row.slice(start, start + 3)) {
        const candidate = normalizeCandidate(value);
        if (!candidate) continue;
        result[pair].push(candidate);
      }
    }
  }

  return result;
}

function parseWikiCandidates(raw) {
  const result = {};
  let currentPair = null;

  for (const line of raw.split(/\r?\n/)) {
    const pairMatch = line.match(/^==([A-Z]{2})==$/);
    if (pairMatch) {
      const pair = normalizePair(pairMatch[1]);
      currentPair = pair;
      if (pair) result[pair] = result[pair] ?? [];
      continue;
    }

    if (!currentPair) continue;
    if (!line.startsWith("*")) continue;

    const candidate = normalizeCandidate(
      line
        .replace(/^\*\s*/, "")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1"),
    );

    if (candidate) {
      result[currentPair].push(candidate);
    }
  }

  return result;
}

function buildMarkdown(sourceMap, source) {
  const lines = [
    `# ${source} options`,
    "",
    `Generated from the ${source} source for A-X blind pair setup.`,
    "",
  ];

  for (const pair of Object.keys(sourceMap).sort()) {
    const items = sourceMap[pair]
      .filter((candidate) => candidate.source === source)
      .map((candidate) => candidate.text);

    lines.push(`## ${pair}`);
    if (items.length === 0) {
      lines.push("- None");
    } else {
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function normalizePair(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!/^[A-X]{2}$/.test(normalized)) return null;
  if (normalized[0] === normalized[1]) return null;
  if (EXCLUDED_PAIRS.has(normalized)) return null;
  return normalized;
}

function normalizeCandidate(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^,+|,+$/g, "")
    .trim();

  if (!normalized) return "";
  const wordCount = normalized.split(" ").filter(Boolean).length;
  if (wordCount > 3) return "";
  return normalized;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const nextChar = input[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}
