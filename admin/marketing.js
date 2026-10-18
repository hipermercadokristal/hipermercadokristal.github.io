(() => {
  const supabase = window.kristalSupabase;
  const announcementForm = document.querySelector("#announcement-form");
  const announcementMessage = document.querySelector("#announcement-message");
  const announcementActive = document.querySelector("#announcement-active");
  const announcementStatus = document.querySelector("#announcement-status");
  const bannerForm = document.querySelector("#banner-form");
  const bannerList = document.querySelector("#marketing-banner-list");
  const bannerInput = document.querySelector("#banner-image");
  const bannerStatus = document.querySelector("#banner-status");
  const emptyBanners = document.querySelector("#empty-marketing-banners");
  const saveBannerButton = document.querySelector("#save-banner-button");
  let banners = [];
  let initialized = false;

  function setStatus(element, message, success = false) {
    element.textContent = message;
    element.classList.toggle("success", success);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function isAllowedLink(value) {
    const link = String(value || "").trim();
    if (link.startsWith("/") && !link.startsWith("//")) return true;
    try {
      return ["http:", "https:"].includes(new URL(link).protocol);
    } catch {
      return false;
    }
  }

  async function loadAnnouncement() {
    const { data, error } = await supabase.from("store_announcement")
      .select("message,active").eq("id", 1).maybeSingle();
    if (error) throw error;
    announcementMessage.value = data?.message || "";
    announcementActive.checked = Boolean(data?.active);
  }

  function renderBanners() {
    bannerList.innerHTML = banners.map((banner, index) => `<article class="marketing-banner-card" data-banner-id="${escapeHtml(banner.id)}">
      <img src="${escapeHtml(banner.image_url)}" alt="" loading="lazy" />
      <div class="marketing-banner-details">
        <strong>${escapeHtml(banner.title)}</strong>
        <span>${banner.active ? "Activo" : "Oculto"} · Orden ${index + 1}</span>
        <a href="${escapeHtml(banner.link_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(banner.link_url)}</a>
      </div>
      <div class="marketing-banner-actions">
        <button type="button" data-banner-action="up" aria-label="Subir orden"${index === 0 ? " disabled" : ""}>↑</button>
        <button type="button" data-banner-action="down" aria-label="Bajar orden"${index === banners.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" data-banner-action="toggle">${banner.active ? "Ocultar" : "Publicar"}</button>
        <button class="delete-button" type="button" data-banner-action="delete">Eliminar</button>
      </div>
    </article>`).join("");
    emptyBanners.hidden = banners.length > 0;
  }

  async function loadBanners() {
    const { data, error } = await supabase.from("store_banners")
      .select("id,title,image_url,image_path,link_url,sort_order,active")
      .order("sort_order").order("created_at");
    if (error) throw error;
    banners = data || [];
    renderBanners();
  }

  async function loadMarketing() {
    setStatus(announcementStatus, "Cargando configuración de marketing…");
    try {
      await Promise.all([loadAnnouncement(), loadBanners()]);
      setStatus(announcementStatus, "");
      setStatus(bannerStatus, "");
    } catch (error) {
      console.error("No se pudo cargar la configuración de marketing.", error);
      setStatus(announcementStatus, error.message || "No se pudo cargar la configuración.");
    }
  }

  async function saveAnnouncement(event) {
    event.preventDefault();
    const submitButton = announcementForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setStatus(announcementStatus, "Guardando aviso…");
    try {
      const message = announcementMessage.value.trim();
      if (announcementActive.checked && !message) {
        throw new Error("Escribe un mensaje antes de activar el aviso.");
      }
      const { error } = await supabase.from("store_announcement").upsert({
        id: 1,
        message,
        active: announcementActive.checked,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw error;
      setStatus(announcementStatus, "Aviso guardado y publicado en la tienda.", true);
    } catch (error) {
      console.error("No se pudo guardar el aviso global.", error);
      setStatus(announcementStatus, error.message || "No se pudo guardar el aviso.");
    } finally {
      submitButton.disabled = false;
    }
  }

  async function addBanner(event) {
    event.preventDefault();
    saveBannerButton.disabled = true;
    setStatus(bannerStatus, "Subiendo imagen promocional…");
    let uploadedPath = "";
    try {
      const formData = new FormData(bannerForm);
      const title = String(formData.get("title")).trim();
      const linkUrl = String(formData.get("link_url") || "/catalogo").trim();
      const image = bannerInput.files[0];
      const extensionByType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (!extensionByType[image?.type] || image.size > 8 * 1024 * 1024) {
        throw new Error("Selecciona una imagen JPG, PNG o WebP de hasta 8 MB.");
      }
      if (!isAllowedLink(linkUrl)) throw new Error("El enlace debe ser una ruta local o una URL HTTP/HTTPS válida.");
      const imagePath = `${crypto.randomUUID()}.${extensionByType[image.type]}`;
      const { data: upload, error: uploadError } = await supabase.storage
        .from("marketing-assets").upload(imagePath, image, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      uploadedPath = upload.path;
      const { data: publicImage } = supabase.storage.from("marketing-assets").getPublicUrl(upload.path);
      const { error: insertError } = await supabase.from("store_banners").insert({
        title,
        image_url: publicImage.publicUrl,
        image_path: upload.path,
        link_url: linkUrl,
        sort_order: banners.length,
        active: true,
      });
      if (insertError) throw insertError;
      bannerForm.reset();
      document.querySelector("#banner-link").value = "/catalogo";
      await loadBanners();
      setStatus(bannerStatus, "Banner subido y publicado.", true);
    } catch (error) {
      let message = error.message || "No se pudo subir el banner.";
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from("marketing-assets").remove([uploadedPath]);
        if (cleanupError) {
          console.error("No se pudo limpiar la imagen del banner después del error.", cleanupError);
          message += " La imagen temporal tampoco se pudo limpiar desde Storage.";
        }
      }
      console.error("No se pudo subir el banner.", error);
      setStatus(bannerStatus, message);
    } finally {
      saveBannerButton.disabled = false;
    }
  }

  async function handleBannerAction(event) {
    const button = event.target.closest("button[data-banner-action]");
    if (!button) return;
    const card = button.closest("[data-banner-id]");
    const currentIndex = banners.findIndex((banner) => banner.id === card?.dataset.bannerId);
    const current = banners[currentIndex];
    if (!current) return;
    button.disabled = true;
    setStatus(bannerStatus, "Actualizando banners…");
    let recordDeleted = false;
    try {
      const action = button.dataset.bannerAction;
      if (action === "delete") {
        if (!window.confirm(`¿Eliminar el banner “${current.title}” y su imagen?`)) return;
        const { error } = await supabase.from("store_banners").delete().eq("id", current.id);
        if (error) throw error;
        recordDeleted = true;
        await loadBanners();
        const { error: storageError } = await supabase.storage.from("marketing-assets").remove([current.image_path]);
        if (storageError) throw new Error(`El banner se quitó de la tienda, pero no se pudo borrar la imagen de Storage: ${storageError.message}`);
      } else if (action === "toggle") {
        const { error } = await supabase.from("store_banners")
          .update({ active: !current.active, updated_at: new Date().toISOString() }).eq("id", current.id);
        if (error) throw error;
      } else {
        const targetIndex = currentIndex + (action === "up" ? -1 : 1);
        if (targetIndex < 0 || targetIndex >= banners.length) return;
        const reordered = [...banners];
        [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
        const updates = await Promise.all(reordered.map((banner, sortOrder) => supabase
          .from("store_banners").update({ sort_order: sortOrder, updated_at: new Date().toISOString() }).eq("id", banner.id)));
        const failedUpdate = updates.find((result) => result.error);
        if (failedUpdate) throw failedUpdate.error;
      }
      await loadBanners();
      setStatus(bannerStatus, "Banners actualizados.", true);
    } catch (error) {
      console.error("No se pudo actualizar el banner.", error);
      if (recordDeleted) {
        try {
          await loadBanners();
        } catch (refreshError) {
          console.error("No se pudo actualizar la lista después de eliminar el banner.", refreshError);
        }
      }
      setStatus(bannerStatus, error.message || "No se pudo actualizar el banner.");
    } finally {
      button.disabled = false;
    }
  }

  announcementForm?.addEventListener("submit", saveAnnouncement);
  bannerForm?.addEventListener("submit", addBanner);
  bannerList?.addEventListener("click", handleBannerAction);
  document.querySelector("#refresh-marketing-button")?.addEventListener("click", loadMarketing);
  window.addEventListener("kristal:admin-ready", () => {
    if (initialized || !supabase) return;
    initialized = true;
    loadMarketing();
  });
})();
