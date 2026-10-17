# Guía rápida para actualizar Hipermercado Kristal

## Abrir y probar la tienda

El sitio consulta los productos en Supabase y por eso debe abrirse desde un servidor web, no con doble clic sobre `index.html`. En desarrollo puedes usar **Live Server** de VS Code. Para publicarlo, el workflow existente de GitHub Pages despliega el sitio estático; los productos se actualizan desde Supabase sin volver a desplegarlo.

## Instalar la tienda como app

En teléfonos, el botón **Instalar App de Hipermercado Kristal** aparece encima de la navegación inferior; en computadora está disponible en la franja superior. En Android y navegadores compatibles, al tocarlo se abre la confirmación nativa de instalación. Safari en iPhone/iPad no ofrece el evento `beforeinstallprompt`, por lo que muestra las instrucciones para **Compartir → Añadir a pantalla de inicio**. La app se abre en una ventana independiente con el nombre y el logo de Hipermercado Kristal.

En Android también está disponible **Descargar APK Android** para instalar la aplicación nativa, además de la opción PWA. El enlace descarga el APK generado por GitHub Actions en cada publicación. Android puede pedir autorización para instalar aplicaciones descargadas desde el navegador; confirma que el archivo provenga de `hipermercadokristal.github.io`. El APK es solo para Android; en Windows se recomienda instalar Caja y Administración desde Chrome o Edge, y en iPhone usar Añadir a pantalla de inicio.

La instalación requiere que la tienda esté publicada por HTTPS. La app conserva la estructura de la tienda para abrirla sin conexión, pero consultar el catálogo, iniciar sesión, registrar pedidos, adjuntar comprobantes y recibir actualizaciones requiere Internet.

## Configurar Supabase (una sola vez)

