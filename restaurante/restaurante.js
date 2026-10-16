const supabaseClient = window.kristalSupabase;
const dishGrid = document.querySelector("#dish-grid");
const categoryFilter = document.querySelector("#category-filter");
const catalogStatus = document.querySelector("#catalog-status");
const dishSearch = document.querySelector("#dish-search");
const orderButton = document.querySelector("#order-button");
const orderCount = document.querySelector("#order-count");
const toast = document.querySelector("#restaurant-toast");
const buffetForm = document.querySelector("#buffet-form");
const buffetPrice = document.querySelector("#buffet-price");
const buffetPriceVES = document.querySelector("#buffet-price-ves");
const buffetError = document.querySelector("#buffet-error");
const proteinHint = document.querySelector("#protein-hint");
const exchangeRateLabel = document.querySelector("#exchange-rate");
const cartBar = document.querySelector("#cart-bar");
const orderDialog = document.querySelector("#order-dialog");
const paymentDialog = document.querySelector("#payment-dialog");
const paymentBankList = document.querySelector("#payment-bank-list");
const paymentBankDetail = document.querySelector("#payment-bank-detail");
const paymentDetailBank = document.querySelector("#payment-detail-bank");
const paymentDetailLogo = document.querySelector("#payment-detail-logo");
const paymentCopyStatus = document.querySelector("#payment-copy-status");
const paymentContinueButton = document.querySelector("#payment-continue-whatsapp");
const orderLines = document.querySelector("#order-lines");
const customerForm = document.querySelector("#customer-form");
const fulfillmentMethod = document.querySelector("#fulfillment-method");
const deliveryAddressRow = document.querySelector("#delivery-address-row");
const deliveryAddress = document.querySelector("#delivery-address");
const whatsappSubmit = document.querySelector("#whatsapp-submit");
const WHATSAPP_NUMBER = "584128867088";
const EXCHANGE_RATE_URL = "https://ve.dolarapi.com/v1/dolares/oficial";
const CART_STORAGE_KEY = "restaurant-kristal-cart-v2";
const RATE_STORAGE_KEY = "restaurant-kristal-bcv-rate";
let paymentCopyTimeout;
let pendingWhatsappUrl = "";
const usdNumber = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vesNumber = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const menuCategories = [
  "Combos especiales",
  "Arroz y fideos",
  "Entradas y acompañantes",
  "Proteínas y especialidades",
  "Bebidas y extras",
];
const menuItems = [
  {
    name: "Combo Individual",
    category: "Combos especiales",
    price: 11,
    image: "assets/menu/combo-individual.jpg",
    badge: "Más vendido",
    description: "Arroz frito, chop suey, una lumpia crujiente y pollo agridulce.",
  },
  {
    name: "Combo Duo",
    category: "Combos especiales",
    price: 22,
    image: "assets/menu/combo-compartir.png",
    badge: "Para compartir",
    description: "Dos arroces, chop suey, dos lumpias y costillas agridulces.",
  },
  {
    name: "Combo Familiar",
    category: "Combos especiales",
    price: 36,
    image: "assets/menu/carne-brocoli.jpg",
    badge: "Combo estrella",
    description: "Para 4–5 personas: arroz especial, chop suey, cuatro lumpias, pollo agridulce y costillas.",
  },
  {
    name: "Arroz Frito Especial",
    category: "Arroz y fideos",
    price: 10,
    image: "assets/menu/arroz-especial.jpg",
    portionLabel: "Ración",
    variants: [
      { name: "1/2 ración", price: 5 },
      { name: "Ración completa", price: 10, default: true },
    ],
    badge: "Favorito",
    description: "Arroz al wok con jamón, camarones, cerdo y pollo.",
  },
  {
    name: "Arroz Frito Chino Tradicional",
    category: "Arroz y fideos",
    price: 7,
    image: "assets/menu/arroz-pollo.jpg",
    portionLabel: "Ración",
    variants: [
      { name: "1/2 ración", price: 3.5 },
      { name: "Ración completa", price: 7, default: true },
    ],
    description: "Arroz salteado al wok con huevo, vegetales y el toque de la casa.",
  },
  {
    name: "Chow Mein",
    category: "Arroz y fideos",
    price: 8.5,
    image: "assets/menu/noodles-v3.jpg",
    portionLabel: "Ración",
    variants: [
      { name: "1/2 ración", price: 4.25 },
      { name: "Ración completa", price: 8.5, default: true },
    ],
    description: "Fideos salteados con vegetales frescos al estilo chino venezolano.",
  },
  {
    name: "Lo Mein",
    category: "Arroz y fideos",
    price: 9,
    image: "assets/menu/tallarines-mixtos.jpg",
    portionLabel: "Ración",
    variants: [
      { name: "1/2 ración", price: 4.5 },
      { name: "Ración completa", price: 9, default: true },
    ],
    description: "Fideos suaves al wok con vegetales y salsa de la casa.",
  },
  {
    name: "Lumpias Crujientes",
    category: "Entradas y acompañantes",
    price: 3.5,
    image: "assets/menu/lumpias.jpg",
    portionLabel: "Presentación",
    variants: [
      { name: "Por unidad", price: 2 },
      { name: "Ración de 2", price: 3.5, default: true },
    ],
    description: "Rellenas de vegetales, doradas y servidas con salsa agridulce.",
  },
  {
    name: "Pan Chino",
    category: "Entradas y acompañantes",
    price: 2.5,
    image: "assets/menu/dim-sum-v3.jpg",
    portionLabel: "Preparación",
    variants: [
      { name: "Tostado con mantequilla", price: 2.5 },
      { name: "Al vapor", price: 2.5, default: true },
    ],
    description: "Suave y calientito, el acompañante clásico de la casa.",
  },
  {
    name: "Sopa Wonton",
    category: "Entradas y acompañantes",
    price: 6,
    image: "assets/menu/sopa-wanton.jpg",
    description: "Caldo reconfortante con wontones y cebollín.",
  },
  {
    name: "Sopa Agripicante",
    category: "Entradas y acompañantes",
    price: 5.5,
    image: "assets/menu/sopa-maiz.jpg",
    description: "Sopa de la casa con un balance sabroso entre ácido y picante.",
  },
  {
    name: "Pollo Agridulce",
    category: "Proteínas y especialidades",
    price: 9,
    image: "assets/menu/chicken-v3.jpg",
    badge: "Favorito",
    description: "Pollo crujiente cubierto con salsa agridulce y pimentón.",
  },
  {
    name: "Chicken Balls",
    category: "Proteínas y especialidades",
    price: 9,
    image: "assets/menu/pollo-ajonjoli.jpg",
    description: "Bocados de pollo dorados, para acompañar con salsa agridulce.",
  },
  {
    name: "Costillitas de Cerdo Sal y Pimienta",
    category: "Proteínas y especialidades",
    price: 11,
    image: "assets/menu/costillitas.jpg",
    description: "Costillitas crujientes al wok con sal, pimienta y especias.",
  },
  {
    name: "Costillitas de Cerdo Agridulces",
    category: "Proteínas y especialidades",
    price: 11,
    image: "assets/menu/cerdo-agridulce.jpg",
    description: "Costillitas glaseadas con salsa agridulce.",
  },
  {
    name: "Chop Suey Especial",
    category: "Proteínas y especialidades",
    price: 10,
    image: "assets/menu/chopsuey-mixto.png",
    description: "Vegetales salteados al wok con pollo, carne y camarones.",
  },
  {
    name: "Cerdo Asado Char Siu",
    category: "Proteínas y especialidades",
    price: 10,
    image: "assets/menu/carne-ostras.jpg",
    description: "Cerdo asado con glaseado dulce al estilo chino.",
  },
  {
    name: "Carne con Brócoli",
    category: "Proteínas y especialidades",
    price: 10,
    image: "assets/menu/arroz-mixto.jpg",
    description: "Carne salteada con brócoli y salsa de soya.",
  },
  {
    name: "Té Frío de la Casa",
    category: "Bebidas y extras",
    price: 2.5,
    image: "assets/menu/fruit-drinks.jpg",
    description: "Bebida fría de la casa, perfecta para acompañar.",
  },
  {
    name: "Bebida Gaseosa 1.5 L",
    category: "Bebidas y extras",
    price: 3.5,
    image: "assets/menu/orange-juice.jpg",
    description: "Bebida familiar de 1.5 litros. Consulta las opciones disponibles.",
  },
  {
    name: "Salsa Agridulce Extra",
    category: "Bebidas y extras",
    price: 0.75,
    image: "assets/menu/shrimp-rice-v3.jpg",
    description: "Porción adicional de salsa agridulce.",
  },
  {
    name: "Salsa de Soya Extra",
    category: "Bebidas y extras",
    price: 0.5,
    image: "assets/menu/camarones-ajo.jpg",
    description: "Porción adicional de salsa de soya.",
  },
  {
    name: "Picante Chino",
    category: "Bebidas y extras",
    price: 0.75,
    image: "assets/menu/pato.jpg",
    description: "Un toque picante para darle más carácter a tu plato.",
  },
];
const uniquePhotoPool = [
  "assets/menu/arroz-especial.jpg",
  "assets/menu/arroz-mixto.jpg",
  "assets/menu/arroz-pollo.jpg",
  "assets/menu/camarones-ajo.jpg",
  "assets/menu/camarones-salteados.jpg",
  "assets/menu/carne-brocoli.jpg",
  "assets/menu/carne-ostras.jpg",
  "assets/menu/cerdo-agridulce.jpg",
  "assets/menu/chicken-v3.jpg",
  "assets/menu/chopsuey-mixto.png",
  "assets/menu/combo-compartir.png",
  "assets/menu/combo-individual.jpg",
  "assets/menu/costillitas.jpg",
  "assets/menu/dim-sum-v3.jpg",
  "assets/menu/fruit-drinks.jpg",
  "assets/menu/lumpias.jpg",
  "assets/menu/noodles-v3.jpg",
  "assets/menu/orange-juice.jpg",
  "assets/menu/pato.jpg",
  "assets/menu/pollo-ajonjoli.jpg",
  "assets/menu/pollo-almendras.jpg",
  "assets/menu/pollo-vegetales.jpg",
  "assets/menu/shrimp-rice-v3.jpg",
  "assets/menu/sopa-maiz.jpg",
  "assets/menu/sopa-wanton.jpg",
  "assets/menu/tallarines-camarones.jpg",
  "assets/menu/tallarines-mixtos.jpg",
  "assets/menu/vegetable-bowl-v3.jpg",
  "assets/menu/wantones.jpg",
];
let dishes = [];
let categories = [];
let activeCategory = "Todos";
let searchQuery = "";
let selectedVariants = new Map();
let toastTimeout;
let exchangeRate = null;
let exchangeRateDate = "";
let exchangeRateStale = false;
let buffetSequence = 0;
let cart = readCart();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatUSD(amount) {
  return `$${usdNumber.format(amount)}`;
}

