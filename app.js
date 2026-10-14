let products = [];

const WHATSAPP_NUMBER = "584128867088";
const FREE_SHIPPING_THRESHOLD = 50;
const PRODUCTS_PER_PAGE = 15;
const currency = new Intl.NumberFormat("es-VE", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
const productGrid = document.querySelector("#product-grid");
const categoryProductGrid = document.querySelector("#category-product-grid");
const featuredProductGrid = document.querySelector("#featured-products");
const departmentFilter = document.querySelector("#product-department-filter");
const homeView = document.querySelector("#home-view");
const catalogView = document.querySelector("#catalog-view");
const storeView = document.querySelector("#store-view");
const categoryView = document.querySelector("#category-view");
const aboutView = document.querySelector("#about-view");
const returnsView = document.querySelector("#returns-view");
const reviewsView = document.querySelector("#reviews-view");
const categoryViewTitle = document.querySelector("#category-view-title");
const categoryViewDescription = document.querySelector("#category-view-description");
const cartCount = document.querySelector("#cart-count");
const cartButton = document.querySelector("#cart-button");
const mobileCartButton = document.querySelector("#mobile-cart-button");
const mobileCartCount = document.querySelector("#mobile-cart-count");
const toast = document.querySelector("#toast");
const searchInput = document.querySelector("#search-input");
const cartDrawer = document.querySelector("#cart-drawer");
const cartBackdrop = document.querySelector("#cart-backdrop");
const cartItemsContainer = document.querySelector("#cart-items");
const checkoutButton = document.querySelector("#checkout-button");
const infoDialog = document.querySelector("#info-dialog");
const shippingProgressMessage = document.querySelector("#shipping-progress-message");
let activeFilter = "Todos";
let activeView = "home";
let activeCategory = "";
let cartTotal = 0;
const cartItems = new Map();
const favoriteItems = new Set();
const productPages = new Map();
let revealObserver = null;
let toastTimeout;
let lastFocusedElement = null;
let catalogLoadError = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function mapDatabaseProduct(row) {
  const category = Array.isArray(row.categorias) ? row.categorias[0] : row.categorias;
  if (!category) throw new Error(`El producto ${row.id} no tiene una categoría válida.`);
  return {
    id: row.id,
    name: row.nombre,
    category: category.nombre,
    group: category.departamento,
    detail: row.presentacion || "Presentación por confirmar",
    price: Number(row.precio_oferta ?? row.precio),
    oldPrice: row.precio_oferta === null ? null : Number(row.precio),
    image: row.imagen_url,
    alt: `Imagen de ${row.nombre}`,
    esDestacado: row.es_destacado,
    consultarWhatsApp: false,
    disponible: row.disponible,
  };
}

async function refreshProducts() {
  const { data, error } = await window.kristalSupabase
    .from("productos")
    .select("id,nombre,precio,precio_oferta,es_destacado,disponible,imagen_url,presentacion,categorias(nombre,departamento)")
    .eq("disponible", true)
    .order("nombre");
  if (error) throw error;

  products = data.map(mapDatabaseProduct);
  const productIds = new Set(products.map((product) => product.id));
  for (const productId of cartItems.keys()) {
    if (!productIds.has(productId)) cartItems.delete(productId);
  }
  catalogLoadError = "";
  updateCart();
  renderActiveProducts();
}

function initializeCatalog() {
  if (!window.kristalSupabase) {
    catalogLoadError = "Configura la URL y la clave pública de Supabase en supabase-config.js para cargar el catálogo.";
    renderActiveProducts();
    return;
  }

  refreshProducts().catch((error) => {
    console.error("No se pudo cargar el catálogo desde Supabase.", error);
    catalogLoadError = "No se pudo conectar con el catálogo. Intenta recargar la página más tarde.";
    renderActiveProducts();
  });

  window.kristalSupabase
    .channel("productos-en-tiempo-real")
    .on("postgres_changes", { event: "*", schema: "public", table: "producto_eventos" }, () => {
      refreshProducts().catch((error) => {
        console.error("No se pudo actualizar el catálogo en tiempo real.", error);
        catalogLoadError = "No se pudo actualizar el catálogo. Revisa tu conexión e inténtalo de nuevo.";
        renderActiveProducts();
      });
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Falló la suscripción en tiempo real de productos.", error);
      }
    });
}

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

function setActiveFilter(filter, { clearSearch = false } = {}) {
  activeFilter = filter;
  if (clearSearch) searchInput.value = "";

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    const selected = chip.dataset.filter === activeFilter;
    chip.classList.toggle("active", selected);
    chip.setAttribute("aria-pressed", String(selected));
  });

  document.querySelectorAll(".category-links [data-category]").forEach((link) => {
    const selected = link.dataset.category === activeFilter;
    link.classList.toggle("selected", selected);
    if (selected) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });

  if (departmentFilter) {
    departmentFilter.value = [...departmentFilter.options].some((option) => option.value === activeFilter)
      ? activeFilter
      : "Todos";
  }
}

function setCurrentNavigation(view, category = "") {
  document.querySelectorAll("#category-links a").forEach((link) => {
    const current =
      (view === "home" && link.hasAttribute("data-page-home")) ||
      (view === "catalog" && link.hasAttribute("data-page-catalog")) ||
      (view === "store" && link.hasAttribute("data-page-store")) ||
      (view === "about" && link.hasAttribute("data-page-about")) ||
      (view === "returns" && link.hasAttribute("data-page-returns")) ||
      (view === "reviews" && link.hasAttribute("data-page-reviews")) ||
      (view === "category" && link.dataset.category === category);
    if (current) link.setAttribute("aria-current", "page");
    else if (link.getAttribute("aria-current") === "page") link.removeAttribute("aria-current");
  });
}

