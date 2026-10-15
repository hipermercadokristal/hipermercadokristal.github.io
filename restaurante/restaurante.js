const supabaseClient = window.kristalSupabase;
const dishGrid = document.querySelector("#dish-grid");
const categoryFilter = document.querySelector("#category-filter");
const catalogStatus = document.querySelector("#catalog-status");
const dishSearch = document.querySelector("#dish-search");
const orderButton = document.querySelector("#order-button");
const orderCount = document.querySelector("#order-count");
const toast = document.querySelector("#restaurant-toast");
const WHATSAPP_NUMBER = "584128867088";
const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
let dishes = [];
let categories = [];
let activeCategory = "Todos";
let searchQuery = "";
const order = new Map();
let toastTimeout;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function setToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2200);
}

function renderCategories() {
  categoryFilter.innerHTML = ["Todos", ...categories.map((category) => category.nombre)]
    .map((name) => `<button type="button" class="${name === activeCategory ? "active" : ""}" data-category="${escapeHtml(name)}" aria-pressed="${name === activeCategory}">${escapeHtml(name)}</button>`)
    .join("");
}

function renderDishes() {
  const query = searchQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const filtered = dishes.filter((dish) => {
    const matchesCategory = activeCategory === "Todos" || dish.category === activeCategory;
    const searchText = `${dish.name} ${dish.description} ${dish.category}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
    return matchesCategory && searchText.includes(query);
  });
  dishGrid.innerHTML = filtered.length
    ? filtered.map((dish) => `<article class="dish-card">
        <img src="${escapeHtml(dish.image)}" alt="Foto de ${escapeHtml(dish.name)}" loading="lazy" />
        <div class="dish-card-body">
          <span class="dish-category">${escapeHtml(dish.category)}</span>
          <h3>${escapeHtml(dish.name)}</h3>
          <p>${escapeHtml(dish.description || "Consulta los detalles de este plato al hacer tu pedido.")}</p>
          <div class="dish-card-bottom"><strong class="dish-price">${currency.format(dish.price)}</strong><button type="button" data-add-dish="${escapeHtml(dish.id)}">Agregar ${order.has(dish.id) ? `(${order.get(dish.id)})` : ""}</button></div>
        </div>
      </article>`).join("")
    : `<p class="empty-menu">${dishes.length ? "No encontramos platos con esos filtros." : "El menú se está preparando. Vuelve pronto para descubrir nuestros platos."}</p>`;
  catalogStatus.textContent = dishes.length ? `${filtered.length} ${filtered.length === 1 ? "plato disponible" : "platos disponibles"}.` : "";
}

function updateOrder() {
  const count = [...order.values()].reduce((total, quantity) => total + quantity, 0);
  orderCount.textContent = String(count);
  orderButton.disabled = count === 0;
  renderDishes();
}

async function loadMenu() {
  if (!supabaseClient) throw new Error("No se pudo conectar con el menú. Revisa la configuración de Supabase.");
  const [categoryResult, dishResult] = await Promise.all([
    supabaseClient.from("restaurant_categories").select("id,nombre").order("nombre"),
    supabaseClient.from("restaurant_products").select("id,nombre,descripcion,precio,imagen_url,disponible,categorias:restaurant_categories(nombre)").eq("disponible", true).order("nombre"),
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (dishResult.error) throw dishResult.error;
  categories = categoryResult.data;
  dishes = dishResult.data.map((row) => ({
    id: row.id,
    name: row.nombre,
    description: row.descripcion || "",
    price: Number(row.precio),
    image: row.imagen_url,
    category: row.categorias?.nombre || "Menú",
  }));
  const available = new Set(dishes.map((dish) => dish.id));
  for (const id of order.keys()) if (!available.has(id)) order.delete(id);
  renderCategories();
  updateOrder();
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

dishGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-dish]");
  if (!button) return;
  const id = button.dataset.addDish;
  order.set(id, (order.get(id) || 0) + 1);
  updateOrder();
  setToast("Plato agregado a tu pedido");
});

orderButton.addEventListener("click", () => {
  const lines = dishes.filter((dish) => order.has(dish.id)).map((dish) =>
    `${dish.name} x${order.get(dish.id)} — ${currency.format(dish.price * order.get(dish.id))}`,
  );
  if (!lines.length) return;
  const total = dishes.reduce((sum, dish) => sum + dish.price * (order.get(dish.id) || 0), 0);
  const message = [
    "¡Hola, Restaurante Kristal! Quiero consultar y hacer este pedido:",
    "",
    ...lines,
    "",
    `Total estimado: ${currency.format(total)}`,
    "",
    "Por favor confirmen disponibilidad, precio final y opciones de entrega. ¡Gracias!",
  ].join("\n");
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
});

if (!supabaseClient) {
  catalogStatus.textContent = "No se pudo conectar con el menú. Revisa la configuración de Supabase.";
} else {
  loadMenu().catch((error) => {
    console.error("No se pudo cargar el menú del restaurante.", error);
    catalogStatus.textContent = "No se pudo cargar el menú. Recarga la página o consulta por WhatsApp.";
  });
  supabaseClient.channel("restaurant-menu-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_product_events" }, () => {
      loadMenu().catch((error) => {
        console.error("No se pudo actualizar el menú del restaurante.", error);
        catalogStatus.textContent = "No se pudo actualizar el menú. Intenta recargar la página.";
      });
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Falló la suscripción al menú del restaurante.", error);
      }
    });
}