function formatVES(amount) {
  return `Bs. ${vesNumber.format(amount)}`;
}

function formatRateDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "fecha no disponible";
  return parsed.toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric" });
}

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) throw new TypeError("El formato guardado del carrito no es válido.");
    const entries = saved.filter((item) =>
      item && typeof item.key === "string" && typeof item.name === "string"
      && Number.isFinite(Number(item.unitPrice)) && Number(item.unitPrice) >= 0
      && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0,
    );
    return new Map(entries.map((item) => [item.key, {
      ...item,
      unitPrice: Number(item.unitPrice),
      quantity: Number(item.quantity),
    }]));
  } catch (error) {
    console.error("No se pudo recuperar el carrito guardado.", error);
    return new Map();
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([...cart.values()]));
  } catch (error) {
    console.error("No se pudo guardar el carrito en este dispositivo.", error);
    setToast("No se pudo guardar el carrito en este dispositivo.");
  }
}

function setToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2500);
}

function readCachedRate() {
  try {
    const saved = JSON.parse(localStorage.getItem(RATE_STORAGE_KEY) || "null");
    if (saved && Number.isFinite(saved.value) && saved.value > 0 && saved.date) {
      exchangeRate = saved.value;
      exchangeRateDate = saved.date;
      exchangeRateStale = true;
      renderPrices();
    }
  } catch (error) {
    console.error("No se pudo recuperar la última tasa BCV guardada.", error);
  }
}

