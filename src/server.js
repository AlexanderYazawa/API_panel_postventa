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
const GITHUB_NOVEDADES_PATH = process.env.GITHUB_NOVEDADES_PATH || "data/novedades.js";
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

app.get("/api/resumen", , async (req, res) => {
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

    if (marketing === "true") {
      novedades = novedades.filter((n) => n.apto_marketing === true);
    }

    if (postventa === "true") {
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
