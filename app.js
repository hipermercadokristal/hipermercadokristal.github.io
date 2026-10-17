let products = [];

const WHATSAPP_NUMBER = "584128867088";
const FREE_SHIPPING_THRESHOLD = 50;
const PRODUCTS_PER_PAGE = 15;
const currency = new Intl.NumberFormat("es-VE", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
const bolivares = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let bcvRate = null;
let bcvRateDate = "";
let bcvRateIsStale = true;
try {
  const savedRate = JSON.parse(localStorage.getItem("restaurant-kristal-bcv-rate") || "null");
  if (savedRate && Number.isFinite(savedRate.value) && savedRate.value > 0) {
    bcvRate = savedRate.value;
    bcvRateDate = savedRate.date || "";
  }
} catch (error) {
  console.error("No se pudo recuperar la tasa BCV para mostrar los precios.", error);
}
const productGrid = document.querySelector("#product-grid");
const categoryProductGrid = document.querySelector("#category-product-grid");
const featuredProductGrid = document.querySelector("#featured-products");
const featuredPreviousButton = document.querySelector("#featured-previous");
const featuredNextButton = document.querySelector("#featured-next");
const departmentFilter = document.querySelector("#product-department-filter");
const homeView = document.querySelector("#home-view");
const catalogView = document.querySelector("#catalog-view");
const storeView = document.querySelector("#store-view");
const categoryView = document.querySelector("#category-view");
const aboutView = document.querySelector("#about-view");
const returnsView = document.querySelector("#returns-view");
const reviewsView = document.querySelector("#reviews-view");
const policiesView = document.querySelector("#policies-view");
const profileView = document.querySelector("#profile-view");
const ordersView = document.querySelector("#orders-view");
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
let featuredAutoplayTimer = 0;
let featuredTouchResumeTimer = 0;
let toastTimeout;
let lastFocusedElement = null;
let catalogLoadError = "";

window.addEventListener("kristal:bcv-rate", (event) => {
  const { rate, date, stale } = event.detail || {};
  if (!Number.isFinite(rate) || rate <= 0) return;
  bcvRate = rate;
  bcvRateDate = date || "";
  bcvRateIsStale = Boolean(stale);
  if (products.length) renderActiveProducts();
});

function displayPriceInVES(price) {
  if (!Number.isFinite(bcvRate)) return '<small class="product-ves-price">Equivalente BCV no disponible</small>';
  const date = bcvRateDate
    ? new Intl.DateTimeFormat("es-VE", { dateStyle: "medium" }).format(new Date(bcvRateDate))
    : "";
  const rateLabel = bcvRateIsStale ? "Tasa BCV anterior" : "Tasa BCV";
  return `<small class="product-ves-price">${escapeHtml(`Bs. ${bolivares.format(price * bcvRate)}`)} · ${rateLabel}${date ? ` · ${escapeHtml(date)}` : ""}</small>`;
}

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
      ((view === "about" || view === "store") && link.hasAttribute("data-page-store")) ||
      (view === "about" && link.hasAttribute("data-page-about")) ||
      (view === "returns" && link.hasAttribute("data-page-returns")) ||
      (view === "reviews" && link.hasAttribute("data-page-reviews")) ||
      (view === "category" && link.dataset.category === category);
    if (current) link.setAttribute("aria-current", "page");
    else if (link.getAttribute("aria-current") === "page") link.removeAttribute("aria-current");
  });
  document.querySelectorAll("a[data-app-route]").forEach((link) => {
    const currentRoute = view === "category" ? "catalog" : view;
    if (link.dataset.appRoute === currentRoute) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function productCartControl(product, { featured = false } = {}) {
  const quantity = cartItems.get(product.id) || 0;
  const canPurchase = Number.isFinite(product.price) && !product.consultarWhatsApp;
  if (!canPurchase) {
    return `<a class="add-button" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hola, quisiera consultar el precio vigente y la disponibilidad de ${product.name}.`)}" target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a>`;
  }
  if (quantity) {
    return `<span class="quantity-control" aria-label="Cantidad en carrito: ${quantity}"><button class="quantity-button" type="button" data-action="decrease" data-product="${escapeHtml(product.id)}" aria-label="Quitar uno de ${escapeHtml(product.name)}">−</button><span>${quantity}</span><button class="quantity-button" type="button" data-action="increase" data-product="${escapeHtml(product.id)}" aria-label="Agregar uno de ${escapeHtml(product.name)}">+</button></span>`;
  }
  return `<button class="add-button" type="button" data-action="increase" data-product="${escapeHtml(product.id)}"><span aria-hidden="true">+</span> ${featured ? "Compra rápida" : "Agregar al carrito"}</button>`;
}