function renderExchangeRate() {
  if (exchangeRate === null) {
    exchangeRateLabel.textContent = "Tasa BCV no disponible";
    exchangeRateLabel.closest(".rate-chip").classList.add("rate-unavailable");
    exchangeRateLabel.closest(".rate-chip").classList.remove("rate-stale");
    return;
  }
  exchangeRateLabel.textContent = `${exchangeRateStale ? "Última tasa" : "BCV"} · ${formatVES(exchangeRate)} / USD · ${formatRateDate(exchangeRateDate)}`;
  exchangeRateLabel.closest(".rate-chip").classList.remove("rate-unavailable");
  exchangeRateLabel.closest(".rate-chip").classList.toggle("rate-stale", exchangeRateStale);
}

function renderPrices() {
  renderExchangeRate();
  renderDishes();
  renderCartLines();
  renderTotals();
}

async function loadExchangeRate() {
  const refreshButton = document.querySelector("#rate-refresh");
  refreshButton.disabled = true;
  if (exchangeRate === null) exchangeRateLabel.textContent = "Consultando BCV…";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(EXCHANGE_RATE_URL, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`La consulta de la tasa BCV respondió ${response.status}.`);
    const data = await response.json();
    const rate = Number(data.promedio);
    if (!Number.isFinite(rate) || rate <= 0 || typeof data.fechaActualizacion !== "string") {
      throw new TypeError("La respuesta de la tasa BCV está incompleta.");
    }
    exchangeRate = rate;
    exchangeRateDate = data.fechaActualizacion;
    exchangeRateStale = false;
    try {
      localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify({ value: rate, date: exchangeRateDate }));
    } catch (error) {
      console.error("No se pudo guardar la tasa BCV en este dispositivo.", error);
    }
    renderPrices();
  } catch (error) {
    console.error("No se pudo actualizar la tasa BCV.", error);
    if (exchangeRate === null) {
      exchangeRateLabel.textContent = "Tasa BCV no disponible";
      exchangeRateLabel.closest(".rate-chip").classList.add("rate-unavailable");
    } else {
      exchangeRateStale = true;
      renderPrices();
    }
  } finally {
    clearTimeout(timeout);
    refreshButton.disabled = false;
  }
}

function renderCategories() {
  categoryFilter.innerHTML = ["Todos", ...categories]
    .map((name) => `<button type="button" class="${name === activeCategory ? "active" : ""}" data-category="${escapeHtml(name)}" aria-pressed="${name === activeCategory}">${escapeHtml(name)}</button>`)
    .join("");
}

function getVariants(dish) {
  return dish.variants?.length ? dish.variants : [{ name: "", price: dish.price }];
}