function renderProducts(targetGrid = productGrid, filter = activeFilter) {
  const query = normalizeText(searchInput.value);
  const normalizedFilter = normalizeText(filter);
  const pagination = document.querySelector(`[data-pagination-for="${targetGrid.id}"]`);
  if (catalogLoadError) {
    targetGrid.innerHTML = `<p class="empty-state">${escapeHtml(catalogLoadError)}</p>`;
    if (pagination) {
      pagination.innerHTML = "";
      pagination.hidden = true;
    }
    return;
  }
  const visibleProducts = products.filter((product) => {
    const matchesFilter =
      normalizedFilter === "todos" ||
      (normalizedFilter === "favoritos"
        ? favoriteItems.has(product.id)
        : normalizedFilter === "ofertas"
          ? Number.isFinite(product.oldPrice) && Number.isFinite(product.price)
          : normalizeText(product.group) === normalizedFilter || normalizeText(product.category) === normalizedFilter);
    const searchableText = normalizeText(
      `${product.name} ${product.category} ${product.group} ${product.detail}`,
    );
    const matchesSearch = searchableText.includes(query);
    return matchesFilter && matchesSearch;
  });

  if (!visibleProducts.length) {
    const isDepartment =
      targetGrid === categoryProductGrid ||
      Object.keys(categoryDescriptions).some((category) => normalizeText(category) === normalizedFilter);
    targetGrid.innerHTML =
      normalizedFilter === "favoritos"
        ? '<p class="empty-state">Aún no tienes favoritos. Guarda productos con el icono de corazón.</p>'
        : normalizedFilter === "ofertas"
          ? `<p class="empty-state">No hay ofertas confirmadas publicadas. <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener noreferrer">Consulta promociones vigentes por WhatsApp.</a></p>`
        : !products.length || isDepartment
          ? `<p class="empty-state">Aún no hay productos publicados ${isDepartment ? "en este departamento" : "en el catálogo"}. <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener noreferrer">Consulta disponibilidad y precios por WhatsApp.</a></p>`
          : '<p class="empty-state">No encontramos productos. Prueba con otra búsqueda.</p>';
    if (pagination) {
      pagination.innerHTML = "";
      pagination.hidden = true;
    }
    return;
  }

  const totalPages = Math.ceil(visibleProducts.length / PRODUCTS_PER_PAGE);
  const currentPage = Math.min(productPages.get(targetGrid.id) || 1, totalPages);
  productPages.set(targetGrid.id, currentPage);
  const pageProducts = visibleProducts.slice((currentPage - 1) * PRODUCTS_PER_PAGE, currentPage * PRODUCTS_PER_PAGE);

  targetGrid.innerHTML = pageProducts
    .map((product) => {
      const hasOffer = Number.isFinite(product.oldPrice) && product.oldPrice > product.price;
      const badgeClass = hasOffer ? "product-badge sale" : "product-badge popular";
      const badge = hasOffer ? "OFERTA" : product.esDestacado ? "DESTACADO" : "";
      const regularPrice = hasOffer
        ? `<span class="regular-price">${currency.format(product.oldPrice)}</span>`
        : "";
      const currentPrice = Number.isFinite(product.price)
        ? `<span class="current-price">${currency.format(product.price)}</span>`
        : '<span class="current-price">Precio por confirmar</span>';
      const quantity = cartItems.get(product.id) || 0;
      const isFavorite = favoriteItems.has(product.id);
      const canPurchase = Number.isFinite(product.price) && !product.consultarWhatsApp;
      const cartControl = canPurchase && quantity
        ? `<span class="quantity-control" aria-label="Cantidad en carrito: ${quantity}"><button class="quantity-button" type="button" data-action="decrease" data-product="${product.id}" aria-label="Quitar uno de ${escapeHtml(product.name)}">−</button><span>${quantity}</span><button class="quantity-button" type="button" data-action="increase" data-product="${product.id}" aria-label="Agregar uno de ${escapeHtml(product.name)}">+</button></span>`
        : canPurchase
          ? `<button class="add-button" type="button" data-action="increase" data-product="${product.id}"><span aria-hidden="true">+</span> Agregar al carrito</button>`
          : `<a class="add-button" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hola, quisiera consultar el precio vigente y la disponibilidad de ${product.name}.`)}" target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a>`;
      return `
        <article class="product-card" data-reveal>
          ${badge ? `<span class="${badgeClass}">${badge}</span>` : ""}
          <button class="favorite-button${isFavorite ? " active" : ""}" type="button" aria-label="${isFavorite ? "Quitar" : "Añadir"} ${escapeHtml(product.name)} ${isFavorite ? "de" : "a"} favoritos" aria-pressed="${isFavorite}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.3-8.8 10-8.8 10s-8.8-4.7-8.8-10A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z" /></svg></button>
          <div class="product-image-wrap">
            <img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.alt)}" loading="lazy" />
          </div>
          <span class="product-category">${escapeHtml(product.category)}</span>
          <h3 class="product-name">${escapeHtml(product.name)}</h3>
          <span class="product-presentation">${escapeHtml(product.detail)}</span>
          <div class="product-prices">${regularPrice}${currentPrice}</div>
          ${cartControl}
        </article>`;
    })
    .join("");
  if (pagination) {
    pagination.hidden = totalPages <= 1;
    pagination.innerHTML =
        totalPages <= 1
          ? ""
          : `<button class="pagination-button" type="button" data-page-number="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""} aria-label="Página anterior">Anterior</button>
            <span class="pagination-pages">${Array.from({ length: totalPages }, (_, index) => {
              const page = index + 1;
              return `<button class="pagination-button${page === currentPage ? " active" : ""}" type="button" data-page-number="${page}" aria-label="Página ${page}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`;
            }).join("")}</span>
            <button class="pagination-button" type="button" data-page-number="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""} aria-label="Página siguiente">Siguiente</button>`;
  }
  observeRevealElements(targetGrid);
}

