# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `pnpm dev` (ts-node-dev con auto-restart, puerto 8100)
- **Build:** `pnpm build` (tsc → `dist/`)
- **Start prod:** `pnpm start`
- **Format:** `pnpm format` (Prettier)
- **Seed admin:** `pnpm seed:admin`
- **Importar catálogo:** `pnpm seed:catalog <catalog.json> [--reset]` (upsert por slug; conserva stock editado)
- **Comisión PayPhone en precios:** `pnpm prices:adjust <respaldo.json> [--apply]` sube precio,
  variantes y precio tachado a `P / 0,9425` redondeado a $0,05 y marca `feeIncludedAt`; no repite en
  productos ya marcados. Se corrió el 2026-09-08 sobre 559 productos. Los precios nuevos que cargue el
  admin ya deben traer la comisión (no hay recargo por tarjeta en el checkout).
- **No hay linter ni tests.** `pnpm build` es la única verificación.

## Tech Stack

- Express 5 + TypeScript (CommonJS, target ES2024)
- MongoDB via Mongoose (`DB_URI`)
- JWT Bearer (`JWT_SECRET`, 30 días)
- Resend para correo desde `team@pantuflas.ec` (dominio verificado; sin key no envía)
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
  e `images[]`. `newArrival` marca la sección "Nuevo" (no se llama `isNew`: Mongoose lo reserva).
  `showOnHome` lo saca en el inicio agrupado por colección (check "Mostrar en el inicio").
  Público: `GET /products` (q, category, collection, featured, newArrival, showOnHome, sort, page),
  `/products/facets`, `/products/:slug`. Admin: `/products/admin/all`, `/products/admin/:slug`,
  POST/PUT/DELETE. Búsqueda con índice `$text`. `reserveStock()` descuenta stock de forma atómica.
- **orders** — `POST /orders` valida precios y stock contra la base (nunca confía en el carrito).
  **Los precios ya incluyen IVA** (`taxIncluded: true`): `tax` es el desglose informativo
  (`subtotal - subtotal/1.15`) y `total = subtotal + envío`. Recibe `payment.method`
  (`payphone` | `transfer` | `cash`, enum en `config/shop.ts`) y devuelve `{ order, payphone }`:
  con tarjeta `payphone` trae los montos en centavos para `PPaymentButtonBox`; con los otros dos
  es `null` y el pedido queda reservado (`pending_payment`). Efectivo solo con retiro en tienda.
  PayPhone redirige al front con `id` y `clientTransactionId`; `POST /orders/confirm` llama a
  `paymentbox…/api/confirm` y cierra con `markPaid()` (`orderPayment.service.ts`: estado, stock,
  correos), igual que aprobar una transferencia. Es idempotente. Hay 5 min o PayPhone reversa.
  **Transferencia:** el cliente sube la captura con `POST /orders/track/:token/proof` (multipart
  `file` + `note`, va a Cloudinary en `pantuflasec-comprobantes/`, fuera de la biblioteca);
  `payment.status` pasa a `review` y se avisa al admin. El equipo resuelve con
  `PUT /orders/admin/:id/payment` `{ action: approve|reject, reason }`; rechazar guarda
  `rejectReason`, avisa al cliente y deja subir otra captura. Efectivo se aprueba igual al retirar.
  **Mensajes:** `order.messages[]` (cliente ↔ equipo). `POST /orders/track/:token/messages` y
  `POST /orders/admin/:id/messages` (`orderMessage.service.ts`); cada lado recibe correo.
  Público: `/orders/config`, `/orders/track/:token` (token = clientTransactionId, un UUID),
  `POST /orders/lookup` ({ email }) que manda por correo los enlaces de los pedidos (siempre 200).
  Cada pedido guarda `siteUrl` (origen permitido de la petición, `utils/origin.ts`): los
  correos enlazan a ese dominio, sea pantuflas.ec, el de pruebas o localhost.
  Correos (`orderEmail.service.ts`): admin al crear pedido, cliente + admin al pagar, cliente en
  cada cambio de estado (preparing, shipped, delivered, cancelled). Plantilla con logo en `email.service.ts`.
  `GET /orders/admin/summary` da el contador de pedidos por atender para el header (pagados +
  empacando + comprobantes por revisar). `GET /orders/admin/all` filtra también por `pay=review`.
  Cada pedido lleva `events[]` (creado, pago, correo enviado o fallido, cambio de estado, contacto
  por WhatsApp/llamada/correo, nota) que alimenta el historial del panel; el equipo anota contactos
  con `POST /orders/admin/:id/events`. La validación del checkout vive en `orderInput.service.ts`.
  Admin (`orderAdmin.service.ts`): `/orders/admin/all`, `/orders/admin/:id`, `PUT /orders/admin/:id/status`.
  Correos de transferencia, efectivo, comprobante y mensajes en `paymentEmail.service.ts`.
