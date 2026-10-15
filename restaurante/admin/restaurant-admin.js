const supabaseClient = window.kristalSupabase;
const authSection = document.querySelector("#auth-section");
const dashboardSection = document.querySelector("#dashboard-section");
const loginForm = document.querySelector("#login-form");
const authStatus = document.querySelector("#auth-status");
const dashboardStatus = document.querySelector("#dashboard-status");
const dishForm = document.querySelector("#dish-form");
const categorySelect = document.querySelector("#dish-category");
const imageInput = document.querySelector("#dish-image");
const inventoryRows = document.querySelector("#inventory-rows");
const emptyInventory = document.querySelector("#empty-inventory");
const saveButton = document.querySelector("#save-dish-button");
const formHeading = document.querySelector("#dish-form-heading");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
let categories = [];
let editingDish = null;
imageInput.required = true;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
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

async function requireAdmin(session) {
  if (session?.user?.app_metadata?.role !== "admin") {
    const { error } = await supabaseClient.auth.signOut();
    if (error) console.error("No se pudo cerrar la sesión sin rol de administrador.", error);
    throw new Error("Esta cuenta no tiene permisos de administrador. Solicita que le asignen el rol admin.");
  }
}

async function loadCategories() {
  const { data, error } = await supabaseClient.from("restaurant_categories").select("id,nombre").order("nombre");
  if (error) throw error;
  categories = data;
  categorySelect.innerHTML = categories.map((category) =>
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.nombre)}</option>`,
  ).join("");
  if (!categories.length) throw new Error("No hay categorías. Ejecuta restaurante/supabase-restaurante.sql en SQL Editor.");
}

async function loadInventory() {
  setMessage(dashboardStatus, "Cargando el menú…");
  const { data, error } = await supabaseClient
    .from("restaurant_products")
    .select("id,nombre,categoria_id,precio,descripcion,disponible,imagen_url,imagen_path,categorias:restaurant_categories(nombre)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  inventoryRows.innerHTML = data.map((dish) => `<tr>
    <td data-label="Plato"><div class="inventory-product"><img src="${escapeHtml(dish.imagen_url)}" alt="" loading="lazy" /><span>${escapeHtml(dish.nombre)}</span></div></td>
    <td data-label="Categoría">${escapeHtml(dish.categorias?.nombre || "Sin categoría")}</td>
    <td data-label="Precio">${currency.format(Number(dish.precio))}</td>
    <td data-label="Estado"><span class="stock-label${dish.disponible ? "" : " unavailable"}">${dish.disponible ? "Disponible" : "Oculto"}</span></td>
    <td data-label="Acciones"><div class="row-actions"><button type="button" data-action="edit" data-id="${escapeHtml(dish.id)}">Editar</button><button type="button" data-action="toggle" data-id="${escapeHtml(dish.id)}">${dish.disponible ? "Ocultar" : "Publicar"}</button><button class="delete-button" type="button" data-action="delete" data-id="${escapeHtml(dish.id)}">Eliminar</button></div></td>
  </tr>`).join("");
  emptyInventory.hidden = data.length > 0;
  setMessage(dashboardStatus, `${data.length} ${data.length === 1 ? "plato" : "platos"} en el menú.`, true);
  return data;
}

function resetDishForm() {
  dishForm.reset();
  document.querySelector("#dish-available").checked = true;
  editingDish = null;
  formHeading.textContent = "Agregar plato";
  saveButton.textContent = "Guardar plato";
  cancelEditButton.hidden = true;
  imageInput.required = true;
}

function beginEditing(dish) {
  editingDish = dish;
  dishForm.elements.nombre.value = dish.nombre;
  dishForm.elements.categoria_id.value = dish.categoria_id;
  dishForm.elements.precio.value = dish.precio;
  dishForm.elements.descripcion.value = dish.descripcion || "";
  dishForm.elements.disponible.checked = dish.disponible;
  imageInput.value = "";
  imageInput.required = false;
  formHeading.textContent = "Editar plato";
  saveButton.textContent = "Guardar cambios";
  cancelEditButton.hidden = false;
  dishForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadImage(file) {
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  if (!extensions[file.type] || file.size > 5 * 1024 * 1024) {
    throw new Error("La foto debe ser PNG, JPG o WebP y no superar 5 MB.");
  }
  const path = `${crypto.randomUUID()}.${extensions[file.type]}`;
  const { error } = await supabaseClient.storage.from("restaurant-images").upload(path, file, {
    cacheControl: "3600", contentType: file.type, upsert: false,
  });
  if (error) throw error;
  return { path, url: supabaseClient.storage.from("restaurant-images").getPublicUrl(path).data.publicUrl };
}

async function saveDish(event) {
  event.preventDefault();
  saveButton.disabled = true;
  setMessage(dashboardStatus, editingDish ? "Guardando cambios…" : "Guardando plato…");
  let uploadedPath = "";
  let dishSaved = false;
  try {
    const formData = new FormData(dishForm);
    const file = imageInput.files[0];
    let imageUrl = editingDish?.imagen_url || "";
    let imagePath = editingDish?.imagen_path || null;
    if (file) {
      const uploaded = await uploadImage(file);
      imageUrl = uploaded.url;
      imagePath = uploaded.path;
      uploadedPath = uploaded.path;
    }
    if (!imageUrl) throw new Error("Selecciona una foto del plato.");
    const price = Number(formData.get("precio"));
    if (!Number.isFinite(price) || price <= 0) throw new Error("El precio debe ser mayor que cero.");
    const dish = {
      nombre: String(formData.get("nombre")).trim(),
      categoria_id: String(formData.get("categoria_id")),
      precio: price,
      descripcion: String(formData.get("descripcion") || "").trim() || null,
      disponible: formData.has("disponible"),
      imagen_url: imageUrl,
      imagen_path: imagePath,
      updated_at: new Date().toISOString(),
    };
    const query = editingDish
      ? supabaseClient.from("restaurant_products").update(dish).eq("id", editingDish.id)
      : supabaseClient.from("restaurant_products").insert(dish);
    const { error } = await query;
    if (error) throw error;
    dishSaved = true;
    const oldImagePath = editingDish?.imagen_path;
    resetDishForm();
    let warning = "";
    if (oldImagePath && file && oldImagePath !== imagePath) {
      const { error: removeError } = await supabaseClient.storage.from("restaurant-images").remove([oldImagePath]);
      if (removeError) {
        console.error("El plato se actualizó, pero no se pudo borrar su imagen anterior.", removeError);
        warning = "Plato guardado, pero no se pudo borrar su foto anterior.";
      }
    }
    try {
      await loadInventory();
      if (warning) setMessage(dashboardStatus, warning);
    } catch (error) {
      console.error("El plato se guardó, pero no se pudo actualizar la lista.", error);
      setMessage(dashboardStatus, `Plato guardado, pero no se pudo actualizar el inventario: ${error.message}`);
    }
  } catch (error) {
    if (uploadedPath && !dishSaved) {
      const { error: cleanupError } = await supabaseClient.storage.from("restaurant-images").remove([uploadedPath]);
      if (cleanupError) console.error("No se pudo limpiar la foto del plato que no llegó a guardarse.", cleanupError);
    }
    console.error("No se pudo guardar el plato.", error);
    setMessage(dashboardStatus, `${error.message || "No se pudo guardar el plato."}${uploadedPath && !dishSaved ? " Si la foto permanece en Storage, elimínala manualmente." : ""}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = editingDish ? "Guardar cambios" : "Guardar plato";
  }
}

