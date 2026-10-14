# Guía rápida para actualizar Hipermercado Kristal

## Abrir y probar la tienda

No necesitas subir la página a la nube. Abre con doble clic `index.html` desde el Explorador de archivos, o abre una terminal en la carpeta del proyecto y ejecuta en PowerShell:

```powershell
Start-Process .\index.html
```

También puedes abrir la carpeta en VS Code y usar **Live Server** si ya tienes esa extensión instalada.

El logo del encabezado y del pie utiliza el mismo archivo `assets/kristal-logo.png`. El catálogo incluye 53 productos asociados a fotos compartidas por el usuario. Las tarjetas muestran sus precios en USD y permiten agregarlos al carrito; al procesar el pedido, el sitio abre WhatsApp con el resumen para coordinar disponibilidad y entrega.

## 1. Navegación, vistas y enlaces

La página principal funciona como una aplicación de vistas independientes: **Inicio** muestra el panel de presentación y la selección destacada; **Catálogo** y cada categoría presentan el inventario publicado cuando se confirme; **Nuestra tienda** presenta las instalaciones y **Sobre nosotros** tiene una página institucional separada. **Cambios y devoluciones** y **Opiniones y preguntas frecuentes** también cuentan con vistas propias. La navegación cambia de vista sin giros de página y actualiza la URL y el historial; el botón para volver desde una categoría regresa al catálogo.

El buscador, el carrito y los accesos por WhatsApp permanecen disponibles en todas las vistas. Los enlaces **Política de privacidad** y **Términos y condiciones** del pie abren `politicas.html` directamente en su sección correspondiente. Esta página explica el uso de datos para pedidos por WhatsApp, la disponibilidad de productos y el proceso de confirmación y pago.

Los botones de redes sociales muestran un aviso hasta que se conozcan las cuentas oficiales. Cuando las tengas, reemplaza cada `<button data-info="redes">` del bloque `.social-links` en `index.html` por un enlace `<a href="URL_OFICIAL">` con la dirección real de cada perfil.

La página de **Sobre nosotros** presenta la ubicación, el surtido y el compromiso con la comunidad. No incluye fecha de fundación porque aún no se ha confirmado; actualízala cuando el negocio proporcione el dato oficial. La política de cambios y devoluciones está publicada en su propia vista.

La vista **Opiniones y preguntas frecuentes** permite filtrar las respuestas y preparar una pregunta u opinión para enviarla por WhatsApp. El indicador 4.9/5 y las tarjetas de reseña están marcados como contenido ficticio de demostración; no representan clientes ni valoraciones reales o verificadas. Los mensajes del formulario no se almacenan ni se publican en la página.

Para cambiar el enlace telefónico que aparece en el pie, actualiza el atributo `href="tel:+584245104430"` en `index.html`. Para cambiar el número que recibe los mensajes de WhatsApp, sigue las instrucciones de la sección siguiente.

## 2. Número de WhatsApp para recibir pedidos

En `app.js`, busca la constante `WHATSAPP_NUMBER`, que está justo después del arreglo `products`:

```js
const WHATSAPP_NUMBER = "584245104430";
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

## 4. Imágenes PNG transparentes de productos

Guarda las imágenes en:

```text
assets/products/
```

Usa nombres sencillos y únicos, por ejemplo `harina-maiz.png`. Procura que sean PNG con fondo transparente, bien recortados y con el producto centrado.

En `app.js`, cambia la propiedad `image` del producto por la ruta relativa desde la carpeta principal del sitio:

```js
image: "assets/products/harina-maiz.png",
```

La propiedad `alt` debe describir la imagen para personas que usan lectores de pantalla:

```js
alt: "Bolsa de harina de maíz precocida",
```

No hace falta cambiar el HTML de la tarjeta: el catálogo usa automáticamente esta ruta tanto en la tarjeta como en el carrito.

Las 53 imágenes de producto proporcionadas por el usuario están en `assets/products/` y se conectan con las tarjetas del catálogo: 4 harinas, 6 arroces, 4 aceites, 6 leches en polvo, 6 pastas, 11 bebidas, 8 papeles higiénicos, 7 detergentes/suavizante y 1 presentación de huevos. Las otras imágenes del lote —iconos y capturas de interfaz— no se trataron como productos. Confirma con Kristal la disponibilidad, presentación y precio real antes de publicar cualquier artículo como inventario.

## 5. Agregar o cambiar productos, precios y ofertas

El arreglo `products` al inicio de `app.js` contiene 53 artículos con fotos de los empaques y productos compartidos. Cada campo `price` determina el precio mostrado en USD y el subtotal del carrito. Puedes corregirlo directamente en el artículo; `oldPrice` y las insignias de oferta solo deben usarse para descuentos confirmados.

### Mostrar “Consultar por WhatsApp” en un producto

Normalmente, los productos con precio se pueden agregar al carrito. Para que un artículo muestre el botón **Consultar por WhatsApp**, agrega `consultarWhatsApp: true` dentro de su objeto en `app.js`:

```js
{
  id: "harina-pan",
  name: "Harina de maíz P.A.N.",
  price: 2.00,
  consultarWhatsApp: true,
  // Los demás campos del producto se mantienen igual.
}
```

El enlace abre el chat de Kristal con un mensaje que nombra ese producto. Para volver a mostrar **Agregar al carrito**, cambia el valor a `false` o elimina la propiedad. También se consulta por WhatsApp automáticamente cuando un producto no tiene un `price` numérico.

Para incluir un producto en **Lo Más Destacado** del inicio, agrega `esDestacado: true` al objeto. El carrusel se genera automáticamente con los productos marcados de esa manera.

- Mantén `id` único: se usa para identificar el producto en el carrito.
- `group` debe coincidir exactamente con un departamento del menú y del filtro: `Víveres y Alacena`, `Frutas y Verduras`, `Carnes, Aves y Charcutería`, `Bebidas y Licores`, `Snacks, Golosinas y Confitería`, `Cuidado Personal e Higiene`, `Cuidado del Hogar y Limpieza`, `Mascotas` o `Congelados`. `category` es el nombre más específico que se muestra en la tarjeta.
- El catálogo muestra hasta 15 productos por página (tres filas de cinco en computadora); cuando un departamento no tenga productos publicados, invita a consultar disponibilidad por WhatsApp.

El arreglo está en JavaScript (no es un archivo JSON separado), porque así la tienda puede usar los datos directamente sin un servidor adicional. No hace falta editar `index.html` para añadir tarjetas.