function visibleProductsFor(filter) {
  const query = normalizeText(searchInput.value);
  const normalizedFilter = normalizeText(filter);
  const isDepartmentFilter = Object.keys(categoryDescriptions).some((category) =>
    normalizeText(category) === normalizedFilter,
  );
  return products.filter((product) => {
    const matchesFilter =
      normalizedFilter === "todos" ||
      (normalizedFilter === "favoritos"
        ? favoriteItems.has(product.id)
        : normalizedFilter === "ofertas"
          ? Number.isFinite(product.oldPrice) && Number.isFinite(product.price) && product.oldPrice > product.price
          : isDepartmentFilter
            ? normalizeText(product.group) === normalizedFilter
            : normalizeText(product.group) === normalizedFilter || normalizeText(product.category) === normalizedFilter);
    const searchableText = normalizeText(
      `${product.name} ${product.category} ${product.group} ${product.detail}`,
    );
    return matchesFilter && searchableText.includes(query);
  });
}

function renderProductPagination(targetGrid, totalPages, currentPage) {
  const pagination = document.querySelector(`[data-pagination-grid="${targetGrid.id}"]`);
  if (!pagination) return;
  pagination.hidden = totalPages <= 1;
  if (totalPages <= 1) {
    pagination.replaceChildren();
    return;
  }
  const buttons = [
    `<button class="pagination-button" type="button" data-page-grid="${targetGrid.id}" data-page="${currentPage - 1}" aria-label="Página anterior"${currentPage === 1 ? " disabled" : ""}>Anterior</button>`,
  ];
  const pageNumbers = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  let previousPage = 0;
  for (const page of [...pageNumbers].filter((number) => number >= 1 && number <= totalPages).sort((a, b) => a - b)) {
    if (previousPage && page - previousPage > 1) buttons.push('<span class="pagination-ellipsis" aria-hidden="true">…</span>');
    buttons.push(`<button class="pagination-button${page === currentPage ? " active" : ""}" type="button" data-page-grid="${targetGrid.id}" data-page="${page}" aria-label="Página ${page}"${page === currentPage ? ' aria-current="page"' : ""}>${page}</button>`);
    previousPage = page;
  }
  buttons.push(
    `<button class="pagination-button" type="button" data-page-grid="${targetGrid.id}" data-page="${currentPage + 1}" aria-label="Página siguiente"${currentPage === totalPages ? " disabled" : ""}>Siguiente</button>`,
  );
  pagination.innerHTML = buttons.join("");
}

