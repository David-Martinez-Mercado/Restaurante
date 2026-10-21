# 🥩 Asador La Brasa — Sistema de gestión de restaurante

Proyecto de **Arquitectura Orientada a Servicios**: microservicios REST en capas
(Routes → Controller → Service → Repository), un API Gateway en NestJS y un front en React.
Implementa la **triple A**: **A**utenticación, **A**utorización y **A**ccounting (auditoría).

Además del panel del personal, incluye un **portal para el cliente en línea** (pedir para recoger, pagar, reservar),
**notificaciones** (campana en la app y **Telegram**) y la **API de pago lista para conectar a la pasarela** de otro equipo.

También funciona como **checador** (entrada/salida del personal), **nómina** (con el motor del repo
[SistemaNomina](https://github.com/EmilianoNajeraCervantes/SistemaNomina) de otro autor, **sin modificarlo**) y **calculadora de IVA**.
Detalle en [docs/INTEGRACION-NOMINA.md](docs/INTEGRACION-NOMINA.md).

## 1. Qué necesitas instalado

| Herramienta | Versión | Para qué | Cómo comprobarlo |
|---|---|---|---|
| **Node.js** | 22 o superior | Ejecutar los servicios y el front | `node --version` |
| **Docker Desktop** | cualquiera reciente | Base de datos PostgreSQL | `docker --version` |

- Docker debe estar **abierto y en ejecución** antes de empezar.
- La primera vez se necesita **internet** (paquetes de npm, motores de Prisma e imagen de PostgreSQL).
- ¿No puedes usar Docker? Mira [Sin Docker](#sin-docker-usar-un-postgresql-propio).
- Recomendado: **4 GB de RAM libres** (se levantan 12 procesos de Node). `npm start` los arranca **uno por uno** para no saturar equipos con poca memoria.
- **git**: el motor de nómina viene como *submódulo*. Si descargas el proyecto con git, usa `git clone --recurse-submodules <url>` (o, después, `npm run setup:nomina`, que lo descarga solo).

## 2. Puesta en marcha

Abre una terminal **dentro de la carpeta `Restaurante`** (la que tiene este README y `package.json`).

```bash
# 1. Instalar dependencias (tarda un par de minutos)
npm install

# 2. Preparar todo: crea los .env con secretos aleatorios, prepara el motor de nómina externo,
#    levanta PostgreSQL en Docker, genera los clientes de base de datos y crea las tablas.
npm run setup:all

# 3. Arrancar el sistema completo (gateway + 10 servicios + motor de nómina + front), escalonado
npm start
```

Cuando la terminal muestre `✔ Todo arriba`, en **otra terminal** (misma carpeta):

```bash
# 4. Cargar menú, mesas, cuentas de demostración, un pedido en línea y una reservación
npm run seed
```

5. Abre **http://localhost:5173** e inicia sesión.

Para detener: `Ctrl + C` en la terminal de `npm start`. Para apagar la base de datos: `npm run db:down`
(los datos se conservan; para borrarlos: `docker compose down -v`).

> Comprobación rápida: `http://localhost:3000/api/v1/gateway/health` debe responder
> `{"status":"ok","services":{"user":"up","menu":"up","order":"up","audit":"up","customer":"up","reservation":"up","notification":"up","payment":"up","attendance":"up","payroll":"up"}}`.

> **Atajo en Windows:** doble clic en **`iniciar.bat`** hace todo lo anterior (abre Docker si hace falta, prepara y arranca). `cargar-datos.bat` carga la demostración y `detener.bat` apaga todo.

> **¿Ya tenías la versión anterior?** Ejecuta `npm install`, `npm run setup` (agrega a tus `.env` solo las variables nuevas, sin tocar las que ya tienes),
> `npm run setup:nomina`, `npm run prisma:generate` y `npm run db:push`.

### Cuentas de demostración (después de `npm run seed`)

| Usuario | Contraseña | Rol | Qué puede hacer |
|---|---|---|---|
| `admin` | `Admin1234` | Administrador | Todo, incluido dar de alta al personal y **aprobar** la nómina |
| `gerente` | `Demo1234` | Gerente | Menú, mesas, pedidos, reservaciones, pagos, avisos, auditoría, asistencia, sueldos, **calcular** nómina e IVA |
| `mesero` | `Demo1234` | Mesero | Abrir pedidos, servir, reservaciones (llegada del cliente), checador |
| `cocinero` | `Demo1234` | Cocinero | Preparar pedidos, marcar platillos como agotados, checador |
| `cajero` | `Demo1234` | Cajero | Cobrar (efectivo/tarjeta), ver pagos en línea, checador, IVA |
| `cliente` | `Demo1234` | Cliente | Portal: pedir en línea, pagar, reservar, perfil, Telegram |

El **registro público siempre crea clientes**. Las cuentas del personal las crea el administrador (pestaña *Usuarios* → **Nuevo usuario**).
El administrador inicial sale de `BOOTSTRAP_ADMIN_*` en `services/user/.env`.

## 3. Recorridos sugeridos para la demostración

### Cliente en línea (≈ 4 min)
1. Entra como **`cliente`** → *Pedir en línea*: elige platillos y **Hacer pedido** (el precio sale del menú, nunca del cliente).
2. En otra ventana, **`cocinero`**: *Pedidos* → **Preparar** → **Marcar listo**.
3. Vuelve al cliente: en pocos segundos suena la **campana 🔔** y aparece el aviso **"¡Tu pedido está listo!"** (y llega a Telegram si lo vinculó).
4. *Mis pedidos* → **Pagar en línea**: mientras la pasarela no esté conectada, se muestra **lo que se enviará** y **lo que se espera recibir** (el contrato).
5. *Reservaciones*: elige día, personas y **hora de llegada** → **Reservar**. Recibirás la confirmación, y un **recordatorio** cuando falten ~30 min.
6. Al terminar de consumir, el cajero **cobra** (efectivo o tarjeta): el cliente recibe el **resumen del consumo** (platillos, importes y método de pago) con la pregunta **"¿Vas a facturar?"**.

### Personal (≈ 5 min)
1. **Mesero**: *Pedidos* → **Nuevo pedido** (opcional: ligarlo a un cliente registrado para que reciba su resumen).
2. **Cocinero**: **Preparar** → **Marcar listo**; en *Menú* marca un platillo **agotado**.
3. **Mesero**: **Servir**. **Cajero**: **Cobrar** → elige *Efectivo* o *Tarjeta*. La mesa queda **libre**.
4. **Mesero** → *Reservaciones*: **Llegó** registra la **hora real de llegada** (y mesa); **No llegó** solo se permite 15 min después de la hora.
5. **Gerente**: *Avisos* (bitácora de envíos y su resultado), *Pagos en línea* y *Auditoría* (incluye intentos **denegados**).

### Checador, nómina e IVA (≈ 5 min)
1. **Mesero/cocinero/cajero** → *Checador*: **Checar ENTRADA** y luego **SALIDA**; ve sus horas del mes, sus faltas y sus recibos.
2. **Gerente** → *Asistencia*: resumen del mes de todo el personal (horas, **horas extra**, **faltas**). **Corregir** una jornada olvidada (el motivo es obligatorio).
3. **Gerente** → *Nómina*: asigna sueldos y pulsa **Calcular** el mes anterior (el seed ya trae asistencia). Las horas extra y faltas salen del checador; **ISR/IMSS/Infonavit y el neto los calcula el motor SistemaNomina**.
4. **Admin** → *Nómina* → **Aprobar** (el gerente que calculó no puede aprobar). Ahora cada trabajador ve su recibo en *Checador*.
5. **Cajero/gerente** → *IVA*: **agrega** o **desglosa** el IVA de un monto (16 %, 8 % o 0 %) y consulta el **IVA trasladado** de los pedidos pagados.

## 4. Arquitectura

```
Navegador ──► Front React :5173  (panel del personal  ·  portal del cliente)
                  │  (solo habla con el gateway; el proxy de Vite evita CORS)
                  ▼
        ┌─────────────────────┐
        │ API Gateway (NestJS)│ :3000   verifica el JWT, reenvía por HTTP, audita lo denegado
        └─────────┬───────────┘         (NO publica ninguna ruta /internal)
   ┌────────┬─────┴───┬────────┬───────────┬────────────┬────────────┬─────────┬───────────┬─────────┐
   ▼        ▼         ▼        ▼           ▼            ▼            ▼         ▼           ▼
 User     Menu      Order    Audit     Customer    Reservation  Notification  Payment   Attendance  Payroll
 :3001    :3002     :3003    :3004     :3008       :3007        :3005         :3006     :3009       :3010
 Auth     CRUD      Lógica   Accounting Perfil,     Horario,     Campana +     Cobro en  Checador    Sueldos,
 (JWT)    platillos pedidos  (bitácora) fiscales,   aforo,       Telegram +    línea     (horas,     recibos,
          y mesas   + IVA               Telegram    recordatorio bot de        (contrato extras,     aprobación
                    (calculadora)                                reservas      pasarela) faltas)         │
                                                                                                         ▼  HTTP (adaptador)
                                                    Motor externo SistemaNomina — repo de otro autor, SIN modificar,
                                                    solo en 127.0.0.1: empleados :3102 · nómina :3103 · incidencias :3104
```

| Servicio | Puerto | Tecnología | Responsabilidad |
|---|---|---|---|
| Front | 5173 | React + Vite | Panel del personal y portal del cliente |
| **Gateway** | 3000 | **NestJS** | Único punto de entrada. Autentica con JWT, enruta, deja pasar el webhook firmado |
| User | 3001 | Express | Registro de clientes, alta de personal, login, refresh con rotación |
| **Menu** | 3002 | Express + Prisma | **CRUD** de platillos y mesas |
| **Order** | 3003 | Express + Prisma | **Lógica**: totales con IVA, estados, pedido en mesa y en línea; **calculadora de IVA** e IVA trasladado |
| Audit | 3004 | Express + Prisma | **Accounting**: recibe eventos y los resume |
| **Notification** | 3005 | Express + Prisma | Avisos (campana y Telegram), bitácora de envíos y **bot de Telegram** |
| **Payment** | 3006 | Express + Prisma | Cobros en línea: **contrato con la pasarela** (sin lógica de pasarela) |
| **Reservation** | 3007 | Express + Prisma | Reservaciones con hora de llegada, aforo y recordatorios |
| **Customer** | 3008 | Express + Prisma | Perfil del cliente, datos fiscales y vínculo con Telegram |
| **Attendance** | 3009 | Express + Prisma | **Checador**: entradas/salidas, horas, horas extra y faltas; correcciones del gerente con motivo |
| **Payroll** | 3010 | Express + Prisma | **Nómina**: sueldos, cálculo con el motor externo, aprobación y recibos |
| SistemaNomina *(externo)* | 3102–3104 | Express + SQLite | Repo de otro autor, sin modificar: calcula ISR, IMSS, Infonavit y neto. Solo 127.0.0.1 |
| PostgreSQL | 5432 | Docker | Un esquema por servicio (`user_service`, `menu_service`, …) |

Ideas clave:

- **Cada servicio es dueño de sus datos** (su propio esquema); se hablan por HTTP, nunca leen tablas ajenas.
- **Rutas internas** (`/api/v1/internal/*`) entre servicios, protegidas con `x-internal-key`; el gateway **no las publica**, así que nadie desde afuera puede, por ejemplo, marcar un pedido como pagado.
- **Eventos de dominio** (`order.ready`, `order.paid`, `payment.confirmed`, `reservation.*`) viajan al Notification Service en modo *fire and forget*: si los avisos fallan, el negocio sigue.
- **Dos tecnologías, un contrato:** el gateway es NestJS y los servicios Express; solo comparten el contrato HTTP/JSON.
- Cada pedido guarda una **copia** del nombre y precio del platillo: cambiar el menú no altera pedidos anteriores.

### Flujo de eventos

```
Order ──order.ready / order.paid──────────┐
Payment ──payment.confirmed───────────────┼──► Notification ──► campana (in_app)
Reservation ──confirmed/reminder/cancelled┘        │          └► Telegram (bot)
                                                   └► bitácora de envíos (sent / simulated / failed / skipped)

Pasarela ──webhook firmado──► Gateway ──► Payment ──payment-confirmed (interno)──► Order
```

## 5. Telegram

El bot hace dos cosas: **avisar** (pedido listo, recordatorio de reservación, resumen de consumo) y **permitir reservar**.

1. En Telegram abre **@BotFather**, escribe `/newbot` y copia el **token** que te da.
2. En `services/notification/.env` pon `TELEGRAM_BOT_TOKEN=<token>` y `TELEGRAM_BOT_USERNAME=<nombre_del_bot>` y reinicia (`npm start`).
3. El cliente va a **Mi perfil → Generar código de vinculación** y abre el enlace (o escribe `/start CODIGO` al bot).

Comandos del bot: `/reservar` (elige día → personas → hora de llegada con botones), `/misreservaciones`, `/cancelar CODIGO`, `/ayuda`.
Quien no tiene cuenta también puede reservar: el bot le pide su nombre.

Sin token, Telegram funciona en **modo simulado**: los mensajes se registran en *Avisos* como "Simulado" pero no salen, y todo lo demás sigue funcionando. El bot usa *long polling*, así que no necesita URL pública.

> El envío real a Telegram no se pudo probar en el entorno de desarrollo (requiere un token propio); la lógica del bot sí está cubierta con pruebas y el modo simulado se verificó de punta a punta.

## 6. Pagos en línea y pasarela

El restaurante **no procesa tarjetas ni incluye lógica de la pasarela**: solo cumple un contrato de dos sentidos.

- **Lo que envía** (`POST {PAYMENT_GATEWAY_URL}/v1/charges`): referencia, importe en centavos, descripción, cliente, líneas, `returnUrl` y `webhookUrl`.
- **Lo que recibe** (`POST /api/v1/payments/webhook`): aviso `payment.succeeded | failed | expired` con **firma HMAC-SHA256** (`x-signature`), idempotente por `eventId`, con validación del importe.

Documentación completa para quien construye la pasarela, con ejemplos: **[docs/CONTRATO-PASARELA-DE-PAGO.md](docs/CONTRATO-PASARELA-DE-PAGO.md)**.
Con `PAYMENT_GATEWAY_URL` vacío (por defecto) el cobro queda *pendiente* y la API muestra el cuerpo que se enviaría. Para probar todo el flujo en el navegador sin la pasarela real:

```bash
node scripts/fake-gateway.mjs     # pasarela falsa en :4100
# pon PAYMENT_GATEWAY_URL=http://localhost:4100 en services/payment/.env y reinicia
```

## 7. Triple A

**Autenticación.** JWT de acceso (15 min) + refresh token rotativo (7 días). Gateway y servicios verifican la firma; un refresh token nunca sirve como token de acceso. El webhook de la pasarela se autentica con su firma HMAC; las rutas internas, con la llave interna.

**Autorización.** Permisos granulares (`packages/core/src/permissions.ts`): cada endpoint exige un permiso, no un rol, y el gateway y **cada servicio** lo comprueban. Lo propio y lo ajeno se separan con permisos `-own` / `-all`: un cliente solo ve **sus** pedidos, pagos, reservaciones y avisos (lo ajeno responde 404).

| Permiso | admin | manager | waiter | cook | cashier | customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| users:read / users:manage | ✔ / ✔ | ✔ / | | | | |
| dishes:read | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| dishes:write | ✔ | ✔ | | | | |
| dishes:availability (agotado) | ✔ | ✔ | | ✔ | | |
| tables:read · tables:update-status | ✔ | ✔ | ✔ | | ✔ | |
| tables:write | ✔ | ✔ | | | | |
| orders:read · orders:create | ✔ | ✔ | ✔ | | | |
| orders:prepare | ✔ | ✔ | | ✔ | | |
| orders:serve · orders:cancel | ✔ | ✔ | ✔ | | | |
| orders:pay (cobro en mostrador) | ✔ | ✔ | | | ✔ | |
| orders:create-online · orders:read-own | ✔ | | | | | ✔ |
| customers:read (buscar clientes) | ✔ | ✔ | ✔ | | | |
| customers:self (mi perfil) | ✔ | | | | | ✔ |
| payments:create · payments:read-own | ✔ | | | | | ✔ |
| payments:read-all | ✔ | ✔ | | | ✔ | |
| reservations:create | ✔ | ✔ | ✔ | | | ✔ |
| reservations:read-all · reservations:manage | ✔ | ✔ | ✔ | | | |
| reservations:read-own | ✔ | | | | | ✔ |
| notifications:read-own | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| notifications:read-all (bitácora) | ✔ | ✔ | | | | |
| attendance:clock (checar) | ✔ | ✔ | ✔ | ✔ | ✔ | |
| attendance:read-all · attendance:manage | ✔ | ✔ | | | | |
| payroll:read-own (mi recibo) | ✔ | ✔ | ✔ | ✔ | ✔ | |
| payroll:read-all · payroll:manage (sueldos) · payroll:calculate | ✔ | ✔ | | | | |
| payroll:approve | ✔ | | | | | |
| tax:calculate · tax:report | ✔ | ✔ | | | ✔ | |
| audit:read | ✔ | ✔ | | | | |

**Accounting.** Cada acción relevante (login, altas, pedidos, pagos, confirmaciones de la pasarela, reservaciones y también los intentos **denegados** 401/403) genera un evento *quién · qué · sobre qué · cuándo · resultado* que va al Audit Service. Un importe alterado en el webhook queda como `payments.webhook-amount-mismatch` (denegado); un pago de un pedido ya cancelado, como `payments.refund-required`. La ingesta exige una llave interna que el gateway **no** reenvía. Consulta: `GET /api/v1/audit` y `/audit/summary`.

## 8. Reglas de negocio

**Pedidos**

| Regla | Detalle |
|---|---|
| Totales | Subtotal = Σ precio del menú × cantidad; **IVA 16 %** redondeado al centavo |
| Canales | *En mesa* (lo toma el personal, una mesa un pedido activo) y *en línea para recoger* (lo hace el cliente; requiere su perfil) |
| Estados | `pending → preparing → ready → served → paid`; se cancela solo desde `pending` o `preparing` |
| Permiso por paso | Preparar/listo: cocina · Servir: mesero · Cobrar: cajero · Cancelar: mesero/gerente |
| Cobro en mostrador | El cajero **debe indicar** efectivo o tarjeta |
| Pago en línea | Un pedido ya pagado en línea pasa directo a *pagado* al servirlo, y **no se puede cancelar** |
| Aviso de "listo" | Al pasar a *listo*, si el pedido es de un cliente registrado, se le avisa en la campana y por Telegram |
| Fin del consumo | Al quedar *pagado* el cliente recibe el **resumen** (platillos, importes y método de pago) y la pregunta **"¿Vas a facturar?"** |

**Reservaciones**

| Regla | Detalle |
|---|---|
| Hora de llegada | De 13:00 a 22:00 en bloques de 30 min (`RESERVATION_*` en `services/reservation/.env`) |
| Aforo | 40 comensales; cada reservación ocupa 2 h. La captura es atómica: dos solicitudes simultáneas no sobrepasan el aforo |
| Anticipación | Mínimo 30 min y máximo 60 días; grupos de 1 a 12 |
| Cancelar | El cliente, hasta 1 h antes (el personal, siempre) |
| Llegada | El mesero la registra desde 1 h antes y se guarda la **hora real**; "no se presentó" solo 15 min después |
| Recordatorio | Cuando faltan ~30 min se avisa **una sola vez** (campana + Telegram) |
| Origen | Portal web, Telegram (incluso sin cuenta) o mostrador |

**Checador y nómina** (detalle en [docs/INTEGRACION-NOMINA.md](docs/INTEGRACION-NOMINA.md))

| Regla | Detalle |
|---|---|
| Checar | Cualquier trabajador marca su entrada y salida; la hora la pone el servidor y la identidad sale del token. Una sola jornada abierta a la vez |
| Jornada olvidada | Una entrada abierta más de 16 h no permite checar salida: el gerente la **corrige con motivo obligatorio** (queda en la bitácora) |
| Horas extra | Lo que pase de 8 h en el día; se pagan al **doble** (hora = sueldo ÷ 30 ÷ 8) |
| Faltas | Día laborable (lunes a sábado) anterior a hoy sin ningún registro, desde la fecha de ingreso; cada una descuenta **un día** de sueldo |
| Cálculo de impuestos | ISR, IMSS, Infonavit, subsidio y neto: **motor externo SistemaNomina** (simplificado, del otro autor) |
| Separación de funciones | El gerente captura sueldos y **calcula**; solo el **administrador aprueba**, y nunca quien calculó. Una nómina aprobada no se recalcula |
| Recibos | Cada trabajador ve solo los suyos, y solo de nóminas aprobadas |
| Calculadora de IVA | Agrega o desglosa IVA (16 %, 8 %, 0 %) en centavos enteros: base + IVA = total siempre. Reporte de IVA trasladado de pedidos pagados |

## 9. API (todo a través del gateway, puerto 3000)

| Método y ruta | Permiso |
|---|---|
| `POST /api/v1/auth/register` (cliente) · `login` · `refresh-token` · `logout` | públicas |
| `GET /auth/me` · `GET /auth/users` · `POST /auth/users` | token · `users:read` · `users:manage` |
| `/dishes`, `/tables` (CRUD, `PATCH …/availability`, `PATCH …/status`) | `dishes:*` / `tables:*` |
| `GET/POST /orders` · `PATCH /orders/:id/status` (con `paymentMethod` al cobrar) | `orders:*` según el paso |
| `POST /orders/online` · `GET /orders/mine` · `GET /orders/mine/:id` | `orders:create-online` / `orders:read-own` |
| `GET/PUT /customers/me` · `POST /customers/me/telegram-link` · `DELETE /customers/me/telegram` | `customers:self` |
| `GET /customers?search=` · `GET /customers/:id` | `customers:read` |
| `GET /reservations/availability?date=&partySize=` · `POST/GET /reservations` · `PATCH /reservations/:id/status` | `reservations:*` |
| `POST /payments` · `GET /payments/mine` · `GET /payments/:id` · `GET /payments` | `payments:*` |
| `POST /payments/webhook` | **pública**, firma HMAC |
| `GET /notifications/mine` · `…/unread-count` · `PATCH /:id/read` · `POST …/read-all` · `GET /notifications/telegram` | `notifications:read-own` |
| `GET /notifications` (bitácora de envíos) | `notifications:read-all` |
| `POST /attendance/clock-in` · `clock-out` · `GET /attendance/me/status` · `/me` · `/me/summary?period=` | `attendance:clock` |
| `GET /attendance?from=&to=&userId=` · `GET /attendance/summary?period=` · `POST /attendance/manual` · `PATCH /attendance/:id` | `attendance:read-all` / `attendance:manage` |
| `GET /payroll/me` (mis recibos aprobados) | `payroll:read-own` |
| `GET /payroll/compensations` · `GET /payroll/runs` · `GET /payroll/runs/:period` · `GET /payroll/engine` · `/engine/transactions` · `/engine/data` | `payroll:read-all` |
| `PUT /payroll/compensations/:userId` | `payroll:manage` |
| `POST /payroll/runs` (calcular) · `POST /payroll/runs/:period/approve` | `payroll:calculate` / `payroll:approve` |
| `POST /tax/calculate` · `GET /tax/report?from=&to=` | `tax:calculate` / `tax:report` |
| `GET /audit` · `GET /audit/summary` | `audit:read` |

## 10. Pruebas

```bash
npm test          # 421 pruebas unitarias de todos los workspaces (no necesitan base de datos)
npm run smoke     # 229 comprobaciones de extremo a extremo; requiere el sistema en marcha (npm start)
```

`npm run smoke` crea sus propios datos y se puede repetir las veces que se quiera. Cubre autenticación, autorización,
pedidos (mesa y en línea), aviso de "listo", pago con webhook firmado (firma inválida, importe alterado, duplicado), resumen de consumo,
Telegram simulado, reservaciones, calculadora de IVA, checador, una **nómina calculada por el motor externo** (sin duplicar incidencias al recalcular) y auditoría.

## 11. Problemas comunes

| Síntoma | Solución |
|---|---|
| `docker: command not found` o `error during connect` | Abre Docker Desktop, espera a que esté "Running" y repite `npm run setup:all` |
| Puerto `5432` (u otro) ocupado (en el equipo de desarrollo se usó `POSTGRES_PORT=5433`) | Cambia `POSTGRES_PORT` en el `.env` de la raíz **y** el puerto en el `DATABASE_URL` de `services/*/.env`. `npm run setup` respeta ese puerto al crear los `.env` nuevos. Si otro programa usa 3000–3008 o 5173, detenlo |
| `Fatal process out of memory` / procesos que se caen | Falta RAM. Cierra aplicaciones pesadas y usa `npm start` (arranque escalonado; no `npm run dev`, que usa *watch*). Para probar solo el backend: `npm run start:backend` |
| `Authentication failed` / `P1000` de Prisma | Hay otro PostgreSQL en ese puerto; cambia `POSTGRES_PORT` como arriba |
| `Cannot find module ... generated/client` | Falta generar Prisma: `npm run prisma:generate` |
| El seed dice "No se pudo conectar" o "No se pudo entrar como admin" | Espera el mensaje `✔ Todo arriba`; el admin es el de `BOOTSTRAP_ADMIN_*` en `services/user/.env` |
| El pago dice "Pasarela pendiente de conectar" | Es lo esperado sin pasarela. Mira la sección 6 |
| Telegram aparece como "Simulado" | Falta `TELEGRAM_BOT_TOKEN` (sección 5) |
| Nómina dice "Motor de nómina apagado" o `503 … de nómina externo` | El motor SistemaNomina no está levantado: `npm run setup:nomina` (una vez) y `npm start`. Si falta la carpeta `integraciones/SistemaNomina`, se descarga con ese comando |
| `integraciones/SistemaNomina` está vacía | Faltó el submódulo: `git submodule update --init` o `npm run setup:nomina` |
| Empezar de cero | `Ctrl+C`, `docker compose down -v`, `npm run setup:all`, `npm start`, `npm run seed` |
| Cambié un `.env` | Reinicia `npm start`. `JWT_ACCESS_SECRET` e `INTERNAL_API_KEY` deben ser **iguales** en todos (`npm run setup` ya lo garantiza) |

### Sin Docker (usar un PostgreSQL propio)

1. Crea usuario y base: `CREATE USER restaurante WITH PASSWORD 'restaurante'; CREATE DATABASE restaurante OWNER restaurante;`
2. Ejecuta `npm run setup` y, en cada `services/*/.env`, ajusta el puerto/credenciales del `DATABASE_URL` (deja el `?schema=` tal cual).
3. Continúa con `npm run prisma:generate`, `npm run db:push`, `npm start`.

## 12. Estructura

```
Restaurante/
├─ packages/            código compartido: core (errores, roles, permisos), auth (JWT), http (middlewares, eventos), contracts (esquemas Zod)
├─ services/            user · menu · order · audit · customer · reservation · notification · payment · attendance · payroll
├─ gateway/             API Gateway (NestJS)
├─ web/                 front (React + Vite): src/views (personal) · src/portal (cliente)
├─ integraciones/       SistemaNomina/ (submódulo: repo de otro autor, SIN modificar) · nomina-externo.cjs (lanzador nuestro)
├─ docs/                CONTRATO-PASARELA-DE-PAGO.md · INTEGRACION-NOMINA.md
├─ scripts/             setup · setup:nomina · seed · smoke · start-all (arranque escalonado) · fake-gateway · menu-data
├─ iniciar.bat          arranca todo (Windows) · cargar-datos.bat carga la demostración
├─ docker-compose.yml   PostgreSQL
└─ package.json         scripts: setup:all, start, start:backend, dev, seed, smoke, test, db:up, db:down
```
