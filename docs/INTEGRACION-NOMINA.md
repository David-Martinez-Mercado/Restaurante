# Integración con SistemaNomina (checador, nómina e IVA)

El restaurante ahora también funciona como **checador**, **nómina** y **calculadora de IVA**. Para la nómina se reutiliza el repo de otro autor,
**[EmilianoNajeraCervantes/SistemaNomina](https://github.com/EmilianoNajeraCervantes/SistemaNomina)**, **sin modificarlo**.

> **Resumen para el autor del otro repo:** no hizo falta pedirle ninguna API ni cambio. Todo se resolvió con los endpoints que ya tiene.
> Al final (sección 8) hay mejoras *opcionales* que le harían la vida más fácil a cualquiera que lo integre.

## 1. Quién hace qué

| Función | Quién la hace | Dónde |
|---|---|---|
| **Checador**: entradas, salidas, horas, horas extra y faltas | Nosotros | `services/attendance` (:3009) |
| Reglas de horas extra (pago doble) y de faltas (un día de sueldo) | Nosotros | `services/payroll/src/domain/payroll.ts` |
| Sueldos, aprobación, recibos por trabajador, permisos y bitácora | Nosotros | `services/payroll` (:3010) |
| **Cálculo de ISR, IMSS, Infonavit, subsidio y neto** | **SistemaNomina** (`FiscalEngine`) | repo externo |
| Alta de empleados, incidencias y cálculo del periodo | **SistemaNomina** | repo externo |
| **Calculadora de IVA** y reporte de IVA trasladado | Nosotros | `services/order` (`/api/v1/tax`) |
| Login, roles, gateway, interfaz | Nosotros | (no se usa el AAA, el gateway ni el front del otro repo) |

## 2. Cómo se mantiene el otro repo "lo más original posible"

- **Submódulo de git** en `integraciones/SistemaNomina`, fijado al commit `eda2d6b`. No se copió ni se editó ningún archivo suyo; nuestro repo solo guarda la referencia.
  - Comprobación: `git -C integraciones/SistemaNomina status` debe salir **vacío**.
- **`integraciones/nomina-externo.cjs`** (vive en *nuestro* repo) levanta sus servicios `employees`, `incidents` y `payroll`:
  - en **otros puertos** (3102, 3103, 3104) porque el original usa 3001–3006, igual que nosotros;
  - pasándole por **variables de entorno** las URLs entre sus servicios (el original ya las lee de `process.env`);
  - **los tres en un solo proceso** de Node (ahorra memoria: equipo de pocos recursos);
  - escuchando **solo en 127.0.0.1**, porque sus servicios no traen autenticación propia.
- **`scripts/nomina-externo-setup.mjs`** instala sus dependencias con `--no-package-lock` y crea sus bases SQLite. Solo toca `node_modules` y `*.db`, que están en el `.gitignore` del propio autor.

No se usan, a propósito: su **AAA** (nosotros ya tenemos autenticación, permisos y auditoría), su **api-gateway** y su **frontend** (los nuestros), **notifications** (tenemos nuestro Notification Service) y **benefits** (prestaciones; quedó fuera para no gastar memoria).

## 3. Lo que usamos de su API

El único lugar que conoce su forma de hablar es el adaptador `services/payroll/src/clients/nomina.client.ts`. Si el autor cambia algo, se arregla ahí.
Sus importes van en **pesos con decimales**; los nuestros, en **centavos enteros** (el adaptador convierte).

| Llamada (puertos 3102 / 3103 / 3104) | Para qué | Campos |
|---|---|---|
| `POST :3102/employees` | Dar de alta al trabajador | `{ name, position, baseSalary }` → `{ id, … }` |
| `POST :3104/incidents` | Mandar horas extra o faltas del checador | `{ employeeId, period, type: "OVERTIME"\|"ABSENCE", hoursOrDays, amount }` → `{ id, … }` |
| `DELETE :3104/incidents/:id` | Reemplazar las incidencias al recalcular | — |
| `POST :3103/periods/generate` | Calcular la nómina del periodo | `{ period: "AAAA-MM" }` → arreglo con `isr, imss, infonavit, subsidio, netPay, overtimePay, absenceDeduction…` por empleado |

Las respuestas se **validan** con un esquema: si el autor cambia la forma, el sistema responde 502 con un mensaje claro en lugar de guardar basura.

## 3b. Ver las transacciones entre los dos sistemas

En la interfaz, entra como `gerente` o `admin` → pestaña **Motor de nómina**. Muestra, en vivo (cada 3 s):

- cada llamada del restaurante al motor (hora, método, ruta, resultado, milisegundos), con lo que se **envió** y lo que el motor **respondió** (despliega la fila);
- lo que el motor tiene guardado en ese momento (empleados e incidencias);
- un botón para **calcular una nómina** y ver aparecer las transacciones.

La bitácora (`engine_transactions`, últimas 500) la llena el adaptador sin tocar al otro repo: `GET /api/v1/payroll/engine/transactions` y `GET /api/v1/payroll/engine/data`.
También puedes abrir los datos crudos del motor en el navegador: http://127.0.0.1:3102/employees y http://127.0.0.1:3104/incidents.

## 4. Flujo de "Calcular nómina" (`POST /api/v1/payroll/runs`)

1. Se comprueba que el motor externo responda; si no, **503 y no se toca nada**.
2. Se da de alta en el motor a quien aún no esté (o a quien cambió de sueldo: el original **no permite editar empleados**, así que se crea uno nuevo).
3. Se pide al **checador** (`/internal/summary`, con llave interna) el resumen de cada quien: horas extra y faltas **desde su fecha de ingreso**.
4. Con **nuestras reglas** se calculan el pago de horas extra y el descuento por faltas.
5. Se **borran** las incidencias que mandamos en un cálculo anterior y se **mandan las nuevas** (recalcular no duplica; hay prueba).
6. El motor calcula impuestos y neto de **todos sus empleados**; nos quedamos solo con los nuestros.
7. El resultado se **guarda** en `payroll_service` (el motor original no permite consultar después lo que calculó).
8. El **gerente** calcula; solo el **administrador** aprueba, y **nunca quien calculó** (separación de funciones). Una nómina aprobada ya no se recalcula y el trabajador ve su recibo.

## 5. Reglas del checador

- Cualquier trabajador (no los clientes) marca su entrada y su salida; la hora la pone el **servidor** y la identidad sale del **token**.
- Una sola jornada abierta a la vez (con candado en la base de datos para que dos toques simultáneos no abran dos).
- No se puede checar salida dentro del primer minuto (doble clic) ni si la entrada lleva más de 16 h abierta (se olvidó: la corrige el gerente).
- El gerente puede **capturar o corregir** jornadas, siempre con **motivo obligatorio**; no se aceptan horas futuras, jornadas de más de 24 h ni traslapes.
- Una jornada se atribuye al **día de su entrada**. **Horas extra** = lo que pase de 8 h en el día. **Falta** = día laborable (lunes a sábado, configurable) anterior a hoy sin ningún registro.
- Pago: hora normal = sueldo mensual ÷ 30 ÷ 8; horas extra al **doble**; cada falta descuenta **un día** (sueldo ÷ 30), sin pasar del sueldo.

## 6. Calculadora de IVA

- `POST /api/v1/tax/calculate`: **agregar** IVA al subtotal o **desglosar** el IVA de un total; tasas 16 %, 8 % (frontera) y 0 %.
  Todo en centavos enteros; base + IVA siempre suman exactamente el total (hay prueba con muchos montos).
- La misma fórmula la usan los pedidos, así que no pueden diferir.
- `GET /api/v1/tax/report?from=&to=`: **IVA trasladado** de los pedidos pagados en el rango (por día y por método de pago), útil para la declaración.

## 7. Límites que conviene conocer

- **Los impuestos son los del motor del autor, que son simplificados**: p. ej. el ISR arriba de $11,128 es un 15 % plano y el IMSS un 2.375 % fijo. Sirve para demostrar la arquitectura; **no sustituye** una nómina fiscal real.
- Quien **ingresa a mitad de mes** cobra el mes completo (el motor no prorratea).
- Los sueldos son mensuales; no hay quincenas ni semanas.
- Sus bases de datos son SQLite locales; si se borra `integraciones/SistemaNomina/*/prisma/dev.db` se pierden los empleados del motor (nosotros los volvemos a dar de alta al siguiente cálculo, y las nóminas ya guardadas están en nuestra base).
- Sus servicios no tienen autenticación: por eso el lanzador los limita a `127.0.0.1`. **No los expongas** a la red.

## 8. ¿Hace falta una API en el otro repo? No. Mejoras opcionales para su autor

Nada de lo siguiente se necesita para que esto funcione (hay un rodeo para cada caso), pero haría la integración más limpia:

| Sugerencia | Hoy tenemos que… |
|---|---|
| `PUT` y `DELETE /employees/:id` | Dar de alta un empleado **nuevo** cada vez que cambia un sueldo (queda el anterior sin usar en su base). |
| `GET /periods/:period` (leer una nómina ya calculada) | Guardar nosotros una copia del resultado. |
| Aceptar un identificador externo (`externalRef`) en empleados e incidencias | Llevar una tabla propia (`external_incidents`) para poder reemplazar incidencias al recalcular. |
| `POST /periods/generate` que acepte `employeeIds` | Dejar que calcule a **todos**; el cálculo borra y recrea el periodo completo, así que dos clientes distintos del mismo motor se pisarían. |
| Verificar el `INTERNAL_KEY` que ya define en sus `.env` también en employees, incidents y payroll (hoy solo lo verifica su AAA en `/internal-log`) | Limitar el acceso con `127.0.0.1`. |
| Un solo `DATABASE_URL`: sus `.env` apuntan a PostgreSQL pero sus `schema.prisma` usan SQLite con `file:./dev.db` | Ignorar sus `.env`. |
| Un `README` al día (menciona SQLite en memoria, 3 servicios y comandos `npm run install-all` que no existen) | Seguir `ARRANQUE.md` y deducir el resto del código. |

## 9. Cómo probarlo

```bash
npm run setup:nomina     # una vez: descarga el submódulo, instala y crea sus bases (iniciar.bat lo hace solo)
npm start                # levanta todo, incluido el motor en 127.0.0.1:3102-3104
npm run seed             # sueldos del personal y un mes de asistencia de demostración
npm run smoke            # 229 comprobaciones, incluida una nómina calculada por el motor externo
```

En la interfaz: entra como `mesero` → **Checador**; como `gerente` → **Asistencia**, **Nómina** (calcula el mes anterior, que ya trae datos del seed) e **IVA**;
como `admin` → aprueba la nómina; el trabajador verá su recibo en **Checador → Mis recibos de nómina**.
