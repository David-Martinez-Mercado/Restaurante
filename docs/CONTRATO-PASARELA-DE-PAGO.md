# Contrato con la pasarela de pago

Este documento es para quien construye la **pasarela de pago**. El restaurante (Asador La Brasa) **no procesa tarjetas ni contiene lógica de la pasarela**: solo cumple este contrato, que tiene dos sentidos.

| Sentido | Quién llama | Endpoint | Para qué |
|---|---|---|---|
| **Salida** | Restaurante → Pasarela | `POST {PAYMENT_GATEWAY_URL}/v1/charges` | Pedir un cobro y obtener la página de pago |
| **Entrada** | Pasarela → Restaurante | `POST {API_PUBLICA}/api/v1/payments/webhook` | Avisar si el cliente pagó, falló o venció |

- Importes **siempre en centavos** (entero) y moneda `MXN`. Ejemplo: $232.00 → `23200`.
- Fechas en ISO 8601 (`2030-06-04T18:05:00.000Z`).
- Los tipos oficiales están en `packages/contracts/src/payment.contracts.ts`.
- El código del restaurante que cumple esto está en `services/payment/` (Payment Service, puerto 3006).

## Flujo completo

```
Cliente        Restaurante (Payment Service)            Pasarela
   │  "Pagar"          │                                    │
   ├──────────────────►│ crea el cobro (pending)            │
   │                   ├──── POST /v1/charges ─────────────►│  (1) SALIDA
   │                   │◄──── 201 { checkoutUrl, ... } ─────┤
   │◄── redirige a checkoutUrl ──────────────────────────────┤
   │   (el cliente captura su tarjeta EN LA PASARELA)        │
   │                   │                                    │
   │                   │◄─── POST /webhook (firmado) ───────┤  (2) ENTRADA
   │                   │ valida firma e importe             │
   │                   │ marca pagado y avisa al pedido     │
   │                   ├──── 200 { received: true } ───────►│
   │◄── redirige a returnUrl ────────────────────────────────┤
```

Los datos de la tarjeta **nunca** pasan por el restaurante.

---

## 1. Salida: crear un cobro

El restaurante llama a la pasarela cuando el cliente pulsa "Pagar en línea".

```
POST {PAYMENT_GATEWAY_URL}/v1/charges
Content-Type: application/json
Idempotency-Key: <reference>
Authorization: Bearer <PAYMENT_GATEWAY_API_KEY>      ← solo si el restaurante la tiene configurada
```

`Idempotency-Key` es igual a `reference`: si llega dos veces el mismo cobro, la pasarela debe devolver el mismo resultado y **no** generar dos cargos.

### Cuerpo (`GatewayChargeRequest`)

```json
{
  "reference": "3f0c3b52-1a8c-4a40-9a39-1c6a0f6a7d11",
  "amountCents": 23200,
  "currency": "MXN",
  "description": "Pedido A1B2C3 · Asador La Brasa",
  "customer": { "id": "9d3a…", "name": "Ana López" },
  "items": [
    { "name": "Rib eye 400 g", "quantity": 2, "unitPriceCents": 42900 },
    { "name": "IVA", "quantity": 1, "unitPriceCents": 6000 }
  ],
  "returnUrl": "http://localhost:5173/portal?payment=3f0c3b52-1a8c-4a40-9a39-1c6a0f6a7d11",
  "webhookUrl": "http://localhost:3000/api/v1/payments/webhook"
}
```

| Campo | Descripción |
|---|---|
| `reference` | Id del cobro en el restaurante (UUID). **La pasarela debe devolverlo tal cual en el webhook.** |
| `amountCents` | Total a cobrar. Es la suma de `quantity × unitPriceCents` de `items` (el IVA viene como una línea más). |
| `currency` | Siempre `MXN`. |
| `description` | Texto para mostrar al cliente. |
| `customer` | Id y nombre del cliente. No se envían datos fiscales ni de contacto. |
| `items` | Desglose para mostrar en la página de pago. |
| `returnUrl` | A dónde regresar al cliente al terminar (pagado o cancelado). |
| `webhookUrl` | A dónde avisar el resultado (ver sección 2). |