function getSelectedVariantIndex(dish) {
  const variants = getVariants(dish);
  const selectedIndex = selectedVariants.get(dish.id);
  if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < variants.length) return selectedIndex;
  let cartIndex = -1;
  for (const item of cart.values()) {
    if (item.dishId === dish.id) cartIndex = variants.findIndex((variant) => variant.name === item.portion);
  }
  return cartIndex >= 0 ? cartIndex : Math.max(0, variants.findIndex((variant) => variant.default));
}

function cartKeyForDish(dish, variant) {
  return `dish:${dish.id}:${encodeURIComponent(variant.name || "regular")}`;
}

function renderDishPrice(dish, variant) {
  return `<span class="dish-card-prices"><strong>${formatUSD(variant.price)}</strong><small>${exchangeRate === null ? "Consulta equivalente en Bs." : `${formatVES(variant.price * exchangeRate)}${exchangeRateStale ? " · tasa anterior" : ""}`}</small></span>`;
}

function renderDishControls(dish, variant) {
  const key = cartKeyForDish(dish, variant);
  const quantity = cart.get(key)?.quantity || 0;
  if (quantity === 0) {
    return `<button class="add-button" type="button" data-cart-add="${escapeHtml(dish.id)}" data-variant="${getSelectedVariantIndex(dish)}"><span aria-hidden="true">+</span> Agregar</button>`;
  }
  return `<div class="quantity-control" aria-label="Cantidad de ${escapeHtml(dish.name)}">
    <button type="button" data-cart-action="decrease" data-line-key="${escapeHtml(key)}" aria-label="Quitar una unidad">−</button>
    <strong>${quantity}</strong>
    <button type="button" data-cart-action="increase" data-line-key="${escapeHtml(key)}" aria-label="Agregar una unidad">+</button>
  </div>`;
}

