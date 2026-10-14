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
const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
let editingProduct = null;
let categories = [];
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

async function requireAdmin(session) {
  const role = session?.user?.app_metadata?.role;
  if (role !== "admin") {
    await supabaseClient.auth.signOut();
    throw new Error("Esta cuenta no tiene permisos de administrador. Solicita al propietario que asigne el rol admin.");
  }
}

async function loadCategories() {
  const { data, error } = await supabaseClient.from("categorias").select("id,nombre,departamento").order("nombre");
  if (error) throw error;
  categories = data;
  categorySelect.innerHTML = categories
    .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.nombre)} — ${escapeHtml(category.departamento)}</option>`)
    .join("");
}

async function loadInventory() {
  setMessage(dashboardStatus, "Cargando inventario…");
  const { data, error } = await supabaseClient
    .from("productos")
    .select("id,nombre,categoria_id,precio,precio_oferta,es_destacado,disponible,imagen_url,imagen_path,presentacion,categorias(nombre)")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  inventoryRows.innerHTML = data.map((product) => {
    const category = Array.isArray(product.categorias) ? product.categorias[0] : product.categorias;
    return `<tr>
      <td><div class="inventory-product"><img src="${escapeHtml(getInventoryImageUrl(product.imagen_url))}" alt="" loading="lazy" /><span>${escapeHtml(product.nombre)}${product.es_destacado ? " · Destacado" : ""}</span></div></td>
      <td>${escapeHtml(category?.nombre || "Sin categoría")}</td>
      <td>${currency.format(Number(product.precio))}</td>
      <td>${product.precio_oferta === null ? "—" : currency.format(Number(product.precio_oferta))}</td>
      <td><span class="stock-label${product.disponible ? "" : " unavailable"}">${product.disponible ? "Disponible" : "Agotado"}</span></td>
      <td><div class="row-actions">
        <button type="button" data-action="edit" data-id="${escapeHtml(product.id)}">Editar</button>
        <button type="button" data-action="toggle" data-id="${escapeHtml(product.id)}">${product.disponible ? "Ocultar" : "Publicar"}</button>
        <button class="delete-button" type="button" data-action="delete" data-id="${escapeHtml(product.id)}">Eliminar</button>
      </div></td>
    </tr>`;
  }).join("");
  emptyInventory.hidden = data.length > 0;
  setMessage(dashboardStatus, `${data.length} ${data.length === 1 ? "producto" : "productos"} en inventario.`, true);
  return data;
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
  productForm.elements.categoria_id.value = product.categoria_id;
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
      .select("id,nombre,categoria_id,precio,precio_oferta,es_destacado,disponible,imagen_url,imagen_path,presentacion,categorias(nombre)")
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
    await requireAdmin(data.session);
    setAuthenticatedView(true);
    await loadCategories();
    await loadInventory();
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
    await requireAdmin(data.session);
    setAuthenticatedView(true);
    setMessage(authStatus, "");
    await loadCategories();
    await loadInventory();
  } catch (error) {
    console.error("No se pudo iniciar sesión en el panel.", error);
    setAuthenticatedView(false);
    setMessage(authStatus, error.message || "No se pudo iniciar sesión.");
  } finally {
    submitButton.disabled = false;
  }
});

productForm.addEventListener("submit", saveProduct);
inventoryRows.addEventListener("click", handleInventoryAction);
cancelEditButton.addEventListener("click", resetProductForm);
document.querySelector("#refresh-button").addEventListener("click", () => {
  loadInventory().catch((error) => {
    console.error("No se pudo actualizar la lista del inventario.", error);
    setMessage(dashboardStatus, error.message || "No se pudo actualizar el inventario.");
  });
});
document.querySelector("#sign-out-button").addEventListener("click", async () => {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    setAuthenticatedView(false);
    loginForm.reset();
  } catch (error) {
    console.error("No se pudo cerrar la sesión administrativa.", error);
    setMessage(dashboardStatus, error.message || "No se pudo cerrar sesión.");
  }
});

initializeAdmin();