function renderProducts(targetGrid = productGrid, filter = activeFilter) {
  const normalizedFilter = normalizeText(filter);
  const isDepartmentFilter = Object.keys(categoryDescriptions).some((category) =>
    normalizeText(category) === normalizedFilter,
  );
  const visibleProducts = visibleProductsFor(filter);
  if (catalogLoadError) {
    targetGrid.innerHTML = `<p class="empty-state">${escapeHtml(catalogLoadError)}</p>`;
    renderProductPagination(targetGrid, 0, 1);
    return;
  }

  if (!visibleProducts.length) {
    const isDepartment = targetGrid === categoryProductGrid || isDepartmentFilter;
    targetGrid.innerHTML =
      normalizedFilter === "favoritos"
        ? '<p class="empty-state">Aún no tienes favoritos. Guarda productos con el icono de corazón.</p>'
        : normalizedFilter === "ofertas"
          ? `<p class="empty-state">No hay ofertas confirmadas publicadas. <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener noreferrer">Consulta promociones vigentes por WhatsApp.</a></p>`
        : !products.length || isDepartment
          ? `<p class="empty-state">Aún no hay productos publicados ${isDepartment ? "en este departamento" : "en el catálogo"}. <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener noreferrer">Consulta disponibilidad y precios por WhatsApp.</a></p>`
          : '<p class="empty-state">No encontramos productos. Prueba con otra búsqueda.</p>';
    renderProductPagination(targetGrid, 0, 1);
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
      const isFavorite = favoriteItems.has(product.id);
      return `
        <article class="product-card" data-product-card="${escapeHtml(product.id)}" data-reveal>
          ${badge ? `<span class="${badgeClass}">${badge}</span>` : ""}
          <button class="favorite-button${isFavorite ? " active" : ""}" type="button" aria-label="${isFavorite ? "Quitar" : "Añadir"} ${escapeHtml(product.name)} ${isFavorite ? "de" : "a"} favoritos" aria-pressed="${isFavorite}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.3-8.8 10-8.8 10s-8.8-4.7-8.8-10A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z" /></svg></button>
          <div class="product-image-wrap">
            <img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.alt)}" loading="lazy" />
          </div>
          <span class="product-category">${escapeHtml(product.category)}</span>
          <h3 class="product-name">${escapeHtml(product.name)}</h3>
          <span class="product-presentation">${escapeHtml(product.detail)}</span>
          <div class="product-prices">${regularPrice}${currentPrice}</div>
          ${displayPriceInVES(product.price)}
          <div class="product-cart-control">${productCartControl(product)}</div>
        </article>`;
    })
    .join("");
  renderProductPagination(targetGrid, totalPages, currentPage);
  observeRevealElements(targetGrid);
}

function renderFeaturedProducts() {
  const scrollLeft = featuredProductGrid.scrollLeft;
  const featuredProducts = products.filter((product) => product.esDestacado);
  if (catalogLoadError) {
    featuredProductGrid.innerHTML = `<p class="empty-state">${escapeHtml(catalogLoadError)}</p>`;
    updateFeaturedCarousel();
    return;
  }
  if (!featuredProducts.length) {
    featuredProductGrid.innerHTML = `<p class="empty-state">Estamos actualizando la selección de productos. <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener noreferrer">Consulta productos y ofertas vigentes por WhatsApp.</a></p>`;
    updateFeaturedCarousel();
    return;
  }
  featuredProductGrid.innerHTML = featuredProducts
    .map((product) => {
      const hasOffer = Number.isFinite(product.oldPrice) && product.oldPrice > product.price;
      const discount = hasOffer ? Math.round((1 - product.price / product.oldPrice) * 100) : 0;
      return `
        <article class="product-card featured-product-card" data-product-card="${escapeHtml(product.id)}" data-reveal>
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
          ${displayPriceInVES(product.price)}
          <div class="product-cart-control">${productCartControl(product, { featured: true })}</div>
        </article>`;
    })
    .join("");
  featuredProductGrid.scrollLeft = scrollLeft;
  observeRevealElements(featuredProductGrid);
  updateFeaturedCarousel();
}

function featuredCarouselStep() {
  const firstCard = featuredProductGrid.querySelector(".featured-product-card");
  if (!firstCard) return 0;
  const gap = Number.parseFloat(getComputedStyle(featuredProductGrid).columnGap) || 0;
  return firstCard.getBoundingClientRect().width + gap;
}

