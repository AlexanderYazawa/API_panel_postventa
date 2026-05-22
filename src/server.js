import express from "express";
import cors from "cors";
import {
  fetchDashboardHtml,
  extractDashboardData,
  getProjectByQuery
} from "./extractor.js";
import { filterClientSafeProject } from "./safety.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DASHBOARD_URL =
  process.env.DASHBOARD_URL || "https://marianottzz.github.io/dashboardgeneral/";
const API_KEY = process.env.API_KEY || "";

const GITHUB_OWNER = process.env.GITHUB_OWNER || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_NOVEDADES_PATH =
  process.env.GITHUB_NOVEDADES_PATH || "data/novedades.js";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_WRITE_KEY = process.env.ADMIN_WRITE_KEY || "";

let cache = {
  fetchedAt: 0,
  ttlMs: 1000 * 60 * 5,
  payload: null
};

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();

  const provided =
    req.headers["x-api-key"] ||
    req.query.api_key;

  if (provided !== API_KEY) {
    return res.status(401).json({
      error: "No autorizado",
      detail: "Falta x-api-key o la clave no coincide."
    });
  }

  next();
}

function requireAdminWriteKey(req, res, next) {
  const provided =
    req.headers["x-admin-key"] ||
    req.body?.admin_key ||
    req.query.admin_key;

  if (!ADMIN_WRITE_KEY) {
    return res.status(500).json({
      error: "ADMIN_WRITE_KEY no configurada en Render."
    });
  }

  if (provided !== ADMIN_WRITE_KEY) {
    return res.status(401).json({
      error: "No autorizado",
      detail: "Falta x-admin-key o la clave de carga no coincide."
    });
  }

  next();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function normalizeNovedad(input) {
  const fecha = String(input.fecha || "").trim();
  const barrio_id = String(input.barrio_id || "").trim();
  const barrio = String(input.barrio || "").trim();
  const categoria = String(input.categoria || "obra").trim();
  const titulo = String(input.titulo || "").trim();
  const detalle = String(input.detalle || "").trim();
  const visibilidad = String(input.visibilidad || "cliente").trim();

  if (!fecha || !barrio_id || !barrio || !titulo || !detalle) {
    throw new Error(
      "Faltan campos obligatorios: fecha, barrio_id, barrio, titulo o detalle."
    );
  }

  const formatos = Array.isArray(input.formato_sugerido)
    ? input.formato_sugerido
    : String(input.formato_sugerido || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

  return {
    id:
      input.id ||
      `nov-${fecha}-${barrio_id.toLowerCase()}-${slugify(titulo)}`,
    fecha,
    barrio_id,
    barrio,
    categoria,
    titulo,
    detalle,
    visibilidad,
    apto_postventa: normalizeBoolean(input.apto_postventa),
    apto_marketing: normalizeBoolean(input.apto_marketing),
    prioridad_comunicacion: String(input.prioridad_comunicacion || "media"),
    formato_sugerido: formatos,
    copy_base_marketing: String(input.copy_base_marketing || ""),
    notas_internas: String(input.notas_internas || "")
  };
}

function insertNovedadInJsFile(fileContent, novedad) {
  const closeIndex = fileContent.lastIndexOf("];");

  if (closeIndex === -1) {
    throw new Error(
      "No se encontró el cierre del array NOVEDADES en data/novedades.js"
    );
  }

  const before = fileContent.slice(0, closeIndex);
  const after = fileContent.slice(closeIndex);

  const trimmed = before.trim();
  const separator =
    trimmed.endsWith("[") || trimmed.endsWith(",") ? "\n  " : ",\n  ";

  const objectText = JSON.stringify(novedad, null, 2)
    .split("\n")
    .join("\n  ");

  return `${before}${separator}${objectText}\n${after}`;
}

async function getGithubFile() {
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    throw new Error("Faltan variables de GitHub en Render.");
  }

  const url =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}` +
    `/contents/${GITHUB_NOVEDADES_PATH}?ref=${GITHUB_BRANCH}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GrupoRomaDashboardAPI"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`GitHub GET error: ${data.message || response.status}`);
  }

  const content = Buffer.from(data.content, "base64").toString("utf8");

  return {
    content,
    sha: data.sha
  };
}

async function updateGithubFile(newContent, sha, novedad) {
  const url =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}` +
    `/contents/${GITHUB_NOVEDADES_PATH}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "GrupoRomaDashboardAPI"
    },
    body: JSON.stringify({
      message: `Agregar novedad: ${novedad.barrio} - ${novedad.titulo}`,
      content: Buffer.from(newContent, "utf8").toString("base64"),
      sha,
      branch: GITHUB_BRANCH
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`GitHub PUT error: ${data.message || response.status}`);
  }

  return data;
}

async function getDashboard() {
  const now = Date.now();

  if (cache.payload && now - cache.fetchedAt < cache.ttlMs) {
    return cache.payload;
  }

  const html = await fetchDashboardHtml(DASHBOARD_URL);
  const extracted = extractDashboardData(html);

  const payload = {
    dashboard_url: DASHBOARD_URL,
    ...extracted
  };

  cache = {
    ...cache,
    fetchedAt: now,
    payload
  };

  return payload;
}

app.get("/", (req, res) => {
  res.json({
    name: "Dashboard API Grupo Roma",
    status: "ok",
    endpoints: [
      "GET /health",
      "GET /api/resumen",
      "GET /api/barrios",
      "GET /api/barrios/:id",
      "GET /api/barrios/:id/cliente",
      "GET /api/postventa/modelos",
      "GET /api/novedades",
      "POST /api/novedades",
      "GET /api/raw"
    ]
  });
});

