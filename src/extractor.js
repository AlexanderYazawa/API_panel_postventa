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

  const html = await res.text();

  // Compatibilidad:
  // 1) Dashboard viejo: datos embebidos dentro del index.html.
  // 2) Dashboard nuevo: datos separados en archivos JS externos, por ejemplo /data/proyectos.js.
  //
  // Para no cambiar server.js, devolvemos el HTML + el contenido de los scripts externos
  // como texto adicional. Luego extractDashboardData puede encontrar las mismas constantes.
  const externalScripts = await fetchExternalScripts(html, url);

  if (!externalScripts.length) {
    return html;
  }

  return `${html}\n\n<!-- EXTERNAL DATA SCRIPTS INLINED FOR API EXTRACTION -->\n${externalScripts
    .map((script) => `<script>\n${script}\n</script>`)
    .join("\n")}`;
}

async function fetchExternalScripts(html, baseUrl) {
  const scripts = [];
  const regex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const matches = [...html.matchAll(regex)];

  for (const match of matches) {
    const src = match[1];

    // Leemos solo JS relativo/same-origin. Evitamos CDNs o scripts externos.
    const resolved = new URL(src, baseUrl);
    const base = new URL(baseUrl);

    if (resolved.origin !== base.origin) continue;
    if (!resolved.pathname.endsWith(".js")) continue;

    try {
      const res = await fetch(resolved.href, {
        headers: {
          "user-agent": "GrupoRomaDashboardExtractor/1.0"
        }
      });

      if (!res.ok) continue;

      const js = await res.text();

      // Optimización: solo agregamos scripts que parezcan contener datos del dashboard.
      if (
        DEFAULT_VARS.some((name) => js.includes(`const ${name}`)) ||
        resolved.pathname.includes("/data/")
      ) {
        scripts.push(js);
      }
    } catch {
      // Si un script externo falla, no rompemos todo: el extractor intentará con lo que tenga.
      continue;
    }
  }

  return scripts;
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
    source_type: "html_embedded_or_external_javascript",
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