1. Crea un proyecto en Supabase y abre **SQL Editor**. Ejecuta `supabase-schema.sql` para crear las tablas `productos` y `categorias`, el bucket público `product-images`, las políticas RLS y la publicación Realtime.
2. Ejecuta `supabase-seed.sql` una sola vez si deseas importar el catálogo de 53 productos que ya mostraba la versión estática. El seed conserva sus rutas de fotos locales en `assets/products/`; verifica precios y disponibilidad antes de publicar. Las nuevas fotos agregadas desde el panel sí se suben al bucket de Supabase.
3. En **Project Settings → API**, copia la **Project URL** y la clave pública **anon/publishable** en `supabase-config.js`. Esas credenciales públicas pueden estar en el frontend; **nunca** pegues una clave `service_role` o secret en este repositorio.
4. Ejecuta `supabase-orders.sql` después de crear `productos` y `categorias`. Crea el historial y detalle de pedidos, perfiles de clientes, políticas RLS, el bucket privado `payment-proofs`, la función segura que calcula el pedido con precios vigentes, el reporte de evidencia (referencia o foto), los códigos QR privados de retiro/entrega y sus funciones de validación, además de la publicación Realtime. Si ya habías ejecutado una versión anterior, vuelve a ejecutar el archivo actualizado; el script es idempotente.
5. Ejecuta `supabase-delivery-roles.sql` después de `supabase-orders.sql`. Añade la asignación de repartidores, políticas RLS para cada rol y funciones seguras de aprobación de pagos, avance de pedidos y finalización por QR. Vuelve a ejecutar este archivo si actualizas la migración; es idempotente.
6. Ejecuta `supabase-admin-organization.sql` después de las migraciones anteriores. Separa el permiso de caja del de propietario, permite al propietario asignar los roles de caja/repartidor desde `/admin/` y archiva productos eliminados para que puedan restaurarse desde el historial. Es idempotente.
7. Ejecuta `supabase-crystal-operations.sql` después de `supabase-orders.sql` y las migraciones de roles. Añade código de barras, precio VES de origen, stock, documento del cliente y coordenadas/punto de referencia de delivery; habilita la creación segura de pedidos con ubicación, la búsqueda y confirmación de retiros por documento o QR solo para caja y las métricas resumidas de ventas solo para administración. Si ya configuraste las tablas, ejecuta este archivo actualizado en SQL Editor antes de usar las nuevas funciones.
8. En **Authentication → Settings**, permite el registro de clientes. Si está activada la confirmación por correo, cada cliente deberá validar su dirección antes de iniciar sesión. Para habilitar **Continuar con Google**, crea credenciales OAuth de tipo aplicación web en Google Cloud Console y agrega `https://fregeynuqwlwsyaslgor.supabase.co/auth/v1/callback` como URI de redirección autorizada. Confirma que corresponde al callback mostrado en **Authentication → Providers → Google**. Activa Google en Supabase con el Client ID y Client Secret, establece `https://hipermercadokristal.github.io/` como **Site URL** y añádelo a **Authentication → URL Configuration → Redirect URLs**. Añade también las URL publicadas completas de `/caja/` y `/delivery/` (por ejemplo, `https://hipermercadokristal.github.io/caja/` y `https://hipermercadokristal.github.io/delivery/`) a **Redirect URLs**; deben coincidir con el dominio real de la tienda. La caja y el reparto vuelven a su propia ruta después de Google. Estas credenciales deben configurarse en el panel de Supabase/Google, no en el código. Google no concede permisos por sí mismo: el propietario debe asignar `operator` o `courier` a cada cuenta existente desde **Administración → Equipo y permisos** antes de que esa persona inicie sesión. En **Authentication → Users**, crea/invita al propietario y asigna su rol `admin` en `app_metadata` desde SQL Editor (sustituye el correo):

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'propietario@ejemplo.com';
   ```

   La cuenta del propietario se configura inicialmente con ese SQL. Para el resto del personal, crea o invita primero las cuentas en **Authentication → Users**; después asígnales `operator` o `courier` desde **Administración → Equipo y permisos**. Si una cuenta nueva se crea al iniciar sesión con Google, el primer intento será rechazado hasta que el propietario le asigne el rol desde Administración; luego debe iniciar sesión de nuevo. El personal debe cerrar sesión y volver a entrar para renovar el token. El registro público no permite asignar roles. Google proporciona nombre y correo; el cliente debe completar y guardar su teléfono en **Perfil** para hacer pedidos.
9. El propietario entra a `/admin/`; las cuentas de caja entran a `/caja/` (también disponible en `/cashier/`) y los repartidores a `/delivery/`. En Administración → **Equipo y permisos**, introduce el correo de una cuenta que ya hayas creado/invitado en **Authentication → Users**, elige Caja u operador o Repartidor y pulsa **Guardar acceso**. Cada usuario debe cerrar sesión y volver a entrar. Solo la cuenta con rol `admin` puede usar `/admin/`; el personal `operator` solo accede a la bandeja de `/caja/`, donde verifica pagos, prepara pedidos y valida tickets de retiro. Caja puede escanear QR con la cámara o buscar un retiro pendiente por cédula. No hay una pasarela bancaria automática conectada; el estado verde `Pagado` aparece cuando caja confirma el pago. La asignación a delivery está disponible cuando el pedido está listo y el pago está autorizado.

Los pedidos de **retiro + efectivo/POS** requieren cédula/documento y muestran un ticket QR temporal de 24 horas; caja puede buscar por documento o escanear el QR. Tras recibir el pago y comprobar los artículos, **Confirmar cobro y entrega** marca el pedido entregado y el pago verificado en una operación segura. En pedidos delivery, caja asigna un repartidor activo desde la bandeja; esa acción cambia el estado a **En camino**. Entonces el cliente ve un QR temporal en **Mis pedidos**. El checkout permite guardar dirección detallada, punto de referencia, teléfono y coordenadas si el cliente concede permiso a la ubicación del navegador. El repartidor inicia sesión en `/delivery/`, ve únicamente los pedidos asignados a su cuenta y usa **Escanear QR de entrega** para abrir la cámara. La ruta de Google Maps usa coordenadas cuando se guardaron y, si no, usa dirección y referencia. El lector usa el detector nativo cuando existe y lleva un lector QR alternativo incluido en el sitio para navegadores sin `BarcodeDetector`; la cámara y geolocalización requieren HTTPS y permiso del navegador. Supabase verifica rol, asignación, estado y vigencia del token y lo consume al marcar el pedido como entregado. El identificador de pedido no se usa como credencial QR. No compartas ni fotografíes esos códigos.

El catálogo del cliente se sirve desde la raíz (`/`) para conservar las rutas existentes de GitHub Pages; `/client/` abre la tienda y su lógica de pedidos vive en `client/`. La lista muestra los precios en USD y el equivalente en bolívares calculado con la tasa oficial BCV consultada para el día; si no hay conexión, el último dato guardado se identifica como tasa anterior. El precio VES importado desde Chrystal se conserva en el inventario como dato de origen.

Administración y Caja son módulos separados y cada uno puede instalarse en una computadora Windows mediante **Instalar Administración** o **Instalar Caja**, usando Chrome o Edge y HTTPS. Reparto tiene su propia PWA móvil y se instala desde `/delivery/`; en iPhone se añade desde Safari mediante **Compartir → Añadir a pantalla de inicio**. `/cashier/` es un acceso alternativo a `/caja/`. La instalación no reemplaza el inicio de sesión ni los permisos de cada rol. Las operaciones, la cámara, el catálogo y los pedidos requieren conexión a Internet.

En `/admin/`, el resumen de ventas muestra pedidos, total registrado, total pagado/verificado y pagos pendientes del día (zona horaria de Caracas). En **Importar inventario**, selecciona la primera hoja de un archivo Excel o CSV con columnas equivalentes a código de barras, descripción, departamento/categoría, precio USD, precio VES y stock actual. Revisa la vista previa: las categorías deben existir en Supabase. Se actualizan productos por código de barras; nuevos productos aparecen con una imagen provisional y quedan agotados cuando el stock importado es cero. Completa sus fotos desde el formulario de inventario. Si una importación por lotes falla, el panel informa cuántas filas ya se aplicaron; importar otra vez actualiza esos mismos códigos, no duplica el producto.

La selección **Lo Más Destacado** se consulta del catálogo de Supabase y funciona como carrusel con avance automático, controles, desplazamiento táctil y pausa al interactuar. Respeta la preferencia de movimiento reducido del dispositivo.

Las rutas `/admin/`, `/perfil` y `/pedidos` siguen el enrutamiento de raíz existente de la tienda; la publicación debe servir el sitio desde la raíz del dominio configurado.

El panel requiere correo y contraseña de Supabase. RLS valida `app_metadata.role = admin` tanto en tablas como en Storage; ocultar el panel en el navegador no sustituye esas políticas. El catálogo público solo puede leer artículos disponibles; una tabla Realtime separada publica únicamente una señal de cambio para mantener privada la información de los productos agotados.

El formulario de producto en `/admin/` inicia plegado para ahorrar espacio. **Eliminar** archiva el producto en vez de borrarlo definitivamente; el historial permite restaurarlo como no disponible. La imagen y los registros previos de pedidos se conservan.

## Restaurante Kristal dentro de la app

El restaurante está integrado en la misma app instalable y se abre desde **Restaurante Kristal** en la navegación de la tienda o desde el pie de página. Su página `/restaurante/` incluye carta con búsqueda y categorías, buffet personalizable, carrito, tasa BCV, datos de Pago Móvil y el flujo de pedido por WhatsApp. Desde su pie de página se puede volver al hipermercado.

La carta combina platos de presentación con productos administrados en Supabase. Las fotos y precios de presentación son referenciales; el equipo confirma la disponibilidad y el total final por WhatsApp. Antes de abrir WhatsApp, el cliente puede seleccionar Banco de Venezuela (0102), Provincial (0108), Banesco (0134) o Mercantil (0105), copiar los datos de pago y el monto en bolívares. Debe esperar la confirmación de la tienda antes de transferir.

El panel del restaurante está en `/restaurante/admin/`; el inventario del hipermercado está en `/admin/`. Ambos requieren una cuenta de Supabase con `app_metadata.role = admin`. Se puede entrar a los dos paneles desde los enlaces de administración del pie de página. Los productos del restaurante y sus fotos usan tablas (`restaurant_categories`, `restaurant_products`) y el bucket (`restaurant-images`), separados de los del hipermercado. Ejecuta `restaurante/supabase-restaurante.sql` desde SQL Editor para crear o actualizar las categorías, tablas, políticas RLS, bucket y señal Realtime; es seguro volver a ejecutarlo.

La app conserva en caché la estructura del menú y sus recursos principales, pero cargar la carta desde Supabase, consultar la tasa BCV, usar Pago Móvil y enviar pedidos requiere conexión a Internet.

Si ya configuraste el proyecto, ejecuta `supabase-departamentos.sql` desde **SQL Editor** para asegurar los 11 departamentos del menú y del formulario de `/admin/`: Víveres y Alacena; Frutas y Verduras; Carnes, Aves y Charcutería; Bebidas, Licores y Tabaco; Snacks, Golosinas y Confitería; Cuidado Personal e Higiene; Cuidado del Hogar y Limpieza; Hogar, Bazar y Utensilios; Electrodomésticos y Ferretería; Mascotas; y Congelados. La migración también asigna los productos existentes de bebidas al nuevo departamento y conserva “Lácteos” en “Víveres y Alacena” para los productos de leche en polvo ya cargados. Es seguro volver a ejecutarla; no vuelvas a ejecutar el seed.

Para una instalación nueva, `supabase-schema.sql` ya crea los mismos 11 departamentos. El filtro del catálogo usa el departamento guardado en cada producto, por lo que las opciones “Hogar, Bazar y Utensilios” y “Bebidas, Licores y Tabaco” solo muestran sus productos correspondientes.

## 1. Navegación, vistas y enlaces

La tienda usa rutas independientes en el navegador: `/` muestra Inicio y sus destacados, `/catalogo` muestra el inventario en cuadrícula, `/departamento/<slug>` muestra un único departamento, `/nosotros` presenta la información y fotos de las instalaciones, `/preguntas-resenas` muestra preguntas frecuentes y opiniones, y `/politicas` reúne privacidad, términos y devoluciones. La navegación actualiza la URL y el historial sin desplazarse entre secciones; la configuración `404.html` permite abrir y recargar directamente las rutas en GitHub Pages.

El buscador, el carrito y los accesos por WhatsApp permanecen disponibles en todas las vistas. El enlace **Política de privacidad y términos** abre `/politicas`, donde se muestran privacidad, condiciones de compra y cambios/devoluciones.

En el pie se agrupan la política de privacidad y los términos en un solo enlace; las preguntas frecuentes aparecen una sola vez dentro de **Opiniones y preguntas frecuentes**, y se eliminó el acceso duplicado de **Contacto y ubicación**.

Los botones de redes sociales muestran un aviso hasta que se conozcan las cuentas oficiales. Cuando las tengas, reemplaza cada `<button data-info="redes">` del bloque `.social-links` en `index.html` por un enlace `<a href="URL_OFICIAL">` con la dirección real de cada perfil.

La página de **Sobre nosotros** presenta la ubicación, el surtido y el compromiso con la comunidad. No incluye fecha de fundación porque aún no se ha confirmado; actualízala cuando el negocio proporcione el dato oficial. La política de cambios y devoluciones está publicada en su propia vista.

La vista **Opiniones y preguntas frecuentes** permite filtrar las respuestas y preparar una pregunta u opinión para enviarla por WhatsApp. El indicador 4.9/5 y las tarjetas de reseña están marcados como contenido ficticio de demostración; no representan clientes ni valoraciones reales o verificadas. Los mensajes del formulario no se almacenan ni se publican en la página.

Para cambiar el enlace telefónico que aparece en el pie, actualiza el atributo `href="tel:+584128867088"` en `index.html`. Para cambiar el número que recibe los mensajes de WhatsApp, sigue las instrucciones de la sección siguiente.

## 2. Número de WhatsApp para recibir pedidos

En `app.js`, busca la constante `WHATSAPP_NUMBER`:

```js
const WHATSAPP_NUMBER = "584128867088";
```

Reemplaza el valor por el número de la caja en formato internacional, con el código del país y **solo dígitos**: sin `+`, espacios, guiones ni paréntesis. Por ejemplo, un número venezolano comienza por `58`.

El botón **Procesar compra por WhatsApp** usa esta constante para abrir el chat y preparar el resumen del pedido.

## 3. Fotos reales de las instalaciones

La sección de galería anterior al pie usa estas imágenes locales:

- `assets/hipermercado-instalaciones.png`: collage de pasillos, área de frescos y fachada.
- `assets/area-bebidas.png`: área de bebidas.
- `assets/hipermercado-logo-interior.png`: logo iluminado en el interior.
- `assets/hipermercado-entrada-cajas.png`: entrada y cajas.
- `assets/hipermercado-pasillos.png`: pasillos de víveres.
- `assets/hipermercado-cuidado-hogar.png`: limpieza y cuidado personal.
- `assets/hipermercado-frescos-lacteos.png`: verduras y lácteos.
- `assets/hipermercado-fachada.png`: fachada exterior.

Las seis fotos nuevas fueron proporcionadas por el negocio. Para sustituir una foto, guarda la nueva imagen con el mismo nombre y formato PNG en `assets/`; el HTML ya apunta a esas rutas. El enlace **Ver ubicación en Google Maps** del pie abre la ubicación de Villa Bruzual compartida por el negocio.

Las imágenes del carrusel de promociones son fotografías ilustrativas de Unsplash, no fotos de las instalaciones ni garantía del inventario disponible. Se guardan localmente para que carguen sin depender de la conexión a Unsplash:

- `assets/promo-verduras.jpg`: [exhibidor de verduras](https://images.unsplash.com/photo-1516594798947-e65505dbb29d).
- `assets/promo-carnes.jpg`: [vitrina de carnicería con cortes de carne](https://unsplash.com/photos/raw-meat-on-display-counter-qgfjZUXup1M).
- La promoción de víveres utiliza la foto real de los pasillos del hipermercado: `assets/hipermercado-pasillos.png`.

Estas imágenes se usan solo como ambientación de cada categoría. La galería de **Nuestra tienda** continúa mostrando las fotos reales compartidas por el negocio.

## 4. Fotos de productos

Las fotos que ya estaban en el catálogo de demostración se conservan en:

```text
assets/products/
```

Para nuevos productos, no edites el código ni guardes fotos manualmente allí: usa el formulario de `/admin/`. La foto se cargará en el bucket `product-images` y el enlace quedará asociado al producto.

## 5. Agregar o cambiar productos, precios y ofertas

El inventario se administra desde `/admin/`; `app.js` ya no contiene una lista de productos. En el formulario plegable puedes asignar nombre, categoría, presentación, precio regular, precio de oferta, foto, disponibilidad y si aparece en **Lo Más Destacado**. Edita una fila para corregir sus datos; **Ocultar** marca el producto como agotado sin archivarlo. **Eliminar** lo archiva para que deje de aparecer en la tienda; usa el historial para restaurarlo.

Las ofertas deben ser menores que el precio regular. El catálogo muestra hasta 15 productos por página y se actualiza inmediatamente al guardar cambios en el panel, sin reconstruir el sitio.
