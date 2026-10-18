const supabaseClient = window.kristalSupabase;
const authSection = document.querySelector("#auth-section");
const dashboardSection = document.querySelector("#dashboard-section");
const authStatus = document.querySelector("#auth-status");
const dashboardStatus = document.querySelector("#dashboard-status");
const productForm = document.querySelector("#product-form");
const categorySelect = document.querySelector("#product-category");
const inventoryRows = document.querySelector("#inventory-rows");
const emptyInventory = document.querySelector("#empty-inventory");
const inventorySearch = document.querySelector("#inventory-search");
const inventorySearchSummary = document.querySelector("#inventory-search-summary");
const inventorySearchEmpty = document.querySelector("#inventory-search-empty");
const productImageRulesForm = document.querySelector("#product-image-rules-form");
const productImageRuleFile = document.querySelector("#product-image-rule-file");
const productImageRulesList = document.querySelector("#product-image-rules-list");
const productImageRulesStatus = document.querySelector("#product-image-rules-status");
const saveProductImageRuleButton = document.querySelector("#save-product-image-rule-button");
const imageInput = document.querySelector("#product-image");
const saveButton = document.querySelector("#save-product-button");
const formHeading = document.querySelector("#product-form-heading");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const adminOrdersList = document.querySelector("#admin-orders-list");
const adminOrdersStatus = document.querySelector("#orders-admin-status");
const emptyOrders = document.querySelector("#empty-orders");
const cashierOrderQueues = {
  active: {
    list: document.querySelector("#active-orders-list"),
    empty: document.querySelector("#active-orders-empty"),
    count: document.querySelector("#active-orders-count"),
  },
  cancelled: {
    list: document.querySelector("#cancelled-orders-list"),
    empty: document.querySelector("#cancelled-orders-empty"),
    count: document.querySelector("#cancelled-orders-count"),
  },
  completed: {
    list: document.querySelector("#completed-orders-list"),
    empty: document.querySelector("#completed-orders-empty"),
    count: document.querySelector("#completed-orders-count"),
  },
};
const cashierQueueLists = Object.values(cashierOrderQueues).map((queue) => queue.list).filter(Boolean);
const staffPage = document.querySelector("[data-staff-page]")?.dataset.staffPage || "admin";
const deletedProductRows = document.querySelector("#deleted-product-rows");
const emptyDeletedProducts = document.querySelector("#empty-deleted-products");
const purgeDeletedProductsButton = document.querySelector("#purge-deleted-products-button");
const deletedProductsStatus = document.querySelector("#deleted-products-status");
const staffRoleForm = document.querySelector("#staff-role-form");
const documentSearchForm = document.querySelector("#staff-document-search-form");
const documentSearchResults = document.querySelector("#staff-document-search-results");
const salesSummary = document.querySelector("#sales-summary");
const dailyStockRows = document.querySelector("#daily-stock-rows");
const emptyDailyStock = document.querySelector("#empty-daily-stock");
const dailyStockStatus = document.querySelector("#daily-stock-status");
const startStockDayButton = document.querySelector("#start-stock-day-button");
const courierBalanceRows = document.querySelector("#courier-balance-rows");
const emptyCourierBalances = document.querySelector("#empty-courier-balances");
const courierPayoutHistoryRows = document.querySelector("#courier-payout-history-rows");
const emptyCourierPayoutHistory = document.querySelector("#empty-courier-payout-history");
const courierPaymentsStatus = document.querySelector("#courier-payments-status");
const refreshCourierPaymentsButton = document.querySelector("#refresh-courier-payments-button");
const archiveAllProductsButton = document.querySelector("#archive-all-products-button");
const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const bolivares = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stockNumber = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 3 });
const departmentNames = [
  "Víveres y Alacena",
  "Frutas y Verduras",
  "Carnes, Aves y Charcutería",
  "Bebidas, Licores y Tabaco",
  "Snacks, Golosinas y Confitería",
  "Cuidado Personal e Higiene",
  "Cuidado del Hogar y Limpieza",
  "Hogar, Bazar y Utensilios",
  "Electrodomésticos y Ferretería",
  "Mascotas",
  "Congelados",
];
let editingProduct = null;
let categories = [];
let inventoryProducts = [];
let productImageRules = [];
let missingDepartments = [];
let deliveryCouriers = [];
let adminOrdersChannel = null;
let staffRole = "";
let dailyDealColumnsAvailable = true;
if (imageInput) imageInput.required = true;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function setMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle("success", success);
}

function isMissingDailyDealColumns(error) {
  return ["42703", "PGRST204"].includes(error?.code)
    && /es_oferta_dia|oferta_dia_hasta/i.test(error.message || "");
}

function setAuthenticatedView(isAuthenticated) {
  if (authSection) authSection.hidden = isAuthenticated;
  if (dashboardSection) dashboardSection.hidden = !isAuthenticated;
}

function getInventoryImageUrl(url) {
  return url.startsWith("assets/") ? `../${url}` : url;
}

async function requireStaff(session) {
  const role = session?.user?.app_metadata?.role;
  if (role === "courier") {
    window.location.replace("/delivery/");
    throw new Error("Abriendo el módulo de reparto…");
  }
  if (staffPage === "admin" && role === "operator") {
    window.location.replace("/caja/");
    throw new Error("Abriendo la bandeja de caja…");
  }
  const allowed = staffPage === "cashier" ? role === "operator" || role === "admin" : role === "admin";
  if (!allowed) {
    const destination = window.kristalAuthRouting?.destinationForUser(session?.user);
    if (destination) {
      window.location.replace(destination);
      throw new Error("Abriendo el módulo correspondiente a tu cuenta…");
    }
    await supabaseClient.auth.signOut();
    throw new Error(staffPage === "cashier"
      ? "Esta cuenta no tiene permiso de caja. Solicita al propietario que asigne el rol operator."
      : "Esta sección es exclusiva del propietario. Las cuentas de caja deben entrar en /caja/.");
  }
  return role;
}