function updateFeaturedCarousel() {
  const controls = featuredPreviousButton.parentElement;
  const canScroll = featuredProductGrid.scrollWidth > featuredProductGrid.clientWidth + 1;
  controls.hidden = !canScroll;
  window.clearInterval(featuredAutoplayTimer);
  featuredAutoplayTimer = 0;
  if (!canScroll || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  featuredAutoplayTimer = window.setInterval(() => {
    const hovering = window.matchMedia("(hover: hover)").matches && featuredProductGrid.matches(":hover");
    if (document.hidden || hovering || featuredProductGrid.contains(document.activeElement) || controls.contains(document.activeElement)) return;
    const atEnd = featuredProductGrid.scrollLeft + featuredProductGrid.clientWidth >= featuredProductGrid.scrollWidth - 2;
    featuredProductGrid.scrollTo({ left: atEnd ? 0 : featuredProductGrid.scrollLeft + featuredCarouselStep(), behavior: "smooth" });
  }, 4500);
}

function moveFeaturedCarousel(direction) {
  const step = featuredCarouselStep();
  if (!step) return;
  const atStart = featuredProductGrid.scrollLeft <= 1;
  const atEnd = featuredProductGrid.scrollLeft + featuredProductGrid.clientWidth >= featuredProductGrid.scrollWidth - 2;
  const left = direction > 0
    ? (atEnd ? 0 : featuredProductGrid.scrollLeft + step)
    : (atStart ? featuredProductGrid.scrollWidth : featuredProductGrid.scrollLeft - step);
  featuredProductGrid.scrollTo({ left, behavior: "smooth" });
}

featuredPreviousButton.addEventListener("click", () => moveFeaturedCarousel(-1));
featuredNextButton.addEventListener("click", () => moveFeaturedCarousel(1));
featuredProductGrid.addEventListener("pointerenter", () => window.clearInterval(featuredAutoplayTimer));
featuredProductGrid.addEventListener("pointerleave", updateFeaturedCarousel);
featuredProductGrid.addEventListener("focusin", () => window.clearInterval(featuredAutoplayTimer));
featuredPreviousButton.parentElement.addEventListener("focusin", () => window.clearInterval(featuredAutoplayTimer));
featuredProductGrid.addEventListener("focusout", (event) => {
  if (!featuredProductGrid.contains(event.relatedTarget)) updateFeaturedCarousel();
});
featuredPreviousButton.parentElement.addEventListener("focusout", (event) => {
  if (!featuredPreviousButton.parentElement.contains(event.relatedTarget)) updateFeaturedCarousel();
});
featuredProductGrid.addEventListener("touchstart", () => {
  window.clearInterval(featuredAutoplayTimer);
  window.clearTimeout(featuredTouchResumeTimer);
}, { passive: true });
featuredProductGrid.addEventListener("touchend", () => {
  featuredTouchResumeTimer = window.setTimeout(updateFeaturedCarousel, 5000);
}, { passive: true });
document.addEventListener("visibilitychange", updateFeaturedCarousel);
window.addEventListener("resize", updateFeaturedCarousel);

function changeProductPage(grid, requestedPage, { scroll = false } = {}) {
  const filter = grid === categoryProductGrid ? activeCategory : activeFilter;
  const totalPages = Math.ceil(visibleProductsFor(filter).length / PRODUCTS_PER_PAGE);
  if (totalPages < 1) return;
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  if (page === (productPages.get(grid.id) || 1)) return;
  productPages.set(grid.id, page);
  renderProducts(grid, filter);
  if (scroll) grid.scrollIntoView({ behavior: "smooth", block: "start" });
}

function installCatalogSwipe(grid) {
  let startX = 0;
  let startY = 0;
  grid.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });
  grid.addEventListener("touchend", (event) => {
    if (!startX || event.changedTouches.length !== 1 || window.innerWidth > 767) return;
    const deltaX = event.changedTouches[0].clientX - startX;
    const deltaY = event.changedTouches[0].clientY - startY;
    startX = 0;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return;
    changeProductPage(grid, (productPages.get(grid.id) || 1) + (deltaX < 0 ? 1 : -1), { scroll: true });
  }, { passive: true });
}

installCatalogSwipe(productGrid);
installCatalogSwipe(categoryProductGrid);
document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page-grid][data-page]");
  if (!pageButton || pageButton.disabled) return;
  const grid = document.getElementById(pageButton.dataset.pageGrid);
  if (grid) changeProductPage(grid, Number(pageButton.dataset.page), { scroll: true });
});