function renderFeaturedProducts() {
  const scrollLeft = featuredProductGrid.scrollLeft;
  const featuredProducts = products.filter((product) => product.esDestacado);
  const carouselControls = document.querySelector(".featured-heading .carousel-controls");
  carouselControls.hidden = !featuredProducts.length;
  if (catalogLoadError) {
    featuredProductGrid.innerHTML = `<p class="empty-state">${escapeHtml(catalogLoadError)}</p>`;
    updateCarouselControls();
    return;
  }
  if (!featuredProducts.length) {
    featuredProductGrid.innerHTML = `<p class="empty-state">Estamos actualizando la selección de productos. <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener noreferrer">Consulta productos y ofertas vigentes por WhatsApp.</a></p>`;
    updateCarouselControls();
    return;
  }
  featuredProductGrid.innerHTML = featuredProducts
    .map((product) => {
      const quantity = cartItems.get(product.id) || 0;
      const hasOffer = Number.isFinite(product.oldPrice) && product.oldPrice > product.price;
      const discount = hasOffer ? Math.round((1 - product.price / product.oldPrice) * 100) : 0;
      const canPurchase = Number.isFinite(product.price) && !product.consultarWhatsApp;
      const cartControl = canPurchase && quantity
        ? `<span class="quantity-control" aria-label="Cantidad en carrito: ${quantity}"><button class="quantity-button" type="button" data-action="decrease" data-product="${product.id}" aria-label="Quitar uno de ${escapeHtml(product.name)}">−</button><span>${quantity}</span><button class="quantity-button" type="button" data-action="increase" data-product="${product.id}" aria-label="Agregar uno de ${escapeHtml(product.name)}">+</button></span>`
        : canPurchase
          ? `<button class="add-button" type="button" data-action="increase" data-product="${product.id}"><span aria-hidden="true">+</span> Compra rápida</button>`
          : `<a class="add-button" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hola, quisiera consultar el precio vigente y la disponibilidad de ${product.name}.`)}" target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a>`;
      return `
        <article class="product-card featured-product-card" data-reveal>
          <span class="product-badge ${hasOffer ? "sale" : "popular"}">${hasOffer ? `OFERTA ${discount}%` : "DESTACADO"}</span>
          <div class="product-image-wrap">
            <img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.alt)}" loading="lazy" />
          </div>
          <span class="product-category">${escapeHtml(product.category)}</span>
          <h3 class="product-name">${escapeHtml(product.name)}</h3>
          <span class="product-presentation">${escapeHtml(product.detail)}</span>
          <div class="product-prices">${hasOffer
            ? `<span class="regular-price">Regular: ${currency.format(product.oldPrice)}</span><span class="current-price">Oferta: ${currency.format(product.price)}</span>`
            : `<span class="current-price">${currency.format(product.price)}</span>`}
          </div>
          ${cartControl}
        </article>`;
    })
    .join("");
  featuredProductGrid.scrollLeft = scrollLeft;
  observeRevealElements(featuredProductGrid);
  updateCarouselControls();
}

const categoryDescriptions = {
  "Víveres y Alacena": "Granos, aceites, harinas y enlatados para tu despensa.",
  "Frutas y Verduras": "Frescos del campo para acompañar tus comidas.",
  "Carnes, Aves y Charcutería": "Cortes, embutidos y lácteos para cada ocasión.",
  "Bebidas y Licores": "Jugos, gaseosas, aguas, maltas y más.",
  "Snacks, Golosinas y Confitería": "Galletas, chocolates, papitas y frutos secos.",
  "Cuidado Personal e Higiene": "Cuidado capilar, jabones, crema dental y desodorantes.",
  "Cuidado del Hogar y Limpieza": "Detergentes, desinfectantes, lavaplatos y utensilios de limpieza.",
  Mascotas: "Alimentos y productos para el cuidado de tus mascotas.",
  Congelados: "Alimentos congelados listos para tu hogar.",
};

