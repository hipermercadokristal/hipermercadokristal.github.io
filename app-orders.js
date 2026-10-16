(() => {
  const supabase = window.kristalSupabase;
  const customerAuthCard = document.querySelector("#customer-auth-card");
  const loginForm = document.querySelector("#customer-login-form");
  const signupForm = document.querySelector("#customer-signup-form");
  const profileForm = document.querySelector("#customer-profile-form");
  const checkoutDialog = document.querySelector("#store-checkout-dialog");
  const checkoutForm = document.querySelector("#store-checkout-form");
  const ordersList = document.querySelector("#customer-orders-list");
  const currency = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
  const bolivares = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const exchangeRateUrl = "https://ve.dolarapi.com/v1/dolares/oficial";
  const exchangeRateStorageKey = "restaurant-kristal-bcv-rate";
  const pendingCheckoutStorageKey = "kristal-pending-checkout-v1";
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
    pending_verification: "Pendiente de verificación por caja",
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
    checkoutForm.elements.payment_reference.required = mobilePayment;
    checkoutForm.elements.payment_proof.required = mobilePayment;
    if (method === "zelle") {
      setStatus("#checkout-method-note", "Solicita a caja los datos e instrucciones de Zelle antes de transferir. Tu pedido quedará pendiente de coordinación.");
    } else if (method === "cash_pos") {
      setStatus("#checkout-method-note", "Pagarás en efectivo o punto de venta al recibir o retirar tu pedido.");
    }
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
    const selectedProof = formData.get("payment_proof");
    let proofPath = null;
    const orderId = crypto.randomUUID();
    submitButton.disabled = true;
    setStatus("#checkout-status", "Registrando tu pedido de forma segura…");

    try {
      if (paymentMethod === "mobile_payment" && exchangeRate === null && !(await refreshExchangeRate())) {
        throw new Error("No está disponible la tasa BCV para calcular el monto en bolívares. Elige otro método o confirma el monto con caja.");
      }
      if (paymentMethod === "mobile_payment") {
        if (!(selectedProof instanceof File) || !selectedProof.size) {
          throw new Error("Adjunta el comprobante de Pago Móvil.");
        }
        if (!paymentProofTypes.has(selectedProof.type) || selectedProof.size > paymentProofMaxBytes) {
          throw new Error("El comprobante debe ser JPG, PNG, WebP o PDF y no superar 5 MB.");
        }
        proofPath = `${currentUser.id}/${orderId}/${safeFileName(selectedProof.name)}`;
        const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(proofPath, selectedProof, {
          contentType: selectedProof.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
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
        p_payment_reference: paymentMethod === "mobile_payment" ? String(formData.get("payment_reference")).trim() : null,
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
      const message = [
        "Hola, registré un pedido en la app de Hipermercado Kristal.",
        `Pedido: ${order.order_id}`,
        `Total: ${currency.format(Number(order.total_usd))}`,
        order.total_ves === null ? "" : `Equivalente referencial: ${formatBolivares(Number(order.total_ves))}`,
        paymentMethod === "mobile_payment" ? "Pago Móvil: pendiente de verificación por caja." : "Por favor, confirmar coordinación del pago.",
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
      return `<article class="customer-order-card">
        <header class="customer-order-header"><div><span class="eyebrow">PEDIDO</span><h2>${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2></div><time datetime="${escapeHtml(order.created_at)}">${escapeHtml(date)}</time></header>
        <p class="order-payment-status ${isMobilePaymentPending ? "pending" : ""}">${escapeHtml(paymentStatusLabels[order.payment_status] || "Estado de pago pendiente")}</p>
        ${timelineMarkup(order.order_status, order.fulfillment)}
        <ul class="customer-order-items">${items.map((item) => `<li><span>${escapeHtml(item.product_name)} × ${item.quantity}</span><strong>${currency.format(Number(item.line_total_usd))}</strong></li>`).join("")}</ul>
        <div class="customer-order-total"><span>Total</span><strong>${currency.format(Number(order.total_usd))}${order.total_ves === null ? "" : `<small>${escapeHtml(formatBolivares(Number(order.total_ves)))} · referencial</small>`}</strong></div>
        <p class="customer-order-delivery">${order.fulfillment === "delivery" ? "Delivery" : "Retiro en tienda"}${order.fulfillment === "delivery" && order.delivery_address ? ` · ${escapeHtml(order.delivery_address)}` : ""}</p>
      </article>`;
    }).join("");
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
      .select("id,fulfillment,delivery_address,payment_status,order_status,total_usd,total_ves,created_at")
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/perfil`,
        },
      });
      if (error) throw error;
    } catch (error) {
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
    } catch (error) {
      console.error("No se pudo guardar el perfil.", error);
      setStatus("#customer-profile-status", error.message || "No se pudieron guardar tus datos.", true);
    } finally {
      button.disabled = false;
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
    if (event.target.name === "payment_method") setCheckoutPaymentFields();
    if (event.target.name === "fulfillment") setFulfillmentFields();
  });
  checkoutForm.addEventListener("submit", createOrder);
  document.querySelector("#store-checkout-close").addEventListener("click", () => checkoutDialog.close());
  checkoutDialog.addEventListener("close", () => document.body.classList.remove("checkout-open"));
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
