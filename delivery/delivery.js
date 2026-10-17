(() => {
  const supabase = window.kristalSupabase;
  const authSection = document.querySelector("#delivery-auth");
  const dashboard = document.querySelector("#delivery-dashboard");
  const authStatus = document.querySelector("#delivery-auth-status");
  const ordersStatus = document.querySelector("#delivery-orders-status");
  const orderList = document.querySelector("#delivery-order-list");
  const scanner = document.querySelector("#delivery-scanner");
  const availabilitySelect = document.querySelector("#delivery-availability");
  const availabilityStatus = document.querySelector("#delivery-availability-status");
  const camera = document.querySelector("#delivery-camera");
  const scanStatus = document.querySelector("#delivery-qr-status");
  const manualCodeStatus = document.querySelector("#delivery-manual-code-status");
  const signOutButton = document.querySelector("#delivery-sign-out");
  const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
  const availabilityLabels = {
    available: "Disponible",
    on_route: "En ruta",
    offline: "Fuera de servicio",
  };
  let currentUser = null;
  let ordersChannel = null;
  let mediaStream = null;
  let scanTimer = 0;
  let scanBusy = false;
  let scanStarted = false;
  let qrCanvas = null;
  let qrContext = null;

  function setStatus(element, message, kind = "") {
    element.textContent = message;
    element.classList.toggle("error", kind === "error");
    element.classList.toggle("success", kind === "success");
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

  function stopScanner() {
    scanStarted = false;
    window.clearTimeout(scanTimer);
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    camera.srcObject = null;
    scanner.hidden = true;
    scanBusy = false;
  }

  async function loadAvailability() {
    if (!currentUser) return;
    const { data, error } = await supabase
      .from("courier_availability")
      .select("availability")
      .eq("courier_id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    availabilitySelect.value = data?.availability || "offline";
    availabilitySelect.dataset.previousValue = availabilitySelect.value;
    setStatus(availabilityStatus, data
      ? `Tu estado está actualizado: ${availabilityLabels[data.availability]}.`
      : "Elige si estás disponible para recibir entregas.");
  }

  async function saveAvailability() {
    if (!currentUser) return;
    const previousValue = availabilitySelect.dataset.previousValue || "offline";
    const availability = availabilitySelect.value;
    availabilitySelect.disabled = true;
    setStatus(availabilityStatus, "Actualizando tu disponibilidad…");
    try {
      const { error } = await supabase
        .from("courier_availability")
        .upsert({
          courier_id: currentUser.id,
          availability,
          updated_at: new Date().toISOString(),
        }, { onConflict: "courier_id" });
      if (error) throw error;
      availabilitySelect.dataset.previousValue = availability;
      setStatus(availabilityStatus, `Estado actualizado: ${availabilityLabels[availability]}.`, "success");
    } catch (error) {
      console.error("No se pudo actualizar la disponibilidad del repartidor.", error);
      availabilitySelect.value = previousValue;
      setStatus(availabilityStatus, error.message || "No se pudo actualizar tu disponibilidad. Comprueba la conexión e inténtalo de nuevo.", "error");
    } finally {
      availabilitySelect.disabled = false;
    }
  }

  async function loadAssignedOrders() {
    if (!currentUser) return;
    setStatus(ordersStatus, "Cargando entregas asignadas…");
    const { data: orders, error } = await supabase
      .from("store_orders")
      .select("id,customer_name,customer_phone,delivery_address,delivery_reference,delivery_latitude,delivery_longitude,total_usd,order_status,created_at")
      .eq("assigned_courier_id", currentUser.id)
      .eq("fulfillment", "delivery")
      .eq("order_status", "delivering")
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!orders.length) {
      orderList.innerHTML = '<p class="delivery-empty">No tienes pedidos asignados para entregar en este momento.</p>';
      setStatus(ordersStatus, "");
      return;
    }

    const { data: items, error: itemsError } = await supabase
      .from("store_order_items")
      .select("order_id,product_name,presentation,quantity")
      .in("order_id", orders.map((order) => order.id));
    if (itemsError) throw itemsError;
    const itemsByOrder = new Map();
    for (const item of items) {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    }

    orderList.innerHTML = orders.map((order) => {
      const address = String(order.delivery_address || "");
      const hasCoordinates = order.delivery_latitude !== null
        && order.delivery_latitude !== undefined
        && order.delivery_longitude !== null
        && order.delivery_longitude !== undefined
        && Number.isFinite(Number(order.delivery_latitude))
        && Number.isFinite(Number(order.delivery_longitude));
      const mapQuery = hasCoordinates
        ? `${order.delivery_latitude},${order.delivery_longitude}`
        : [address, order.delivery_reference].filter(Boolean).join(", ");
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
      const items = itemsByOrder.get(order.id) || [];
      return `<article class="delivery-order-card">
        <header class="delivery-order-heading">
          <div><p class="eyebrow">EN CAMINO</p><h2>Pedido ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2></div>
          <strong>${currency.format(Number(order.total_usd))}</strong>
        </header>
        <p><strong>${escapeHtml(order.customer_name)}</strong> · <a href="tel:${encodeURIComponent(order.customer_phone)}">${escapeHtml(order.customer_phone)}</a></p>
        <p class="delivery-address"><span><strong>Dirección:</strong> ${escapeHtml(address)}${order.delivery_reference ? `<br><strong>Referencia:</strong> ${escapeHtml(order.delivery_reference)}` : ""}${hasCoordinates ? `<br><small>GPS: ${escapeHtml(`${order.delivery_latitude}, ${order.delivery_longitude}`)}</small>` : ""}</span><a href="${mapUrl}" target="_blank" rel="noopener noreferrer">Abrir mapa</a></p>
        <ul class="delivery-order-items">${items.map((item) => `<li><span>${escapeHtml(item.product_name)}${item.presentation ? ` · ${escapeHtml(item.presentation)}` : ""}</span><strong>× ${Number(item.quantity)}</strong></li>`).join("")}</ul>
      </article>`;
    }).join("");
    setStatus(ordersStatus, `${orders.length} ${orders.length === 1 ? "entrega asignada" : "entregas asignadas"}.`);
  }

  async function refreshOrders() {
    try {
      await loadAssignedOrders();
    } catch (error) {
      console.error("No se pudieron cargar los pedidos asignados al repartidor.", error);
      setStatus(ordersStatus, error.message || "No se pudieron cargar tus entregas. Actualiza la página.", "error");
    }
  }

  function subscribeToAssignedOrders() {
    if (ordersChannel) supabase.removeChannel(ordersChannel);
    ordersChannel = supabase
      .channel(`delivery-orders-${currentUser.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "store_orders",
        filter: `assigned_courier_id=eq.${currentUser.id}`,
      }, refreshOrders)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`El canal de pedidos asignados terminó con estado ${status}.`);
        }
      });
  }

  async function completeDelivery(token) {
    if (scanBusy) return;
    scanBusy = true;
    setStatus(scanStatus, "Verificando el QR de forma segura…");
    try {
      const { data: orderId, error } = await supabase.rpc("complete_delivery_by_qr", { p_token: token });
      if (error) throw error;
      stopScanner();
      await finishDelivery(orderId, scanStatus);
    } catch (error) {
      console.error("No se pudo completar la entrega escaneada.", error);
      setStatus(scanStatus, error.message || "No se pudo validar el QR. Confirma que el pedido esté en camino y asignado a tu cuenta.", "error");
      scanBusy = false;
    }
  }

  async function completeDeliveryByCode(event) {
    event.preventDefault();
    if (scanBusy) return;
    const form = event.currentTarget;
    const input = form.elements.delivery_code;
    const code = input.value.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) {
      setStatus(manualCodeStatus, "Escribe el código de 4 letras o números que muestra el cliente.", "error");
      input.focus();
      return;
    }
    scanBusy = true;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setStatus(manualCodeStatus, "Verificando el código de entrega…");
    try {
      const { data, error } = await supabase.rpc("complete_delivery_by_code", { p_code: code });
      if (error) throw error;
      if (!data?.success) {
        setStatus(manualCodeStatus, data?.message || "No se pudo validar el código.", "error");
        return;
      }
      input.value = "";
      stopScanner();
      await finishDelivery(data.order_id, manualCodeStatus);
    } catch (error) {
      console.error("No se pudo completar la entrega con el código manual.", error);
      setStatus(manualCodeStatus, error.message || "No se pudo validar el código. Confirma que el pedido esté asignado a tu cuenta.", "error");
    } finally {
      scanBusy = false;
      submitButton.disabled = false;
    }
  }

  async function finishDelivery(orderId, statusElement) {
    const completionMessage = `Entrega confirmada. Pedido ${String(orderId).slice(0, 8).toUpperCase()} completado.`;
    try {
      await loadAssignedOrders();
      setStatus(ordersStatus, completionMessage, "success");
    } catch (error) {
      console.error("La entrega se confirmó, pero no se pudo actualizar la lista.", error);
      setStatus(ordersStatus, `${completionMessage} No se pudo actualizar la lista; vuelve a cargarla.`, "success");
    } finally {
      scanBusy = false;
    }
    setStatus(statusElement, completionMessage, "success");
  }

  function tokenFromQrValue(rawValue) {
    try {
      const url = new URL(rawValue);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/delivery")) {
        throw new Error("Este QR no pertenece a una entrega de Hipermercado Kristal.");
      }
      const params = new URLSearchParams(url.hash.slice(1));
      if (params.get("scan") !== "delivery") throw new Error("Este QR no es un código de entrega.");
      return params.get("token") || "";
    } catch (error) {
      if (error instanceof TypeError && /^[a-f0-9]{64}$/i.test(rawValue.trim())) return rawValue.trim();
      throw error;
    }
  }

  async function detectQr(detector) {
    if (!scanStarted) return;
    try {
      if (!scanBusy && camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        let value = "";
        if (detector) {
          const codes = await detector.detect(camera);
          value = codes[0]?.rawValue || "";
        }
        if (!value && window.jsQR) {
          if (!qrCanvas) {
            qrCanvas = document.createElement("canvas");
            qrContext = qrCanvas.getContext("2d", { willReadFrequently: true });
          }
          const scale = Math.min(1, 640 / camera.videoWidth);
          qrCanvas.width = Math.round(camera.videoWidth * scale);
          qrCanvas.height = Math.round(camera.videoHeight * scale);
          qrContext.drawImage(camera, 0, 0, qrCanvas.width, qrCanvas.height);
          const frame = qrContext.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
          value = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" })?.data || "";
        }
        if (value) {
          const token = tokenFromQrValue(value);
          if (!token) throw new Error("El QR no contiene un token válido.");
          await completeDelivery(token);
          return;
        }
      }
    } catch (error) {
      if (scanStarted) {
        console.error("No se pudo leer o validar un cuadro de la cámara.", error);
        setStatus(scanStatus, error.message || "No se pudo leer el QR. Mantén el código dentro del marco e inténtalo de nuevo.", "error");
      }
    }
    if (scanStarted) scanTimer = window.setTimeout(() => detectQr(detector), 180);
  }

  async function openScanner() {
    if (!currentUser) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus(scanStatus, "La cámara requiere HTTPS y permisos del navegador. Abre esta página en Chrome actualizado.", "error");
      scanner.hidden = false;
      return;
    }
    if (!("BarcodeDetector" in window) && !window.jsQR) {
      setStatus(scanStatus, "No se pudo cargar el lector QR. Comprueba tu conexión e inténtalo de nuevo.", "error");
      scanner.hidden = false;
      return;
    }
    try {
      let detector = null;
      if ("BarcodeDetector" in window) {
        try {
          detector = new BarcodeDetector({ formats: ["qr_code"] });
        } catch (error) {
          console.warn("Se usará el lector QR compatible como alternativa.", error);
        }
      }
      scanner.hidden = false;
      setStatus(scanStatus, "Solicitando acceso a la cámara…");
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      camera.srcObject = mediaStream;
      await camera.play();
      scanStarted = true;
      setStatus(scanStatus, "Apunta la cámara al QR de entrega del cliente. Mantén el código centrado y bien iluminado.");
      detectQr(detector);
    } catch (error) {
      console.error("No se pudo iniciar el escáner de entrega.", error);
      stopScanner();
      scanner.hidden = false;
      setStatus(scanStatus, error.message || "No se pudo abrir la cámara. Revisa los permisos del navegador.", "error");
    }
  }

  async function enterDashboard(session) {
    const role = session?.user?.app_metadata?.role;
    if (role !== "courier") {
      const destination = window.kristalAuthRouting?.destinationForUser(session?.user);
      if (destination) {
        window.location.replace(destination);
        return;
      }
      dashboard.hidden = true;
      authSection.hidden = false;
      await supabase.auth.signOut();
      setStatus(authStatus, "Esta cuenta no tiene rol de repartidor. Solicita a la tienda que lo asigne.", "error");
      return;
    }
    currentUser = session.user;
    authSection.hidden = true;
    dashboard.hidden = false;
    signOutButton.hidden = false;
    try {
      await loadAvailability();
    } catch (error) {
      console.error("No se pudo cargar la disponibilidad del repartidor.", error);
      setStatus(availabilityStatus, `No se pudo cargar tu disponibilidad. Ejecuta supabase-courier-availability.sql en Supabase. ${error.message || ""}`, "error");
    }
    await refreshOrders();
    subscribeToAssignedOrders();
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get("scan") === "delivery" && params.has("token")) {
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      scanner.hidden = false;
      await completeDelivery(params.get("token"));
    }
  }

  async function initialize() {
    if (!supabase) {
      setStatus(authStatus, "No se pudo conectar con Supabase. Inténtalo de nuevo más tarde.", "error");
      return;
    }
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session) await enterDashboard(data.session);
    } catch (error) {
      console.error("No se pudo validar el acceso de reparto.", error);
      setStatus(authStatus, error.message || "No se pudo validar tu sesión.", "error");
    }
    supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        if (event !== "SIGNED_OUT") return;
        currentUser = null;
        stopScanner();
        authSection.hidden = false;
        dashboard.hidden = true;
        signOutButton.hidden = true;
      }
    });
  }

  document.querySelector("#delivery-scan-open").addEventListener("click", openScanner);
  document.querySelector("#delivery-scan-close").addEventListener("click", stopScanner);
  document.querySelector("#delivery-manual-code-form").addEventListener("submit", completeDeliveryByCode);
  document.querySelector("#delivery-code-input").addEventListener("input", (event) => {
    event.currentTarget.value = event.currentTarget.value.toUpperCase();
  });
  availabilitySelect.addEventListener("change", saveAvailability);
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      stopScanner();
      if (ordersChannel) {
        await supabase.removeChannel(ordersChannel);
        ordersChannel = null;
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error("No se pudo cerrar la sesión de reparto.", error);
      setStatus(ordersStatus, error.message || "No se pudo cerrar la sesión.", "error");
    } finally {
      signOutButton.disabled = false;
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && scanStarted) stopScanner();
  });
  window.addEventListener("pagehide", stopScanner);

  initialize();
})();