function categoryHash(category) {
  return `#categoria/${normalizeText(category).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function closeMobileCategoryMenu() {
  document.querySelector("#category-links").classList.remove("open");
  document.querySelector("#mobile-menu-button").setAttribute("aria-expanded", "false");
  document.querySelector(".departments-menu").open = false;
}

function showCategoryView(category, { pushHistory = true } = {}) {
  activeView = "category";
  activeCategory = category;
  homeView.hidden = true;
  catalogView.hidden = true;
  storeView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  categoryView.hidden = false;
  setActiveFilter(category, { clearSearch: true });
  setCurrentNavigation("category", category);
  categoryViewTitle.textContent = category;
  categoryViewDescription.textContent = categoryDescriptions[category] || "Explora los productos de esta categoría.";
  productPages.set(categoryProductGrid.id, 1);
  renderProducts(categoryProductGrid, category);
  closeMobileCategoryMenu();
  document.title = `${categoryViewTitle.textContent} | Hipermercado Kristal`;
  if (pushHistory) history.pushState({ view: "category", category }, "", categoryHash(category));
  window.scrollTo(0, 0);
}

function showHomeView({ pushHistory = true } = {}) {
  activeView = "home";
  activeCategory = "";
  categoryView.hidden = true;
  catalogView.hidden = true;
  storeView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  homeView.hidden = false;
  setActiveFilter("Todos", { clearSearch: true });
  setCurrentNavigation("home");
  closeMobileCategoryMenu();
  document.title = "Inicio | Hipermercado Kristal";
  if (pushHistory) history.pushState({ view: "home" }, "", "#inicio");
  window.scrollTo(0, 0);
}

function showCatalogView({ filter = "Todos", pushHistory = true, scrollTarget = null, clearSearch = false } = {}) {
  activeView = "catalog";
  activeCategory = "";
  homeView.hidden = true;
  categoryView.hidden = true;
  storeView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  catalogView.hidden = false;
  productPages.set(productGrid.id, 1);
  setActiveFilter(filter, { clearSearch });
  setCurrentNavigation("catalog");
  renderProducts(productGrid, filter);
  closeMobileCategoryMenu();
  document.title = filter === "Ofertas" ? "Ofertas | Hipermercado Kristal" : "Catálogo | Hipermercado Kristal";
  if (pushHistory) {
    const hash = filter === "Ofertas" ? "#ofertas" : "#catalogo";
    history.pushState({ view: "catalog", filter }, "", hash);
  }
  if (scrollTarget) document.querySelector(scrollTarget)?.scrollIntoView({ behavior: "auto", block: "start" });
  else window.scrollTo(0, 0);
}

function showStoreView({ pushHistory = true, scrollTarget = null } = {}) {
  activeView = "store";
  activeCategory = "";
  homeView.hidden = true;
  categoryView.hidden = true;
  catalogView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  storeView.hidden = false;
  setActiveFilter("Todos", { clearSearch: true });
  setCurrentNavigation("store");
  closeMobileCategoryMenu();
  document.title = "Nuestra tienda | Hipermercado Kristal";
  if (pushHistory) history.pushState({ view: "store" }, "", "#tienda");
  if (scrollTarget) document.querySelector(scrollTarget)?.scrollIntoView({ behavior: "auto", block: "start" });
  else window.scrollTo(0, 0);
}

function showInstitutionalView(viewName, viewElement, title, hash, { pushHistory = true } = {}) {
  activeView = viewName;
  activeCategory = "";
  homeView.hidden = true;
  catalogView.hidden = true;
  storeView.hidden = true;
  categoryView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  viewElement.hidden = false;
  setActiveFilter("Todos", { clearSearch: true });
  setCurrentNavigation(viewName);
  closeMobileCategoryMenu();
  document.title = `${title} | Hipermercado Kristal`;
  if (pushHistory) history.pushState({ view: viewName }, "", hash);
  window.scrollTo(0, 0);
}

function showAboutView(options) {
  showInstitutionalView("about", aboutView, "Sobre nosotros", "#nosotros", options);
}

function showReturnsView(options) {
  showInstitutionalView("returns", returnsView, "Cambios y devoluciones", "#cambios", options);
}

function showReviewsView(options) {
  showInstitutionalView("reviews", reviewsView, "Opiniones y preguntas frecuentes", "#opiniones", options);
}

function restoreRoute(state = history.state) {
  if (state?.view === "about" || location.hash === "#nosotros") {
    showAboutView({ pushHistory: false });
    return;
  }
  if (state?.view === "returns" || location.hash === "#cambios") {
    showReturnsView({ pushHistory: false });
    return;
  }
  if (state?.view === "reviews" || location.hash === "#opiniones") {
    showReviewsView({ pushHistory: false });
    return;
  }
  if (state?.view === "category" && categoryDescriptions[state.category]) {
    showCategoryView(state.category, { pushHistory: false });
    return;
  }
  if (state?.view === "catalog" || location.hash === "#catalogo") {
    showCatalogView({ filter: state?.filter || "Todos", pushHistory: false });
    return;
  }
  if (state?.view === "store" || location.hash === "#tienda" || location.hash === "#instalaciones") {
    showStoreView({ pushHistory: false });
    return;
  }
  if (state?.view === "home") {
    showHomeView({ filter: state.filter || "Todos", pushHistory: false });
    return;
  }
  const route = location.hash.match(/^#categoria\/([a-z0-9-]+)$/);
  if (route) {
    const category = Object.keys(categoryDescriptions).find((item) =>
      categoryHash(item) === `#categoria/${route[1]}`,
    );
    if (category) {
      showCategoryView(category, { pushHistory: false });
      return;
    }
  }
  if (location.hash === "#ofertas") {
    showCatalogView({ filter: "Ofertas", pushHistory: false });
    return;
  }
  showHomeView({ pushHistory: false });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

function showInfoDialog(title, message) {
  document.querySelector("#info-dialog-title").textContent = title;
  document.querySelector("#info-dialog-message").textContent = message;
  infoDialog.showModal();
}

