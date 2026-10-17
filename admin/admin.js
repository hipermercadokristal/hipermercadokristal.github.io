const supabaseClient = window.kristalSupabase;
const authSection = document.querySelector("#auth-section");
const dashboardSection = document.querySelector("#dashboard-section");
const loginForm = document.querySelector("#login-form");
const authStatus = document.querySelector("#auth-status");
const dashboardStatus = document.querySelector("#dashboard-status");
const productForm = document.querySelector("#product-form");
const categorySelect = document.querySelector("#product-category");
const inventoryRows = document.querySelector("#inventory-rows");
const emptyInventory = document.querySelector("#empty-inventory");
const imageInput = document.querySelector("#product-image");
const saveButton = document.querySelector("#save-product-button");
const formHeading = document.querySelector("#product-form-heading");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const adminOrdersList = document.querySelector("#admin-orders-list");
const adminOrdersStatus = document.querySelector("#orders-admin-status");
const emptyOrders = document.querySelector("#empty-orders");
const staffPage = document.querySelector("[data-staff-page]")?.dataset.staffPage || "admin";
const deletedProductRows = document.querySelector("#deleted-product-rows");
const emptyDeletedProducts = document.querySelector("#empty-deleted-products");
const staffRoleForm = document.querySelector("#staff-role-form");
const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
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
let missingDepartments = [];
let deliveryCouriers = [];
let adminOrdersChannel = null;
let staffRole = "";
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
  if (staffPage === "cashier" && role === "admin") {
    window.location.replace("/admin/");
    throw new Error("Abriendo la administración…");
  }
  const allowed = staffPage === "cashier" ? role === "operator" : role === "admin";
  if (!allowed) {
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

async function loadInventory() {
  setMessage(dashboardStatus, "Cargando inventario…");
  const { data, error } = await supabaseClient
    .from("productos")
    .select("id,nombre,categoria_id,precio,precio_oferta,es_destacado,disponible,imagen_url,imagen_path,presentacion,categorias(nombre,departamento)")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  inventoryRows.innerHTML = data.map((product) => {
    const category = Array.isArray(product.categorias) ? product.categorias[0] : product.categorias;
    return `<tr>
      <td data-label="Producto"><div class="inventory-product"><img src="${escapeHtml(getInventoryImageUrl(product.imagen_url))}" alt="" loading="lazy" /><span>${escapeHtml(product.nombre)}${product.es_destacado ? " · Destacado" : ""}</span></div></td>
      <td data-label="Departamento">${escapeHtml(category?.departamento || "Sin departamento")}</td>
      <td data-label="Precio">${currency.format(Number(product.precio))}</td>
      <td data-label="Oferta">${product.precio_oferta === null ? "—" : currency.format(Number(product.precio_oferta))}</td>
      <td data-label="Estado"><span class="stock-label${product.disponible ? "" : " unavailable"}">${product.disponible ? "Disponible" : "Agotado"}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button type="button" data-action="edit" data-id="${escapeHtml(product.id)}">Editar</button>
        <button type="button" data-action="toggle" data-id="${escapeHtml(product.id)}">${product.disponible ? "Ocultar" : "Publicar"}</button>
        <button class="delete-button" type="button" data-action="delete" data-id="${escapeHtml(product.id)}">Eliminar</button>
      </div></td>
    </tr>`;
  }).join("");
  emptyInventory.hidden = data.length > 0;
  const inventoryMessage = `${data.length} ${data.length === 1 ? "producto" : "productos"} en inventario.`;
  setMessage(
    dashboardStatus,
    missingDepartments.length
      ? `Faltan departamentos en Supabase: ${missingDepartments.join(", ")}. Ejecuta supabase-departamentos.sql desde SQL Editor. ${inventoryMessage}`
      : inventoryMessage,
    missingDepartments.length === 0,
  );
  return data;
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

async function loadDeliveryCouriers() {
  const { data, error } = await supabaseClient.rpc("list_delivery_couriers");
  if (error) throw error;
  deliveryCouriers = data || [];
}

function buildWhatsAppOrderLink(order, items) {
  const lines = [
    `Pedido ${order.id}`,
    `Cliente: ${order.customer_name} · ${order.customer_phone}`,
    `Entrega: ${order.fulfillment === "delivery" ? `Delivery — ${order.delivery_address || ""}` : "Retiro en tienda"}`,
    `Pago: ${order.payment_method} · ${order.payment_status}`,
    `Total: ${currency.format(Number(order.total_usd))}`,
    ...(order.total_ves === null ? [] : [`Equivalente referencial: Bs. ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.total_ves))}`]),
    ...items.map((item) => `• ${item.product_name} × ${item.quantity}`),
  ];
  return `https://wa.me/584128867088?text=${encodeURIComponent(lines.join("\n"))}`;
}

async function loadAdminOrders() {
  setMessage(adminOrdersStatus, "Cargando pedidos…");
  const { data: orders, error } = await supabaseClient
    .from("store_orders")
    .select("id,user_id,assigned_courier_id,customer_name,customer_phone,fulfillment,delivery_address,payment_method,payment_bank_code,payment_reference,payment_proof_path,payment_status,order_status,total_usd,total_ves,created_at")
    .not("order_status", "in", "(delivered,cancelled)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  if (!orders.length) {
    adminOrdersList.replaceChildren();
    emptyOrders.hidden = false;
    setMessage(adminOrdersStatus, "No hay pedidos abiertos en la bandeja.", true);
    return;
  }
  emptyOrders.hidden = true;
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
    const paymentAction = order.payment_method === "mobile_payment" && order.payment_status === "pending_verification"
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
            ${deliveryCouriers.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === order.assigned_courier_id ? " selected" : ""}>${escapeHtml(item.full_name)}${item.phone ? ` · ${escapeHtml(item.phone)}` : ""}</option>`).join("")}
          </select></label>
          <button type="button" data-order-action="assign" data-id="${escapeHtml(order.id)}"${deliveryCouriers.length ? "" : " disabled"}>${order.order_status === "delivering" ? "Reasignar delivery" : "Asignar y enviar"}</button>
          ${courier ? `<span>Asignado a ${escapeHtml(courier.full_name)}</span>` : ""}
          ${deliveryCouriers.length ? "" : "<span>No hay cuentas activas con rol de repartidor.</span>"}
        </div>`
      : "";
    const date = new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at));
    return `<article class="admin-order-card" data-order-id="${escapeHtml(order.id)}">
      <header class="admin-order-heading"><div><span class="eyebrow">${escapeHtml(date)}</span><h3>Pedido ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h3></div><strong>${currency.format(Number(order.total_usd))}${order.total_ves === null ? "" : `<small>Bs. ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.total_ves))} · referencial</small>`}</strong></header>
      <p><strong>${escapeHtml(order.customer_name)}</strong> · ${escapeHtml(order.customer_phone)}</p>
      <p>${order.fulfillment === "delivery" ? `Delivery: ${escapeHtml(order.delivery_address || "")}` : "Retiro en tienda"} · Pago: ${escapeHtml(order.payment_method)}</p>
      ${order.payment_method === "mobile_payment" ? `<p>Banco: ${escapeHtml(order.payment_bank_code || "—")} · Referencia: ${escapeHtml(order.payment_reference || "—")}</p>` : ""}
      <ul class="admin-order-items">${orderItems.map((item) => `<li>${escapeHtml(item.product_name)} × ${item.quantity} <span>${currency.format(Number(item.line_total_usd))}</span></li>`).join("")}</ul>
      <div class="admin-order-proof">${proofLink}${proofError ? `<span role="alert">${escapeHtml(proofError)}</span>` : ""}</div>
      <div class="order-payment-state${order.payment_status === "verified" ? " verified" : ""}">${order.payment_status === "verified" ? "Pagado" : escapeHtml(paymentStatusLabels[order.payment_status] || "Estado de pago pendiente")}</div>
      ${paymentAction}
      ${assignmentControls}
      <div class="admin-order-status-controls"><label>Estado del pedido<select data-order-status>${statusOptions}</select></label><button type="button" data-order-action="status" data-id="${escapeHtml(order.id)}">Guardar estado</button></div>
      <a class="order-whatsapp-link" href="${buildWhatsAppOrderLink(order, orderItems)}" target="_blank" rel="noopener noreferrer">Preparar aviso por WhatsApp</a>
    </article>`;
  }));
  adminOrdersList.innerHTML = orderCards.join("");
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
  const scanHeading = document.querySelector("#staff-scan-heading");
  if (scanHeading) scanHeading.textContent = "Validar ticket de retiro";
  const scanPurpose = document.querySelector("#staff-scan-purpose");
  if (scanPurpose) scanPurpose.value = "pickup";
}

