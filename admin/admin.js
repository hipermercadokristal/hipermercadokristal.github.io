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
let adminOrdersChannel = null;
let staffRole = "";
imageInput.required = true;

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
  authSection.hidden = isAuthenticated;
  dashboardSection.hidden = !isAuthenticated;
}

function getInventoryImageUrl(url) {
  return url.startsWith("assets/") ? `../${url}` : url;
}

async function requireStaff(session) {
  const role = session?.user?.app_metadata?.role;
  if (!["admin", "courier"].includes(role)) {
    await supabaseClient.auth.signOut();
    throw new Error("Esta cuenta no tiene permisos de caja ni de reparto. Solicita al propietario que asigne el rol correspondiente.");
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

const orderStatusLabels = {
  received: "Recibido",
  preparing: "En preparación",
  ready: "Listo para retirar",
  delivering: "En delivery",
  delivered: "Entregado",
  cancelled: "Cancelado",
};
const paymentStatusLabels = {
  pending_verification: "Pendiente de verificar Pago Móvil",
  awaiting_instructions: "Pendiente de instrucciones Zelle",
  awaiting_in_store: "Pago pendiente al retirar",
  awaiting_delivery: "Pago pendiente al entregar",
  verified: "Pago recibido",
  rejected: "Pago rechazado",
};

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
    .select("id,user_id,customer_name,customer_phone,fulfillment,delivery_address,payment_method,payment_bank_code,payment_reference,payment_proof_path,payment_status,order_status,total_usd,total_ves,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  if (!orders.length) {
    adminOrdersList.replaceChildren();
    emptyOrders.hidden = false;
    setMessage(adminOrdersStatus, "No hay pedidos registrados.", true);
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
      ? `<div class="order-payment-actions"><button type="button" data-order-action="verify" data-id="${escapeHtml(order.id)}">Aprobar pago</button><button class="delete-button" type="button" data-order-action="reject" data-id="${escapeHtml(order.id)}">Rechazar pago</button></div>`
      : !["verified", "rejected"].includes(order.payment_status)
        ? `<div class="order-payment-actions"><button type="button" data-order-action="verify" data-id="${escapeHtml(order.id)}">${order.payment_method === "zelle" ? "Confirmar Zelle recibido" : "Confirmar efectivo/POS recibido"}</button></div>`
        : `<span class="order-payment-result">Pago: ${escapeHtml(paymentStatusLabels[order.payment_status] || order.payment_status)}</span>`;
    const availableStatuses = Object.entries(orderStatusLabels).filter(([value]) =>
      order.fulfillment === "delivery" || value !== "delivering",
    );
    const statusOptions = availableStatuses.map(([value, label]) => {
      const fulfillmentLabel = value === "ready" && order.fulfillment === "delivery" ? "Listo para enviar" : label;
      return `<option value="${value}"${order.order_status === value ? " selected" : ""}>${fulfillmentLabel}</option>`;
    }).join("");
    const date = new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at));
    return `<article class="admin-order-card" data-order-id="${escapeHtml(order.id)}">
      <header class="admin-order-heading"><div><span class="eyebrow">${escapeHtml(date)}</span><h3>Pedido ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h3></div><strong>${currency.format(Number(order.total_usd))}${order.total_ves === null ? "" : `<small>Bs. ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.total_ves))} · referencial</small>`}</strong></header>
      <p><strong>${escapeHtml(order.customer_name)}</strong> · ${escapeHtml(order.customer_phone)}</p>
      <p>${order.fulfillment === "delivery" ? `Delivery: ${escapeHtml(order.delivery_address || "")}` : "Retiro en tienda"} · Pago: ${escapeHtml(order.payment_method)}</p>
      ${order.payment_method === "mobile_payment" ? `<p>Banco: ${escapeHtml(order.payment_bank_code || "—")} · Referencia: ${escapeHtml(order.payment_reference || "—")}</p>` : ""}
      <ul class="admin-order-items">${orderItems.map((item) => `<li>${escapeHtml(item.product_name)} × ${item.quantity} <span>${currency.format(Number(item.line_total_usd))}</span></li>`).join("")}</ul>
      <div class="admin-order-proof">${proofLink}${proofError ? `<span role="alert">${escapeHtml(proofError)}</span>` : ""}</div>
      ${paymentAction}
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
  const update = action === "verify"
    ? { payment_status: "verified" }
    : action === "reject"
      ? { payment_status: "rejected" }
      : { order_status: button.closest(".admin-order-card").querySelector("[data-order-status]").value };
  if (action === "verify") {
    const card = button.closest(".admin-order-card");
    const paymentText = card.querySelector(".admin-order-heading h3").textContent;
    const confirmationMessage = button.textContent === "Aprobar pago"
      ? `¿Verificaste el abono bancario de ${paymentText} y deseas aprobarlo?`
      : `¿Confirmas que recibiste el pago de ${paymentText}?`;
    if (!window.confirm(confirmationMessage)) return;
  }
  if (action === "reject" && !window.confirm("¿Confirmas que el comprobante no corresponde a un pago válido?")) return;

  button.disabled = true;
  setMessage(adminOrdersStatus, "Guardando cambios…");
  try {
    const { error } = await supabaseClient
      .from("store_orders")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", orderId);
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
    await loadAdminOrders();
    subscribeToAdminOrders();
  } catch (error) {
    console.error("No se pudo cargar la bandeja de pedidos.", error);
    setMessage(
      adminOrdersStatus,
      `No se pudo cargar la bandeja: ${error.message || "error de conexión"}. Verifica que supabase-orders.sql esté aplicado.`,
      false,
    );
  }
}

function setStaffView(role) {
  staffRole = role;
  setAuthenticatedView(true);
  const isAdmin = role === "admin";
  document.querySelector("#dashboard-heading").textContent = isAdmin ? "Inventario de productos" : "Operaciones de reparto";
  document.querySelector("#admin-product-form-panel").hidden = !isAdmin;
  document.querySelector("#admin-inventory-panel").hidden = !isAdmin;
  document.querySelector("#order-inbox-panel").hidden = !isAdmin;
  document.querySelector("#staff-scan-panel").hidden = false;
  document.querySelector("#staff-scan-heading").textContent = isAdmin ? "Validar ticket o entrega" : "Confirmar entrega";
  document.querySelector("#staff-scan-purpose").querySelector('option[value="pickup"]').hidden = !isAdmin;
  if (!isAdmin) document.querySelector("#staff-scan-purpose").value = "delivery";
}

async function processStaffScan(purpose, token) {
  const result = document.querySelector("#staff-scan-result");
  const status = document.querySelector("#staff-scan-status");
  if (!["pickup", "delivery"].includes(purpose) || !token) {
    setMessage(status, "El código QR no contiene un tipo o token válido.");
    return;
  }
  if (purpose === "pickup" && staffRole !== "admin") {
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
      if (staffRole === "admin") await loadAdminOrders();
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
    await initializeAdminOrders();
  }
  const scanParams = new URLSearchParams(location.hash.slice(1));
  if (scanParams.has("scan") || scanParams.has("token")) {
    const purpose = scanParams.get("scan");
    const token = scanParams.get("token");
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    document.querySelector("#staff-scan-purpose").value = purpose === "delivery" ? "delivery" : "pickup";
    document.querySelector("#staff-scan-token").value = token || "";
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
}

function beginEditing(product) {
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
      if (!window.confirm(`¿Eliminar "${data.nombre}" del inventario?`)) return;
      const { error: deleteError } = await supabaseClient.from("productos").delete().eq("id", productId);
      if (deleteError) throw deleteError;
      if (data.imagen_path) {
        const { error: imageError } = await supabaseClient.storage.from("product-images").remove([data.imagen_path]);
        if (imageError) {
          console.error("El producto se eliminó, pero no se pudo borrar su foto.", imageError);
          await loadInventory();
          setMessage(dashboardStatus, "Producto eliminado, pero no se pudo borrar su foto del almacenamiento.");
          return;
        }
      }
      await loadInventory();
    }
  } catch (error) {
    console.error("No se pudo completar la acción del inventario.", error);
    setMessage(dashboardStatus, error.message || "No se pudo completar la acción.");
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

productForm.addEventListener("submit", saveProduct);
document.querySelector("#staff-scan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  processStaffScan(event.currentTarget.elements.purpose.value, event.currentTarget.elements.token.value.trim());
});
inventoryRows.addEventListener("click", handleInventoryAction);
cancelEditButton.addEventListener("click", resetProductForm);
document.querySelector("#refresh-button").addEventListener("click", () => {
  loadInventory().catch((error) => {
    console.error("No se pudo actualizar la lista del inventario.", error);
    setMessage(dashboardStatus, error.message || "No se pudo actualizar el inventario.");
  });
});
document.querySelector("#refresh-orders-button").addEventListener("click", () => {
  loadAdminOrders().catch((error) => {
    console.error("No se pudo actualizar la bandeja de pedidos.", error);
    setMessage(adminOrdersStatus, error.message || "No se pudo actualizar la bandeja.", false);
  });
});
adminOrdersList.addEventListener("click", handleAdminOrderAction);
document.querySelector("#sign-out-button").addEventListener("click", async () => {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    if (adminOrdersChannel) {
      await supabaseClient.removeChannel(adminOrdersChannel);
      adminOrdersChannel = null;
    }
    setAuthenticatedView(false);
    staffRole = "";
    document.querySelector("#staff-scan-result").replaceChildren();
    setMessage(document.querySelector("#staff-scan-status"), "");
    loginForm.reset();
  } catch (error) {
    console.error("No se pudo cerrar la sesión administrativa.", error);
    setMessage(dashboardStatus, error.message || "No se pudo cerrar sesión.");
  }
});

initializeAdmin();