### Respuesta esperada: `201 Created` (`GatewayChargeResponse`)

```json
{
  "gatewayReference": "gw_8f2c1a",
  "checkoutUrl": "https://pasarela.example/checkout/gw_8f2c1a",
  "expiresAt": "2030-06-04T18:30:00.000Z"
}
```

| Campo | Obligatorio | Descripción |
|---|---|---|
| `gatewayReference` | sí | Identificador del cargo en la pasarela. |
| `checkoutUrl` | sí | Página de pago a la que se envía al cliente (URL absoluta). |
| `expiresAt` | no | Cuándo vence el cobro. Si pasa sin pagarse, un cobro nuevo reemplaza al anterior. |

También se acepta la respuesta envuelta: `{ "data": { ... } }`.

### Errores

Cualquier respuesta distinta de `2xx`, un cuerpo que no cumpla el esquema, o no contestar en 8 segundos, hacen que el restaurante marque el cobro como `failed` y le diga al cliente que reintente (puede crear uno nuevo).

---

## 2. Entrada: webhook de resultado

Cuando cambia el estado del pago, la pasarela llama al `webhookUrl` que recibió.

```
POST {API_PUBLICA}/api/v1/payments/webhook
Content-Type: application/json
x-signature: sha256=<HMAC-SHA256 hexadecimal del cuerpo>
```

Este endpoint **no lleva JWT**: se autentica con la firma.

### Cuerpo (`gatewayWebhookSchema`)

```json
{
  "eventId": "evt_0001",
  "type": "payment.succeeded",
  "reference": "3f0c3b52-1a8c-4a40-9a39-1c6a0f6a7d11",
  "gatewayReference": "gw_8f2c1a",
  "amountCents": 23200,
  "currency": "MXN",
  "method": "card",
  "paidAt": "2030-06-04T18:05:00.000Z"
}
```

| Campo | Obligatorio | Valores / notas |
|---|---|---|
| `eventId` | sí | Único por aviso. Sirve para que un reintento no se procese dos veces. |
| `type` | sí | `payment.succeeded` · `payment.failed` · `payment.expired` |
| `reference` | sí | El `reference` del cargo (UUID). |
| `gatewayReference` | sí | El mismo que devolvió `/v1/charges`. |
| `amountCents` | sí | Entero positivo. **Debe coincidir exactamente con el cobro**; si no, se rechaza (422). |
| `currency` | sí | Solo `MXN`. |
| `method` | no | `card` · `spei` · `oxxo` · `wallet` |
| `paidAt` | no | Momento del pago. Si falta, se usa la hora de recepción. |
| `failureReason` | no | Texto (máx. 200) para `payment.failed`. |

### Cómo firmar

`x-signature = "sha256=" + hex( HMAC_SHA256( PAYMENT_WEBHOOK_SECRET, cuerpoCrudo ) )`

Se firma el **cuerpo exacto en bytes** que se envía (no un JSON "equivalente": un espacio de más cambia la firma). El secreto `PAYMENT_WEBHOOK_SECRET` está en `services/payment/.env` y se comparte con quien construya la pasarela por un canal seguro.

Node.js:

```js
import { createHmac } from "node:crypto";

const body = JSON.stringify(evento);
const signature = "sha256=" + createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET).update(body).digest("hex");

await fetch(webhookUrl, {
  method: "POST",
  headers: { "content-type": "application/json", "x-signature": signature },
  body, // exactamente el mismo texto que se firmó
});
```

Python:

```python
import hmac, hashlib, json, requests

body = json.dumps(evento, separators=(",", ":"))
firma = "sha256=" + hmac.new(SECRETO.encode(), body.encode(), hashlib.sha256).hexdigest()
requests.post(webhook_url, data=body, headers={"content-type": "application/json", "x-signature": firma})
```