function renderCart() {
  const entries = products.filter((product) => cartItems.has(product.id));
  const itemCount = [...cartItems.values()].reduce((total, quantity) => total + quantity, 0);
  const subtotal = entries.reduce((total, product) => total + product.price * cartItems.get(product.id), 0);
  document.querySelector("#cart-item-summary").textContent = `(${itemCount} ${itemCount === 1 ? "producto" : "productos"})`;
  document.querySelector("#cart-total").textContent = entries.length ? currency.format(subtotal) : "—";
  const shippingProgress = Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100);
  const shippingProgressTrack = document.querySelector("#shipping-progress-track");
  document.querySelector("#shipping-progress-fill").style.width = `${shippingProgress}%`;
  shippingProgressTrack.setAttribute("aria-valuenow", String(Math.min(subtotal, FREE_SHIPPING_THRESHOLD)));
  shippingProgressMessage.textContent = subtotal >= FREE_SHIPPING_THRESHOLD
    ? "¡Felicidades! Tu compra ya califica para envío gratis."
    : `Agrega ${currency.format(FREE_SHIPPING_THRESHOLD - subtotal)} más para obtener envío gratis.`;
  checkoutButton.disabled = entries.length === 0;

  if (!entries.length) {
    cartItemsContainer.innerHTML = `
      <div class="cart-empty">
        <span class="cart-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21 8H6" /><circle cx="10" cy="21" r="1" /><circle cx="18" cy="21" r="1" /></svg></span>
        <h3>Tu carrito está vacío</h3>
        <p>Consulta por WhatsApp la disponibilidad y los precios vigentes.</p>
        <button class="continue-shopping" type="button" data-close-cart>Seguir comprando</button>
      </div>`;
    return;
  }

  cartItemsContainer.innerHTML = entries
    .map((product) => {
      const quantity = cartItems.get(product.id);
      const lineTotal = product.price * quantity;
      return `
        <article class="cart-item">
          <div class="cart-item-image"><img src="${escapeHtml(product.image)}" alt="" /></div>
          <div class="cart-item-details">
            <h3>${escapeHtml(product.name)}</h3>
            <span class="cart-item-presentation">${escapeHtml(product.detail)}</span>
            <span class="cart-item-unit-price">${currency.format(product.price)} c/u</span>
            <div class="cart-item-bottom">
              <span class="cart-quantity-control">
                <button type="button" data-cart-action="decrease" data-product="${product.id}" aria-label="Disminuir ${escapeHtml(product.name)}">−</button>
                <span>${quantity}</span>
                <button type="button" data-cart-action="increase" data-product="${product.id}" aria-label="Aumentar ${escapeHtml(product.name)}">+</button>
              </span>
              <strong class="cart-line-total">${currency.format(lineTotal)}</strong>
            </div>
          </div>
          <button class="cart-remove" type="button" data-cart-action="remove" data-product="${product.id}" aria-label="Eliminar ${escapeHtml(product.name)} del carrito">×</button>
        </article>`;
    })
    .join("");
}

function updateCarouselControls() {
  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    const carousel = document.getElementById(button.dataset.scrollTarget);
    if (!carousel) return;
    const direction = Number(button.dataset.scrollDirection);
    const atStart = carousel.scrollLeft <= 1;
    const atEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 1;
    button.disabled = direction < 0 ? atStart : atEnd;
  });
}

function observeRevealElements(root = document) {
  if (!revealObserver) return;
  root.querySelectorAll("[data-reveal]").forEach((element) => {
    if (element.dataset.revealObserved) return;
    element.dataset.revealObserved = "true";
    revealObserver.observe(element);
  });
}

function animateAddToCart(source) {
  const cartIcon = document.querySelector(".cart-icon-wrap");
  cartIcon.classList.remove("bouncing");
  void cartIcon.offsetWidth;
  cartIcon.classList.add("bouncing");

  const bounds = source.getBoundingClientRect();
  const originX = bounds.left + bounds.width / 2;
  const originY = bounds.top + bounds.height / 2;
  for (let index = 0; index < 7; index += 1) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * index) / 7;
    spark.className = "cart-spark";
    spark.style.left = `${originX}px`;
    spark.style.top = `${originY}px`;
    spark.style.setProperty("--spark-x", `${Math.cos(angle) * 38}px`);
    spark.style.setProperty("--spark-y", `${Math.sin(angle) * 38}px`);
    document.body.append(spark);
    requestAnimationFrame(() => spark.classList.add("visible"));
    spark.addEventListener("animationend", () => spark.remove(), { once: true });
  }
}

