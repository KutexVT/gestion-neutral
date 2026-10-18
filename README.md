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
