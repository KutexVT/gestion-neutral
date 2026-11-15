# Gestión — copia neutral

Aplicación independiente de clientes, consumos, inventario, cobros y reportes. Interfaz en grises con modo claro y oscuro. Conserva las funciones de la versión original y elimina su marca, símbolos y textos publicitarios.

## Acceso

La pantalla inicial ofrece **Dueño** y **Mesero**. No solicita usuario ni contraseña. Si hay varios meseros se puede seleccionar su nombre antes de entrar. El dueño crea y elimina perfiles desde Equipo.

**Cualquier persona que pueda abrir esta aplicación puede elegir Dueño y administrar los datos.** La selección de rol organiza las pantallas y operaciones; no identifica a la persona. Las sesiones internas mantienen permisos del perfil seleccionado, CSRF y atribución de acciones.

## Iniciar

Requisitos: Docker con Compose. Para desarrollo: Node.js 22.12 o superior.

```sh
npm run setup
docker compose up -d --build
```

Abrir **http://localhost:3182**. Las migraciones crean automáticamente los perfiles Dueño y Mesero. La base empieza vacía de productos y clientes.

La copia usa el proyecto Docker `gestion-neutral`, volumen propio y una contraseña de PostgreSQL generada en `.env`. No contiene datos, sesiones ni credenciales del proyecto de origen. No usar la base de producción del original: la migración `003_direct_profiles.sql` elimina sus campos de contraseña para esta edición.

## Desarrollo

```sh
npm ci
npm run setup
docker compose -f compose.yaml -f compose.dev.yaml up -d db
npm run migrate
npm run build
npm start
```

PostgreSQL de desarrollo: localhost:5487. Aplicación: localhost:3182. Para Vite ejecuta el backend con `APP_ORIGIN=http://localhost:5182 npm run dev` y en otra terminal `npm run dev:web`. Abre localhost:5182. La base se mantiene en un volumen independiente.

## Funciones

- Clientes activos y cerrados, consumos por mesero y consumo personal del dueño y meseros
- Catálogo con fotos, precios históricos y control de existencias
- Sumar existencias desde Inventario con entrada registrada en movimientos
- Correcciones por diferencia y transacciones que evitan sobreventa simultánea
- Cobro con efectivo recibido, vuelto y factura virtual
- Reportes diarios, ventas por quien cobró y filtros por fecha o vendedor
- Historial cronológico y actualizaciones en tiempo real mediante SSE
- Tema claro/oscuro persistente con transición suave y movimiento reducido

## Pruebas

```sh
npm run build
npm test
```

Las pruebas crean y eliminan bases temporales `bar_test_*` en el PostgreSQL configurado. Incluyen roles, CSRF, inventario concurrente, correcciones, efectivo, auditoría, entrada sin contraseña y navegación móvil. Para instalar el navegador de pruebas: `npx playwright install chromium`.

## Configuración

`.env.example` documenta las variables. `CURRENCY=CRC` y `TIME_ZONE=America/Costa_Rica` son los valores iniciales. `APP_NAME` define el título genérico del panel. Para un dominio HTTPS configure `APP_ORIGIN` y `SECURE_COOKIES=true`. La publicación no cambia el acceso abierto por selección de perfil.

## Copias de seguridad

`scripts/backup.sh` guarda la base local de esta copia en `backups/`. `scripts/restore.sh --replace archivo.dump` reemplaza la base de esta copia y revoca sus sesiones. Ambos usan su proyecto Docker propio.

## Railway

Proyecto independiente: `gestion-neutral`. Servicio web: `gestion`. Base persistente: `Postgres`.

URL: https://gestion-production-4635.up.railway.app

La aplicación se despliega desde esta carpeta. Para subir cambios después de probarlos:

```sh
railway link --project 40091934-e9fc-4237-8118-b733bcc74872 --environment production --service gestion
railway up --service gestion --detach
```

Railway guarda `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_ORIGIN` con la URL pública, `SECURE_COOKIES=true`, `NODE_ENV=production`, `HOST=0.0.0.0` y `PORT=3182`. El servicio tiene healthcheck `/api/health` y reinicio ante fallos. Docker aplica las migraciones al iniciar. No subir `.env` ni conectar esta copia a la base de la aplicación original. La base de Railway es independiente de la base local y empieza con sus propios perfiles Dueño y Mesero.

## Contar efectivo

