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

- Clientes activos y cerrados, consumos por mesero y consumo personal
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