async function loadCategories() {
  const { data, error } = await supabaseClient.from("categorias").select("id,nombre,departamento").order("nombre");
  if (error) throw error;
  const departmentsByName = new Map(
    data
      .filter((category) => category.nombre === category.departamento)
      .map((category) => [category.nombre, category]),
  );
  categories = departmentNames.map((name) => departmentsByName.get(name)).filter(Boolean);
  missingDepartments = departmentNames.filter((name) => !departmentsByName.has(name));
  if (!categories.length) {
    throw new Error("No hay departamentos principales en Supabase. Ejecuta supabase-departamentos.sql desde SQL Editor.");
  }
  categorySelect.innerHTML = categories
    .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.nombre)}</option>`)
    .join("");
}

function normalizeInventorySearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-VE")
    .trim();
}

function renderInventory() {
  const query = normalizeInventorySearch(inventorySearch?.value);
  const filteredProducts = query
    ? inventoryProducts.filter((product) => {
      const category = Array.isArray(product.categorias) ? product.categorias[0] : product.categorias;
      return normalizeInventorySearch([
        product.nombre,
        product.codigo_barras,
        product.presentacion,
        category?.nombre,
        category?.departamento,
      ].join(" ")).includes(query);
    })
    : inventoryProducts;

  inventoryRows.innerHTML = filteredProducts.map((product) => {
    const category = Array.isArray(product.categorias) ? product.categorias[0] : product.categorias;
    const department = window.getKristalProductDepartment(product.nombre, category?.departamento || "");
    const dailyDealActive = product.es_oferta_dia
      && product.oferta_dia_hasta
      && new Date(product.oferta_dia_hasta) > new Date();
    return `<tr>
      <td data-label="Producto"><div class="inventory-product"><img src="${escapeHtml(getInventoryImageUrl(product.imagen_url))}" alt="" loading="lazy" /><span>${escapeHtml(product.nombre)}${product.es_destacado ? " · Destacado" : ""}</span></div></td>
      <td data-label="Código">${escapeHtml(product.codigo_barras || "—")}</td>
      <td data-label="Departamento">${escapeHtml(department || "Sin departamento")}${department !== category?.departamento ? " · sugerido" : ""}</td>
      <td data-label="Precio">${currency.format(Number(product.precio))}</td>
      <td data-label="Precio VES">${product.precio_ves === null ? "—" : `Bs. ${bolivares.format(Number(product.precio_ves))}`}</td>
      <td data-label="Stock interno">${product.stock_tracked && product.stock !== null ? stockNumber.format(Number(product.stock)) : "Sin control"}</td>
      <td data-label="Oferta">${product.precio_oferta === null ? "—" : `${currency.format(Number(product.precio_oferta))}${product.es_oferta_dia ? dailyDealActive ? " · Del día" : " · Vencida" : ""}`}</td>
      <td data-label="Visibilidad"><span class="stock-label${product.disponible ? "" : " unavailable"}">${product.disponible ? "Publicado" : "Oculto"}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button type="button" data-action="edit" data-id="${escapeHtml(product.id)}">Editar</button>
        <button type="button" data-action="toggle" data-id="${escapeHtml(product.id)}">${product.disponible ? "Ocultar" : "Publicar"}</button>
        <button class="delete-button" type="button" data-action="delete" data-id="${escapeHtml(product.id)}">Eliminar</button>
      </div></td>
    </tr>`;
  }).join("");

  emptyInventory.hidden = inventoryProducts.length > 0;
  inventorySearchEmpty.hidden = !query || filteredProducts.length > 0 || inventoryProducts.length === 0;
  inventorySearchSummary.hidden = !query;
  if (query) {
    inventorySearchSummary.textContent = `Se encontraron ${filteredProducts.length} de ${inventoryProducts.length} productos.`;
  }
}

async function loadInventory() {
  setMessage(dashboardStatus, "Cargando inventario…");
  const pageSize = 1000;
  const products = [];
  for (let offset = 0; ; offset += pageSize) {
    const loadPage = (includeDailyDealColumns) => supabaseClient
      .from("productos")
      .select(includeDailyDealColumns
        ? "id,nombre,codigo_barras,stock,stock_tracked,precio_ves,categoria_id,precio,precio_oferta,es_destacado,es_oferta_dia,oferta_dia_hasta,disponible,imagen_url,imagen_path,presentacion,categorias(nombre,departamento)"
        : "id,nombre,codigo_barras,stock,stock_tracked,precio_ves,categoria_id,precio,precio_oferta,es_destacado,disponible,imagen_url,imagen_path,presentacion,categorias(nombre,departamento)")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    let { data, error } = await loadPage(dailyDealColumnsAvailable);
    if (error && dailyDealColumnsAvailable && isMissingDailyDealColumns(error)) {
      dailyDealColumnsAvailable = false;
      ({ data, error } = await loadPage(false));
    }
    if (error) throw error;
    products.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  inventoryProducts = products;
  renderInventory();
  const inventoryMessage = `${products.length} ${products.length === 1 ? "producto" : "productos"} en inventario.`;
  setMessage(
    dashboardStatus,
    missingDepartments.length
      ? `Faltan departamentos en Supabase: ${missingDepartments.join(", ")}. Ejecuta supabase-departamentos.sql desde SQL Editor. ${inventoryMessage}`
      : inventoryMessage,
    missingDepartments.length === 0,
  );
  return products;
}

async function loadDailyStock() {
  setMessage(dailyStockStatus, "Cargando resumen de stock…");
  const { data, error } = await supabaseClient.rpc("get_inventory_stock_day");
  if (error) throw error;
  dailyStockRows.innerHTML = (data || []).map((product) => `<tr>
    <td data-label="Producto">${escapeHtml(product.product_name)}</td>
    <td data-label="Stock inicial">${stockNumber.format(Number(product.opening_stock))}</td>
    <td data-label="Unidades descontadas hoy">${stockNumber.format(Number(product.units_sold))}</td>
    <td data-label="Stock final">${stockNumber.format(Number(product.closing_stock))}</td>
  </tr>`).join("");
  emptyDailyStock.hidden = Boolean(data?.length);
  setMessage(dailyStockStatus, data?.length
    ? `${data.length} ${data.length === 1 ? "producto con stock controlado" : "productos con stock controlado"} en el resumen de hoy.`
    : "No hay stock controlado registrado para hoy.");
}

async function startDailyStock() {
  startStockDayButton.disabled = true;
  setMessage(dailyStockStatus, "Registrando el stock inicial de hoy…");
  try {
    const { data: count, error } = await supabaseClient.rpc("start_inventory_stock_day");
    if (error) throw error;
    await loadDailyStock();
    setMessage(
      dailyStockStatus,
      count
        ? `Se registró el stock inicial de ${count} productos. Las ventas posteriores se descontarán automáticamente.`
        : "El stock inicial ya estaba registrado o no hay productos con control de stock.",
      true,
    );
  } catch (error) {
    console.error("No se pudo registrar el stock inicial del día.", error);
    setMessage(dailyStockStatus, error.message || "No se pudo registrar el stock inicial.");
  } finally {
    startStockDayButton.disabled = false;
  }
}

async function loadCourierCompensation() {
  setMessage(courierPaymentsStatus, "Cargando saldos e historial de pagos…");
  const [
    { data: balances, error: balanceError },
    { data: payouts, error: payoutError },
  ] = await Promise.all([
    supabaseClient.rpc("get_courier_balance_summary"),
    supabaseClient.rpc("get_courier_payout_history"),
  ]);
  if (balanceError) throw balanceError;
  if (payoutError) throw payoutError;

  courierBalanceRows.innerHTML = (balances || []).map((courier) => {
    const balance = Number(courier.balance_usd);
    return `<tr>
      <td data-label="Repartidor">${escapeHtml(courier.courier_name)}${courier.courier_email ? `<small class="courier-email">${escapeHtml(courier.courier_email)}</small>` : ""}</td>
      <td data-label="Entregas completadas">${Number(courier.completed_deliveries)}</td>
      <td data-label="Saldo pendiente">${currency.format(balance)}</td>
      <td data-label="Acción"><button class="payout-button" type="button" data-settle-courier="${escapeHtml(courier.courier_id)}" data-courier-name="${escapeHtml(courier.courier_name)}" data-balance="${balance}"${balance > 0 ? "" : " disabled"}>Registrar pago</button></td>
    </tr>`;
  }).join("");
  emptyCourierBalances.hidden = Boolean(balances?.length);

  courierPayoutHistoryRows.innerHTML = (payouts || []).map((payout) => {
    const paidAt = new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(payout.paid_at));
    return `<tr>
      <td data-label="Fecha">${escapeHtml(paidAt)}</td>
      <td data-label="Repartidor">${escapeHtml(payout.courier_name)}</td>
      <td data-label="Monto">${currency.format(Number(payout.amount_usd))}</td>
      <td data-label="Registrado por">${escapeHtml(payout.paid_by_name)}</td>
    </tr>`;
  }).join("");
  emptyCourierPayoutHistory.hidden = Boolean(payouts?.length);
  setMessage(courierPaymentsStatus, "Saldo actualizado: $4 por cada delivery completado.");
}

async function settleCourierBalance(button) {
  const courierId = button.dataset.settleCourier;
  const courierName = button.dataset.courierName;
  const balance = Number(button.dataset.balance);
  if (!courierId || !Number.isFinite(balance) || balance <= 0) return;
  if (!window.confirm(`¿Confirmas que pagaste ${currency.format(balance)} a ${courierName}? Al registrar el pago, el saldo pendiente quedará en $0.`)) return;

  button.disabled = true;
  setMessage(courierPaymentsStatus, "Registrando el pago…");
  try {
    const { data: amount, error } = await supabaseClient.rpc("settle_courier_balance", {
      p_courier_id: courierId,
    });
    if (error) throw error;
    await loadCourierCompensation();
    setMessage(courierPaymentsStatus, `Pago de ${currency.format(Number(amount))} registrado. El saldo pendiente de ${courierName} quedó liquidado.`, true);
  } catch (error) {
    console.error("No se pudo registrar el pago al repartidor.", error);
    setMessage(courierPaymentsStatus, error.message || "No se pudo registrar el pago.");
    button.disabled = false;
  }
}

async function loadDeletedProducts() {
  if (!deletedProductRows) return;
  const { data, error } = await supabaseClient
    .from("productos")
    .select("id,nombre,precio,precio_oferta,imagen_url,deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  deletedProductRows.innerHTML = data.map((product) => {
    const deletedAt = new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(product.deleted_at));
    return `<tr>
      <td data-label="Producto"><div class="inventory-product"><img src="${escapeHtml(getInventoryImageUrl(product.imagen_url))}" alt="" loading="lazy" /><span>${escapeHtml(product.nombre)}<small class="deleted-product-price">Precio: ${currency.format(Number(product.precio))}${product.precio_oferta === null ? "" : ` · Oferta: ${currency.format(Number(product.precio_oferta))}`}</small></span></div></td>
      <td data-label="Eliminado">${escapeHtml(deletedAt)}</td>
      <td data-label="Acciones"><div class="row-actions"><button type="button" data-restore-product="${escapeHtml(product.id)}">Restaurar</button></div></td>
    </tr>`;
  }).join("");
  emptyDeletedProducts.hidden = data.length > 0;
  if (purgeDeletedProductsButton) purgeDeletedProductsButton.disabled = data.length === 0;
}

async function loadSalesSummary() {
  if (!salesSummary) return;
  const { data, error } = await supabaseClient.rpc("admin_store_sales_summary");
  if (error) throw error;
  const summary = Array.isArray(data) ? data[0] : data;
  if (!summary) throw new Error("Supabase no devolvió el resumen de ventas.");
  document.querySelector("#sales-orders-today").textContent = String(summary.orders_today);
  document.querySelector("#sales-gross-today").textContent = currency.format(Number(summary.gross_today));
  document.querySelector("#sales-verified-today").textContent = currency.format(Number(summary.verified_today));
  document.querySelector("#sales-pending-today").textContent = String(summary.pending_payments);
}

async function setStaffRole(event) {
  event.preventDefault();
  const status = document.querySelector("#staff-role-status");
  const submit = staffRoleForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setMessage(status, "Guardando acceso…");
  try {
    const formData = new FormData(staffRoleForm);
    const { error } = await supabaseClient.rpc("set_store_staff_role", {
      p_email: String(formData.get("email")).trim(),
      p_role: formData.get("role"),
    });
    if (error) throw error;
    staffRoleForm.reset();
    setMessage(status, "Acceso actualizado. La persona debe cerrar sesión y volver a entrar.", true);
    await loadDeliveryCouriers();
  } catch (error) {
    console.error("No se pudo actualizar el rol del personal.", error);
    setMessage(status, error.message || "No se pudo actualizar el acceso.");
  } finally {
    submit.disabled = false;
  }
}

const orderStatusLabels = {
  received: "Recibido",
  preparing: "En preparación",
  ready: "Listo para retirar",
  delivering: "En delivery",
  delivered: "Entregado",
  cancelled: "Cancelado",
};
const paymentStatusLabels = {
  pending_verification: "Pendiente de verificar Pago Móvil manualmente",
  awaiting_instructions: "Pendiente de instrucciones Zelle",
  awaiting_in_store: "Pago pendiente al retirar",
  awaiting_delivery: "Pago pendiente al entregar",
  verified: "Pago recibido",
  rejected: "Pago rechazado",
};
const courierAvailabilityLabels = {
  available: "Disponible",
  on_route: "En ruta",
  offline: "Fuera de servicio",
};

async function loadDeliveryCouriers() {
  const { data, error } = await supabaseClient.rpc("list_delivery_couriers");
  if (error) throw error;
  const couriers = data || [];
  if (!couriers.length) {
    deliveryCouriers = [];
    return;
  }
  const { data: availability, error: availabilityError } = await supabaseClient
    .from("courier_availability")
    .select("courier_id,availability")
    .in("courier_id", couriers.map((courier) => courier.id));
  if (availabilityError) {
    console.error("No se pudo consultar la disponibilidad de los repartidores.", availabilityError);
    setMessage(dashboardStatus, `La asignación de pedidos funciona, pero no se ven los estados de reparto. Ejecuta supabase-courier-availability.sql en Supabase. ${availabilityError.message || ""}`);
  }
  const availabilityByCourier = new Map((availability || []).map((item) => [item.courier_id, item.availability]));
  deliveryCouriers = couriers.map((courier) => ({
    ...courier,
    availability: availabilityByCourier.get(courier.id) || "offline",
  }));
}

function buildWhatsAppOrderLink(order, items) {
  const lines = [
    `Pedido ${order.id}`,
    `Cliente: ${order.customer_name} · ${order.customer_phone}`,
    `Entrega: ${order.fulfillment === "delivery" ? `Delivery — ${order.delivery_address || ""}` : "Retiro en tienda"}`,
    ...(Number(order.delivery_fee_usd) > 0 ? [`Cargo de delivery: ${currency.format(Number(order.delivery_fee_usd))}`] : []),
    `Pago: ${order.payment_method} · ${order.payment_status}`,
    `Total: ${currency.format(Number(order.total_usd))}`,
    ...(order.total_ves === null ? [] : [`Equivalente referencial: Bs. ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.total_ves))}`]),
    ...items.map((item) => `• ${item.product_name} × ${item.quantity}`),
  ];
  return `https://wa.me/584128867088?text=${encodeURIComponent(lines.join("\n"))}`;
}