Dueño y meseros tienen la herramienta **Contar efectivo**. Indica cantidades enteras para billetes de ₡1 000, ₡2 000, ₡5 000, ₡10 000 y ₡20 000 y monedas de ₡10, ₡25, ₡50, ₡100 y ₡500. Cada fila tiene botones + y − para sumar o quitar una unidad, además de entrada manual. No permite bajar de cero ni superar 1 000 000. Muestra subtotales por denominación, por tipo y un total en CRC. Las denominaciones corresponden a las listas actuales del BCCR: [billetes](https://www.bccr.fi.cr/cr/es/billetes-y-monedas/billetes/billetes-en-circulacion.html) y [monedas](https://www.bccr.fi.cr/cr/es/billetes-y-monedas/monedas/denominacion-de-monedas.html).

Es una calculadora independiente: no registra ventas ni movimientos de inventario. Conserva el conteo al navegar dentro de la sesión; recargar o cambiar de perfil lo limpia. **Limpiar conteo** permite comenzar otro. Cantidades negativas, fracciones o mayores de 1 000 000 muestran un error y bloquean el total para evitar una suma parcial.

## Cierre de caja

Solo el perfil Dueño tiene acceso a **Cierre de caja** y a su API. En esta edición de demostración cualquiera puede elegir ese perfil: no identifica al dueño real. Para operación privada usa la edición original con autenticación.

- Al cobrar se elige Efectivo, SINPE, Tarjeta o Pago mixto. Las porciones deben sumar el total final. El vuelto se calcula únicamente sobre la porción en efectivo. Los reportes y comprobantes muestran los medios por separado.
- **Nuevo cierre** propone el día desde medianoche hasta ahora en `America/Costa_Rica`. En **Configurar horario y fondo** se puede definir otra hora de inicio, por ejemplo 05:00 para incluir las ventas de madrugada en la jornada anterior. También se puede elegir un intervalo manual de hasta 31 días.
- El fondo inicial queda sin definir hasta introducirlo. Es el efectivo que había al inicio del intervalo. Se requiere indicar un importe al guardar; usar 0 solamente cuando realmente se empezó sin efectivo. El fondo habitual es una sugerencia para nuevos cierres y no modifica el historial.
- Usa **Actualizar resumen** para fijar el corte y después cuenta con la calculadora de billetes y monedas. Conviene detener los cobros durante el conteo físico. El sistema sigue permitiendo ventas después del corte. No crea un turno ni bloquea cuentas.
- Efectivo esperado = fondo inicial + cobros en efectivo + entradas − salidas. SINPE y tarjeta comparan los cobros y movimientos del intervalo con el importe verificado en banco o terminal, sin incluir el saldo anterior de la cuenta. Un campo vacío queda como **Sin verificar** y no se convierte en cero.
- Registra gastos, retiros, aportes y devoluciones en **Registrar entrada o salida** con medio, fecha e importe y motivo. No repitas las ventas como entradas. Una anulación agrega una contrapartida en la fecha del movimiento original y conserva ambos registros. Para corregir importe o medio anula el movimiento y registra el correcto.
- El resumen incluye facturas, productos y autores de entregas, vendedor que cobró, cuentas pendientes, movimientos y actividad. Los pagos se atribuyen a quien cobró la cuenta completa. El consumo personal y las cuentas aún sin cobrar no suman dinero esperado.
- **Corregir pago registrado**, dentro de la cuenta cerrada, permite al dueño corregir lo que realmente ocurrió con un motivo y control de versión. No ejecuta un reembolso. Los pagos o devoluciones posteriores se registran como movimientos en su fecha real. Cambiar el total facturado o los productos no inventa cobros adicionales.
- **Revisar cierre de caja** muestra la comparación antes de confirmar. Un faltante o sobrante exige una observación. Es posible guardar un cierre pendiente de investigar. Los pagos antiguos sin datos quedan sin clasificar y se advierte que el esperado está incompleto.
- Cada cierre conserva una copia del resumen, conteo por denominación, fondo, importes verificados, diferencias, autor y fecha. Es inmutable. **Crear revisión de este cierre** mantiene el mismo intervalo y enlaza una nueva revisión al anterior. Varias revisiones del día no se suman como ingresos.

La migración `004_register.sql` conserva las cuentas existentes. Los cobros anteriores con efectivo registrado se clasifican como efectivo; no se inventa un método para los que no tenían registro. La fecha de cobro inicial se conserva aunque se corrija posteriormente la hora de salida. Los cierres y movimientos usan transacciones e idempotencia; una revisión rechaza un resumen que cambió entre consultarlo y guardarlo. Los importes se calculan en céntimos enteros. El contador por denominaciones permite cierres en CRC.

Las pruebas cubren pagos mixtos, vuelto, permisos, entradas y anulaciones, conteos inválidos, diferencias, revisiones inmutables y cobros simultáneos con un corte. La prueba de navegador recorre los tres medios de pago y el cierre móvil con historial y nueva revisión.

### Consumo personal en el cierre

- Dueños y meseros tienen **Mi consumo** con una lista propia editable. Los pedidos descuentan inventario y las correcciones devuelven o descuentan la diferencia.
- **Cierre de caja → Consumo personal** muestra quién consumió, su rol, quién registró el cambio, productos, cantidades, precio registrado y valor neto del intervalo. Se incluyen tanto dueños como meseros. Es una valoración al precio del catálogo guardado en cada línea, no un costo de compra.
- El intervalo usa la fecha de cada registro o corrección del historial inmutable. Una corrección de consumo anterior aparece como diferencia positiva o negativa el día en que se realiza. Nunca suma ventas ni reduce el dinero esperado en caja.
- El detalle queda conservado dentro de cada cierre guardado. Los cierres anteriores a esta función mantienen su contenido original e indican que se necesita una nueva revisión para añadirlo.