async function processStaffScan(purpose, token) {
  const result = document.querySelector("#staff-scan-result");
  const status = document.querySelector("#staff-scan-status");
  if (!["pickup", "delivery"].includes(purpose) || !token) {
    setMessage(status, "El código QR no contiene un tipo o token válido.");
    return;
  }
  if (purpose === "pickup" && staffRole !== "operator") {
    setMessage(status, "Solo caja puede validar tickets de retiro.");
    return;
  }

  result.replaceChildren();
  setMessage(status, "Validando código con Supabase…");
  try {
    if (purpose === "delivery") {
      const { data: orderId, error } = await supabaseClient.rpc("complete_delivery_by_qr", { p_token: token });
      if (error) throw error;
      setMessage(status, `Entrega confirmada. Pedido ${String(orderId).slice(0, 8).toUpperCase()} marcado como entregado.`, true);
      if (staffRole === "admin" || staffRole === "operator") await loadAdminOrders();
    } else {
      const { data, error } = await supabaseClient.rpc("scan_store_pickup_ticket", { p_token: token });
      if (error) throw error;
      const items = Array.isArray(data.items) ? data.items : [];
      result.innerHTML = `<article class="scanned-pickup-ticket">
        <h3>Pedido ${escapeHtml(String(data.id).slice(0, 8).toUpperCase())}</h3>
        <p><strong>${escapeHtml(data.customer_name)}</strong> · ${escapeHtml(data.customer_phone)}</p>
        <ul>${items.map((item) => `<li>${escapeHtml(item.product_name)} × ${Number(item.quantity)}</li>`).join("")}</ul>
        <p>Total: <strong>${currency.format(Number(data.total_usd))}</strong></p>
        <p>Pago pendiente: cobra y confirma el pago desde la bandeja de pedidos.</p>
      </article>`;
      setMessage(status, "Ticket de retiro válido. Comprueba los artículos y registra el cobro en caja.", true);
    }
  } catch (error) {
    console.error("No se pudo validar el código del pedido.", error);
    setMessage(status, error.message || "No se pudo validar el código. Revisa el estado del pedido e inténtalo de nuevo.");
  }
}