async function loadAdminOrders() {
  setMessage(adminOrdersStatus, "Cargando pedidos…");
  let ordersRequest = supabaseClient
    .from("store_orders")
    .select("id,user_id,assigned_courier_id,customer_name,customer_phone,customer_document,fulfillment,delivery_address,delivery_reference,delivery_fee_usd,delivery_latitude,delivery_longitude,payment_method,payment_bank_code,payment_reference,payment_proof_path,payment_status,order_status,total_usd,total_ves,created_at")
    .order("created_at", { ascending: false })
    .limit(staffPage === "cashier" ? 300 : 100);
  if (staffPage !== "cashier") {
    ordersRequest = ordersRequest.not("order_status", "in", "(delivered,cancelled)");
  }
  const { data: orders, error } = await ordersRequest;
  if (error) throw error;
  if (!orders.length) {
    if (staffPage === "cashier") {
      for (const queue of Object.values(cashierOrderQueues)) {
        queue.list.replaceChildren();
        queue.count.textContent = "0";
        queue.empty.hidden = false;
      }
    } else {
      adminOrdersList.replaceChildren();
      emptyOrders.hidden = false;
    }
    setMessage(adminOrdersStatus, staffPage === "cashier" ? "No hay pedidos registrados." : "No hay pedidos abiertos en la bandeja.", true);
    return;
  }
  if (staffPage !== "cashier") emptyOrders.hidden = true;
  const orderIds = orders.map((order) => order.id);
  const { data: items, error: itemsError } = await supabaseClient
    .from("store_order_items")
    .select("order_id,product_name,quantity,line_total_usd")
    .in("order_id", orderIds);
  if (itemsError) throw itemsError;
  const itemsByOrder = new Map();
  for (const item of items) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  }

  const orderCards = await Promise.all(orders.map(async (order) => {
    const orderItems = itemsByOrder.get(order.id) || [];
    let proofLink = "";
    let proofError = "";
    if (order.payment_proof_path) {
      const { data: signed, error: signedError } = await supabaseClient.storage
        .from("payment-proofs")
        .createSignedUrl(order.payment_proof_path, 3600);
      if (signedError) {
        console.error(`No se pudo crear un enlace privado para el comprobante del pedido ${order.id}.`, signedError);
        proofError = "No se pudo abrir el comprobante; revisa las políticas del bucket privado.";
      } else {
        proofLink = `<a class="order-proof-link" href="${escapeHtml(signed.signedUrl)}" target="_blank" rel="noopener noreferrer">Ver comprobante</a>`;
      }
    }
    const isClosedOrder = ["delivered", "cancelled"].includes(order.order_status);
    const paymentAction = isClosedOrder
      ? ""
      : order.payment_method === "mobile_payment" && order.payment_status === "pending_verification"
      ? `<div class="order-payment-actions"><button type="button" data-order-action="verify" data-id="${escapeHtml(order.id)}">Confirmar pago manualmente</button><button class="delete-button" type="button" data-order-action="reject" data-id="${escapeHtml(order.id)}">Rechazar pago</button></div>`
      : !["verified", "rejected"].includes(order.payment_status)
        ? `<div class="order-payment-actions"><button type="button" data-order-action="verify" data-id="${escapeHtml(order.id)}">${order.payment_method === "zelle" ? "Confirmar Zelle recibido" : "Confirmar efectivo/POS recibido"}</button></div>`
        : "";
    const courier = deliveryCouriers.find((item) => item.id === order.assigned_courier_id);
    const allowedNextStatuses = {
      received: ["preparing", "cancelled"],
      preparing: ["ready", "cancelled"],
      ready: ["preparing", "cancelled"],
      delivering: ["cancelled"],
    }[order.order_status] || [];
    if (
      order.fulfillment === "pickup"
      && order.order_status === "ready"
      && ["verified", "awaiting_in_store"].includes(order.payment_status)
    ) allowedNextStatuses.push("delivered");
    const statusOptions = allowedNextStatuses.map((value) => {
      const label = orderStatusLabels[value];
      const fulfillmentLabel = value === "ready" && order.fulfillment === "delivery" ? "Listo para enviar" : label;
      return `<option value="${value}">${fulfillmentLabel}</option>`;
    });
    const currentStatusLabel = order.order_status === "delivering" && order.fulfillment === "delivery"
      ? "En camino · lo completa el repartidor"
      : orderStatusLabels[order.order_status];
    statusOptions.unshift(`<option value="${escapeHtml(order.order_status)}" selected disabled>${escapeHtml(currentStatusLabel)}</option>`);
    const assignmentControls = order.fulfillment === "delivery" && ["ready", "delivering"].includes(order.order_status)
      ? `<div class="delivery-assignment">
          <label>Repartidor<select data-courier-select="${escapeHtml(order.id)}">
            <option value="">Selecciona un repartidor</option>
            ${deliveryCouriers.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === order.assigned_courier_id ? " selected" : ""}>${escapeHtml(item.full_name)} · ${escapeHtml(courierAvailabilityLabels[item.availability] || courierAvailabilityLabels.offline)}${item.phone ? ` · ${escapeHtml(item.phone)}` : ""}</option>`).join("")}
          </select></label>
          <button type="button" data-order-action="assign" data-id="${escapeHtml(order.id)}"${deliveryCouriers.length ? "" : " disabled"}>${order.order_status === "delivering" ? "Reasignar delivery" : "Asignar y enviar"}</button>
          ${courier ? `<span>Asignado a ${escapeHtml(courier.full_name)}</span>` : ""}
          ${deliveryCouriers.length ? "" : "<span>No hay cuentas activas con rol de repartidor.</span>"}
        </div>`
      : "";
    const date = new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at));
    return `<article class="admin-order-card" data-order-id="${escapeHtml(order.id)}">
      <header class="admin-order-heading"><div><span class="eyebrow">${escapeHtml(date)}</span><h3>Pedido ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h3></div><strong>${currency.format(Number(order.total_usd))}${order.total_ves === null ? "" : `<small>Bs. ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.total_ves))} · referencial</small>`}</strong></header>
      <p><strong>${escapeHtml(order.customer_name)}</strong> · ${escapeHtml(order.customer_phone)}${order.customer_document ? ` · C.I.: ${escapeHtml(order.customer_document)}` : ""}</p>
      <p>${order.fulfillment === "delivery" ? `Delivery: ${escapeHtml(order.delivery_address || "")}${order.delivery_reference ? ` · Referencia: ${escapeHtml(order.delivery_reference)}` : ""}${order.delivery_latitude !== null && order.delivery_longitude !== null ? ` · GPS: ${escapeHtml(`${order.delivery_latitude}, ${order.delivery_longitude}`)}` : ""}` : "Retiro en tienda"} · Pago: ${escapeHtml(order.payment_method)}</p>
      ${Number(order.delivery_fee_usd) > 0 ? `<p>Cargo de delivery: ${currency.format(Number(order.delivery_fee_usd))}</p>` : ""}
      ${order.payment_method === "mobile_payment" ? `<p>Banco: ${escapeHtml(order.payment_bank_code || "—")} · Referencia: ${escapeHtml(order.payment_reference || "—")}</p>` : ""}
      <ul class="admin-order-items">${orderItems.map((item) => `<li>${escapeHtml(item.product_name)} × ${item.quantity} <span>${currency.format(Number(item.line_total_usd))}</span></li>`).join("")}</ul>
      <div class="admin-order-proof">${proofLink}${proofError ? `<span role="alert">${escapeHtml(proofError)}</span>` : ""}</div>
      <div class="order-payment-state${order.payment_status === "verified" ? " verified" : ""}">${order.payment_status === "verified" ? "Pagado" : escapeHtml(paymentStatusLabels[order.payment_status] || "Estado de pago pendiente")}</div>
      ${paymentAction}
      ${assignmentControls}
      ${isClosedOrder ? "" : `<div class="admin-order-status-controls"><label>Estado del pedido<select data-order-status>${statusOptions}</select></label><button type="button" data-order-action="status" data-id="${escapeHtml(order.id)}">Guardar estado</button></div>`}
      <a class="order-whatsapp-link" href="${buildWhatsAppOrderLink(order, orderItems)}" target="_blank" rel="noopener noreferrer">Preparar aviso por WhatsApp</a>
    </article>`;
  }));
  if (staffPage === "cashier") {
    const groupedOrders = { active: [], cancelled: [], completed: [] };
    orders.forEach((order, index) => {
      const queueName = order.order_status === "cancelled"
        ? "cancelled"
        : order.order_status === "delivered" ? "completed" : "active";
      groupedOrders[queueName].push(orderCards[index]);
    });
    for (const [queueName, queue] of Object.entries(cashierOrderQueues)) {
      const cards = groupedOrders[queueName];
      queue.list.innerHTML = cards.join("");
      queue.count.textContent = String(cards.length);
      queue.empty.hidden = cards.length > 0;
    }
  } else {
    adminOrdersList.innerHTML = orderCards.join("");
  }
  setMessage(adminOrdersStatus, `${orders.length} pedidos recientes.`);
}

async function handleAdminOrderAction(event) {
  const button = event.target.closest("button[data-order-action]");
  if (!button) return;
  const orderId = button.dataset.id;
  const action = button.dataset.orderAction;
  const card = button.closest(".admin-order-card");
  if (action === "verify") {
    const paymentText = card.querySelector(".admin-order-heading h3").textContent;
    const confirmationMessage = button.textContent === "Confirmar pago manualmente"
      ? `¿Verificaste el abono bancario de ${paymentText} y deseas aprobarlo?`
      : `¿Confirmas que recibiste el pago de ${paymentText}?`;
    if (!window.confirm(confirmationMessage)) return;
  }
  if (action === "reject" && !window.confirm("¿Confirmas que el comprobante no corresponde a un pago válido?")) return;
  let request;
  if (action === "verify" || action === "reject") {
    request = supabaseClient.rpc("set_store_order_payment_status", {
      p_order_id: orderId,
      p_decision: action === "verify" ? "approve" : "reject",
    });
  } else if (action === "assign") {
    const courierId = card.querySelector("[data-courier-select]").value;
    if (!courierId) {
      setMessage(adminOrdersStatus, "Selecciona un repartidor antes de asignar el pedido.");
      return;
    }
    request = supabaseClient.rpc("assign_store_order_courier", {
      p_order_id: orderId,
      p_courier_id: courierId,
    });
  } else {
    request = supabaseClient.rpc("set_store_order_status", {
      p_order_id: orderId,
      p_order_status: card.querySelector("[data-order-status]").value,
    });
  }

  button.disabled = true;
  setMessage(adminOrdersStatus, "Guardando cambios…");
  try {
    const { error } = await request;
    if (error) throw error;
    await loadAdminOrders();
  } catch (error) {
    console.error("No se pudo actualizar el pedido.", error);
    setMessage(adminOrdersStatus, error.message || "No se pudo actualizar el pedido.", false);
  } finally {
    button.disabled = false;
  }
}

function subscribeToAdminOrders() {
  if (adminOrdersChannel) supabaseClient.removeChannel(adminOrdersChannel);
  adminOrdersChannel = supabaseClient
    .channel("admin-store-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "store_orders" }, () => {
      loadAdminOrders().catch((error) => {
        console.error("No se pudo actualizar la bandeja de pedidos.", error);
        setMessage(adminOrdersStatus, error.message || "No se pudo actualizar la bandeja.", false);
      });
      loadCourierCompensation().catch((error) => {
        console.error("No se pudo actualizar el saldo de delivery.", error);
        setMessage(courierPaymentsStatus, error.message || "No se pudo actualizar el saldo de delivery.");
      });
    })
    .subscribe();
}

async function initializeAdminOrders() {
  try {
    await loadDeliveryCouriers();
    await loadAdminOrders();
    subscribeToAdminOrders();
  } catch (error) {
    console.error("No se pudo cargar la bandeja de pedidos.", error);
    setMessage(
      adminOrdersStatus,
      `No se pudo cargar la bandeja: ${error.message || "error de conexión"}. Ejecuta supabase-orders.sql, supabase-delivery-roles.sql y supabase-admin-organization.sql en Supabase SQL Editor.`,
      false,
    );
  }
}

function setStaffView(role) {
  staffRole = role;
  setAuthenticatedView(true);
  const isAdmin = staffPage === "admin" && role === "admin";
  document.querySelector("#dashboard-heading").textContent = isAdmin ? "Administración de la tienda" : "Caja · Pedidos y pagos";
  document.querySelector("#order-inbox-panel").hidden = isAdmin;
  const scanPanel = document.querySelector("#staff-scan-panel");
  if (scanPanel) scanPanel.hidden = isAdmin;
  const adminReturnLink = document.querySelector(".admin-return-link");
  if (adminReturnLink) adminReturnLink.hidden = !(staffPage === "cashier" && role === "admin");
}

async function searchPickupByDocument(event) {
  event.preventDefault();
  const status = document.querySelector("#staff-document-search-status");
  documentSearchResults.replaceChildren();
  setMessage(status, "Buscando pedidos de retiro pendientes…");
  const submitButton = documentSearchForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const { data, error } = await supabaseClient.rpc("find_store_pickup_orders_by_document", {
      p_document: documentSearchForm.elements.document.value.trim(),
    });
    if (error) throw error;
    if (!Array.isArray(data) || !data.length) {
      setMessage(status, "No hay pedidos de retiro pendientes asociados a ese documento.");
      return;
    }
    documentSearchResults.innerHTML = data.map((order) => `<article class="scanned-pickup-ticket">
      <h3>Pedido ${escapeHtml(String(order.id).slice(0, 8).toUpperCase())}</h3>
      <p><strong>${escapeHtml(order.customer_name)}</strong> · ${escapeHtml(order.customer_phone)}</p>
      <ul>${(order.items || []).map((item) => `<li>${escapeHtml(item.product_name)} × ${Number(item.quantity)}</li>`).join("")}</ul>
      <p>Total: <strong>${currency.format(Number(order.total_usd))}</strong></p>
      <button class="primary-button" type="button" data-complete-pickup-order="${escapeHtml(order.id)}">Confirmar cobro y entrega</button>
    </article>`).join("");
    setMessage(status, `${data.length} ${data.length === 1 ? "pedido pendiente encontrado" : "pedidos pendientes encontrados"}.`);
  } catch (error) {
    console.error("No se pudieron buscar pedidos por documento.", error);
    setMessage(status, error.message || "No se pudo completar la búsqueda.");
  } finally {
    submitButton.disabled = false;
  }
}

async function completePickup(rpcName, params, button) {
  const status = document.querySelector("#staff-document-search-status");
  button.disabled = true;
  try {
    const { data: orderId, error } = await supabaseClient.rpc(rpcName, params);
    if (error) throw error;
    setMessage(status, `Pedido ${String(orderId).slice(0, 8).toUpperCase()} cobrado y entregado correctamente.`, true);
    documentSearchResults?.replaceChildren();
  } catch (error) {
    console.error("No se pudo confirmar el retiro en caja.", error);
    setMessage(status, error.message || "No se pudo confirmar el retiro. Comprueba el pedido e inténtalo de nuevo.");
    button.disabled = false;
    return;
  }
  try {
    await loadAdminOrders();
  } catch (error) {
    console.error("El retiro se confirmó, pero no se pudo actualizar la bandeja de pedidos.", error);
    setMessage(status, `El pedido se entregó, pero no se pudo actualizar la lista: ${error.message || "error de conexión"}`);
  }
}

async function enterStaffDashboard(session) {
  const role = await requireStaff(session);
  setStaffView(role);
  if (role === "admin" && staffPage === "admin") {
    await loadCategories();
    await loadInventory();
    await loadDeletedProducts();
    loadProductImageRules().catch((error) => {
      console.error("No se pudieron cargar las reglas de imagen.", error);
      setMessage(productImageRulesStatus, `${error.message || "No se pudieron cargar las reglas."} Ejecuta supabase-product-image-rules.sql en SQL Editor.`);
    });
    loadCourierCompensation().catch((error) => {
      console.error("No se pudieron cargar los saldos de delivery.", error);
      setMessage(courierPaymentsStatus, `${error.message || "No se pudieron cargar los saldos."} Ejecuta supabase-courier-payments.sql en Supabase SQL Editor.`);
    });
    loadDailyStock().catch((error) => {
      console.error("No se pudo cargar el resumen diario de stock.", error);
      setMessage(dailyStockStatus, `${error.message || "No se pudo cargar el resumen."} Ejecuta supabase-inventory-stock-tracking.sql en Supabase SQL Editor.`);
    });
    loadSalesSummary().catch((error) => {
      console.error("No se pudieron cargar las métricas de ventas.", error);
      setMessage(dashboardStatus, `No se pudieron cargar las métricas: ${error.message || "error de conexión"}`);
    });
    window.dispatchEvent(new CustomEvent("kristal:admin-ready"));
  }
  if (staffPage === "cashier") await initializeAdminOrders();
}

function resetProductForm() {
  productForm.reset();
  document.querySelector("#product-available").checked = true;
  editingProduct = null;
  formHeading.textContent = "Agregar producto";
  saveButton.textContent = "Guardar producto";
  cancelEditButton.hidden = true;
  imageInput.required = true;
  document.querySelector("#product-form-details").open = false;
}

function beginEditing(product) {
  document.querySelector("#product-form-details").open = true;
  editingProduct = product;
  productForm.elements.nombre.value = product.nombre;
  const productCategory = Array.isArray(product.categorias) ? product.categorias[0] : product.categorias;
  const departmentName = window.getKristalProductDepartment(product.nombre, productCategory?.departamento);
  const department = categories.find((category) => category.nombre === departmentName);
  productForm.elements.categoria_id.value = department?.id || "";
  productForm.elements.presentacion.value = product.presentacion || "";
  productForm.elements.codigo_barras.value = product.codigo_barras || "";
  productForm.elements.stock.value = product.stock_tracked ? product.stock ?? "" : "";
  productForm.elements.precio.value = product.precio;
  productForm.elements.precio_ves.value = product.precio_ves ?? "";
  productForm.elements.precio_oferta.value = product.precio_oferta ?? "";
  productForm.elements.es_oferta_dia.checked = Boolean(product.es_oferta_dia);
  const dailyDealEnd = product.oferta_dia_hasta ? new Date(product.oferta_dia_hasta) : null;
  productForm.elements.oferta_dia_hasta.value = dailyDealEnd && Number.isFinite(dailyDealEnd.getTime())
    ? new Date(dailyDealEnd.getTime() - dailyDealEnd.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : "";
  productForm.elements.es_destacado.checked = product.es_destacado;
  productForm.elements.disponible.checked = product.disponible;
  imageInput.value = "";
  imageInput.required = false;
  formHeading.textContent = "Editar producto";
  saveButton.textContent = "Guardar cambios";
  cancelEditButton.hidden = false;
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadProductImage(file) {
  const extensionByType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  if (!extensionByType[file.type] || file.size > 5 * 1024 * 1024) {
    throw new Error("La foto debe ser PNG, JPG o WebP y no superar 5 MB.");
  }

  const path = `${crypto.randomUUID()}.${extensionByType[file.type]}`;
  const { error } = await supabaseClient.storage.from("product-images").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabaseClient.storage.from("product-images").getPublicUrl(path);
  return { path, url: data.publicUrl };
}

async function loadProductImageRules() {
  const { data, error } = await supabaseClient
    .from("product_image_rules")
    .select("id,keywords,image_url,image_path")
    .order("created_at", { ascending: false });
  if (error) throw error;
  productImageRules = data || [];
  productImageRulesList.innerHTML = productImageRules.map((rule) => `<article class="product-image-rule">
    <img src="${escapeHtml(rule.image_url)}" alt="" loading="lazy" />
    <div><strong>${escapeHtml((rule.keywords || []).join(" · "))}</strong><small>La frase más específica tiene prioridad al importar.</small></div>
    <button class="delete-button" type="button" data-delete-image-rule="${escapeHtml(rule.id)}">Eliminar regla</button>
  </article>`).join("");
  if (productImageRulesStatus) productImageRulesStatus.textContent = "";
}

async function saveProductImageRule(event) {
  event.preventDefault();
  if (!productImageRulesForm || !productImageRuleFile || !saveProductImageRuleButton) return;
  saveProductImageRuleButton.disabled = true;
  setMessage(productImageRulesStatus, "Subiendo foto y guardando regla…");
  let uploadedPath = null;
  let ruleSaved = false;
  try {
    const formData = new FormData(productImageRulesForm);
    const keywords = [...new Set(String(formData.get("keywords") || "")
      .split(/\r?\n/)
      .map((phrase) => phrase.trim())
      .filter(Boolean))];
    if (!keywords.length || keywords.some((phrase) => phrase.length > 80)) {
      throw new Error("Escribe al menos una frase clave y limita cada frase a 80 caracteres.");
    }
    const imageFile = productImageRuleFile.files[0];
    if (!imageFile) throw new Error("Selecciona la foto que corresponde a esas palabras clave.");
    const uploadedImage = await uploadProductImage(imageFile);
    uploadedPath = uploadedImage.path;
    const { error } = await supabaseClient.from("product_image_rules").insert({
      keywords,
      image_url: uploadedImage.url,
      image_path: uploadedImage.path,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    ruleSaved = true;
    productImageRulesForm.reset();
    await loadProductImageRules();
    setMessage(productImageRulesStatus, "Foto y palabras clave guardadas. Se usarán en la próxima importación.", true);
  } catch (error) {
    if (uploadedPath && !ruleSaved) {
      try {
        const { error: cleanupError } = await supabaseClient.storage.from("product-images").remove([uploadedPath]);
        if (cleanupError) throw cleanupError;
      } catch (cleanupError) {
        console.error("No se pudo limpiar la foto de una regla que no llegó a guardarse.", cleanupError);
      }
    }
    console.error("No se pudo guardar la regla de imagen.", error);
    setMessage(productImageRulesStatus, ruleSaved
      ? `La regla se guardó, pero no se pudo actualizar la lista: ${error.message || "error desconocido"}. Pulsa “Actualizar reglas”.`
      : error.message || "No se pudo guardar la regla de imagen.");
  } finally {
    saveProductImageRuleButton.disabled = false;
  }
}

async function deleteProductImageRule(ruleId, button) {
  if (!ruleId) return;
  button.disabled = true;
  setMessage(productImageRulesStatus, "Eliminando regla…");
  try {
    const { error } = await supabaseClient.from("product_image_rules").delete().eq("id", ruleId);
    if (error) throw error;
    await loadProductImageRules();
    setMessage(productImageRulesStatus, "Regla eliminada. Las fotos ya asignadas a productos no cambian.", true);
  } catch (error) {
    console.error("No se pudo eliminar la regla de imagen.", error);
    setMessage(productImageRulesStatus, error.message || "No se pudo eliminar la regla.");
    button.disabled = false;
  }
}

async function saveProduct(event) {
  event.preventDefault();
  setMessage(dashboardStatus, "");
  saveButton.disabled = true;
  saveButton.textContent = "Guardando…";

  let uploadedPath = null;
  let imageCleanupWarning = "";
  let productSaved = false;
  try {
    const formData = new FormData(productForm);
    const imageFile = imageInput.files[0];
    let imageUrl = editingProduct?.imagen_url || "";
    let imagePath = editingProduct?.imagen_path || null;

    if (imageFile) {
      const upload = await uploadProductImage(imageFile);
      imageUrl = upload.url;
      imagePath = upload.path;
      uploadedPath = upload.path;
    }
    if (!imageUrl) throw new Error("Selecciona una foto para el producto.");

    const regularPrice = Number(formData.get("precio"));
    const salePriceText = String(formData.get("precio_oferta") || "").trim();
    const salePrice = salePriceText ? Number(salePriceText) : null;
    const isDailyDeal = formData.has("es_oferta_dia");
    const dailyDealEndText = String(formData.get("oferta_dia_hasta") || "").trim();
    const dailyDealEnd = dailyDealEndText ? new Date(dailyDealEndText) : null;
    const stockText = String(formData.get("stock") || "").trim();
    const inventoryStock = stockText ? Number(stockText) : null;
    const vesPriceText = String(formData.get("precio_ves") || "").trim();
    const vesPrice = vesPriceText ? Number(vesPriceText) : null;
    if ((inventoryStock !== null && (!Number.isFinite(inventoryStock) || inventoryStock < 0))
      || (vesPrice !== null && (!Number.isFinite(vesPrice) || vesPrice < 0))) {
      throw new Error("El stock y el precio de referencia en VES deben ser valores válidos y no negativos.");
    }
    if (!Number.isFinite(regularPrice) || regularPrice <= 0 || (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= regularPrice))) {
      throw new Error("El precio de oferta debe ser mayor que cero y menor que el precio regular.");
    }
    if (isDailyDeal && (salePrice === null || !dailyDealEnd || !Number.isFinite(dailyDealEnd.getTime()) || dailyDealEnd <= new Date())) {
      throw new Error("Una Oferta del Día necesita un precio de descuento y una fecha/hora futura de finalización.");
    }
    if (isDailyDeal && !dailyDealColumnsAvailable) {
      throw new Error("Ejecuta supabase-marketing.sql en Supabase para habilitar las Ofertas del Día.");
    }

    const product = {
      nombre: String(formData.get("nombre")).trim(),
      categoria_id: String(formData.get("categoria_id")),
      presentacion: String(formData.get("presentacion") || "").trim() || null,
      codigo_barras: String(formData.get("codigo_barras") || "").trim() || null,
      stock: inventoryStock,
      stock_tracked: inventoryStock !== null,
      precio: regularPrice,
      precio_ves: vesPrice,
      precio_oferta: salePrice,
      ...(dailyDealColumnsAvailable ? {
        es_oferta_dia: isDailyDeal,
        oferta_dia_hasta: isDailyDeal ? dailyDealEnd.toISOString() : null,
      } : {}),
      es_destacado: formData.has("es_destacado"),
      disponible: formData.has("disponible"),
      imagen_url: imageUrl,
      imagen_path: imagePath,
      updated_at: new Date().toISOString(),
    };
    const query = editingProduct
      ? supabaseClient.from("productos").update(product).eq("id", editingProduct.id)
      : supabaseClient.from("productos").insert(product);
    const { error } = await query;
    if (error) throw error;
    productSaved = true;

    const previousImagePath = editingProduct?.imagen_path;
    if (previousImagePath && imageFile && previousImagePath !== imagePath) {
      const { error: removeError } = await supabaseClient.storage.from("product-images").remove([previousImagePath]);
      if (removeError) {
        console.error("El producto se guardó, pero no se pudo limpiar su imagen anterior.", removeError);
        imageCleanupWarning = "Producto guardado, pero no se pudo borrar la foto anterior del almacenamiento.";
      }
    }

    resetProductForm();
    try {
      await loadInventory();
      setMessage(dashboardStatus, imageCleanupWarning || "Producto guardado correctamente.", !imageCleanupWarning);
    } catch (error) {
      console.error("El producto se guardó, pero no se pudo actualizar la lista.", error);
      setMessage(dashboardStatus, `Producto guardado, pero no se pudo actualizar el inventario: ${error.message}`);
    }
  } catch (error) {
    if (productSaved) {
      console.error("El producto se guardó, pero falló una operación posterior.", error);
      setMessage(dashboardStatus, `Producto guardado, pero no se completó toda la operación: ${error.message}`);
    } else {
      if (uploadedPath) {
        try {
          const { error: cleanupError } = await supabaseClient.storage.from("product-images").remove([uploadedPath]);
          if (cleanupError) throw cleanupError;
        } catch (cleanupError) {
          console.error("No se pudo limpiar la foto de un producto que no llegó a guardarse.", cleanupError);
          imageCleanupWarning = " No se pudo retirar la imagen subida; elimínala desde Storage.";
        }
      }
      console.error("No se pudo guardar el producto.", error);
      setMessage(dashboardStatus, `${error.message || "No se pudo guardar el producto."}${imageCleanupWarning}`);
    }
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = editingProduct ? "Guardar cambios" : "Guardar producto";
  }
}

async function handleInventoryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const productId = button.dataset.id;

  try {
    let request = supabaseClient
      .from("productos")
      .select("id,nombre,codigo_barras,stock,stock_tracked,precio_ves,categoria_id,precio,precio_oferta,es_destacado,es_oferta_dia,oferta_dia_hasta,disponible,imagen_url,imagen_path,presentacion,categorias(nombre,departamento)")
      .eq("id", productId)
      .single();
    let { data, error } = await request;
    if (error && isMissingDailyDealColumns(error)) {
      dailyDealColumnsAvailable = false;
      request = supabaseClient
        .from("productos")
        .select("id,nombre,codigo_barras,stock,stock_tracked,precio_ves,categoria_id,precio,precio_oferta,es_destacado,disponible,imagen_url,imagen_path,presentacion,categorias(nombre,departamento)")
        .eq("id", productId)
        .single();
      ({ data, error } = await request);
    }
    if (error) throw error;

    if (button.dataset.action === "edit") {
      beginEditing(data);
      return;
    }
    if (button.dataset.action === "toggle") {
      const { error: updateError } = await supabaseClient
        .from("productos")
        .update({ disponible: !data.disponible, updated_at: new Date().toISOString() })
        .eq("id", productId);
      if (updateError) throw updateError;
      await loadInventory();
      return;
    }
    if (button.dataset.action === "delete") {
      if (!window.confirm(`¿Archivar "${data.nombre}"? Dejará de aparecer en la tienda y quedará disponible en el historial para restaurarlo.`)) return;
      const { error: archiveError } = await supabaseClient.rpc("archive_store_product", { p_product_id: productId });
      if (archiveError) throw archiveError;
      await loadInventory();
      await loadDeletedProducts();
    }
  } catch (error) {
    console.error("No se pudo completar la acción del inventario.", error);
    setMessage(dashboardStatus, error.message || "No se pudo completar la acción.");
  }
}

async function archiveAllInventory() {
  if (!archiveAllProductsButton || archiveAllProductsButton.disabled) return;
  archiveAllProductsButton.disabled = true;
  let archivedCount = 0;

  try {
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("La sesión de administración expiró. Inicia sesión de nuevo.");

    const productIds = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabaseClient
        .from("productos")
        .select("id")
        .is("deleted_at", null)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      productIds.push(...data.map((product) => product.id));
      if (data.length < pageSize) break;
    }

    if (!productIds.length) {
      setMessage(dashboardStatus, "No hay productos activos para archivar.", true);
      return;
    }

    const confirmed = window.confirm(
      `Vas a archivar ${productIds.length} productos del inventario. Dejarán de aparecer en la tienda, pero podrás restaurarlos desde “Productos eliminados”. Los pedidos e imágenes se conservarán. ¿Deseas continuar?`,
    );
    if (!confirmed) return;

    const archivedAt = new Date().toISOString();
    const batchSize = 200;
    for (let offset = 0; offset < productIds.length; offset += batchSize) {
      const batch = productIds.slice(offset, offset + batchSize);
      const { data, error } = await supabaseClient
        .from("productos")
        .update({
          deleted_at: archivedAt,
          deleted_by: user.id,
          disponible: false,
          es_destacado: false,
          updated_at: archivedAt,
        })
        .in("id", batch)
        .is("deleted_at", null)
        .select("id");
      if (error) throw error;
      archivedCount += data.length;
      if (data.length !== batch.length) {
        throw new Error(`Supabase solo confirmó ${archivedCount} de ${productIds.length} productos. Actualiza las listas antes de continuar.`);
      }
      setMessage(dashboardStatus, `Archivando inventario: ${archivedCount} de ${productIds.length} productos…`);
    }

    await Promise.all([loadInventory(), loadDeletedProducts()]);
    setMessage(dashboardStatus, `Se archivaron ${archivedCount} productos. Puedes restaurarlos desde “Productos eliminados”.`, true);
  } catch (error) {
    console.error("No se pudo archivar todo el inventario.", error);
    let refreshMessage = "";
    if (archivedCount) {
      try {
        await Promise.all([loadInventory(), loadDeletedProducts()]);
      } catch (refreshError) {
        console.error("No se pudieron actualizar las listas después del archivado parcial.", refreshError);
        refreshMessage = " No se pudieron actualizar las listas; usa los botones de actualización.";
      }
    }
    const partialMessage = archivedCount
      ? `Se archivaron ${archivedCount} productos antes del error. `
      : "";
    setMessage(dashboardStatus, `${partialMessage}${error.message || "No se pudo archivar el inventario."}${refreshMessage}`);
  } finally {
    archiveAllProductsButton.disabled = false;
  }
}

async function restoreDeletedProduct(productId, button) {
  if (!productId) {
    setMessage(dashboardStatus, "No se pudo identificar el producto que quieres restaurar.");
    return;
  }
  if (button) button.disabled = true;
  setMessage(dashboardStatus, "Restaurando producto…");
  try {
    const { data, error } = await supabaseClient
      .from("productos")
      .update({ deleted_at: null, deleted_by: null, disponible: false, es_destacado: false, updated_at: new Date().toISOString() })
      .eq("id", productId)
      .not("deleted_at", "is", null)
      .select("id")
      .single();
    if (error) throw error;
    if (!data?.id) throw new Error("Supabase no confirmó la restauración del producto.");
    await Promise.all([loadInventory(), loadDeletedProducts()]);
    setMessage(dashboardStatus, "Producto restaurado como no disponible. Actívalo en el inventario cuando esté listo.", true);
  } catch (error) {
    console.error("No se pudo restaurar el producto archivado.", error);
    setMessage(dashboardStatus, error.message || "No se pudo restaurar el producto. Verifica los permisos y vuelve a intentarlo.");
  } finally {
    if (button) button.disabled = false;
  }
}

async function purgeDeletedProducts() {
  if (!purgeDeletedProductsButton || purgeDeletedProductsButton.disabled) return;
  const confirmed = window.confirm(
    "Esta acción eliminará permanentemente todos los productos archivados. No podrás restaurarlos. ¿Deseas vaciar la papelera?",
  );
  if (!confirmed) return;

  purgeDeletedProductsButton.disabled = true;
  setMessage(deletedProductsStatus, "Eliminando permanentemente los productos archivados…");
  try {
    const { data, error } = await supabaseClient.rpc("purge_deleted_store_products");
    if (error) throw error;
    if (!Number.isInteger(data) || data < 0) {
      throw new Error("Supabase no confirmó cuántos productos fueron eliminados.");
    }
    await loadDeletedProducts();
    setMessage(
      deletedProductsStatus,
      data === 0 ? "La papelera ya estaba vacía." : `Se eliminaron permanentemente ${data} productos.`,
      true,
    );
  } catch (error) {
    console.error("No se pudo vaciar la papelera de productos.", error);
    setMessage(
      deletedProductsStatus,
      error.message || "No se pudo vaciar la papelera. Verifica la migración SQL y vuelve a intentarlo.",
    );
    purgeDeletedProductsButton.disabled = false;
  }
}

async function initializeAdmin() {
  if (!supabaseClient) {
    setMessage(authStatus, "Configura la URL y la clave pública de Supabase en supabase-config.js.");
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!data.session) return;
    await enterStaffDashboard(data.session);
  } catch (error) {
    console.error("No se pudo abrir el panel de administración.", error);
    setAuthenticatedView(false);
    setMessage(authStatus, error.message || "No se pudo validar tu acceso.");
  }
}

productForm?.addEventListener("submit", saveProduct);
documentSearchForm?.addEventListener("submit", searchPickupByDocument);
documentSearchResults?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-complete-pickup-order]");
  if (!button) return;
  completePickup("complete_store_pickup_by_document", {
    p_document: documentSearchForm.elements.document.value.trim(),
    p_order_id: button.dataset.completePickupOrder,
  }, button);
});
window.addEventListener("kristal:inventory-imported", () => {
  loadInventory().catch((error) => {
    console.error("La importación terminó, pero no se pudo refrescar el inventario.", error);
    setMessage(dashboardStatus, error.message || "Inventario importado; actualiza la lista para ver los cambios.");
  });
});
inventoryRows?.addEventListener("click", handleInventoryAction);
inventorySearch?.addEventListener("input", renderInventory);
productImageRulesForm?.addEventListener("submit", saveProductImageRule);
productImageRulesList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-image-rule]");
  if (button) deleteProductImageRule(button.dataset.deleteImageRule, button);
});
document.querySelector("#refresh-product-image-rules-button")?.addEventListener("click", () => {
  loadProductImageRules().catch((error) => {
    console.error("No se pudieron actualizar las reglas de imagen.", error);
    setMessage(productImageRulesStatus, `${error.message || "No se pudieron actualizar las reglas."} Ejecuta supabase-product-image-rules.sql en SQL Editor.`);
  });
});
archiveAllProductsButton?.addEventListener("click", archiveAllInventory);
deletedProductRows?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-restore-product]");
  if (button) restoreDeletedProduct(button.dataset.restoreProduct, button);
});
purgeDeletedProductsButton?.addEventListener("click", purgeDeletedProducts);
cancelEditButton?.addEventListener("click", resetProductForm);
staffRoleForm?.addEventListener("submit", setStaffRole);
document.querySelector("#admin-dashboard-view-switcher")?.addEventListener("change", (event) => {
  const destination = event.currentTarget.value;
  if (destination) window.location.assign(destination);
});
document.querySelector("#refresh-button")?.addEventListener("click", () => {
  loadInventory().catch((error) => {
    console.error("No se pudo actualizar la lista del inventario.", error);
    setMessage(dashboardStatus, error.message || "No se pudo actualizar el inventario.");
  });
});
startStockDayButton?.addEventListener("click", startDailyStock);
document.querySelector("#refresh-stock-day-button")?.addEventListener("click", () => {
  loadDailyStock().catch((error) => {
    console.error("No se pudo actualizar el resumen diario de stock.", error);
    setMessage(dailyStockStatus, error.message || "No se pudo actualizar el resumen.");
  });
});
refreshCourierPaymentsButton?.addEventListener("click", () => {
  loadCourierCompensation().catch((error) => {
    console.error("No se pudieron actualizar los saldos de delivery.", error);
    setMessage(courierPaymentsStatus, error.message || "No se pudieron actualizar los saldos.");
  });
});
courierBalanceRows?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-settle-courier]");
  if (button) settleCourierBalance(button);
});
document.querySelector("#refresh-deleted-products-button")?.addEventListener("click", () => {
  loadDeletedProducts().catch((error) => {
    console.error("No se pudo actualizar el historial de productos eliminados.", error);
    setMessage(dashboardStatus, error.message || "No se pudo actualizar el historial.");
  });
});
document.querySelector("#refresh-orders-button")?.addEventListener("click", () => {
  loadAdminOrders().catch((error) => {
    console.error("No se pudo actualizar la bandeja de pedidos.", error);
    setMessage(adminOrdersStatus, error.message || "No se pudo actualizar la bandeja.", false);
  });
});
adminOrdersList?.addEventListener("click", handleAdminOrderAction);
cashierQueueLists.forEach((list) => list.addEventListener("click", handleAdminOrderAction));
document.querySelector("#sign-out-button")?.addEventListener("click", async () => {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    if (adminOrdersChannel) {
      await supabaseClient.removeChannel(adminOrdersChannel);
      adminOrdersChannel = null;
    }
    setAuthenticatedView(false);
    staffRole = "";
  } catch (error) {
    console.error("No se pudo cerrar la sesión administrativa.", error);
    setMessage(dashboardStatus, error.message || "No se pudo cerrar sesión.");
  }
});

initializeAdmin();