function setCartOpen(isOpen) {
  if (isOpen) {
    lastFocusedElement = document.activeElement;
    renderCart();
    cartDrawer.inert = false;
    cartBackdrop.hidden = false;
    requestAnimationFrame(() => {
      cartDrawer.classList.add("open");
      cartBackdrop.classList.add("visible");
      cartDrawer.setAttribute("aria-hidden", "false");
      document.body.classList.add("cart-open");
      document.querySelector("#cart-close").focus();
    });
    return;
  }

  cartDrawer.classList.remove("open");
  cartBackdrop.classList.remove("visible");
  cartDrawer.setAttribute("aria-hidden", "true");
  cartDrawer.inert = true;
  document.body.classList.remove("cart-open");
  window.setTimeout(() => {
    if (!cartDrawer.classList.contains("open")) cartBackdrop.hidden = true;
  }, 260);
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function updateCart() {
  cartTotal = [...cartItems.values()].reduce((total, quantity) => total + quantity, 0);
  cartCount.textContent = String(cartTotal);
  cartButton.setAttribute("aria-label", `Carrito, ${cartTotal} ${cartTotal === 1 ? "artículo" : "artículos"}`);
  mobileCartCount.textContent = String(cartTotal);
  mobileCartButton.setAttribute("aria-label", `Abrir carrito, ${cartTotal} ${cartTotal === 1 ? "artículo" : "artículos"}`);
  mobileCartButton.hidden = cartTotal === 0;
  document.body.classList.toggle("has-cart-items", cartTotal > 0);
  renderCart();
}

function renderActiveProducts() {
  if (activeView === "category") renderProducts(categoryProductGrid, activeCategory);
  else renderProducts(productGrid, activeFilter);
  renderFeaturedProducts();
}

document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (activeView !== "category") {
    showCatalogView({ filter: activeFilter, scrollTarget: "#productos" });
    renderProducts(productGrid, activeFilter);
  } else {
    renderActiveProducts();
  }
});

searchInput.addEventListener("input", () => {
  if (activeView === "home" && searchInput.value.trim()) {
    showCatalogView({ pushHistory: false });
    history.replaceState({ view: "catalog", filter: activeFilter }, "", "#catalogo");
  }
  if (activeView === "catalog" && searchInput.value.trim() && activeFilter !== "Todos") setActiveFilter("Todos");
  productPages.set(
    activeView === "category" ? categoryProductGrid.id : productGrid.id,
    1,
  );
  renderActiveProducts();
});

document.querySelector(".product-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  setActiveFilter(button.dataset.filter, { clearSearch: button.dataset.filter === "Todos" });
  productPages.set(productGrid.id, 1);
  renderProducts();
});

departmentFilter.addEventListener("change", () => {
  setActiveFilter(departmentFilter.value, { clearSearch: true });
  productPages.set(productGrid.id, 1);
  renderProducts(productGrid, activeFilter);
});

document.querySelectorAll(".product-pagination").forEach((pagination) => {
  pagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page-number]");
    if (!button || button.disabled) return;
    const targetGrid = document.getElementById(pagination.dataset.paginationFor);
    if (!targetGrid) return;
    productPages.set(targetGrid.id, Number(button.dataset.pageNumber));
    renderProducts(targetGrid, targetGrid === categoryProductGrid ? activeCategory : activeFilter);
  });
});

document.querySelector(".category-links").addEventListener("click", (event) => {
  const homeLink = event.target.closest("[data-page-home]");
  if (homeLink) {
    event.preventDefault();
    showHomeView();
    return;
  }
  const catalogLink = event.target.closest("[data-page-catalog]");
  if (catalogLink) {
    event.preventDefault();
    showCatalogView({ clearSearch: true });
    return;
  }
  const storeLink = event.target.closest("[data-page-store]");
  if (storeLink) {
    event.preventDefault();
    showStoreView();
    return;
  }
  if (event.target.closest("[data-page-about]")) {
    event.preventDefault();
    showAboutView();
    return;
  }
  if (event.target.closest("[data-page-returns]")) {
    event.preventDefault();
    showReturnsView();
    return;
  }
  if (event.target.closest("[data-page-reviews]")) {
    event.preventDefault();
    showReviewsView();
    return;
  }
  const link = event.target.closest("[data-category]");
  if (!link) return;
  event.preventDefault();
  if (link.dataset.category === "Ofertas") {
    showCatalogView({ filter: "Ofertas", clearSearch: true });
    return;
  }
  showCategoryView(link.dataset.category);
});

document.querySelectorAll(".filter-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showCatalogView({ filter: link.dataset.filter, clearSearch: true });
  });
});

function handleProductGridClick(event) {
  const favorite = event.target.closest(".favorite-button");
  if (favorite) {
    const productId = favorite.closest(".product-card").querySelector("[data-product]")?.dataset.product;
    if (!productId) return;
    const isFavorite = favoriteItems.has(productId);
    if (isFavorite) favoriteItems.delete(productId);
    else favoriteItems.add(productId);
    favorite.classList.toggle("active", !isFavorite);
    favorite.setAttribute("aria-pressed", String(!isFavorite));
    renderActiveProducts();
    showToast(isFavorite ? "Producto eliminado de tus favoritos" : "Producto añadido a tus favoritos");
    return;
  }

  const quantityButton = event.target.closest("[data-action]");
  if (!quantityButton) return;
  const product = products.find((item) => item.id === quantityButton.dataset.product);
  if (!product) return;

  const direction = quantityButton.dataset.action === "decrease" ? -1 : 1;
  const quantity = Math.max(0, (cartItems.get(product.id) || 0) + direction);
  if (quantity) cartItems.set(product.id, quantity);
  else cartItems.delete(product.id);
  if (direction > 0) animateAddToCart(quantityButton);
  updateCart();
  renderActiveProducts();
  showToast(direction > 0 ? `${product.name} agregado al carrito` : quantity ? `Cantidad actualizada: ${quantity}` : `${product.name} eliminado del carrito`);
}

productGrid.addEventListener("click", handleProductGridClick);
categoryProductGrid.addEventListener("click", handleProductGridClick);
featuredProductGrid.addEventListener("click", handleProductGridClick);

document.querySelector("#category-back-button").addEventListener("click", () => showCatalogView({ clearSearch: true }));
window.addEventListener("popstate", (event) => restoreRoute(event.state));

