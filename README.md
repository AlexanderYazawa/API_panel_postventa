# Dashboard API Grupo Roma

API externa para leer el dashboard publicado en GitHub Pages **sin modificar el HTML**.

La API:
- descarga el HTML desde `DASHBOARD_URL`;
- extrae variables JavaScript como `PROJS`, `GESTION_DATA`, `MODELOS`, `ESTRATEGIA`, `CLIENTES`;
- devuelve datos estructurados para usar con ChatGPT, Claude o cualquier otra herramienta;
- incluye endpoint filtrado para respuestas a clientes: `/api/barrios/:id/cliente`.

## 1. Instalación local

```bash
npm install
cp .env.example .env
npm run dev
```

Abrir:

```text
http://localhost:3000/health
```

## 2. Variables de entorno

```env
DASHBOARD_URL=https://marianottzz.github.io/dashboardgeneral/
API_KEY=una-clave-larga
PORT=3000
```

Si `API_KEY` está configurada, usar header:

```http
x-api-key: una-clave-larga
```

## 3. Endpoints principales

### Resumen

```http
GET /api/resumen
```

### Listar barrios

```http
GET /api/barrios
```

### Barrio completo, interno

```http
GET /api/barrios/Vitta
```

### Barrio filtrado para cliente

```http
GET /api/barrios/Vitta/cliente
```

### Modelos de postventa

```http
GET /api/postventa/modelos?barrio=VI
```

### Datos crudos

```http
GET /api/raw
```

## 4. Conectar con ChatGPT

1. Publicar esta API en Render, Railway, Vercel, Fly.io u otro hosting.
2. Reemplazar `https://TU-DOMINIO-DE-LA-API.com` en `openapi.yaml`.
3. Crear un GPT personalizado.
4. En Actions, pegar el schema `openapi.yaml`.
5. Configurar autenticación API Key usando `x-api-key`.
6. Agregar instrucciones estrictas al GPT:

```text
Antes de responder sobre un barrio, consultá siempre la Action del Dashboard Grupo Roma.
No inventes fechas, porcentajes, expedientes, estados ni avances.
Si el dato no aparece en la respuesta de la API, decí que no hay información confirmada en el dashboard.
Para mensajes a clientes, usá solamente el endpoint /api/barrios/{id}/cliente.
No uses información de estrategia, clientes sensibles, notas internas, pendientes legales o datos internos en respuestas externas.
```

## 5. Importante

El endpoint `/cliente` hace un filtrado conservador, pero no reemplaza la validación humana.
Como el HTML original no etiqueta cada dato como “cliente” o “interno”, conviene revisar los primeros usos antes de automatizar respuestas sensibles.