- **config/shop.ts** — métodos de pago y estados; los métodos de envío ahí son solo el arranque.
- **maps** (`maps.service.ts` + `maps/links.ts`, `maps/routing.ts`, portado de Teque Cruncheese) —
  entrega en moto por distancia: `GET /orders/quote?location=` recibe "lat,lng" del mapa, un link
  de Google Maps o una dirección y devuelve km por carretera desde La Garzota (`STORE_LAT/LNG`) y el
  precio del tarifario `DELIVERY_TARIFF` (`config/shop.ts`, Let's Go Delivery + $0,50; hasta 22 km).
  Rutea con Google Routes si hay `GOOGLE_MAPS_API_KEY` (padding `GOOGLE_KM_FACTOR`) y si no con
  Valhalla y OSRM, gratis. El método de envío `kind: distance` usa esa cotización en
  `validateShipping` (nunca el precio del navegador) y guarda `shipping.location/coords/km`.
- **shipping** (`shipping.service.ts`) — métodos de entrega que edita el admin (`Setting` clave
  `shipping`): retiros (`kind: pickup`, con dirección y ciudad, clave `pickup-…`) y envíos con
  precio y descripción (clave `envio-…`) y moto por distancia (`kind: distance`, clave `moto-…`). `GET/PUT /settings/shipping` admin; el checkout lee los
  activos por `/orders/config` y `validateShipping` valida contra ellos. Las claves se conservan
  al editar porque los pedidos viejos las referencian.
- **settings** — ajustes que edita el admin (`Setting`, un doc por clave, validados en
  `setting.service.ts`): `hero` (portada del home: foto, título, botón; pública en
  `GET /settings/hero`) y `payments` (cuentas bancarias e instrucciones de transferencia y
  efectivo; `GET/PUT /settings/payments` admin). `GET /orders/config` incluye `payments` y
  `taxIncluded` para el checkout.
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
- **Auth:** `authMiddleware` verifica el Bearer y deja `req.user` (`AuthRequest`). Gates de rol van
  después: `adminMiddleware` (solo admin: catálogo, galería, archivos, usuarios) y `staffMiddleware`
  (admin o staff: pedidos). Roles: `customer`, `staff` (vendedor), `admin`.
- **Respuestas:** cuerpo desnudo (`res.json(item)`), paginación `{ items, total, page, pages }`, login `{ token, user }`.
- **Mongo serverless:** `dbConnect()` cachea la promesa mientras conecta y la descarta al
  desconectarse (si no, tras un reposo devolvía "conectado" con la conexión caída y todo
  respondía 503). `api/index.ts` reintenta la conexión tres veces en arranques fríos. Nunca
  `process.exit` en Vercel.

## Convenciones

- Comillas dobles, punto y coma, 2 espacios. Prettier lo aplica.
- Exports nombrados. La única excepción son los routers (`export default router`).
- Archivos camelCase + sufijo con punto: `product.controller.ts`, `product.routes.ts`, `product.service.ts`, `product.model.ts`, `auth.middleware.ts`.
- Controllers se importan como namespace: `import * as productController from "../controllers/product.controller"`.
- Identificadores genéricos en inglés; dominio, comentarios, mensajes y commits en español.
- Comentarios explican el porqué, no el qué.