function renderDishes() {
  const query = searchQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const filtered = dishes.filter((dish) => {
    const matchesCategory = activeCategory === "Todos" || dish.category === activeCategory;
    const searchText = `${dish.name} ${dish.description} ${dish.category}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
    return matchesCategory && searchText.includes(query);
  });
  dishGrid.innerHTML = filtered.length
    ? filtered.map((dish) => {
      const variants = getVariants(dish);
      const selectedIndex = getSelectedVariantIndex(dish);
      const variant = variants[selectedIndex];
      const hasOptions = variants.length > 1;
      const badge = dish.badge ? `<span class="dish-badge">${escapeHtml(dish.badge)}</span>` : "";
      const selector = hasOptions
        ? `<label class="portion-select"><span>${escapeHtml(dish.portionLabel || "Opción")}</span><select data-portion-for="${escapeHtml(dish.id)}" aria-label="${escapeHtml(dish.portionLabel || "Opción")} para ${escapeHtml(dish.name)}">${variants.map((option, index) => `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(option.name)} · ${formatUSD(option.price)}</option>`).join("")}</select></label>`
        : "";
      return `<article class="dish-card" data-dish-id="${escapeHtml(dish.id)}">
        <div class="dish-photo-wrap"><img src="${escapeHtml(dish.image)}" alt="Fotografía referencial de ${escapeHtml(dish.name)}" loading="lazy" />${badge}</div>
        <div class="dish-card-body">
          <span class="dish-category">${escapeHtml(dish.category)}</span>
          <h3>${escapeHtml(dish.name)}</h3>
          <p>${escapeHtml(dish.description || "Consulta los detalles de este plato al hacer tu pedido.")}</p>
          <div class="dish-card-order">${selector}<div class="dish-card-bottom">${renderDishPrice(dish, variant)}${renderDishControls(dish, variant)}</div></div>
        </div>
      </article>`;
    }).join("")
    : `<p class="empty-menu">${dishes.length ? "No encontramos platos con esos filtros." : "No hay productos disponibles en este momento."}</p>`;
  catalogStatus.textContent = `${filtered.length} ${filtered.length === 1 ? "opción" : "opciones"} para elegir`;
}

function getOrderTotals() {
  const totalItems = [...cart.values()].reduce((sum, item) => sum + item.quantity, 0);
  const totalUSD = [...cart.values()].reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return { totalItems, totalUSD, totalVES: exchangeRate === null ? null : totalUSD * exchangeRate };
}

function getPaymentAmountText(totalVES, totalItems) {
  if (totalItems === 0) return "Agrega productos al carrito para calcular el monto.";
  if (totalVES === null) return "Conversión no disponible: tasa BCV sin conexión.";
  const rateStatus = exchangeRateStale
    ? "última tasa guardada"
    : `BCV ${formatRateDate(exchangeRateDate)}`;
  return `${rateStatus}: ${formatVES(exchangeRate)} por USD.`;
}

function renderPaymentAmount() {
  const { totalItems, totalUSD, totalVES } = getOrderTotals();
  const paymentTotalUSD = document.querySelector("#payment-total-usd");
  const paymentTotalVES = document.querySelector("#payment-total-ves");
  paymentTotalUSD.textContent = totalItems ? `${formatUSD(totalUSD)} REF.` : "Sin pedido";
  paymentTotalVES.textContent = totalItems
    ? totalVES === null ? "No disponible" : formatVES(totalVES)
    : "Sin pedido";
  paymentTotalVES.disabled = totalItems === 0 || totalVES === null;
  if (!paymentTotalVES.disabled) {
    paymentTotalVES.dataset.copyValue = formatVES(totalVES);
  } else {
    delete paymentTotalVES.dataset.copyValue;
  }
  document.querySelector("#payment-rate-note").textContent = getPaymentAmountText(totalVES, totalItems);
}

function ensureUniqueDishPhotos(items) {
  const usedPhotos = new Set();
  for (const dish of items) {
    const image = typeof dish.image === "string" ? dish.image.trim() : "";
    const identity = image ? new URL(image, window.location.href).pathname.toLocaleLowerCase("es") : "";
    if (identity && !usedPhotos.has(identity)) {
      usedPhotos.add(identity);
      continue;
    }
    const replacement = uniquePhotoPool.find((photo) => !usedPhotos.has(new URL(photo, window.location.href).pathname.toLocaleLowerCase("es")));
    if (!replacement) {
      throw new Error("No hay suficientes fotografías distintas para todos los productos. Revisa las imágenes cargadas en el panel.");
    }
    dish.image = replacement;
    usedPhotos.add(new URL(replacement, window.location.href).pathname.toLocaleLowerCase("es"));
  }
}

function renderTotals() {
  const { totalItems, totalUSD, totalVES } = getOrderTotals();
  orderCount.textContent = String(totalItems);
  orderButton.disabled = totalItems === 0;
  document.querySelector("#cart-total-usd").textContent = formatUSD(totalUSD);
  document.querySelector("#dialog-total-usd").textContent = formatUSD(totalUSD);
  const vesText = totalVES === null
    ? "Equivalente en Bs. no disponible"
    : `${formatVES(totalVES)}${exchangeRateStale ? " · última tasa guardada" : ` · BCV ${formatRateDate(exchangeRateDate)}`}`;
  document.querySelector("#cart-total-ves").textContent = vesText;
  document.querySelector("#dialog-total-ves").textContent = vesText;
  document.querySelector("#buffet-price-ves").textContent = exchangeRate === null
    ? "Equivalente en Bs. pendiente de tasa BCV"
    : `${formatVES(getBuffetPrice() * exchangeRate)} · BCV`;
  whatsappSubmit.disabled = totalItems === 0;
  cartBar.classList.toggle("cart-bar-empty", totalItems === 0);
  if (!paymentBankDetail.hidden) renderPaymentAmount();
}

function renderCartLines() {
  if (cart.size === 0) {
    orderLines.innerHTML = `<div class="empty-cart"><span aria-hidden="true">＋</span><strong>Tu pedido está vacío</strong><p>Agrega algo rico de la carta para continuar.</p><button type="button" id="empty-cart-menu">Volver a la carta</button></div>`;
    return;
  }
  orderLines.innerHTML = [...cart.values()].map((item) => {
    const detail = item.detail ? `<small class="order-line-detail">${escapeHtml(item.detail)}</small>` : "";
    const portion = item.portion ? `<small class="order-line-portion">${escapeHtml(item.portion)}</small>` : "";
    return `<article class="order-line">
      <img src="${escapeHtml(item.image)}" alt="" />
      <div class="order-line-main"><strong>${escapeHtml(item.name)}</strong>${portion}${detail}<small class="order-line-price">${formatUSD(item.unitPrice)} c/u · ${formatUSD(item.unitPrice * item.quantity)}</small></div>
      <div class="order-line-actions">
        <div class="quantity-control compact">
          <button type="button" data-cart-action="decrease" data-line-key="${escapeHtml(item.key)}" aria-label="Quitar una unidad">−</button>
          <strong>${item.quantity}</strong>
          <button type="button" data-cart-action="increase" data-line-key="${escapeHtml(item.key)}" aria-label="Agregar una unidad">+</button>
        </div>
        <button class="remove-line" type="button" data-cart-action="remove" data-line-key="${escapeHtml(item.key)}" aria-label="Eliminar ${escapeHtml(item.name)} del pedido" title="Eliminar">⌫</button>
      </div>
    </article>`;
  }).join("");
}

function updateCart() {
  saveCart();
  renderDishes();
  renderCartLines();
  renderTotals();
}

function changeCartQuantity(key, change) {
  const item = cart.get(key);
  if (!item) return;
  const quantity = item.quantity + change;
  if (quantity <= 0) cart.delete(key);
  else cart.set(key, { ...item, quantity });
  updateCart();
}

function addDishToCart(dish, variant) {
  const key = cartKeyForDish(dish, variant);
  const current = cart.get(key);
  cart.set(key, {
    key,
    dishId: dish.id,
    name: dish.name,
    image: dish.image,
    portion: variant.name,
    unitPrice: Number(variant.price),
    quantity: (current?.quantity || 0) + 1,
    detail: "",
  });
  updateCart();
  const card = dishGrid.querySelector(`[data-dish-id="${CSS.escape(String(dish.id))}"]`);
  if (card) {
    card.classList.remove("dish-added");
    requestAnimationFrame(() => card.classList.add("dish-added"));
  }
  setToast(`${dish.name} agregado al pedido`);
}

async function loadMenu() {
  if (!supabaseClient) throw new Error("No se pudo conectar con el menú. Revisa la configuración de Supabase.");
  const [categoryResult, dishResult] = await Promise.all([
    supabaseClient.from("restaurant_categories").select("id,nombre").order("nombre"),
    supabaseClient.from("restaurant_products").select("id,nombre,descripcion,precio,imagen_url,disponible,categorias:restaurant_categories(nombre)").eq("disponible", true).order("nombre"),
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (dishResult.error) throw dishResult.error;
  const liveDishes = dishResult.data.map((row) => ({
    id: `live-${row.id}`,
    name: row.nombre,
    description: row.descripcion || "",
    price: Number(row.precio),
    image: row.imagen_url,
    category: row.categorias?.nombre || "Menú del día",
  }));
  if (liveDishes.some((dish) => !Number.isFinite(dish.price) || dish.price < 0)) {
    throw new TypeError("El menú contiene un producto con precio no válido.");
  }
  dishes = [
    ...menuItems.map((dish, index) => ({ ...dish, id: `menu-${index}` })),
    ...liveDishes,
  ];
  ensureUniqueDishPhotos(dishes);
  categories = [...new Set([
    ...menuCategories,
    ...categoryResult.data.map((category) => category.nombre),
    ...liveDishes.map((dish) => dish.category),
  ])];
  if (activeCategory !== "Todos" && !categories.includes(activeCategory)) activeCategory = "Todos";
  const available = new Set(dishes.map((dish) => dish.id));
  for (const [key, item] of cart) {
    if (item.dishId && !available.has(item.dishId)) cart.delete(key);
  }
  renderCategories();
  renderDishes();
  renderCartLines();
  renderTotals();
}

function getBuffetPrice() {
  const basePrice = Number(buffetForm.querySelector('input[name="buffet-size"]:checked').dataset.price);
  const extrasPrice = [...buffetForm.querySelectorAll('input[name="buffet-extra"]:checked')]
    .reduce((total, input) => total + Number(input.dataset.price), 0);
  return basePrice + extrasPrice;
}

function updateBuffetPrice() {
  const price = getBuffetPrice();
  buffetPrice.textContent = formatUSD(price);
  buffetPriceVES.textContent = exchangeRate === null
    ? "Equivalente en Bs. pendiente de tasa BCV"
    : `${formatVES(price * exchangeRate)} · BCV`;
  const size = buffetForm.querySelector('input[name="buffet-size"]:checked').value;
  const proteinLimit = size === "Pequeño" ? 1 : size === "Mediano" ? 2 : 3;
  proteinHint.textContent = `· hasta ${proteinLimit}`;
  buffetForm.querySelectorAll('input[name="buffet-protein"]').forEach((input) => {
    input.disabled = !input.checked && buffetForm.querySelectorAll('input[name="buffet-protein"]:checked').length >= proteinLimit;
  });
}

function updateDeliveryFields() {
  const needsDelivery = fulfillmentMethod.value === "Delivery";
  deliveryAddressRow.hidden = !needsDelivery;
  deliveryAddress.required = needsDelivery;
}

function openOrderDialog() {
  renderCartLines();
  renderTotals();
  orderDialog.showModal();
}

function setPaymentNotice(message, emphasis = "") {
  const notice = document.querySelector("#payment-success-message");
  notice.replaceChildren(document.createTextNode(message));
  if (emphasis) {
    notice.append(document.createElement("br"));
    const highlighted = document.createElement("strong");
    highlighted.textContent = emphasis;
    notice.append(highlighted);
  }
  notice.hidden = !message && !emphasis;
}

function openPaymentDialog(successMessage = "", paymentReminder = "") {
  paymentBankList.hidden = false;
  paymentBankDetail.hidden = true;
  paymentContinueButton.hidden = !pendingWhatsappUrl;
  setPaymentNotice(successMessage, paymentReminder);
  paymentDialog.showModal();
}

document.querySelector("#payment-open").addEventListener("click", () => openPaymentDialog());
document.querySelector("#footer-payment-open").addEventListener("click", () => openPaymentDialog());
document.querySelector("#payment-close").addEventListener("click", () => paymentDialog.close());
paymentDialog.addEventListener("close", () => {
  pendingWhatsappUrl = "";
  paymentContinueButton.hidden = true;
});
document.querySelector("#payment-back").addEventListener("click", () => {
  paymentBankDetail.hidden = true;
  paymentBankList.hidden = false;
});
paymentDialog.addEventListener("click", (event) => {
  if (event.target === paymentDialog) paymentDialog.close();
});
paymentBankList.addEventListener("click", (event) => {
  const bankButton = event.target.closest("[data-payment-bank]");
  if (!bankButton) return;
  paymentDetailLogo.src = bankButton.dataset.paymentLogo;
  paymentDetailLogo.alt = `Logo de ${bankButton.dataset.paymentBank}`;
  paymentDetailBank.textContent = bankButton.dataset.paymentBank;
  document.querySelector("#payment-code").textContent = bankButton.dataset.paymentCode;
  document.querySelector("#payment-code").dataset.copyValue = bankButton.dataset.paymentCode;
  document.querySelector("#payment-phone").dataset.copyValue = "04245104430";
  document.querySelector("#payment-id").dataset.copyValue = "V-26199919";
  renderPaymentAmount();
  paymentCopyStatus.hidden = true;
  paymentContinueButton.hidden = !pendingWhatsappUrl;
  paymentBankList.hidden = true;
  paymentBankDetail.hidden = false;
});

paymentContinueButton.addEventListener("click", () => {
  if (!pendingWhatsappUrl) return;
  const newWindow = window.open(pendingWhatsappUrl, "_blank");
  if (!newWindow) {
    setToast("Permite las ventanas emergentes para continuar a WhatsApp.");
    return;
  }
  newWindow.opener = null;
  pendingWhatsappUrl = "";
  paymentContinueButton.hidden = true;
  setPaymentNotice(
    "WhatsApp se abrió en otra pestaña. Cuando la tienda confirme tu pedido, vuelve aquí para completar el Pago Móvil.",
    "No realices el pago hasta recibir la confirmación de la tienda.",
  );
});

async function writePaymentClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Use the selection-based fallback when clipboard permissions are unavailable.
    }
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.focus();
  fallback.select();
  fallback.setSelectionRange(0, fallback.value.length);
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("No se pudo copiar al portapapeles.");
}

async function copyPaymentData(value, label) {
  try {
    await writePaymentClipboard(value);
    paymentCopyStatus.textContent = `¡Copiado! ${label}`;
    paymentCopyStatus.hidden = false;
    clearTimeout(paymentCopyTimeout);
    paymentCopyTimeout = setTimeout(() => {
      paymentCopyStatus.hidden = true;
    }, 1800);
  } catch {
    paymentCopyStatus.textContent = "No se pudo copiar. Mantén pulsado el dato para copiarlo.";
    paymentCopyStatus.hidden = false;
    clearTimeout(paymentCopyTimeout);
    paymentCopyTimeout = setTimeout(() => {
      paymentCopyStatus.hidden = true;
    }, 3000);
  }
}

paymentBankDetail.addEventListener("click", (event) => {
  const field = event.target.closest("[data-copy-value]");
  if (field) {
    copyPaymentData(field.dataset.copyValue, field.dataset.copyLabel);
    return;
  }
  if (event.target.closest("#payment-copy")) {
    const bank = paymentDetailBank.textContent;
    const code = document.querySelector("#payment-code").dataset.copyValue;
    const phone = document.querySelector("#payment-phone").dataset.copyValue;
    const id = document.querySelector("#payment-id").dataset.copyValue;
    const { totalItems, totalVES } = getOrderTotals();
    const amount = totalItems === 0
      ? "Monto del pedido: no hay productos en el carrito."
      : totalVES === null
        ? "Monto a transferir: no disponible (tasa BCV sin conexión)."
        : `Monto a transferir: ${formatVES(totalVES)}`;
    copyPaymentData(
      `Banco: ${bank}\nCódigo bancario: ${code}\nTeléfono: ${phone}\nCédula / RIF: ${id}\n${amount}`,
      "Todos los datos y el monto en bolívares",
    );
  }
});

function buildWhatsAppMessage(formData) {
  const lines = [...cart.values()].map((item, index) => {
    const option = item.portion ? ` (${item.portion})` : "";
    const detail = item.detail ? `\n   ${item.detail}` : "";
    return `${index + 1}. ${item.name}${option} × ${item.quantity} — ${formatUSD(item.unitPrice * item.quantity)}${detail}`;
  });
  const { totalUSD, totalVES } = getOrderTotals();
  const delivery = formData.get("fulfillment");
  const values = [
    "¡Hola, Restaurante Kristal! Quiero hacer este pedido:",
    "",
    ...lines,
    "",
    `Subtotal estimado: ${formatUSD(totalUSD)}`,
    totalVES === null
      ? "Equivalente en Bs.: no disponible (tasa BCV sin conexión)"
      : `Equivalente estimado: ${formatVES(totalVES)} (BCV ${formatRateDate(exchangeRateDate)}: ${formatVES(exchangeRate)} por USD)`,
    "",
    `Nombre: ${formData.get("customer-name")}`,
    `Teléfono: ${formData.get("customer-phone")}`,
    `Entrega: ${delivery}`,
  ];
  if (delivery === "Delivery") values.push(`Dirección: ${formData.get("address")}`);
  const notes = String(formData.get("notes") || "").trim();
  if (notes) values.push(`Notas especiales: ${notes}`);
  values.push("", "Por favor confirmen disponibilidad, precio final y tiempo de entrega. ¡Gracias!");
  return values.join("\n");
}

categoryFilter.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderCategories();
  renderDishes();
});

dishSearch.addEventListener("input", () => {
  searchQuery = dishSearch.value.trim();
  renderDishes();
});

dishGrid.addEventListener("change", (event) => {
  const select = event.target.closest("[data-portion-for]");
  if (!select) return;
  selectedVariants.set(select.dataset.portionFor, Number(select.value));
  renderDishes();
});

dishGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-add]");
  if (!button) return;
  const dish = dishes.find((item) => item.id === button.dataset.cartAdd);
  if (!dish) return;
  const variant = getVariants(dish)[Number(button.dataset.variant)];
  if (!variant) return;
  addDishToCart(dish, variant);
});

orderLines.addEventListener("click", (event) => {
  if (event.target.closest("#empty-cart-menu")) {
    orderDialog.close();
    document.querySelector("#menu").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const button = event.target.closest("[data-cart-action]");
  if (!button) return;
  const { cartAction, lineKey } = button.dataset;
  if (cartAction === "remove") {
    cart.delete(lineKey);
    updateCart();
    return;
  }
  changeCartQuantity(lineKey, cartAction === "increase" ? 1 : -1);
});

dishGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-action]");
  if (!button) return;
  changeCartQuantity(button.dataset.lineKey, button.dataset.cartAction === "increase" ? 1 : -1);
});

orderButton.addEventListener("click", openOrderDialog);
document.querySelector("#order-close").addEventListener("click", () => orderDialog.close());
orderDialog.addEventListener("click", (event) => {
  if (event.target === orderDialog) orderDialog.close();
});

fulfillmentMethod.addEventListener("change", updateDeliveryFields);

buffetForm.addEventListener("change", (event) => {
  if (event.target.matches('input[name="buffet-size"], input[name="buffet-protein"], input[name="buffet-extra"]')) updateBuffetPrice();
});

buffetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const base = buffetForm.querySelector('input[name="buffet-base"]:checked');
  const proteins = [...buffetForm.querySelectorAll('input[name="buffet-protein"]:checked')].map((input) => input.value);
  const size = buffetForm.querySelector('input[name="buffet-size"]:checked').value;
  const proteinLimit = size === "Pequeño" ? 1 : size === "Mediano" ? 2 : 3;
  if (!base || proteins.length === 0 || proteins.length > proteinLimit) {
    buffetError.textContent = !base
      ? "Selecciona una base para tu plato."
      : proteins.length === 0 ? "Selecciona al menos una proteína." : `El tamaño ${size.toLowerCase()} permite hasta ${proteinLimit} proteínas.`;
    return;
  }
  buffetSequence += 1;
  const pricedExtras = [...buffetForm.querySelectorAll('input[name="buffet-extra"]:checked')]
    .map((input) => `${input.value} (+${formatUSD(Number(input.dataset.price))})`);
  const detail = [base.value, ...proteins, ...pricedExtras].join(" · ");
  const key = `buffet:${Date.now()}:${buffetSequence}`;
  cart.set(key, {
    key,
    name: `Plato buffet ${size}`,
    image: "assets/menu/vegetable-bowl-v3.jpg",
    portion: size,
    unitPrice: getBuffetPrice(),
    quantity: 1,
    detail,
  });
  buffetError.textContent = "";
  buffetForm.reset();
  buffetForm.querySelector('input[name="buffet-size"][value="Pequeño"]').checked = true;
  updateBuffetPrice();
  updateCart();
  setToast("Tu plato de buffet se agregó al pedido");
});

customerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (cart.size === 0) {
    setToast("Agrega al menos un producto antes de continuar.");
    return;
  }
  if (fulfillmentMethod.value === "Delivery" && !deliveryAddress.value.trim()) {
    deliveryAddress.reportValidity();
    return;
  }
  const message = buildWhatsAppMessage(new FormData(customerForm));
  pendingWhatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  orderDialog.close();
  openPaymentDialog(
    "Tu pedido está casi listo. Elige tu banco y copia los datos y el monto; después pulsa «Continuar a WhatsApp».",
    "Importante: espera la confirmación de la tienda sobre la disponibilidad y el monto final antes de realizar el pago.",
  );
});

document.querySelector("#rate-refresh").addEventListener("click", loadExchangeRate);

readCachedRate();
renderExchangeRate();
renderCartLines();
renderTotals();
updateBuffetPrice();
updateDeliveryFields();
loadExchangeRate();
setInterval(loadExchangeRate, 60 * 60 * 1000);

if (!supabaseClient) {
  catalogStatus.textContent = "No se pudo conectar con el menú. Revisa la configuración de Supabase.";
} else {
  loadMenu().catch((error) => {
    console.error("No se pudo cargar el menú del restaurante.", error);
    catalogStatus.textContent = "No se pudo cargar la carta. Recarga la página o consulta por WhatsApp.";
    dishGrid.innerHTML = `<p class="empty-menu">No pudimos conectar con la carta en este momento.</p>`;
  });
  supabaseClient.channel("restaurant-menu-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_product_events" }, () => {
      loadMenu().catch((error) => {
        console.error("No se pudo actualizar el menú del restaurante.", error);
        catalogStatus.textContent = "No se pudo actualizar la carta. Intenta recargar la página.";
      });
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Falló la suscripción en tiempo real al menú.", error || status);
      }
    });
}
