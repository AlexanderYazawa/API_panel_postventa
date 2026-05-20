const INTERNAL_PATTERNS = [
  /intern[ao]/i,
  /no comunicar/i,
  /cliente sensible/i,
  /clientes sensibles/i,
  /legal/i,
  /tribut/i,
  /politic/i,
  /recurso legal/i,
  /deuda/i,
  /pago/i,
  /canon/i,
  /acuerdo/i,
  /estrateg/i,
  /reubicaci[oó]n container/i
];

export function isLikelyInternalText(value) {
  const text = String(value || "");
  return INTERNAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function filterClientSafeProject(project, gestionData = []) {
  if (!project) return null;

  const safeHitos = Array.isArray(project.hitos)
    ? project.hitos
        .filter((h) => !isLikelyInternalText(h.obs))
        .map((h) => ({
          etapa: h.etapa,
          nombre: h.nombre,
          estado: h.est,
          expediente: h.exp || undefined,
          inicio: h.ini || undefined,
          fin: h.fin || undefined
        }))
    : [];

  const safeObra = Array.isArray(project.obra)
    ? project.obra.map((o) => ({
        rubro: o.r,
        avance: o.p,
        nota: isLikelyInternalText(o.nota) ? undefined : o.nota || undefined
      }))
    : [];

  const safeGestionDetallada = Array.isArray(gestionData)
    ? gestionData.map((g) => ({
        nombre: g.nombre,
        estado: g.est,
        expediente: g.exp || undefined,
        inicio: g.ini || undefined,
        fin: g.fin || undefined
      }))
    : [];

  return {
    id: project.id,
    barrio: project.nombre,
    localidad: project.loc,
    lotes: project.lotes || undefined,
    hectareas: project.ha || undefined,
    avance_gestion: project.avanceGestion,
    avance_obra: project.avanceObra,
    entrega_estimativa: project.entrega,
    urgente: Boolean(project.urgente),
    nota_publicable_posible: isLikelyInternalText(project.nota) ? undefined : project.nota || undefined,
    hitos_resumen: safeHitos,
    gestion_detallada: safeGestionDetallada,
    obra: safeObra,
    advertencia_uso: "Datos extraídos del dashboard. Revisar internamente antes de enviar a cliente si el caso es sensible."
  };
}