### Respuestas del restaurante

| Código | Significado | ¿Reintentar? |
|---|---|---|
| `200` | Recibido. `data.outcome` es `processed`, `duplicate` (ya se había aplicado ese `eventId`) o `ignored` (el aviso no cambia nada, p. ej. "falló" sobre un pago ya pagado). | No |
| `401` | Firma ausente o inválida. | No: corregir la firma |
| `404` | `reference` desconocido. | No |
| `422` | Cuerpo inválido o **importe distinto al del cobro**. | No: corregir |
| `503` | El restaurante no pudo avisar a su servicio de pedidos. El evento **no** quedó registrado. | **Sí**, con espera creciente |

Reglas que aplica el restaurante:

- **Idempotencia:** un mismo `eventId` se procesa una sola vez. Reintentar es seguro.
- **Pago final:** una vez `paid`, ningún aviso posterior lo cambia.
- **Pago tardío:** `payment.succeeded` sí se acepta sobre un cobro que estaba `failed` o `expired` (el dinero ya se cobró).
- **Pedido cancelado:** si el cliente pagó un pedido que ya se había cancelado, el pago se registra y queda marcado en auditoría como `payments.refund-required` (el reembolso lo coordina el restaurante).

---

## 3. Estados del pago en el restaurante

```
          payment.succeeded
 pending ───────────────────────► paid   (final)
   │  ▲                             ▲
   │  └─────────────────────────────┤ payment.succeeded (pago tardío)
   ├── payment.failed ──► failed ───┤
   └── payment.expired ─► expired ──┘
```

Al llegar a `paid`: el pedido queda con `paymentMethod = online` y `paidAt`; el cliente recibe el aviso "Pago recibido" y, cuando termina de consumir, el resumen de su consumo.

## 4. Variables de entorno (`services/payment/.env`)

| Variable | Descripción |
|---|---|
| `PAYMENT_GATEWAY_URL` | URL base de la pasarela (ej. `http://localhost:4100`). **Vacía = pasarela no conectada**: el cobro se crea como `pending` y la API devuelve en `gatewayRequest` el cuerpo que se enviaría, sin contactar a nadie. |
| `PAYMENT_GATEWAY_API_KEY` | Opcional; se envía como `Authorization: Bearer`. |
| `PAYMENT_WEBHOOK_SECRET` | Secreto compartido para firmar el webhook (mín. 16 caracteres). |
| `PUBLIC_API_URL` | URL pública del gateway; con ella se arma el `webhookUrl`. |
| `WEB_URL` | URL del front; con ella se arma el `returnUrl`. |

## 5. Probar sin la pasarela real

**A. Pasarela falsa incluida** (para ver todo el flujo con un navegador):

```bash
node scripts/fake-gateway.mjs          # escucha en http://localhost:4100
# en services/payment/.env:  PAYMENT_GATEWAY_URL=http://localhost:4100   (y reiniciar el Payment Service)
```

Al pulsar "Pagar en línea" en el portal, el cliente llega a una página de pago de mentira con los botones **Pagar**, **Fallar** y **Vencer**; cada uno firma y envía el webhook correspondiente y regresa al portal.

**B. Simular solo el webhook con `curl`** (con la pasarela sin conectar):

```bash
BODY='{"eventId":"evt_1","type":"payment.succeeded","reference":"<id del cobro>","gatewayReference":"gw_1","amountCents":23200,"currency":"MXN","method":"card"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" -hex | sed 's/^.* //')"
curl -X POST http://localhost:3000/api/v1/payments/webhook -H "content-type: application/json" -H "x-signature: $SIG" -d "$BODY"
```

El `id` del cobro sale de `POST /api/v1/payments` (o del recuadro "Pasarela pendiente de conectar" del portal). `npm run smoke` hace este mismo recorrido de forma automática.
