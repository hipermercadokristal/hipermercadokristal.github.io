# Guía rápida para actualizar Hipermercado Kristal

## Abrir y probar la tienda

El sitio consulta los productos en Supabase y por eso debe abrirse desde un servidor web, no con doble clic sobre `index.html`. En desarrollo puedes usar **Live Server** de VS Code. Para publicarlo, el workflow existente de GitHub Pages despliega el sitio estático; los productos se actualizan desde Supabase sin volver a desplegarlo.

## Instalar la tienda como app

La tienda se puede instalar en el teléfono o computadora desde el botón **Instalar app** de la franja superior. En Android y navegadores compatibles, el botón abre la confirmación de instalación; en iPhone/iPad, usa **Compartir → Añadir a pantalla de inicio** desde Safari. La app se abre en una ventana independiente con el nombre y el logo de Hipermercado Kristal. También puede instalarse desde el menú del navegador.

La instalación requiere que la tienda esté publicada por HTTPS. La app conserva la estructura de la tienda para abrirla sin conexión, pero consultar el catálogo, iniciar sesión, registrar pedidos, adjuntar comprobantes y recibir actualizaciones requiere Internet.

## Configurar Supabase (una sola vez)

1. Crea un proyecto en Supabase y abre **SQL Editor**. Ejecuta `supabase-schema.sql` para crear las tablas `productos` y `categorias`, el bucket público `product-images`, las políticas RLS y la publicación Realtime.
2. Ejecuta `supabase-seed.sql` una sola vez si deseas importar el catálogo de 53 productos que ya mostraba la versión estática. El seed conserva sus rutas de fotos locales en `assets/products/`; verifica precios y disponibilidad antes de publicar. Las nuevas fotos agregadas desde el panel sí se suben al bucket de Supabase.
3. En **Project Settings → API**, copia la **Project URL** y la clave pública **anon/publishable** en `supabase-config.js`. Esas credenciales públicas pueden estar en el frontend; **nunca** pegues una clave `service_role` o secret en este repositorio.
4. Ejecuta `supabase-orders.sql` después de crear `productos` y `categorias`. Crea el historial y detalle de pedidos, perfiles de clientes, políticas RLS, el bucket privado `payment-proofs`, la función segura que calcula el pedido con precios vigentes de la base de datos y la publicación Realtime. El cliente debe adjuntar referencia y comprobante para Pago Móvil; el pago queda pendiente hasta que caja lo compruebe.
5. En **Authentication → Settings**, permite el registro de clientes. Si está activada la confirmación por correo, cada cliente deberá validar su dirección antes de iniciar sesión. Para habilitar **Continuar con Google**, crea credenciales OAuth de tipo aplicación web en Google Cloud Console, agrega como URI de redirección autorizada la URL de callback que muestra Supabase en **Authentication → Providers → Google**, activa Google en esa pantalla con el Client ID y Client Secret, y añade el dominio público de la tienda (incluida la ruta `/perfil`) a **Authentication → URL Configuration → Redirect URLs**. El botón permite crear una cuenta o iniciar sesión con Google; estas credenciales deben configurarse en el panel de Supabase/Google, no en el código. En **Authentication → Users**, crea/invita al propietario y asigna solo a esa cuenta el rol `admin` en `app_metadata` desde SQL Editor (sustituye el correo):

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'propietario@ejemplo.com';
   ```

   Cierra y vuelve a iniciar sesión después de asignar el rol para renovar el token. El registro público no permite que los clientes asignen o cambien `app_metadata.role`; por eso las políticas de administración siguen limitadas al propietario. Google proporciona nombre y correo; el cliente debe completar y guardar su teléfono en **Perfil** para hacer pedidos.
6. Abre `/admin/` para administrar el inventario y la bandeja de pedidos. Los clientes crean su cuenta desde **Perfil**; sus perfiles y pedidos quedan aislados por RLS. Desde la bandeja, caja abre el comprobante privado, verifica el abono en la cuenta bancaria y luego aprueba o rechaza el pago. También actualiza el estado de preparación/entrega y puede preparar manualmente un aviso por WhatsApp; no hay aprobación bancaria ni envío automático por API.

El checkout admite retiro, delivery, Pago Móvil, Zelle y efectivo/POS. Para Pago Móvil muestra y permite copiar el equivalente referencial en bolívares usando la tasa BCV, que caja debe confirmar antes de la transferencia. Para Zelle, caja debe proporcionar las instrucciones; no se configuran datos de destinatario. El recibo confirma el registro del pedido, pero no es factura fiscal ni prueba de pago. No se debe marcar un Pago Móvil como verificado solo por la referencia o la imagen.

Las rutas `/admin/`, `/perfil` y `/pedidos` siguen el enrutamiento de raíz existente de la tienda; la publicación debe servir el sitio desde la raíz del dominio configurado.

El panel requiere correo y contraseña de Supabase. RLS valida `app_metadata.role = admin` tanto en tablas como en Storage; ocultar el panel en el navegador no sustituye esas políticas. El catálogo público solo puede leer artículos disponibles; una tabla Realtime separada publica únicamente una señal de cambio para mantener privada la información de los productos agotados.

El panel `/admin/` adapta el formulario y el inventario a pantallas pequeñas: en móvil, cada fila de inventario se presenta como una tarjeta con sus datos y acciones.

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

El inventario se administra desde `/admin/`; `app.js` ya no contiene una lista de productos. En el formulario puedes asignar nombre, categoría, presentación, precio regular, precio de oferta, foto, disponibilidad y si aparece en **Lo Más Destacado**. Edita una fila para corregir sus datos; **Ocultar** marca el producto como agotado sin borrarlo, y **Eliminar** lo retira junto con su foto del bucket cuando corresponda.

Las ofertas deben ser menores que el precio regular. El catálogo muestra hasta 15 productos por página y se actualiza inmediatamente al guardar cambios en el panel, sin reconstruir el sitio.