const categoryDescriptions = {
  "Víveres y Alacena": "Granos, aceites, harinas, pastas, enlatados y condimentos.",
  "Frutas y Verduras": "Hortalizas, tubérculos y frutas frescas del campo.",
  "Carnes, Aves y Charcutería": "Cortes de carne, pollo, embutidos, quesos y lácteos.",
  "Bebidas, Licores y Tabaco": "Jugos, gaseosas, maltas, licores, vinos, cerveza, cigarrillos y encendedores.",
  "Snacks, Golosinas y Confitería": "Galletas, chocolates, papitas, frutos secos y golosinas.",
  "Cuidado Personal e Higiene": "Cuidado capilar, jabones, crema dental, desodorantes y cuidado femenino.",
  "Cuidado del Hogar y Limpieza": "Detergentes, desinfectantes, lavaplatos, tobos y colectores.",
  "Hogar, Bazar y Utensilios": "Platos, cubiertos, ollas, plásticos, envases, organización, sillas, mesas y accesorios del hogar.",
  "Electrodomésticos y Ferretería": "Licuadoras, ventiladores, herramientas manuales, bombillos, extensiones y artículos eléctricos básicos.",
  Mascotas: "Alimentos balanceados y artículos de cuidado para mascotas.",
  Congelados: "Alimentos congelados listos para cocinar.",
};
const legacyCategoryAliases = {
  "Bebidas y Licores": "Bebidas, Licores y Tabaco",
};

