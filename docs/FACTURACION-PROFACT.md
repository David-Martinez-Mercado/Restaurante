# Facturación electrónica (CFDI 4.0) con Profact

El **Billing Service** (puerto 3011) factura los consumos pagados con un **CFDI 4.0** timbrado por el PAC
**Profact** (API *TimbraCFDI* v2, <https://developers.timbracfdi33.mx>). Es un servicio más del sistema: tiene su
propio esquema de PostgreSQL (`billing_service`), se habla con los demás por HTTP y nadie lee sus tablas.

## Cómo funciona

```
Cliente (portal / botón de Telegram)            Caja o gerencia (pestaña Facturas)
        │  POST /api/v1/invoices {orderId}                │
        ▼                                                 ▼
   Gateway (JWT) ──────────────► Billing Service :3011 ◄──┘
                                   │ 1. pide el pedido al Order Service        (importes, método de pago, fecha de pago)
                                   │ 2. pide el perfil al Customer Service     (datos fiscales del cliente)
                                   │ 3. reserva folio y deja la factura "pending" (candado: un pedido, una factura)
                                   │ 4. arma el XML sin sellar
                                   ▼
                              Profact (TimbraCFDI)  ── sella con el CSD del emisor ──► SAT
                                   │ 5. guarda UUID, XML timbrado, sellos y QR
                                   ▼
                          evento invoice.issued ──► Notification (campana + Telegram)
```

- **Los importes salen del pedido, los datos fiscales del perfil del cliente.** Quien pide la factura solo manda el `orderId`.
- El cliente factura **sus** pedidos; caja y gerencia pueden facturar el de un cliente registrado. Un pedido sin cliente
  registrado (venta de mostrador anónima) **no se puede facturar**: no hay datos fiscales.
- **Un pedido, una factura vigente.** Si se cancela, se puede facturar de nuevo. Si el SAT la rechaza (por ejemplo un RFC
  mal escrito) queda como *rechazada* con el motivo, el cliente corrige su perfil y reintenta.
- **Plazo:** solo dentro del **mes** en que se consumió (hora de México).
- **Telegram:** el resumen del consumo trae el botón **Sí, facturar** cuando el cliente ya guardó sus datos fiscales.
  Al pulsarlo, el bot llama a `POST /api/v1/internal/invoices/telegram` (ruta interna, con `x-internal-key`; el gateway no la publica).

## Qué lleva el CFDI

| Campo | Valor |
|---|---|
| Versión / tipo | 4.0, ingreso (`I`), moneda MXN, exportación `01`, método de pago `PUE` |
| Serie y folio | Serie `BILLING_SERIE` (por omisión `A`) y folio consecutivo |
| Fecha | Hora local de México (el SAT rechaza fechas "del futuro") |
| Forma de pago | efectivo → `01`; tarjeta o pago en línea → `04` |
| Conceptos | Un concepto por platillo: `ClaveProdServ 90101501` (servicios de restaurante), `ClaveUnidad E48`, `ObjetoImp 02` |
| IVA | 16 % trasladado. El IVA de cada concepto se reparte por "mayor residuo" para que **la suma sea exactamente el IVA del pedido** |
| Sello | **Lo pone Profact** al timbrar (autosellado): el sistema nunca guarda el certificado ni la llave |

## Configuración (`services/billing/.env`)

| Variable | Para qué |
|---|---|
| `PROFACT_URL` | `https://pruebas.timbracfdi33.mx:1444/api/v2` (pruebas, por omisión) · producción: `https://timbracfdi33.mx:1444/api/v2` |
| `PROFACT_TOKEN` | Token de integrador. El de pruebas (`mvpNUXmQfK8=`) lo publica Profact en su documentación. Vacío = facturar responde 503 |
| `BILLING_EMISOR_RFC` · `_NAME` · `_REGIME` · `_POSTAL_CODE` | Quién factura: el restaurante, **tal como está en su Constancia de Situación Fiscal** |
| `BILLING_SERIE` · `BILLING_TIMEZONE` | Serie de las facturas y zona horaria de expedición |

### Ambiente de pruebas (el que viene configurado)

No requiere cuenta ni cobra. Usa los datos de prueba estándar del SAT, que Profact ya tiene registrados:

| | RFC | Nombre | CP | Régimen |
|---|---|---|---|---|
| Emisor | `EKU9003173C9` | `ESCUELA KEMPER URGATE` | `42501` | `601` |
| Receptor (cliente demo) | `XIA190128J61` | `XENON INDUSTRIAL ARTICLES` | `76343` | `601`, uso `G03` |

`npm run seed` deja al cliente demo con ese receptor, así que **Mis pedidos → Facturar** funciona de inmediato.
El RFC genérico `XAXX010101000` (público en general) **no sirve** con CFDI 4.0 en este flujo, que exige nombre, CP y régimen reales.

### Pasar a producción

1. Pide a Profact (`soporte@profact.com.mx`) tu alta de integrador y su token de producción.
2. Pon en `services/billing/.env` la URL de producción, el token y los datos reales del emisor.
3. Registra **una sola vez** el certificado de sello digital (CSD) del restaurante, con el `.cer`, el `.key` y su contraseña:

   ```bash
   npm run profact:registra-emisor -- ruta/al/certificado.cer ruta/a/llave.key "contraseña-del-csd"
   ```

   El script manda los archivos a Profact (`POST /Timbrado/RegistraEmisor`) y los descarta: **no se guardan** en el sistema.
   La misma llamada sirve para renovar el CSD.
4. Reinicia el Billing Service.

## Cancelar

Solo gerencia y administración (`invoices:cancel`), desde *Facturas → Cancelar* o `POST /api/v1/invoices/:id/cancel`:

| Motivo SAT | Cuándo |
|---|---|
| `01` | Emitida con errores **con** relación: exige indicar la factura vigente que la sustituye |
| `02` | Emitida con errores sin relación |
| `03` | No se llevó a cabo la operación |
| `04` | Operación nominativa relacionada en una factura global |

El SAT tarda unos minutos en registrar un comprobante recién timbrado; hasta entonces responde que no se puede cancelar
y el sistema devuelve un **409** que pide reintentar. La cancelación queda en la bitácora de auditoría y se avisa al cliente.

## Permisos

| Permiso | Cliente | Cajero | Gerente | Admin |
|---|:-:|:-:|:-:|:-:|
| `invoices:create` · `invoices:read-own` (facturar y ver las suyas) | ✔ | | | ✔ |
| `invoices:read-all` · `invoices:issue` (facturar por un cliente) | | ✔ | ✔ | ✔ |
| `invoices:cancel` | | | ✔ | ✔ |

Un cliente que consulta o descarga una factura ajena recibe **404** (no se revela que existe).

## API (por el gateway)

| Método y ruta | Descripción |
|---|---|
| `POST /api/v1/invoices` `{orderId}` | Timbra la factura del pedido → 201 con el detalle (emisor, sellos, QR) |
| `GET /api/v1/invoices?status=&orderId=` | Lista: las propias del cliente, o todas para el personal |
| `GET /api/v1/invoices/:id` | Detalle para la representación impresa |
| `GET /api/v1/invoices/:id/xml` | XML timbrado (descarga) |
| `POST /api/v1/invoices/:id/cancel` `{reason, replacementInvoiceId?}` | Cancela ante el SAT |

Errores frecuentes: `409` sin datos fiscales / ya facturado / fuera de plazo / pedido sin pagar · `404` pedido o factura ajena ·
`422 "No se pudo timbrar: …"` el SAT o Profact rechazaron los datos (el mensaje se muestra tal cual) · `503` Profact no responde o el token es inválido.

## Limitaciones conocidas

- **Representación impresa propia:** el PDF es la vista HTML del sistema (imprimible desde el navegador), no el PDF de Profact. El documento fiscal es el XML.
- **Cancelación sin aceptación:** no se modela la aceptación del receptor que el SAT exige en cancelaciones de montos altos; se muestra el resultado que devuelve Profact.
- **Sin "público en general":** no hay factura global ni a `XAXX010101000`.
- **Plazo y forma de pago:** la regla del mes de consumo y la forma de pago (`01`/`04`) son supuestos del proyecto; ajústalos con tu contador.
- **Probado contra el ambiente de pruebas.** Producción requiere cuenta, token y CSD reales, que no se usaron aquí.