document.querySelectorAll('.brand[href="#inicio"]').forEach((brand) => {
  brand.addEventListener("click", (event) => {
    event.preventDefault();
    showHomeView();
  });
});

document.querySelectorAll('a[href="#sucursales"], a[href="#beneficios"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showStoreView({ scrollTarget: event.currentTarget.getAttribute("href") });
  });
});

document.querySelectorAll('a[href="#instalaciones"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showStoreView({ scrollTarget: "#instalaciones" });
  });
});

document.querySelector(".dashboard-store-preview [data-page-store]").addEventListener("click", (event) => {
  event.preventDefault();
  showStoreView();
});

document.querySelectorAll("footer [data-page-about]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  showAboutView();
}));
document.querySelectorAll("footer [data-page-returns]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  showReturnsView();
}));
document.querySelectorAll("footer [data-page-reviews]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  showReviewsView();
}));

document.querySelector("#hero-cta").addEventListener("click", (event) => {
  event.preventDefault();
  showCategoryView(event.currentTarget.dataset.category);
});

document.querySelector("#welcome-catalog-cta").addEventListener("click", (event) => {
  event.preventDefault();
  showCatalogView({ scrollTarget: "#productos" });
});

cartButton.addEventListener("click", () => setCartOpen(true));
mobileCartButton.addEventListener("click", () => setCartOpen(true));
document.querySelector("#cart-close").addEventListener("click", () => setCartOpen(false));
cartBackdrop.addEventListener("click", () => setCartOpen(false));
cartItemsContainer.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-cart]")) {
    setCartOpen(false);
    return;
  }

  const control = event.target.closest("[data-cart-action]");
  if (!control) return;
  const product = products.find((item) => item.id === control.dataset.product);
  if (!product) return;

  const action = control.dataset.cartAction;
  const currentQuantity = cartItems.get(product.id) || 0;
  if (action === "remove") {
    cartItems.delete(product.id);
    showToast(`${product.name} eliminado del carrito`);
  } else {
    const adjustment = action === "increase" ? 1 : -1;
    const nextQuantity = Math.max(0, currentQuantity + adjustment);
    if (nextQuantity) cartItems.set(product.id, nextQuantity);
    else cartItems.delete(product.id);
    if (adjustment > 0) animateAddToCart(control);
  }
  updateCart();
  renderActiveProducts();
  if (action === "remove") {
    document.querySelector("#cart-close").focus();
  } else {
    cartItemsContainer
      .querySelector(`[data-cart-action="${action}"][data-product="${product.id}"]`)
      ?.focus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cartDrawer.classList.contains("open")) {
    setCartOpen(false);
    return;
  }
  if (event.key !== "Tab" || !cartDrawer.classList.contains("open")) return;
  const focusable = [...cartDrawer.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

checkoutButton.addEventListener("click", () => {
  const entries = products.filter((product) => cartItems.has(product.id));
  if (!entries.length) return;

  const total = entries.reduce((sum, product) => sum + product.price * cartItems.get(product.id), 0);
  const orderLines = entries.map((product) => {
    const quantity = cartItems.get(product.id);
    const lineTotal = product.price * quantity;
    return `• ${product.name} (${product.detail}) x${quantity} — ${currency.format(product.price)} c/u | Subtotal: ${currency.format(lineTotal)}`;
  });
  const message = [
    "¡Hola, Hipermercado Kristal! Quiero procesar este pedido:",
    "",
    ...orderLines,
    "",
    `TOTAL: ${currency.format(total)}`,
    "",
    "Quedo atento/a para confirmar disponibilidad y coordinar la entrega. ¡Gracias!",
  ].join("\n");
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
});

document.querySelectorAll("[data-scroll-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const carousel = document.getElementById(button.dataset.scrollTarget);
    if (!carousel) return;
    carousel.scrollBy({
      left: Number(button.dataset.scrollDirection) * carousel.clientWidth * 0.85,
      behavior: "smooth",
    });
  });
});

document.querySelectorAll(".featured-product-grid, .hypermarket-gallery").forEach((carousel) => {
  carousel.addEventListener("scroll", updateCarouselControls, { passive: true });
});

document.querySelector("#mobile-menu-button").addEventListener("click", (event) => {
  const menu = document.querySelector("#category-links");
  const isOpen = menu.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(isOpen));
  if (!isOpen) document.querySelector(".departments-menu").open = false;
});

const slides = [
  {
    eyebrow: "FRUTAS Y VERDURAS FRESCAS",
    title: "Tu fin de semana<br />rinde mucho más en<br />Frutas y Verduras",
    description: "Color, sabor y frescura para llenar tu mesa.",
    cta: "Ver frescos",
    category: "Frutas y Verduras",
    image: "assets/promo-verduras.jpg",
    theme: "fresh",
    sticker: "FRESCO",
    stickerCopy: "como<br />debe ser",
  },
  {
    eyebrow: "CARNES Y CHARCUTERÍA",
    title: "Calidad y frescura<br />insuperable en Carnes<br />y Charcutería",
    description: "El sabor ideal para compartir alrededor de la mesa.",
    cta: "Ver carnes",
    category: "Carnes, Aves y Charcutería",
    image: "assets/promo-carnes.jpg",
    theme: "meat",
    sticker: "CALIDAD",
    stickerCopy: "para<br />compartir",
  },
  {
    eyebrow: "VÍVERES Y DESPENSA",
    title: "Todo lo esencial<br />para tu hogar<br />al mejor precio",
    description: "Llena tu despensa con lo que necesitas cada día.",
    cta: "Ver víveres",
    category: "Víveres y Alacena",
    image: "assets/hipermercado-pasillos.png",
    theme: "pantry",
    sticker: "ESENCIAL",
    stickerCopy: "para<br />tu hogar",
  },
];
let activeSlide = 0;
let heroTransitionTimeout;
const hero = document.querySelector(".hero");