async function handleInventoryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  try {
    const { data, error } = await supabaseClient.from("restaurant_products")
      .select("id,nombre,categoria_id,precio,descripcion,disponible,imagen_url,imagen_path,categorias:restaurant_categories(nombre)")
      .eq("id", button.dataset.id).single();
    if (error) throw error;
    if (button.dataset.action === "edit") {
      beginEditing(data);
      return;
    }
    if (button.dataset.action === "toggle") {
      const { error: updateError } = await supabaseClient.from("restaurant_products")
        .update({ disponible: !data.disponible, updated_at: new Date().toISOString() }).eq("id", data.id);
      if (updateError) throw updateError;
      await loadInventory();
      return;
    }
    if (button.dataset.action === "delete") {
      if (!window.confirm(`¿Eliminar "${data.nombre}" del menú?`)) return;
      const { error: deleteError } = await supabaseClient.from("restaurant_products").delete().eq("id", data.id);
      if (deleteError) throw deleteError;
      if (data.imagen_path) {
        const { error: imageError } = await supabaseClient.storage.from("restaurant-images").remove([data.imagen_path]);
        if (imageError) {
          console.error("El plato se eliminó, pero no se pudo borrar su foto.", imageError);
          await loadInventory();
          setMessage(dashboardStatus, "Plato eliminado, pero no se pudo borrar su foto del almacenamiento.");
          return;
        }
      }
      await loadInventory();
    }
  } catch (error) {
    console.error("No se pudo completar la acción del menú.", error);
    setMessage(dashboardStatus, error.message || "No se pudo completar la acción.");
  }
}

async function initializeAdmin() {
  if (!supabaseClient) {
    setMessage(authStatus, "Configura Supabase antes de iniciar sesión.");
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
    console.error("No se pudo abrir el panel del restaurante.", error);
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
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
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
    console.error("No se pudo iniciar sesión en el panel del restaurante.", error);
    setAuthenticatedView(false);
    setMessage(authStatus, error.message || "No se pudo iniciar sesión.");
  } finally {
    button.disabled = false;
  }
});

dishForm.addEventListener("submit", saveDish);
inventoryRows.addEventListener("click", handleInventoryAction);
cancelEditButton.addEventListener("click", resetDishForm);
document.querySelector("#refresh-button").addEventListener("click", () => {
  loadInventory().catch((error) => {
    console.error("No se pudo actualizar el menú.", error);
    setMessage(dashboardStatus, error.message || "No se pudo actualizar el menú.");
  });
});
document.querySelector("#sign-out-button").addEventListener("click", async () => {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    setAuthenticatedView(false);
    loginForm.reset();
  } catch (error) {
    console.error("No se pudo cerrar la sesión del restaurante.", error);
    setMessage(dashboardStatus, error.message || "No se pudo cerrar la sesión.");
  }
});

initializeAdmin();
