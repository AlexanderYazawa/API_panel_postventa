import vm from "node:vm";

const DEFAULT_VARS = [
  "PROJS",
  "GESTION_DATA",
  "MODELOS",
  "ESTRATEGIA",
  "CLIENTES",
  "CHECKLIST"
];

export async function fetchDashboardHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "GrupoRomaDashboardExtractor/1.0"
    }
  });

  if (!res.ok) {
    throw new Error(`No se pudo leer el dashboard. HTTP ${res.status}`);
  }

  return await res.text();
}

function findConstExpression(source, name) {
  const marker = `const ${name}`;
  const idx = source.indexOf(marker);
  if (idx === -1) return null;

  let pos = idx + marker.length;
  while (/\s/.test(source[pos])) pos++;
  if (source[pos] !== "=") {
    throw new Error(`Formato inesperado para const ${name}`);
  }

  pos++;
  while (/\s/.test(source[pos])) pos++;

  const start = pos;
  const first = source[pos];

  if (first !== "[" && first !== "{") {
    const semi = source.indexOf(";", pos);
    if (semi === -1) throw new Error(`No se encontró cierre ; para ${name}`);
    return source.slice(start, semi).trim();
  }

  const stack = [];
  let quote = null;
  let escaping = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = pos; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "[" || ch === "{") {
      stack.push(ch);
      continue;
    }

    if (ch === "]" || ch === "}") {
      const open = stack.pop();
      if ((open === "[" && ch !== "]") || (open === "{" && ch !== "}")) {
        throw new Error(`Llaves/corchetes desbalanceados extrayendo ${name}`);
      }

      if (stack.length === 0) {
        return source.slice(start, i + 1).trim();
      }
    }
  }

  throw new Error(`No se pudo extraer la expresión completa de ${name}`);
}

function evalJsExpression(expr, name) {
  try {
    return vm.runInNewContext(`(${expr})`, Object.freeze({}), {
      timeout: 1000,
      displayErrors: true
    });
  } catch (err) {
    throw new Error(`No se pudo evaluar ${name}: ${err.message}`);
  }
}

export function extractDashboardData(html, variables = DEFAULT_VARS) {
  const data = {};
  const found = [];

  for (const name of variables) {
    const expr = findConstExpression(html, name);
    if (!expr) continue;

    data[name] = evalJsExpression(expr, name);
    found.push(name);
  }

  return {
    source_type: "html_embedded_javascript",
    extracted_at: new Date().toISOString(),
    variables_found: found,
    data
  };
}

export function getProjectByQuery(projects, query) {
  const q = normalize(query);

  return projects.find((p) =>
    normalize(p.id) === q ||
    normalize(p.nombre) === q ||
    normalize(p.nombre).includes(q) ||
    q.includes(normalize(p.nombre))
  );
}

export function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