app.get("/health", async (req, res) => {
  try {
    const d = await getDashboard();
    res.json({
      ok: true,
      dashboard_url: DASHBOARD_URL,
      variables_found: d.variables_found,
      extracted_at: d.extracted_at
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/resumen", requireApiKey, async (req, res) => {
  try {
    const d = await getDashboard();
    const projects = d.data.PROJS || [];

    res.json({
      fuente: d.dashboard_url,
      extraido_en: d.extracted_at,
      total_proyectos: projects.length,
      urgentes: projects
        .filter((p) => p.urgente)
        .map((p) => ({
          id: p.id,
          barrio: p.nombre,
          localidad: p.loc,
          avance_gestion: p.avanceGestion,
          avance_obra: p.avanceObra,
          entrega_estimativa: p.entrega
        })),
      proyectos: projects.map((p) => ({
        id: p.id,
        barrio: p.nombre,
        localidad: p.loc,
        avance_gestion: p.avanceGestion,
        avance_obra: p.avanceObra,
        urgente: Boolean(p.urgente),
        entrega_estimativa: p.entrega
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/barrios", requireApiKey, async (req, res) => {
  try {
    const d = await getDashboard();
    const projects = d.data.PROJS || [];

    res.json({
      fuente: d.dashboard_url,
      extraido_en: d.extracted_at,
      barrios: projects.map((p) => ({
        id: p.id,
        barrio: p.nombre,
        localidad: p.loc,
        lotes: p.lotes || undefined,
        hectareas: p.ha || undefined,
        avance_gestion: p.avanceGestion,
        avance_obra: p.avanceObra,
        urgente: Boolean(p.urgente),
        entrega_estimativa: p.entrega
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/barrios/:id", requireApiKey, async (req, res) => {
  try {
    const d = await getDashboard();
    const projects = d.data.PROJS || [];
    const project = getProjectByQuery(projects, req.params.id);

    if (!project) {
      return res.status(404).json({
        error: "Barrio no encontrado",
        recibido: req.params.id
      });
    }

    res.json({
      fuente: d.dashboard_url,
      extraido_en: d.extracted_at,
      proyecto: project,
      gestion_detallada: d.data.GESTION_DATA?.[project.id] || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/barrios/:id/cliente", requireApiKey, async (req, res) => {
  try {
    const d = await getDashboard();
    const projects = d.data.PROJS || [];
    const project = getProjectByQuery(projects, req.params.id);

    if (!project) {
      return res.status(404).json({
        error: "Barrio no encontrado",
        recibido: req.params.id
      });
    }

    const gestionData = d.data.GESTION_DATA?.[project.id] || [];

    res.json({
      fuente: d.dashboard_url,
      extraido_en: d.extracted_at,
      audiencia: "cliente",
      datos: filterClientSafeProject(project, gestionData)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/postventa/modelos", requireApiKey, async (req, res) => {
  try {
    const d = await getDashboard();
    let modelos = d.data.MODELOS || [];
    const barrio = req.query.barrio;

    if (barrio) {
      const normalized = String(barrio).toUpperCase();
      modelos = modelos.filter((m) =>
        String(m.proj || "").toUpperCase() === normalized ||
        String(m.barrio || "").toUpperCase() === normalized ||
        String(m.proyecto || "").toUpperCase() === normalized ||
        String(m.proj || "").toUpperCase() === "TODOS"
      );
    }

    res.json({
      fuente: d.dashboard_url,
      extraido_en: d.extracted_at,
      barrio: barrio || "todos",
      modelos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/novedades", requireApiKey, async (req, res) => {
  try {
    const d = await getDashboard();
    let novedades = d.data.NOVEDADES || [];

    const barrio = req.query.barrio;
    const visibilidad = req.query.visibilidad;
    const marketing = req.query.marketing;
    const postventa = req.query.postventa;

    if (barrio) {
      const q = String(barrio).toLowerCase();
      novedades = novedades.filter((n) =>
        String(n.barrio_id || "").toLowerCase() === q ||
        String(n.barrio || "").toLowerCase().includes(q)
      );
    }

    if (visibilidad) {
      novedades = novedades.filter((n) =>
        String(n.visibilidad || "") === String(visibilidad)
      );
    }

    if (String(marketing) === "true") {
      novedades = novedades.filter((n) => n.apto_marketing === true);
    }

    if (String(postventa) === "true") {
      novedades = novedades.filter((n) => n.apto_postventa === true);
    }

    novedades = novedades.sort((a, b) =>
      String(b.fecha || "").localeCompare(String(a.fecha || ""))
    );

    res.json({
      fuente: d.dashboard_url,
      extraido_en: d.extracted_at,
      total: novedades.length,
      novedades
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/novedades", requireAdminWriteKey, async (req, res) => {
  try {
    const novedad = normalizeNovedad(req.body);

    const currentFile = await getGithubFile();
    const updatedContent = insertNovedadInJsFile(
      currentFile.content,
      novedad
    );

    const githubResult = await updateGithubFile(
      updatedContent,
      currentFile.sha,
      novedad
    );

    cache = {
      ...cache,
      fetchedAt: 0,
      payload: null
    };

    res.status(201).json({
      ok: true,
      message: "Novedad guardada correctamente.",
      novedad,
      github_commit: githubResult.commit?.html_url || null,
      archivo: GITHUB_NOVEDADES_PATH
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.get("/api/raw", requireApiKey, async (req, res) => {
  try {
    const d = await getDashboard();
    res.json(d);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard API Grupo Roma escuchando en http://localhost:${PORT}`);
});
