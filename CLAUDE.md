# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `pnpm dev` (ts-node-dev con auto-restart, puerto 8100)
- **Build:** `pnpm build` (tsc → `dist/`)
- **Start prod:** `pnpm start`
- **Format:** `pnpm format` (Prettier)
- **Seed admin:** `pnpm seed:admin`
- **Importar catálogo:** `pnpm seed:catalog <catalog.json> [--reset]` (upsert por slug; conserva stock editado)
- **No hay linter ni tests.** `pnpm build` es la única verificación.

## Tech Stack

- Express 5 + TypeScript (CommonJS, target ES2024)
- MongoDB via Mongoose (`DB_URI`)
- JWT Bearer (`JWT_SECRET`, 30 días)
- Resend para correo (opcional: sin key no envía)
- Cloudinary para fotos subidas desde el admin (opcional: sin keys, `POST /uploads/image` responde 503)
- PayPhone (Cajita de Pagos): `PAYPHONE_TOKEN` + `PAYPHONE_STORE_ID`; el server solo confirma
- Vercel: `api/index.ts` es la función; `vercel.json` reescribe todo a `/api`. Producción en
  `https://api.pantuflas.ec` (alias `https://dev-project-back.bakano.ec`) (proyecto `pantuflasec-backapp`, team proyectos-de-diego).

## Architecture

### Request Flow

`Express app → CORS → JSON parser (50mb) → /api router → handlers → globalErrorHandler`

### Layered Structure

- **Routes** (`src/routes/`) — definen endpoints, aplican `authMiddleware`, delegan al controller
- **Controllers** (`src/controllers/`) — parsean req, llaman al service, responden. Sin lógica de negocio.
- **Services** (`src/services/`) — lógica de negocio y APIs externas. Lanzan `CustomError`.
- **Models** (`src/models/`) — schemas Mongoose

### Módulos de la tienda

- **products** — `Product` con `variants[]` (talla/color, stock y precio propio o `null` = base)
  e `images[]`. Público: `GET /products` (q, category, collection, featured, sort, page),
  `/products/facets`, `/products/:slug`. Admin: `/products/admin/all`, `/products/admin/:slug`,
  POST/PUT/DELETE. Búsqueda con índice `$text`. `reserveStock()` descuenta stock de forma atómica.
- **orders** — `POST /orders` valida precios y stock contra la base (nunca confía en el carrito),
  calcula `subtotal + envío + IVA (TAX_RATE)` y devuelve `{ order, payphone }` con los montos
  en centavos para `PPaymentButtonBox`. PayPhone redirige al front con `id` y
  `clientTransactionId`; `POST /orders/confirm` llama a `paymentbox…/api/confirm`, marca pagado,
  descuenta stock y manda correos. Es idempotente. Hay 5 min para confirmar o PayPhone reversa.
  Público: `/orders/config`, `/orders/track/:token` (token = clientTransactionId, un UUID).
  Admin: `/orders/admin/all`, `/orders/admin/:id`, `PUT /orders/admin/:id/status`.
- **config/shop.ts** — métodos de envío y estados de pedido. Cambiar precios de envío ahí.
- **users** — admin: `GET/POST /users`, `PUT /users/:id` (nombre, teléfono, rol, activo,
  contraseña), `DELETE /users/:id`. Un admin no puede quitarse el rol ni desactivarse a sí mismo.
  `pnpm user:create <correo> <clave> [admin|customer] [nombre]` crea o actualiza desde la terminal.
- **gallery** — fotos de la portada que el admin ordena: `GET /gallery` (activas, en orden),
  admin `GET /gallery/admin/all`, `POST /gallery`, `PUT /gallery/reorder` ({ ids }), `PUT/DELETE /gallery/:id`.
- **uploads** — biblioteca en Cloudinary bajo `pantuflasec/<carpeta>`: `GET /uploads` (paginado por
  `cursor`), `POST /uploads/image` (multipart `file` + `folder`), `DELETE /uploads/:publicId`
  (rechaza si un producto la usa), `GET /uploads/status`.
- **Fotos: nunca locales.** Toda imagen de producto es una URL de Cloudinary. Para pasar las del
  catálogo importado: `pnpm images:migrate <carpeta con los .webp>` (idempotente).

### Key Patterns

- **Env:** solo `src/config/env.ts` lee `process.env`. No lo leas en otro archivo.
- **Errores:** `throw new CustomError("Mensaje en español", 404)`; `globalErrorHandler` responde `{ message }` y avisa a Slack en 5xx.
- **Auth:** `authMiddleware` verifica el Bearer y deja `req.user` (`AuthRequest`). Gates de rol van después (`adminMiddleware`).
- **Respuestas:** cuerpo desnudo (`res.json(item)`), paginación `{ items, total, page, pages }`, login `{ token, user }`.
- **Mongo serverless:** `dbConnect()` cachea la promesa; nunca `process.exit` en Vercel.

## Convenciones

- Comillas dobles, punto y coma, 2 espacios. Prettier lo aplica.
- Exports nombrados. La única excepción son los routers (`export default router`).
- Archivos camelCase + sufijo con punto: `product.controller.ts`, `product.routes.ts`, `product.service.ts`, `product.model.ts`, `auth.middleware.ts`.
- Controllers se importan como namespace: `import * as productController from "../controllers/product.controller"`.
- Identificadores genéricos en inglés; dominio, comentarios, mensajes y commits en español.
- Comentarios explican el porqué, no el qué.