function categorySlug(category) {
  return normalizeText(category).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function categoryPath(category) {
  return `/departamento/${categorySlug(category)}`;
}

function closeMobileCategoryMenu() {
  document.querySelector("#category-links").classList.remove("open");
  document.querySelectorAll(".mobile-menu-button").forEach((button) => button.setAttribute("aria-expanded", "false"));
  document.body.classList.remove("mobile-menu-open");
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
  policiesView.hidden = true;
  profileView.hidden = true;
  ordersView.hidden = true;
  categoryView.hidden = false;
  setActiveFilter(category, { clearSearch: true });
  setCurrentNavigation("category", category);
  categoryViewTitle.textContent = category;
  categoryViewDescription.textContent = categoryDescriptions[category] || "Explora los productos de esta categoría.";
  productPages.set(categoryProductGrid.id, 1);
  renderProducts(categoryProductGrid, category);
  closeMobileCategoryMenu();
  document.title = `${categoryViewTitle.textContent} | Hipermercado Kristal`;
  if (pushHistory) history.pushState({ view: "category", category }, "", categoryPath(category));
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
  policiesView.hidden = true;
  profileView.hidden = true;
  ordersView.hidden = true;
  homeView.hidden = false;
  setActiveFilter("Todos", { clearSearch: true });
  setCurrentNavigation("home");
  closeMobileCategoryMenu();
  document.title = "Inicio | Hipermercado Kristal";
  if (pushHistory) history.pushState({ view: "home" }, "", "/");
  window.scrollTo(0, 0);
}

function showCatalogView({ filter = "Todos", pushHistory = true, clearSearch = false } = {}) {
  activeView = "catalog";
  activeCategory = "";
  homeView.hidden = true;
  categoryView.hidden = true;
  storeView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  policiesView.hidden = true;
  profileView.hidden = true;
  ordersView.hidden = true;
  catalogView.hidden = false;
  productPages.set(productGrid.id, 1);
  setActiveFilter(filter, { clearSearch });
  setCurrentNavigation("catalog");
  renderProducts(productGrid, filter);
  closeMobileCategoryMenu();
  document.title = filter === "Ofertas" ? "Ofertas | Hipermercado Kristal" : "Catálogo | Hipermercado Kristal";
  if (pushHistory) history.pushState({ view: "catalog", filter }, "", filter === "Ofertas" ? "/catalogo?filtro=ofertas" : "/catalogo");
  window.scrollTo(0, 0);
}

function showInstitutionalView(viewName, viewElement, title, route, { pushHistory = true } = {}) {
  activeView = viewName;
  activeCategory = "";
  homeView.hidden = true;
  catalogView.hidden = true;
  storeView.hidden = true;
  categoryView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  policiesView.hidden = viewElement !== policiesView;
  profileView.hidden = true;
  ordersView.hidden = true;
  viewElement.hidden = false;
  setActiveFilter("Todos", { clearSearch: true });
  setCurrentNavigation(viewName);
  closeMobileCategoryMenu();
  document.title = `${title} | Hipermercado Kristal`;
  if (pushHistory) history.pushState({ view: viewName }, "", route);
  window.scrollTo(0, 0);
}

function showAccountView(view, { pushHistory = true } = {}) {
  activeView = view;
  activeCategory = "";
  homeView.hidden = true;
  catalogView.hidden = true;
  storeView.hidden = true;
  categoryView.hidden = true;
  aboutView.hidden = true;
  returnsView.hidden = true;
  reviewsView.hidden = true;
  policiesView.hidden = true;
  profileView.hidden = view !== "profile";
  ordersView.hidden = view !== "orders";
  setActiveFilter("Todos", { clearSearch: true });
  setCurrentNavigation(view);
  closeMobileCategoryMenu();
  document.title = `${view === "profile" ? "Perfil" : "Mis pedidos"} | Hipermercado Kristal`;
  if (pushHistory) history.pushState({ view }, "", view === "profile" ? "/perfil" : "/pedidos");
  document.dispatchEvent(new CustomEvent("kristal:account-view", { detail: { view } }));
  window.scrollTo(0, 0);
}

function showAboutView(options) {
  showInstitutionalView("about", aboutView, "Sobre nosotros", "/nosotros", options);
  storeView.hidden = false;
}

let policiesLoaded = false;

async function loadPolicies() {
  if (policiesLoaded) return;
  const response = await fetch("/politicas.html");
  if (!response.ok) throw new Error(`No se pudo cargar politicas.html (${response.status}).`);
  const source = new DOMParser().parseFromString(await response.text(), "text/html");
  const policyMain = source.querySelector(".policy-main");
  if (!policyMain) throw new Error("politicas.html no contiene el contenido de políticas esperado.");
  policyMain.querySelector(".policy-nav")?.remove();
  policyMain.querySelector(".policy-back-top")?.remove();
  policiesView.innerHTML = policyMain.innerHTML;
  policiesLoaded = true;
}

function showPoliciesView({ pushHistory = true } = {}) {
  showInstitutionalView("returns", policiesView, "Políticas y condiciones", "/politicas", { pushHistory });
  returnsView.hidden = false;
  loadPolicies().catch((error) => {
    console.error("No se pudo cargar la vista de políticas.", error);
    policiesView.innerHTML = '<main class="policy-main page-container"><p role="alert">No se pudieron cargar las políticas. Recarga la página para intentarlo de nuevo.</p></main>';
  });
}

function showReviewsView(options) {
  showInstitutionalView("reviews", reviewsView, "Opiniones y preguntas frecuentes", "/preguntas-resenas", options);
}

function restoreRoute(state = history.state) {
  const forwardedPath = new URLSearchParams(location.search).get("route");
  if (forwardedPath?.startsWith("/")) {
    history.replaceState(null, "", forwardedPath);
  }
  const hash = location.hash;
  const legacyHashRoutes = {
    "#inicio": "/",
    "#catalogo": "/catalogo",
    "#productos": "/catalogo",
    "#ofertas": "/catalogo?filtro=ofertas",
    "#nosotros": "/nosotros",
    "#tienda": "/nosotros",
    "#instalaciones": "/nosotros",
    "#beneficios": "/nosotros",
    "#sucursales": "/nosotros",
    "#cambios": "/politicas",
    "#opiniones": "/preguntas-resenas",
  };
  const legacyCategoryHash = hash.match(/^#categoria\/([a-z0-9-]+)$/);
  const legacyCategory = legacyCategoryHash && (
    Object.keys(categoryDescriptions).find((item) => categorySlug(item) === legacyCategoryHash[1]) ||
    Object.entries(legacyCategoryAliases).find(([name]) => categorySlug(name) === legacyCategoryHash[1])?.[1]
  );
  const legacyPath = legacyHashRoutes[hash] || (legacyCategory && categoryPath(legacyCategory));
  if ((location.pathname === "/" || location.pathname === "/index.html") && legacyPath) {
    history.replaceState(null, "", legacyPath);
  }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/perfil" || state?.view === "profile") {
    showAccountView("profile", { pushHistory: false });
    return;
  }
  if (path === "/pedidos" || state?.view === "orders") {
    showAccountView("orders", { pushHistory: false });
    return;
  }
  if (
    path === "/nosotros" ||
    path === "/tienda" ||
    (path === "/" && ["#nosotros", "#tienda", "#instalaciones", "#beneficios", "#sucursales"].includes(hash)) ||
    state?.view === "about" ||
    state?.view === "store"
  ) {
    showAboutView({ pushHistory: false });
    return;
  }
  if (path === "/politicas" || (path === "/" && hash === "#cambios") || state?.view === "returns") {
    showPoliciesView({ pushHistory: false });
    return;
  }
  if (path === "/preguntas-resenas" || (path === "/" && hash === "#opiniones") || state?.view === "reviews") {
    showReviewsView({ pushHistory: false });
    return;
  }
  const departmentRoute = path.match(/^\/departamento\/([a-z0-9-]+)$/);
  const categoryPathMatch = departmentRoute || hash.match(/^#categoria\/([a-z0-9-]+)$/);
  const category = categoryPathMatch && Object.keys(categoryDescriptions).find((item) =>
    categorySlug(item) === categoryPathMatch[1],
  );
  const stateCategory = legacyCategoryAliases[state?.category] || state?.category;
  if (category || (state?.view === "category" && categoryDescriptions[stateCategory])) {
    showCategoryView(category || stateCategory, { pushHistory: false });
    return;
  }
  if (path === "/catalogo" || state?.view === "catalog" || hash === "#catalogo" || hash === "#productos" || hash === "#ofertas") {
    const filter = new URLSearchParams(location.search).get("filtro") === "ofertas" || hash === "#ofertas"
      ? "Ofertas"
      : state?.filter || "Todos";
    showCatalogView({ filter, pushHistory: false });
    return;
  }
  if (path === "/" || path === "/index.html" || state?.view === "home" || hash === "#inicio") {
    showHomeView({ pushHistory: path !== "/" && !state?.view });
    return;
  }
  showHomeView({ pushHistory: true });
}

function navigateToPath(path) {
  history.pushState(null, "", path);
  restoreRoute();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

document.addEventListener("kristal:toast", (event) => {
  if (event.detail?.message) showToast(event.detail.message);
});

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
  const appCartCount = document.querySelector("#mobile-nav-cart-count");
  if (appCartCount) appCartCount.textContent = String(cartTotal);
  mobileCartButton.setAttribute("aria-label", `Abrir carrito, ${cartTotal} ${cartTotal === 1 ? "artículo" : "artículos"}`);
  mobileCartButton.hidden = cartTotal === 0;
  document.body.classList.toggle("has-cart-items", cartTotal > 0);
  renderCart();
}

function updateProductCardControls(productId) {
  document.querySelectorAll(".product-card[data-product-card]").forEach((card) => {
    if (card.dataset.productCard !== productId) return;
    const product = products.find((item) => item.id === productId);
    const control = card.querySelector(".product-cart-control");
    if (product && control) {
      control.innerHTML = productCartControl(product, { featured: card.classList.contains("featured-product-card") });
    }
  });
}

function renderActiveProducts() {
  if (activeView === "category") renderProducts(categoryProductGrid, activeCategory);
  else renderProducts(productGrid, activeFilter);
  renderFeaturedProducts();
}

document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (activeView !== "category") {
    showCatalogView({ filter: activeFilter });
    renderProducts(productGrid, activeFilter);
  } else {
    renderActiveProducts();
  }
});

