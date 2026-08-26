import type { Film } from "./types";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  ntilde: "ñ",
  oacute: "ó",
  iacute: "í",
  aacute: "á",
  uacute: "ú",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const cp =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? whole;
  });
}

export function parseTotal(html: string): number | null {
  const m = html.match(/data-num-entries="(\d+)"/);
  return m ? Number(m[1]) : null;
}

const ITEM =
  /data-item-name="([^"]*)"[\s\S]{0,400}?data-item-slug="([^"]*)"[\s\S]{0,800}?data-postered-identifier='([^']*)'/g;

export function parseWatchlistPage(html: string): Film[] {
  const films: Film[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(ITEM)) {
    const rawName = decodeEntities(m[1]);
    const slug = m[2];
    let lid: string | null = null;
    try {
      lid = JSON.parse(decodeEntities(m[3])).lid ?? null;
    } catch {
      lid = null;
    }
    if (!lid || !slug || seen.has(lid)) continue;
    seen.add(lid);
    const ym = rawName.match(/^(.*)\s+\((\d{4})\)$/);
    films.push({
      lid,
      slug,
      name: ym ? ym[1] : rawName,
      year: ym ? Number(ym[2]) : null,
    });
  }
  return films;
}