function selectSlide(index) {
  if (index === activeSlide) return;
  activeSlide = index;
  const slide = slides[index];
  hero.dataset.slide = String(index);
  document.querySelector("#hero-image").src = slide.image;
  document.querySelector("#hero-sticker-title").textContent = slide.sticker;
  document.querySelector("#hero-sticker-copy").innerHTML = slide.stickerCopy;
  const heroContent = document.querySelector(".hero-content");
  heroContent.classList.remove("changing");
  void heroContent.offsetWidth;
  heroContent.classList.add("changing");
  window.clearTimeout(heroTransitionTimeout);
  heroTransitionTimeout = window.setTimeout(() => heroContent.classList.remove("changing"), 320);
  document.querySelector("#hero-eyebrow").textContent = slide.eyebrow;
  document.querySelector("#hero-title").innerHTML = slide.title;
  document.querySelector("#hero-description").textContent = slide.description;
  document.querySelector("#hero-cta").firstChild.textContent = `${slide.cta} `;
  document.querySelector("#hero-cta").dataset.category = slide.category;
  document.querySelector("#hero-cta").href = categoryHash(slide.category);
  document.querySelectorAll(".hero-dot").forEach((dot, dotIndex) => {
    const selected = dotIndex === index;
    dot.classList.toggle("active", selected);
    dot.setAttribute("aria-pressed", String(selected));
  });
}

document.querySelector(".hero-pagination").addEventListener("click", (event) => {
  const dot = event.target.closest("[data-slide]");
  if (dot) selectSlide(Number(dot.dataset.slide));
});

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.setInterval(() => {
    if (activeView !== "catalog" || document.hidden || hero.matches(":hover") || hero.contains(document.activeElement)) return;
    selectSlide((activeSlide + 1) % slides.length);
  }, 5000);
}

const faqSearch = document.querySelector("#faq-search");
const faqItems = [...document.querySelectorAll("[data-faq-item]")];
const faqEmpty = document.querySelector("#faq-empty");
faqSearch.addEventListener("input", () => {
  const query = normalizeText(faqSearch.value);
  let visibleCount = 0;
  faqItems.forEach((item) => {
    const matches = normalizeText(item.textContent).includes(query);
    item.hidden = !matches;
    if (matches) visibleCount += 1;
  });
  faqEmpty.hidden = visibleCount > 0;
});

const reviewForm = document.querySelector("#review-form");
const reviewKind = document.querySelector("#review-kind");
const reviewRatingField = document.querySelector("#review-rating-field");
const reviewStatus = document.querySelector("#review-form-status");
const reviewWhatsappFallback = document.querySelector("#review-whatsapp-fallback");

reviewKind.addEventListener("change", () => {
  const needsRating = reviewKind.value === "opinion";
  reviewRatingField.hidden = !needsRating;
  reviewRatingField.querySelectorAll('input[name="rating"]').forEach((radio) => {
    radio.required = needsRating && radio.value === "5";
    if (!needsRating) radio.checked = false;
  });
});

reviewForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!reviewForm.reportValidity()) return;

  const formData = new FormData(reviewForm);
  const kind = formData.get("kind");
  const rating = kind === "opinion" ? formData.get("rating") : null;
  const message = [
    `Hola, soy ${formData.get("name")}.`,
    `Quiero enviar una ${kind === "opinion" ? "opinión" : "pregunta"} sobre Hipermercado Kristal.`,
    ...(rating ? [`Calificación: ${rating}/5 estrellas.`] : []),
    "",
    String(formData.get("message")).trim(),
  ].join("\n");
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  const whatsappWindow = window.open(whatsappUrl, "_blank");
  if (whatsappWindow) whatsappWindow.opener = null;

  reviewWhatsappFallback.href = whatsappUrl;
  reviewWhatsappFallback.hidden = Boolean(whatsappWindow);
  reviewStatus.textContent = whatsappWindow
    ? "WhatsApp se abrió con tu mensaje. El equipo revisará el contenido antes de considerar su publicación."
    : "El navegador bloqueó la ventana de WhatsApp. Usa el enlace de continuación para enviar tu mensaje.";
});

const infoMessages = {
  redes: ["Redes sociales", "Los enlaces oficiales de Instagram, Facebook y TikTok aún no están configurados. Contáctanos por WhatsApp para confirmar nuestros perfiles oficiales."],
};

document.querySelectorAll("[data-info]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const info = infoMessages[link.dataset.info];
    if (info) showInfoDialog(info[0], info[1]);
  });
});

document.querySelector("#info-dialog-close").addEventListener("click", () => infoDialog.close());
infoDialog.addEventListener("click", (event) => {
  if (event.target === infoDialog) infoDialog.close();
});

if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("revealed");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -35px 0px" });
  document.body.classList.add("reveal-ready");
  observeRevealElements();
}

window.addEventListener("resize", updateCarouselControls, { passive: true });
renderFeaturedProducts();
restoreRoute();
renderCart();
initializeCatalog();
