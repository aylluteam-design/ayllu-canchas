# Ayllu Canchas · prototipo funcional

App web instalable (PWA) para dueños de canchas sintéticas. El jugador reserva solo desde un enlace, con registro
ligero (nombre y celular); el horario queda **apartado** hasta que el dueño confirma la seña de Yape/Plin; si no pagan
a tiempo, se libera solo. El choque de horarios lo impide la **base de datos**, no el navegador.

Tiene dos modos:

| Modo | Cuándo | Datos |
|---|---|---|
| **Demo** | Sin variables de Supabase | Solo en el navegador. Sirve para mostrar la app. |
| **Real** | Con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` | Supabase: login del dueño, base compartida y segura. |

## 1. Probarlo en tu computadora (modo demo, 3 minutos)

Necesitas [Node.js 20 o más](https://nodejs.org).

```bash
npm install
npm run dev
```

Abre la dirección que muestra la terminal (normalmente http://localhost:5173) y toca "Entrar a la demo del dueño".
Para ver lo que ve el jugador, abre `http://localhost:5173/#/r/demo` en otra pestaña: lo que reserve ahí aparece en
"Pendientes" del dueño.

## 2. Conectar Supabase (modo real)

1. En Supabase crea un proyecto para Canchas. Recomendación: uno aparte del de Inspecciones, para no mezclar datos de
   clientes de productos distintos (el plan Free permite 2 proyectos activos; verifica en tu cuenta).
2. **SQL Editor → New query**, pega todo `supabase/migrations/001_canchas.sql` y toca **Run**. Debe decir "Success". Luego repite con **otra query nueva** pegando `supabase/migrations/002_deporte_extras.sql` (deporte, imágenes y agregados) y toca **Run**.
3. **Authentication → Providers → Email**: para la demo, desactiva "Confirm email" (así el dueño entra apenas crea su
   cuenta). Para clientes reales, déjalo activado.
4. **Project Settings → API**: copia la **Project URL** y la clave pública (aparece como *Publishable key* o *anon public*,
   según la versión del panel). Nunca uses la clave `service_role` ni la *secret*.
5. Crea el archivo `.env.local` (copia `.env.example`) con esos dos valores y reinicia `npm run dev`.
6. La pantalla de acceso ahora es la real: "Crear cuenta" → crea tu complejo → ajusta canchas, precios y tu Yape en
   "Ajustes". Tu enlace de reservas está en la pestaña "Enlace".

## 3. Subirlo a GitHub

Crea un repositorio vacío en GitHub (por ejemplo `ayllu-canchas`) y, dentro de esta carpeta:

```bash
git init
git add .
git commit -m "Ayllu Canchas: primer prototipo"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/ayllu-canchas.git
git push -u origin main
```

`.env.local` no se sube (está en `.gitignore`).

## 4. Publicarlo (GitHub Pages, gratis)

1. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**. Crea dos:
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con los valores del paso 2.4.
3. Haz un nuevo push (o **Actions → Publicar en GitHub Pages → Run workflow**). A los 2 o 3 minutos la app queda en
   `https://TU-USUARIO.github.io/ayllu-canchas/`.
4. En Supabase: **Authentication → URL Configuration → Site URL**: pon esa dirección (necesario para los correos de confirmación).

Ojo con dos cosas: en el plan gratuito de GitHub, Pages exige repositorio **público** (el código no contiene secretos; la
clave pública de Supabase está pensada para el navegador y la protección está en las reglas RLS de la base). Y el
workflow corre `npm run test:sql` antes de publicar: si alguien rompe las reglas de la base, no se despliega.

## 5. Instalarla en el celular

Android (Chrome): menú ⋮ → "Instalar app". iPhone (Safari): Compartir → "Agregar a pantalla de inicio".
El enlace de los jugadores (`…/#/r/tu-complejo`) se abre como página normal; no necesitan instalar nada.

## 6. Pruebas

```bash
npm run test:sql                      # reglas de la base de datos en un Postgres local (36 pruebas)
npm run build && npx vite preview --port 4173
python3 tests/e2e.py                  # recorrido completo en el navegador, modo demo (requiere Playwright)
```

## 7. Qué está probado y qué no (léelo antes de mostrarlo a un cliente)

**Probado:** las reglas de la base (choques, vencimiento, límites, aislamiento entre dueños, que el público no lea
nombres ni teléfonos) corren en un Postgres local con una simulación de los roles de Supabase. El recorrido completo de la
app corre en modo demo. En modo real se comprobó que compila, muestra el acceso y maneja la falta de conexión.

**No probado todavía:** el modo real contra un proyecto Supabase de verdad (login, correos de confirmación, llamadas
`rpc`). Es lo primero que hay que probar tras el paso 2; si algo falla, el mensaje de error de la consola del navegador
(F12) dice qué.

**Pendiente / límites conocidos**
- Sin notificación push al dueño: la lista de Pendientes se refresca sola cada 15 segundos con la app abierta.
- Registro del jugador sin verificar (nombre y celular). Se frena con máximo 2 reservas pendientes por celular y con el
  vencimiento; alguien podría usar celulares falsos. Verificar con código por SMS/WhatsApp cuesta por mensaje.
- El vencimiento se aplica cuando alguien consulta (jugador o dueño). Más adelante se puede programar con `pg_cron`.
- Un usuario dueño = un complejo. Horario de atención único para todas las canchas.
- Sin recuperación de contraseña, sin generador de QR, sin pagos dentro de la app (la seña se confirma a mano).
- Se asume que dueño y jugadores están en hora de Perú (el navegador decide qué horarios ya pasaron).
- Supabase Free no tiene copias de seguridad diarias y pausa los proyectos inactivos; pasar a Pro (referencial
  US$25/mes por organización, verificar) antes de guardar datos reales de clientes.
- El plazo y la seña son los mismos para todas las canchas del complejo.

## Estructura

```
supabase/migrations/001_canchas.sql   tablas, reglas, seguridad y funciones públicas
supabase/migrations/002_deporte_extras.sql   deporte por cancha, fotos y agregados (chalecos, bebidas…)
src/main.js                           pantallas del dueño y del jugador
src/data/local.js                     modo demo
src/data/supabase.js                  modo real
public/                               manifest, service worker, íconos
tests/                                pruebas de la base (SQL) y del navegador (e2e)
.github/workflows/pages.yml           publicación automática
```