searchInput.addEventListener("input", () => {
  if (activeView === "home" && searchInput.value.trim()) {
    showCatalogView();
  }
  if (activeView === "catalog" && searchInput.value.trim() && activeFilter !== "Todos") setActiveFilter("Todos");
  productPages.set(
    activeView === "category" ? categoryProductGrid.id : productGrid.id,
    1,
  );
  renderActiveProducts();
});

document.querySelector("#catalog-view").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  setActiveFilter(button.dataset.filter, { clearSearch: button.dataset.filter === "Todos" });
  productPages.set(productGrid.id, 1);
  renderProducts();
});

departmentFilter.addEventListener("change", () => {
  const selectedDepartment = departmentFilter.value;
  const department = Object.keys(categoryDescriptions).find((name) =>
    normalizeText(name) === normalizeText(selectedDepartment),
  );
  if (department) {
    navigateToPath(categoryPath(department));
    return;
  }
  setActiveFilter(selectedDepartment, { clearSearch: true });
  productPages.set(productGrid.id, 1);
  renderProducts(productGrid, activeFilter);
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-route]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.origin !== location.origin) return;
  if (link.target && link.target !== "_self") return;
  event.preventDefault();
  closeMobileCategoryMenu();
  const category = link.dataset.category;
  if (category && categoryDescriptions[category]) {
    navigateToPath(categoryPath(category));
    return;
  }
  navigateToPath(link.pathname + link.search);
});