async function enterStaffDashboard(session) {
  const role = await requireStaff(session);
  setStaffView(role);
  if (role === "admin") {
    await loadCategories();
    await loadInventory();
    await loadDeletedProducts();
  }
  if (staffPage === "cashier") await initializeAdminOrders();
  const scanParams = new URLSearchParams(location.hash.slice(1));
  if (scanParams.has("scan") || scanParams.has("token")) {
    const purpose = scanParams.get("scan");
    const token = scanParams.get("token");
    if (purpose === "delivery") {
      window.location.replace(`/delivery/${location.hash}`);
      return;
    }
    if (staffPage !== "cashier") return;
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    const scanPurpose = document.querySelector("#staff-scan-purpose");
    if (scanPurpose) scanPurpose.value = "pickup";
    const scanToken = document.querySelector("#staff-scan-token");
    if (scanToken) scanToken.value = token || "";
    await processStaffScan(purpose, token);
  }
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
  const department = categories.find((category) => category.nombre === productCategory?.departamento);
  productForm.elements.categoria_id.value = department?.id || "";
  productForm.elements.presentacion.value = product.presentacion || "";
  productForm.elements.precio.value = product.precio;
  productForm.elements.precio_oferta.value = product.precio_oferta ?? "";
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
    if (!Number.isFinite(regularPrice) || regularPrice <= 0 || (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= regularPrice))) {
      throw new Error("El precio de oferta debe ser mayor que cero y menor que el precio regular.");
    }

    const product = {
      nombre: String(formData.get("nombre")).trim(),
      categoria_id: String(formData.get("categoria_id")),
      presentacion: String(formData.get("presentacion") || "").trim() || null,
      precio: regularPrice,
      precio_oferta: salePrice,
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
    const { data, error } = await supabaseClient
      .from("productos")
      .select("id,nombre,categoria_id,precio,precio_oferta,es_destacado,disponible,imagen_url,imagen_path,presentacion,categorias(nombre,departamento)")
      .eq("id", productId)
      .single();
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

  async function restoreDeletedProduct(productId) {
    try {
      const { error } = await supabaseClient
        .from("productos")
        .update({ deleted_at: null, deleted_by: null, disponible: false, updated_at: new Date().toISOString() })
        .eq("id", productId);
      if (error) throw error;
      await Promise.all([loadInventory(), loadDeletedProducts()]);
      setMessage(dashboardStatus, "Producto restaurado como no disponible. Actívalo en el inventario cuando esté listo.", true);
    } catch (error) {
      console.error("No se pudo restaurar el producto archivado.", error);
      setMessage(dashboardStatus, error.message || "No se pudo restaurar el producto.");
    }
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

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    setMessage(authStatus, "Configura Supabase antes de iniciar sesión.");
    return;
  }

  const submitButton = loginForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  setMessage(authStatus, "Validando acceso…");
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: loginForm.elements.email.value.trim(),
      password: loginForm.elements.password.value,
    });
    if (error) throw error;
    await enterStaffDashboard(data.session);
    setMessage(authStatus, "");
  } catch (error) {
    console.error("No se pudo iniciar sesión en el panel.", error);
    setAuthenticatedView(false);
    setMessage(authStatus, error.message || "No se pudo iniciar sesión.");
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#google-sign-in-button")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!supabaseClient) {
    setMessage(authStatus, "Configura Supabase antes de iniciar sesión.");
    return;
  }

  button.disabled = true;
  setMessage(authStatus, "Conectando con Google…");
  try {
    const redirectTo = new URL(window.location.pathname, window.location.origin).toString();
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
  } catch (error) {
    console.error("No se pudo iniciar sesión con Google.", error);
    setMessage(authStatus, error.message || "No se pudo iniciar sesión con Google.");
    button.disabled = false;
  }
});

productForm?.addEventListener("submit", saveProduct);
document.querySelector("#staff-scan-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  processStaffScan(event.currentTarget.elements.purpose.value, event.currentTarget.elements.token.value.trim());
});
inventoryRows?.addEventListener("click", handleInventoryAction);
deletedProductRows?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-restore-product]");
  if (button) restoreDeletedProduct(button.dataset.restoreProduct);
});
cancelEditButton?.addEventListener("click", resetProductForm);
staffRoleForm?.addEventListener("submit", setStaffRole);
document.querySelector("#refresh-button")?.addEventListener("click", () => {
  loadInventory().catch((error) => {
    console.error("No se pudo actualizar la lista del inventario.", error);
    setMessage(dashboardStatus, error.message || "No se pudo actualizar el inventario.");
  });
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
    document.querySelector("#staff-scan-result")?.replaceChildren();
    const scanStatus = document.querySelector("#staff-scan-status");
    if (scanStatus) setMessage(scanStatus, "");
    loginForm.reset();
  } catch (error) {
    console.error("No se pudo cerrar la sesión administrativa.", error);
    setMessage(dashboardStatus, error.message || "No se pudo cerrar sesión.");
  }
});

initializeAdmin();
