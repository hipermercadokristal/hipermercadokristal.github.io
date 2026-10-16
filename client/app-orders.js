(() => {
  const supabase = window.kristalSupabase;
  const customerAuthCard = document.querySelector("#customer-auth-card");
  const loginForm = document.querySelector("#customer-login-form");
  const signupForm = document.querySelector("#customer-signup-form");
  const profileForm = document.querySelector("#customer-profile-form");
  const checkoutDialog = document.querySelector("#store-checkout-dialog");
  const paymentDataDialog = document.querySelector("#payment-data-dialog");
  const checkoutForm = document.querySelector("#store-checkout-form");
  const ordersList = document.querySelector("#customer-orders-list");
  const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
  const bolivares = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const exchangeRateUrl = "https://ve.dolarapi.com/v1/dolares/oficial";
  const exchangeRateStorageKey = "restaurant-kristal-bcv-rate";
  const pendingCheckoutStorageKey = "kristal-pending-checkout-v1";
  const oauthReturnStorageKey = "kristal-oauth-return-to-profile";
  const paymentProofMaxBytes = 5 * 1024 * 1024;
  const paymentProofTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  const orderStatusLabels = {
    received: "Pedido recibido",
    preparing: "En preparación en pasillo",
    ready: "Listo para retirar",
    delivering: "En camino con delivery",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };
  const paymentStatusLabels = {
    pending_verification: "Pendiente de verificación manual por caja",
    awaiting_instructions: "Pendiente de instrucciones de Zelle de caja",
    awaiting_in_store: "Pago al retirar en tienda",
    awaiting_delivery: "Pago al recibir el delivery",
    verified: "Pago verificado por caja",
    rejected: "Pago rechazado; contacta a caja",
  };
  let currentUser = null;
  let realtimeChannel = null;
  let requestedItems = [];
  let ordersRequest = 0;
  let exchangeRate = null;
  let exchangeRateDate = "";
  let exchangeRateIsStale = false;

  function setStatus(selector, message, isError = false) {
    const element = document.querySelector(selector);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function updateInstalledAppAccess(user) {
    const root = document.documentElement;
    if (!root.classList.contains("installed-app")) return;
    const authenticated = Boolean(user);
    root.classList.toggle("app-auth-required", !authenticated);
    root.classList.remove("app-auth-pending");
    if (!authenticated && location.pathname.replace(/\/+$/, "") !== "/perfil") {
      document.dispatchEvent(new CustomEvent("kristal:navigate", { detail: { path: "/perfil" } }));
    }
    if (!authenticated) {
      setStatus("#customer-auth-status", "Inicia sesión o crea tu cuenta para continuar usando la app.");
    }
  }

  function restorePendingCheckout() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingCheckoutStorageKey) || "null");
      if (!Array.isArray(saved)) return;
      requestedItems = saved.filter((item) =>
        item && typeof item.product_id === "string"
        && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99
        && typeof item.name === "string" && Number.isFinite(item.price),
      );
    } catch (error) {
      console.error("No se pudo recuperar el carrito pendiente después del acceso con Google.", error);
      setStatus("#customer-auth-status", "No se pudo restaurar el carrito después del inicio de sesión.", true);
    }
  }

  function persistPendingCheckout(items) {
    try {
      sessionStorage.setItem(pendingCheckoutStorageKey, JSON.stringify(items));
      return true;
    } catch (error) {
      console.error("No se pudo guardar temporalmente el carrito antes del acceso con Google.", error);
      setStatus("#customer-auth-status", "No se pudo guardar tu carrito para continuar el acceso. Verifica el almacenamiento del navegador e inténtalo de nuevo.", true);
      return false;
    }
  }

  function formatBolivares(amount) {
    return `Bs. ${bolivares.format(amount)}`;
  }

  function showCheckoutTotal() {
    const total = requestedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    document.querySelector("#checkout-total").textContent =
      `Total estimado: ${currency.format(total)}. El total definitivo se calcula con los precios actuales de la tienda.`;
    const copyButton = document.querySelector("#checkout-copy-ves");
    const rateStatus = document.querySelector("#checkout-rate-status");
    if (exchangeRate !== null) {
      const amountVES = total * exchangeRate;
      copyButton.hidden = false;
      copyButton.textContent = `Copiar ${formatBolivares(amountVES)}`;
      copyButton.dataset.amount = bolivares.format(amountVES);
      rateStatus.textContent = `${exchangeRateIsStale ? "Última tasa guardada" : "Tasa BCV"}: ${formatBolivares(exchangeRate)} por USD${exchangeRateDate ? ` · ${new Intl.DateTimeFormat("es-VE", { dateStyle: "medium" }).format(new Date(exchangeRateDate))}` : ""}. Equivalente referencial; caja confirmará el monto final.`;
    } else {
      copyButton.hidden = true;
      rateStatus.textContent = "No se pudo consultar la tasa BCV. El equivalente en bolívares no está disponible; confirma el monto con caja antes de transferir.";
    }
  }

  async function refreshExchangeRate() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(exchangeRateUrl, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`La consulta BCV respondió ${response.status}.`);
      const data = await response.json();
      const rate = Number(data.promedio);
      if (!Number.isFinite(rate) || rate <= 0 || typeof data.fechaActualizacion !== "string") {
        throw new TypeError("La respuesta de la tasa BCV está incompleta.");
      }
      exchangeRate = rate;
      exchangeRateDate = data.fechaActualizacion;
      exchangeRateIsStale = false;
      try {
        localStorage.setItem(exchangeRateStorageKey, JSON.stringify({ value: rate, date: exchangeRateDate }));
      } catch (error) {
        console.error("No se pudo guardar la tasa BCV en este dispositivo.", error);
      }
    } catch (error) {
      console.error("No se pudo actualizar la tasa BCV para el checkout.", error);
      if (exchangeRate === null) {
        try {
          const saved = JSON.parse(localStorage.getItem(exchangeRateStorageKey) || "null");
          if (saved && Number.isFinite(saved.value) && saved.value > 0 && saved.date) {
            exchangeRate = saved.value;
            exchangeRateDate = saved.date;
            exchangeRateIsStale = true;
          }
        } catch (storageError) {
          console.error("No se pudo recuperar la última tasa BCV guardada.", storageError);
        }
      } else {
        exchangeRateIsStale = true;
      }
    } finally {
      clearTimeout(timeout);
      if (requestedItems.length) showCheckoutTotal();
    }
    return exchangeRate !== null;
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

  function setAuthTab(tab) {
    const isLogin = tab === "login";
    document.querySelector("#customer-login-tab").classList.toggle("active", isLogin);
    document.querySelector("#customer-login-tab").setAttribute("aria-selected", String(isLogin));
    document.querySelector("#customer-signup-tab").classList.toggle("active", !isLogin);
    document.querySelector("#customer-signup-tab").setAttribute("aria-selected", String(!isLogin));
    loginForm.hidden = !isLogin;
    signupForm.hidden = isLogin;
    setStatus("#customer-auth-status", "");
  }

  function setAuthenticatedUser(user) {
    if (currentUser?.id !== user?.id) ordersRequest += 1;
    currentUser = user;
    updateInstalledAppAccess(user);
    if (user) {
      try {
        if (sessionStorage.getItem(oauthReturnStorageKey) === "1") {
          sessionStorage.removeItem(oauthReturnStorageKey);
          document.dispatchEvent(new CustomEvent("kristal:navigate", { detail: { path: "/perfil" } }));
        }
      } catch (error) {
        console.error("No se pudo completar la navegación después del acceso con Google.", error);
        setStatus("#customer-auth-status", "Iniciaste sesión, pero no se pudo abrir Perfil. Usa la navegación de la app.", true);
      }
    }
    customerAuthCard.hidden = Boolean(user);
    profileForm.hidden = !user;
    if (!user) {
      profileForm.reset();
      ordersList.replaceChildren();
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
      return;
    }
    document.querySelector("#customer-profile-name").value = user.user_metadata?.full_name || "";
    document.querySelector("#customer-profile-phone").value = user.user_metadata?.phone || "";
    loadProfile().then(() => {
      if (requestedItems.length && !checkoutDialog.open) populateCheckout(requestedItems);
    }).catch((error) => {
      console.error("No se pudo cargar el perfil del cliente.", error);
      setStatus("#customer-profile-status", error.message || "No se pudo cargar el perfil.", true);
    });
    subscribeToOrders();
    if (location.pathname.replace(/\/+$/, "") === "/pedidos") {
      loadOrders().catch((error) => {
        console.error("No se pudieron cargar tus pedidos.", error);
        setStatus("#orders-status", error.message || "No se pudieron cargar tus pedidos.", true);
      });
    }
  }

  async function loadProfile() {
    if (!currentUser) return;
    const { data, error } = await supabase
      .from("customer_profiles")
      .select("full_name,phone,default_address")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return;
    document.querySelector("#customer-profile-name").value = data.full_name || "";
    document.querySelector("#customer-profile-phone").value = data.phone || "";
    document.querySelector("#customer-profile-address").value = data.default_address || "";
  }

  function setCheckoutPaymentFields() {
    const method = checkoutForm.elements.payment_method.value;
    const mobilePayment = method === "mobile_payment";
    document.querySelector("#checkout-mobile-payment").hidden = !mobilePayment;
    document.querySelector("#checkout-method-note").hidden = mobilePayment;
    checkoutForm.elements.payment_bank_code.required = mobilePayment;
    const evidenceMode = document.querySelector('[data-evidence-tab][aria-selected="true"]')?.dataset.evidenceTab || "reference";
    checkoutForm.elements.payment_reference.required = mobilePayment && evidenceMode === "reference";
    checkoutForm.elements.payment_proof.required = mobilePayment && evidenceMode === "proof";
    checkoutForm.elements.payment_reference.setCustomValidity("");
    setStatus("#checkout-reference-status", "");
    if (method === "zelle") {
      setStatus("#checkout-method-note", "Solicita a caja los datos e instrucciones de Zelle antes de transferir. Tu pedido quedará pendiente de coordinación.");
    } else if (method === "cash_pos") {
      setStatus("#checkout-method-note", "Pagarás en efectivo o punto de venta al recibir o retirar tu pedido.");
    }
  }

  function setPaymentEvidenceMode(mode) {
    document.querySelectorAll("[data-evidence-tab]").forEach((tab) => {
      const selected = tab.dataset.evidenceTab === mode;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll("[data-evidence-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.evidencePanel !== mode;
    });
    if (mode === "proof") checkoutForm.elements.payment_reference.value = "";
    else checkoutForm.elements.payment_proof.value = "";
    setStatus("#checkout-reference-status", "");
    setCheckoutPaymentFields();
  }

  function openPaymentDataSheet() {
    const bankSelect = checkoutForm.elements.payment_bank_code;
    const bank = bankSelect.options[bankSelect.selectedIndex].textContent.trim();
    document.querySelector("#payment-data-bank").textContent = bank;
    document.querySelectorAll("[data-copy-payment]").forEach((button) => {
      const valueElement = document.querySelector(`#payment-data-${button.dataset.copyPayment}`);
      button.dataset.copyValue = valueElement.textContent.trim();
    });
    if (!paymentDataDialog.open) paymentDataDialog.showModal();
  }

  function setFulfillmentFields() {
    const delivery = checkoutForm.elements.fulfillment.value === "delivery";
    const addressRow = document.querySelector("#store-delivery-address-row");
    addressRow.hidden = !delivery;
    checkoutForm.elements.delivery_address.required = delivery;
  }

  function populateCheckout(items) {
    requestedItems = items;
    showCheckoutTotal();
    if (currentUser) {
      document.querySelector('[name="customer_name"]').value =
        document.querySelector("#customer-profile-name").value || currentUser.user_metadata?.full_name || "";
      document.querySelector('[name="customer_phone"]').value =
        document.querySelector("#customer-profile-phone").value || currentUser.user_metadata?.phone || "";
      document.querySelector('[name="delivery_address"]').value =
        document.querySelector("#customer-profile-address").value || "";
    }
    document.querySelector("#store-checkout-form").hidden = false;
    document.querySelector("#order-receipt").hidden = true;
    setStatus("#checkout-status", "");
    setPaymentEvidenceMode("reference");
    setCheckoutPaymentFields();
    setFulfillmentFields();
    document.dispatchEvent(new CustomEvent("kristal:close-cart"));
    checkoutDialog.showModal();
    document.body.classList.add("checkout-open");
    refreshExchangeRate();
  }

  async function handleCheckoutRequest(event) {
    requestedItems = event.detail?.items || [];
    if (!requestedItems.length) return;
    if (!currentUser) {
      setStatus("#customer-auth-status", "Inicia sesión o crea una cuenta para guardar y rastrear tu pedido.");
      document.dispatchEvent(new CustomEvent("kristal:close-cart"));
      document.dispatchEvent(new CustomEvent("kristal:navigate", { detail: { path: "/perfil" } }));
      return;
    }
    populateCheckout(requestedItems);
  }

  function safeFileName(name) {
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "file";
    return `${crypto.randomUUID()}.${extension.replace(/[^a-z0-9]/g, "").slice(0, 8) || "file"}`;
  }

  async function createOrder(event) {
    event.preventDefault();
    if (!currentUser) {
      setStatus("#checkout-status", "Tu sesión venció. Inicia sesión nuevamente para confirmar.", true);
      return;
    }
    const submitButton = document.querySelector("#confirm-store-order");
    const formData = new FormData(checkoutForm);
    const paymentMethod = formData.get("payment_method");
    const evidenceMode = document.querySelector('[data-evidence-tab][aria-selected="true"]')?.dataset.evidenceTab || "reference";
    const selectedProof = evidenceMode === "proof" ? formData.get("payment_proof") : null;
    let proofPath = null;
    const orderId = crypto.randomUUID();
    submitButton.disabled = true;
    setStatus("#checkout-status", "Registrando tu pedido de forma segura…");

    try {
      if (paymentMethod === "mobile_payment" && exchangeRate === null && !(await refreshExchangeRate())) {
        throw new Error("No está disponible la tasa BCV para calcular el monto en bolívares. Elige otro método o confirma el monto con caja.");
      }
      if (paymentMethod === "mobile_payment") {
        if (evidenceMode === "reference" && !/^[0-9]{4,20}$/.test(String(formData.get("payment_reference")).trim())) {
          throw new Error("La referencia bancaria debe tener entre 4 y 20 dígitos.");
        }
        if (evidenceMode === "proof" && (!(selectedProof instanceof File) || !selectedProof.size)) {
          throw new Error("Adjunta el comprobante de Pago Móvil.");
        }
        if (selectedProof && (!paymentProofTypes.has(selectedProof.type) || selectedProof.size > paymentProofMaxBytes)) {
          throw new Error("El comprobante debe ser JPG, PNG, WebP o PDF y no superar 5 MB.");
        }
        if (selectedProof) {
          proofPath = `${currentUser.id}/${orderId}/${safeFileName(selectedProof.name)}`;
          const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(proofPath, selectedProof, {
            contentType: selectedProof.type,
            upsert: false,
          });
          if (uploadError) throw uploadError;
        }
      }

      const { data, error } = await supabase.rpc("create_store_order", {
        p_order_id: orderId,
        p_customer_name: String(formData.get("customer_name")).trim(),
        p_customer_phone: String(formData.get("customer_phone")).trim(),
        p_fulfillment: formData.get("fulfillment"),
        p_delivery_address: formData.get("fulfillment") === "delivery"
          ? String(formData.get("delivery_address") || "").trim() || null
          : null,
        p_payment_method: paymentMethod,
        p_payment_bank_code: paymentMethod === "mobile_payment" ? formData.get("payment_bank_code") : null,
        p_payment_reference: paymentMethod === "mobile_payment" && evidenceMode === "reference"
          ? String(formData.get("payment_reference")).trim()
          : null,
        p_payment_proof_path: proofPath,
        p_exchange_rate: exchangeRate,
        p_items: requestedItems.map(({ product_id, quantity }) => ({ product_id, quantity })),
      });
      if (error) throw error;
      const order = Array.isArray(data) ? data[0] : data;
      if (!order?.order_id) throw new Error("La tienda no devolvió la confirmación del pedido.");

      document.querySelector("#receipt-order-id").textContent = order.order_id;
      document.querySelector("#receipt-total").textContent = currency.format(Number(order.total_usd));
      document.querySelector("#receipt-total-ves").textContent =
        order.total_ves === null ? "No disponible" : formatBolivares(Number(order.total_ves));
      document.querySelector("#receipt-payment-status").textContent =
        paymentStatusLabels[order.payment_status] || "Pendiente de coordinación";
      const receipt = document.querySelector("#order-receipt");
      receipt.dataset.orderId = order.order_id;
      receipt.dataset.paymentMethod = paymentMethod;
      receipt.dataset.evidenceMode = evidenceMode;
      document.querySelector("#receipt-payment-check").hidden = paymentMethod !== "mobile_payment";
      document.querySelector("#receipt-reference-form").elements.payment_reference.value =
        String(formData.get("payment_reference") || "").trim();
      document.querySelector("#receipt-reference-form").hidden =
        paymentMethod !== "mobile_payment" || evidenceMode !== "reference";
      document.querySelector("#receipt-reference-form").dataset.orderId = order.order_id;
      document.querySelector("#receipt-heading").textContent = "Pedido recibido";
      document.querySelector(".receipt-check").classList.remove("is-verified");
      setStatus("#receipt-verification-status", "");
      setStatus("#receipt-reference-status", "");
      const message = [
        "Hola, registré un pedido en la app de Hipermercado Kristal.",
        `Pedido: ${order.order_id}`,
        `Total: ${currency.format(Number(order.total_usd))}`,
        order.total_ves === null ? "" : `Equivalente referencial: ${formatBolivares(Number(order.total_ves))}`,
        paymentMethod === "mobile_payment" ? "Pago Móvil: pendiente de verificación manual por caja." : "Por favor, confirmar coordinación del pago.",
      ].filter(Boolean).join("\n");
      document.querySelector("#receipt-whatsapp").href = `https://wa.me/584128867088?text=${encodeURIComponent(message)}`;
      document.querySelector("#store-checkout-form").hidden = true;
      document.querySelector("#order-receipt").hidden = false;
      setStatus("#checkout-status", "");
      document.dispatchEvent(new CustomEvent("kristal:order-completed", {
        detail: { productIds: requestedItems.map((item) => item.product_id) },
      }));
      sessionStorage.removeItem(pendingCheckoutStorageKey);
      requestedItems = [];
      loadOrders().catch((refreshError) => {
        console.error("El pedido quedó registrado, pero no se pudo actualizar el historial.", refreshError);
        setStatus("#orders-status", refreshError.message || "El pedido quedó registrado; recarga el seguimiento más tarde.", true);
      });
    } catch (error) {
      if (proofPath) {
        const { error: cleanupError } = await supabase.storage.from("payment-proofs").remove([proofPath]);
        if (cleanupError) console.error("No se pudo limpiar el comprobante del pedido fallido.", cleanupError);
      }
      console.error("No se pudo registrar el pedido.", error);
      setStatus("#checkout-status", error.message || "No se pudo registrar el pedido. Revisa tu conexión e inténtalo de nuevo.", true);
    } finally {
      submitButton.disabled = false;
    }
  }

  async function refreshReceiptPaymentStatus(button) {
    const receipt = document.querySelector("#order-receipt");
    if (!currentUser || !receipt.dataset.orderId) {
      setStatus("#receipt-verification-status", "Inicia sesión para consultar el estado de este pago.", true);
      return;
    }
    button.disabled = true;
    setStatus("#receipt-verification-status", "Consultando el estado registrado del pedido…");
    try {
      const { data, error } = await supabase
        .from("store_orders")
        .select("payment_status")
        .eq("id", receipt.dataset.orderId)
        .eq("user_id", currentUser.id)
        .single();
      if (error) throw error;
      const status = data.payment_status;
      document.querySelector("#receipt-payment-status").textContent =
        paymentStatusLabels[status] || "Estado de pago pendiente";
      const verified = status === "verified";
      document.querySelector("#receipt-heading").textContent =
        verified ? "Pago verificado con éxito" : "Pedido recibido";
      document.querySelector(".receipt-check").classList.toggle("is-verified", verified);
      document.querySelector("#receipt-reference-form").hidden =
        status !== "pending_verification" || receipt.dataset.evidenceMode !== "reference";
      if (verified) {
        setStatus("#receipt-verification-status", "Pago verificado y confirmado por caja.");
      } else if (status === "rejected") {
        setStatus("#receipt-verification-status", "Caja rechazó el pago. Revisa el comprobante o contacta a caja por WhatsApp.", true);
      } else {
        setStatus("#receipt-verification-status", "El pago sigue pendiente. Esta consulta revisa el estado de la tienda; no consulta al banco. Caja debe verificar el abono antes de confirmarlo.");
      }
    } catch (error) {
      console.error("No se pudo consultar el estado del pago.", error);
      setStatus("#receipt-verification-status", error.message || "No se pudo consultar el estado. Inténtalo de nuevo.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function updateReceiptPaymentReference(event) {
    event.preventDefault();
    const receipt = document.querySelector("#order-receipt");
    const form = event.currentTarget;
    const reference = String(form.elements.payment_reference.value).trim();
    const submitButton = form.querySelector('button[type="submit"]');
    if (!/^[0-9]{4,20}$/.test(reference)) {
      setStatus("#receipt-reference-status", "La referencia debe tener entre 4 y 20 dígitos.", true);
      return;
    }
    submitButton.disabled = true;
    setStatus("#receipt-reference-status", "Actualizando la referencia…");
    try {
      const { error } = await supabase.rpc("update_mobile_payment_reference", {
        p_order_id: receipt.dataset.orderId,
        p_payment_reference: reference,
      });
      if (error) throw error;
      setStatus("#receipt-reference-status", "Referencia actualizada. El pago continúa pendiente hasta que caja confirme el abono.");
    } catch (error) {
      console.error("No se pudo actualizar la referencia bancaria.", error);
      setStatus("#receipt-reference-status", error.message || "No se pudo actualizar la referencia.", true);
    } finally {
      submitButton.disabled = false;
    }
  }

  function timelineMarkup(status, fulfillment) {
    const steps = fulfillment === "delivery"
      ? [
        ["received", "Pedido recibido"],
        ["preparing", "En preparación"],
        ["ready", "Listo para enviar"],
        ["delivering", "En camino"],
        ["delivered", "Entregado"],
      ]
      : [
        ["received", "Pedido recibido"],
        ["preparing", "En preparación"],
        ["ready", "Listo para retirar"],
        ["delivered", "Entregado"],
      ];
    const activeIndex = steps.findIndex(([key]) => key === status);
    if (status === "cancelled") return '<p class="order-cancelled">Este pedido fue cancelado. Contacta a caja si necesitas ayuda.</p>';
    return `<ol class="order-timeline">${steps.map(([key, label], index) => {
      const reached = activeIndex >= 0 && index <= activeIndex;
      return `<li class="${reached ? "reached" : ""}${key === status ? " current" : ""}"><span class="timeline-dot" aria-hidden="true"></span><span>${label}</span></li>`;
    }).join("")}</ol>`;
  }

  function renderOrders(orders, itemsByOrder) {
    if (!orders.length) {
      ordersList.innerHTML = '<div class="institutional-card"><p>Aún no tienes pedidos. Cuando completes una compra aparecerá aquí.</p><a class="institutional-action" href="/catalogo" data-app-route="catalog">Explorar catálogo</a></div>';
      return;
    }
    ordersList.innerHTML = orders.map((order) => {
      const items = itemsByOrder.get(order.id) || [];
      const date = new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at));
      const isMobilePaymentPending = order.payment_status === "pending_verification";
      const qrPurpose = order.fulfillment === "delivery" && order.order_status === "delivering"
        ? "delivery"
        : order.fulfillment === "pickup"
          && order.payment_method === "cash_pos"
          && order.payment_status === "awaiting_in_store"
          && !["delivered", "cancelled"].includes(order.order_status)
          ? "pickup"
          : "";
      return `<article class="customer-order-card">
        <header class="customer-order-header"><div><span class="eyebrow">PEDIDO</span><h2>${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2></div><time datetime="${escapeHtml(order.created_at)}">${escapeHtml(date)}</time></header>
        <p class="order-payment-status ${isMobilePaymentPending ? "pending" : ""}">${escapeHtml(paymentStatusLabels[order.payment_status] || "Estado de pago pendiente")}</p>
        ${timelineMarkup(order.order_status, order.fulfillment)}
        <ul class="customer-order-items">${items.map((item) => `<li><span>${escapeHtml(item.product_name)} × ${item.quantity}</span><strong>${currency.format(Number(item.line_total_usd))}</strong></li>`).join("")}</ul>
        <div class="customer-order-total"><span>Total</span><strong>${currency.format(Number(order.total_usd))}${order.total_ves === null ? "" : `<small>${escapeHtml(formatBolivares(Number(order.total_ves)))} · referencial</small>`}</strong></div>
        <p class="customer-order-delivery">${order.fulfillment === "delivery" ? "Delivery" : "Retiro en tienda"}${order.fulfillment === "delivery" && order.delivery_address ? ` · ${escapeHtml(order.delivery_address)}` : ""}</p>
        ${qrPurpose ? `<section class="order-qr-ticket" data-order-qr="${escapeHtml(order.id)}" data-qr-purpose="${qrPurpose}"><h3>${qrPurpose === "delivery" ? "Muestra este código QR al repartidor al recibir tu pedido" : "Ticket de retiro en caja"}</h3><img alt="${qrPurpose === "delivery" ? "Código QR de confirmación de entrega" : "Código QR para retirar el pedido"}" /><p role="status" aria-live="polite">Preparando código seguro…</p></section>` : ""}
      </article>`;
    }).join("");
    renderOrderQrCodes(orders).catch((error) => {
      console.error("No se pudieron preparar los códigos QR de los pedidos.", error);
    });
  }

  async function renderOrderQrCodes(orders) {
    const ticketSections = [...ordersList.querySelectorAll("[data-order-qr]")];
    await Promise.all(ticketSections.map(async (section) => {
      const status = section.querySelector('[role="status"]');
      try {
        if (typeof window.qrcode !== "function") throw new Error("No se cargó el generador QR. Revisa tu conexión e inténtalo de nuevo.");
        const { data: token, error } = await supabase.rpc("issue_store_order_qr_code", {
          p_order_id: section.dataset.orderQr,
          p_purpose: section.dataset.qrPurpose,
        });
        if (error) throw error;
        const scanUrl = new URL(section.dataset.qrPurpose === "delivery" ? "/delivery/" : "/admin/", window.location.origin);
        scanUrl.hash = new URLSearchParams({ scan: section.dataset.qrPurpose, token }).toString();
        const qr = window.qrcode(0, "M");
        qr.addData(scanUrl.toString());
        qr.make();
        section.querySelector("img").src = qr.createDataURL(5, 4);
        status.textContent = section.dataset.qrPurpose === "delivery"
          ? "Muestra este código al repartidor cuando recibas tu pedido."
          : "Muestra este código en caja. Pagarás al retirar.";
      } catch (error) {
        console.error(`No se pudo generar el código QR del pedido ${section.dataset.orderQr}.`, error);
        status.textContent = error.message || "No se pudo generar el código QR. Intenta actualizar tus pedidos.";
        status.classList.add("error");
      }
    }));
  }

  async function loadOrders() {
    if (!currentUser) {
      setStatus("#orders-status", "Inicia sesión para consultar el historial y seguimiento de tus pedidos.");
      ordersList.replaceChildren();
      return;
    }
    const requestId = ++ordersRequest;
    setStatus("#orders-status", "Cargando tus pedidos…");
    const { data: orders, error: ordersError } = await supabase
      .from("store_orders")
      .select("id,fulfillment,delivery_address,payment_method,payment_status,order_status,total_usd,total_ves,created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    if (ordersError) throw ordersError;
    if (requestId !== ordersRequest || !currentUser) return;
    if (!orders.length) {
      renderOrders([], new Map());
      setStatus("#orders-status", "");
      return;
    }
    const { data: items, error: itemsError } = await supabase
      .from("store_order_items")
      .select("order_id,product_name,quantity,line_total_usd")
      .in("order_id", orders.map((order) => order.id));
    if (itemsError) throw itemsError;
    if (requestId !== ordersRequest || !currentUser) return;
    const itemsByOrder = new Map();
    for (const item of items) {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    }
    renderOrders(orders, itemsByOrder);
    setStatus("#orders-status", "");
  }

  function subscribeToOrders() {
    if (!currentUser || !supabase) return;
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    realtimeChannel = supabase
      .channel(`customer-orders-${currentUser.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "store_orders",
        filter: `user_id=eq.${currentUser.id}`,
      }, () => {
        loadOrders().catch((error) => {
          console.error("No se pudo actualizar el seguimiento del pedido.", error);
          setStatus("#orders-status", error.message || "No se pudo actualizar el seguimiento.", true);
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`El canal de seguimiento de pedidos terminó con estado ${status}.`);
        }
      });
  }

  async function initialize() {
    if (!supabase) {
      setStatus("#customer-auth-status", "La tienda no está conectada a Supabase. Inténtalo más tarde.", true);
      document.querySelector("#checkout-button").disabled = true;
      updateInstalledAppAccess(null);
      return;
    }
    restorePendingCheckout();
    try {
      const saved = JSON.parse(localStorage.getItem(exchangeRateStorageKey) || "null");
      if (saved && Number.isFinite(saved.value) && saved.value > 0 && saved.date) {
        exchangeRate = saved.value;
        exchangeRateDate = saved.date;
        exchangeRateIsStale = true;
      }
    } catch (error) {
      console.error("No se pudo recuperar la última tasa BCV guardada.", error);
    }
    refreshExchangeRate();
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      setAuthenticatedUser(data.session?.user || null);
      if (location.pathname.replace(/\/+$/, "") === "/pedidos") {
        await loadOrders();
      }
    } catch (error) {
      console.error("No se pudo validar la sesión del cliente.", error);
      setStatus("#customer-auth-status", error.message || "No se pudo validar tu sesión.", true);
      updateInstalledAppAccess(null);
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticatedUser(session?.user || null);
    });
  }

  document.querySelector("#customer-login-tab").addEventListener("click", () => setAuthTab("login"));
  document.querySelector("#customer-signup-tab").addEventListener("click", () => setAuthTab("signup"));
  document.querySelector("#customer-google-auth").addEventListener("click", async (event) => {
    if (!supabase) return;
    if (requestedItems.length && !persistPendingCheckout(requestedItems)) return;
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("#customer-auth-status", "Conectando con Google…");
    try {
      sessionStorage.setItem(oauthReturnStorageKey, "1");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // The Google OAuth provider redirects to Supabase's /auth/v1/callback; redirectTo is the app's post-login URL.
          // Keep the app destination at the root because GitHub Pages does not serve arbitrary deep routes directly.
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
    } catch (error) {
      try {
        sessionStorage.removeItem(oauthReturnStorageKey);
      } catch (storageError) {
        console.error("No se pudo limpiar el retorno pendiente de Google.", storageError);
      }
      console.error("No se pudo iniciar el acceso con Google.", error);
      setStatus("#customer-auth-status", error.message || "No se pudo iniciar el acceso con Google.", true);
      button.disabled = false;
    }
  });
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus("#customer-auth-status", "Iniciando sesión…");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginForm.elements.email.value.trim(),
        password: loginForm.elements.password.value,
      });
      if (error) throw error;
      setStatus("#customer-auth-status", "");
    } catch (error) {
      console.error("No se pudo iniciar sesión del cliente.", error);
      setStatus("#customer-auth-status", error.message || "No se pudo iniciar sesión.", true);
    } finally {
      button.disabled = false;
    }
  });
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = signupForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus("#customer-auth-status", "Creando tu cuenta…");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupForm.elements.email.value.trim(),
        password: signupForm.elements.password.value,
        options: {
          data: {
            full_name: signupForm.elements.full_name.value.trim(),
            phone: signupForm.elements.phone.value.trim(),
          },
        },
      });
      if (error) throw error;
      if (data.session) {
        setStatus("#customer-auth-status", "Cuenta creada. Ya puedes completar tu pedido.");
      } else {
        customerAuthCard.hidden = false;
        profileForm.hidden = true;
        setStatus("#customer-auth-status", "Cuenta creada. Revisa tu correo y confirma la cuenta antes de iniciar sesión.");
      }
    } catch (error) {
      console.error("No se pudo crear la cuenta del cliente.", error);
      setStatus("#customer-auth-status", error.message || "No se pudo crear la cuenta.", true);
    } finally {
      button.disabled = false;
    }
  });
  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    const button = profileForm.querySelector('button[type="submit"]');
    button.disabled = true;
    let profileSaved = false;
    setStatus("#customer-profile-status", "Guardando tus datos…");
    try {
      const profile = {
        user_id: currentUser.id,
        full_name: profileForm.elements.full_name.value.trim(),
        phone: profileForm.elements.phone.value.trim(),
        default_address: profileForm.elements.default_address.value.trim(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("customer_profiles").upsert(profile);
      if (error) throw error;
      const { error: userUpdateError } = await supabase.auth.updateUser({
        data: { full_name: profile.full_name, phone: profile.phone },
      });
      if (userUpdateError) throw userUpdateError;
      setStatus("#customer-profile-status", "Datos guardados.", false);
      profileSaved = true;
    } catch (error) {
      console.error("No se pudo guardar el perfil.", error);
      setStatus("#customer-profile-status", error.message || "No se pudieron guardar tus datos.", true);
    } finally {
      button.disabled = false;
    }
    if (profileSaved && document.documentElement.classList.contains("installed-app")) {
      document.dispatchEvent(new CustomEvent("kristal:navigate", { detail: { path: "/" } }));
    }
  });
  document.querySelector("#customer-sign-out").addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("No se pudo cerrar la sesión del cliente.", error);
      setStatus("#customer-profile-status", error.message || "No se pudo cerrar sesión.", true);
      return;
    }
    setStatus("#customer-auth-status", "Has cerrado sesión.");
  });
  checkoutForm.addEventListener("change", (event) => {
    if (event.target.name === "payment_method") {
      setCheckoutPaymentFields();
      if (event.target.value === "mobile_payment") openPaymentDataSheet();
    }
    if (event.target.name === "fulfillment") setFulfillmentFields();
  });
  document.querySelectorAll("[data-evidence-tab]").forEach((tab) => {
    tab.addEventListener("click", () => setPaymentEvidenceMode(tab.dataset.evidenceTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll("[data-evidence-tab]")];
      const nextIndex = (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[nextIndex].focus();
      setPaymentEvidenceMode(tabs[nextIndex].dataset.evidenceTab);
    });
  });
  document.querySelector("#open-payment-details").addEventListener("click", openPaymentDataSheet);
  document.querySelector("#payment-data-close").addEventListener("click", () => paymentDataDialog.close());
  document.querySelector("#payment-data-done").addEventListener("click", () => paymentDataDialog.close());
  document.querySelectorAll("[data-copy-payment]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyValue);
        document.dispatchEvent(new CustomEvent("kristal:toast", { detail: { message: "¡Copiado al portapapeles!" } }));
      } catch (error) {
        console.error("No se pudieron copiar los datos de Pago Móvil.", error);
        document.dispatchEvent(new CustomEvent("kristal:toast", { detail: { message: "No se pudo copiar. Mantén pulsado el dato para seleccionarlo." } }));
      }
    });
  });
  checkoutForm.elements.payment_reference.addEventListener("input", (event) => {
    const input = event.currentTarget;
    const invalid = input.value.length > 0 && !/^[0-9]{4,20}$/.test(input.value);
    input.setCustomValidity(invalid ? "Ingresa una referencia de 4 a 20 dígitos." : "");
    setStatus("#checkout-reference-status", invalid ? "La referencia debe contener entre 4 y 20 dígitos." : "");
  });
  document.querySelector("#receipt-reference-form").elements.payment_reference.addEventListener("input", (event) => {
    const input = event.currentTarget;
    const invalid = input.value.length > 0 && !/^[0-9]{4,20}$/.test(input.value);
    input.setCustomValidity(invalid ? "Ingresa una referencia de 4 a 20 dígitos." : "");
    setStatus("#receipt-reference-status", invalid ? "La referencia debe contener entre 4 y 20 dígitos." : "");
  });
  checkoutForm.addEventListener("submit", createOrder);
  document.querySelector("#receipt-refresh-payment").addEventListener("click", (event) => {
    refreshReceiptPaymentStatus(event.currentTarget);
  });
  document.querySelector("#receipt-reference-form").addEventListener("submit", updateReceiptPaymentReference);
  document.querySelector("#store-checkout-close").addEventListener("click", () => checkoutDialog.close());
  checkoutDialog.addEventListener("close", () => {
    document.body.classList.remove("checkout-open");
    if (paymentDataDialog.open) paymentDataDialog.close();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#order-receipt [data-app-route]") && checkoutDialog.open) checkoutDialog.close();
  });
  document.querySelector("#checkout-copy-ves").addEventListener("click", async (event) => {
    const amount = event.currentTarget.dataset.amount;
    if (!amount) return;
    try {
      await navigator.clipboard.writeText(amount);
      setStatus("#checkout-copy-status", "Monto en bolívares copiado.");
    } catch (error) {
      console.error("No se pudo copiar el monto en bolívares.", error);
      setStatus("#checkout-copy-status", "No se pudo copiar. Mantén pulsado el monto para seleccionarlo.", true);
    }
  });
  document.addEventListener("kristal:checkout-request", (event) => {
    handleCheckoutRequest(event).catch((error) => {
      console.error("No se pudo abrir el checkout.", error);
      setStatus("#checkout-status", error.message || "No se pudo abrir el checkout.", true);
    });
  });
  document.addEventListener("kristal:account-view", (event) => {
    if (event.detail?.view === "orders") {
      loadOrders().catch((error) => {
        console.error("No se pudieron cargar tus pedidos.", error);
        setStatus("#orders-status", error.message || "No se pudieron cargar tus pedidos.", true);
      });
    }
  });
  document.addEventListener("kristal:navigate", (event) => {
    if (event.detail?.path) history.pushState(null, "", event.detail.path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  initialize();
})();