document.addEventListener("click", (event) => {
  const routeLink = event.target.closest("[data-app-route]");
  if (!routeLink || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (routeLink.tagName === "BUTTON") {
    if (routeLink.dataset.appRoute === "cart") document.dispatchEvent(new CustomEvent("kristal:open-cart"));
    return;
  }
  if (routeLink.origin !== location.origin) return;
  event.preventDefault();
  closeMobileCategoryMenu();
  const routes = { home: "/", catalog: "/catalogo", orders: "/pedidos", profile: "/perfil" };
  const path = routes[routeLink.dataset.appRoute];
  if (path) navigateToPath(path);
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
  updateProductCardControls(product.id);
  showToast(direction > 0 ? `${product.name} agregado al carrito` : quantity ? `Cantidad actualizada: ${quantity}` : `${product.name} eliminado del carrito`);
}

productGrid.addEventListener("click", handleProductGridClick);
categoryProductGrid.addEventListener("click", handleProductGridClick);
featuredProductGrid.addEventListener("click", handleProductGridClick);

document.querySelector("#category-back-button").addEventListener("click", () => showCatalogView({ clearSearch: true }));
window.addEventListener("popstate", (event) => restoreRoute(event.state));

document.querySelector("#welcome-catalog-cta").addEventListener("click", (event) => {
  event.preventDefault();
  navigateToPath("/catalogo");
});

cartButton.addEventListener("click", () => setCartOpen(true));
mobileCartButton.addEventListener("click", () => setCartOpen(true));
document.addEventListener("kristal:open-cart", () => setCartOpen(true));
document.addEventListener("kristal:close-cart", () => setCartOpen(false));
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
  updateProductCardControls(product.id);
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
  document.dispatchEvent(new CustomEvent("kristal:checkout-request", {
    detail: {
      items: entries.map((product) => ({
        product_id: product.id,
        quantity: cartItems.get(product.id),
        name: product.name,
        price: product.price,
      })),
    },
  }));
});

document.addEventListener("kristal:order-completed", (event) => {
  const completedProducts = event.detail?.productIds || [];
  for (const productId of completedProducts) cartItems.delete(productId);
  updateCart();
  completedProducts.forEach(updateProductCardControls);
});

document.querySelectorAll(".mobile-menu-button").forEach((button) => button.addEventListener("click", (event) => {
  const menu = document.querySelector("#category-links");
  const isOpen = menu.classList.toggle("open");
  document.querySelectorAll(".mobile-menu-button").forEach((menuButton) => {
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
  });
  document.body.classList.toggle("mobile-menu-open", isOpen);
  if (!isOpen) document.querySelector(".departments-menu").open = false;
}));
document.addEventListener("click", (event) => {
  if (!document.body.classList.contains("mobile-menu-open")) return;
  if (event.target.closest(".category-nav, .app-menu-toggle")) return;
  closeMobileCategoryMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !document.body.classList.contains("mobile-menu-open")) return;
  closeMobileCategoryMenu();
  [...document.querySelectorAll(".mobile-menu-button")]
    .find((button) => button.getClientRects().length > 0)
    ?.focus();
});

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

renderFeaturedProducts();
restoreRoute();
renderCart();
initializeCatalog();
