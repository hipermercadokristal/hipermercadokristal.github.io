const chatPanel = document.querySelector("#kristal-chat-panel");
const chatToggle = document.querySelector("#kristal-chat-toggle");
const chatClose = document.querySelector("#kristal-chat-close");
const chatMessages = document.querySelector("#kristal-chat-messages");
const chatForm = document.querySelector("#kristal-chat-form");
const chatInput = document.querySelector("#kristal-chat-input");
const chatQuickReplies = document.querySelector("#kristal-chat-quick-replies");
const chatWhatsAppNumber = "584128867088";
let waitingForOrderReference = false;

function normalizeChatText(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function appendChatMessage(text, sender, actions = []) {
  const message = document.createElement("article");
  message.className = `kristal-chat-message is-${sender}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.append(paragraph);

  actions.forEach((action) => {
    const link = document.createElement("a");
    link.className = "kristal-chat-action";
    link.textContent = action.label;
    link.href = action.href;
    if (action.external) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else if (action.appRoute) {
      link.dataset.appRoute = action.appRoute;
    } else if (action.openPaymentDetails) {
      link.dataset.openPaymentDetails = "";
    } else {
      link.dataset.route = "";
    }
    message.append(link);
  });

  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function whatsappAction(message) {
  return {
    label: "Abrir WhatsApp de Atención",
    href: `https://wa.me/${chatWhatsAppNumber}?text=${encodeURIComponent(message)}`,
    external: true,
  };
}

function customerOrdersAction() {
  return {
    label: "Ver mis pedidos",
    href: "/pedidos",
    appRoute: "orders",
  };
}

const chatTopics = {
  pagos: {
    customerMessage: "💳 Métodos de pago",
    response: {
      text: "💳 Aceptamos Pago Móvil, Zelle con instrucciones coordinadas con caja y Pago en Caja (efectivo o punto de venta al recibir). Datos de Pago Móvil: Banco de Venezuela 0102, Provincial 0108, Banesco 0134 o Mercantil 0105; teléfono 04245104430; cédula/RIF V-26199919. No tenemos publicados números de cuenta ni datos de Zelle; solicítalos directamente a caja antes de transferir.",
      actions: [{
        label: "Ver datos de Pago Móvil",
        href: "#",
        openPaymentDetails: true,
      }],
    },
  },
  ubicacion: {
    customerMessage: "🕒 Horario y ubicación",
    response: {
      text: "🕒 Lunes a sábado, 7:00 a. m. a 9:00 p. m.; domingo, 7:00 a. m. a 12:00 p. m. 📍 Hipermercado Kristal está en Villa Bruzual, municipio Turén, estado Portuguesa. La dirección de calle no está publicada; puedes abrir el mapa para llegar.",
      actions: [
        {
          label: "Abrir ubicación en el mapa",
          href: "https://www.google.com/maps/search/?api=1&query=9.3273659%2C-69.1198186",
          external: true,
        },
        whatsappAction("Hola, ¿me comparten la dirección exacta de Hipermercado Kristal?"),
      ],
    },
  },
  delivery: {
    customerMessage: "🛵 Tarifas de Delivery",
    response: {
      text: "🛵 La tarifa actualmente configurada en la tienda es US$ 4 por delivery. No hay tarifas distintas publicadas por zona; confirma con Atención al Cliente si tu sector tiene cobertura y si aplica ese cargo.",
      actions: [whatsappAction("Hola, quisiera confirmar si mi zona tiene cobertura de delivery y cuál es su tarifa.")],
    },
  },
  pedido: {
    customerMessage: "📦 Consultar Pedido",
    response: {
      text: "📦 Para proteger la información de tu compra, el estado solo se consulta desde tu cuenta. Inicia sesión en “Mis pedidos” para revisar retiro o delivery. Si necesitas que Atención al Cliente te ayude, escribe tu número de orden o teléfono abajo; no se enviará hasta que abras WhatsApp.",
      actions: [customerOrdersAction()],
    },
    askForOrderReference: true,
  },
  asesor: {
    customerMessage: "💬 Hablar con un Asesor (WhatsApp)",
    response: {
      text: "Con gusto. Se abrirá WhatsApp con un mensaje para Atención al Cliente; podrás revisarlo antes de enviarlo.",
      actions: [whatsappAction("Hola, necesito ayuda de Atención al Cliente de Hipermercado Kristal.")],
    },
  },
};

function submitChatMessage(value) {
  const text = value.trim();
  if (!text) return;

  if (waitingForOrderReference) {
    waitingForOrderReference = false;
    chatInput.placeholder = "Elige un tema o escribe tu consulta…";
    appendChatMessage("Preparé el mensaje, pero no envié tus datos. Si eliges abrir WhatsApp, podrás revisar y enviar la consulta al equipo.", "assistant", [
      whatsappAction(`Hola, necesito ayuda para consultar mi pedido. Mi número de orden o teléfono es: ${text.slice(0, 100)}.`),
      customerOrdersAction(),
    ]);
    return;
  }

  appendChatMessage(text, "customer");
  const normalizedText = normalizeChatText(text);
  const matchingTopic = Object.values(chatTopics).find((topic) =>
    normalizeChatText(topic.customerMessage).includes(normalizedText)
    || normalizedText.includes(normalizeChatText(topic.customerMessage.replace(/^[^\p{L}\p{N}]+/u, ""))),
  );

  if (matchingTopic) {
    appendChatMessage(matchingTopic.response.text, "assistant", matchingTopic.response.actions);
    if (matchingTopic.askForOrderReference) {
      waitingForOrderReference = true;
      chatInput.placeholder = "Número de orden o teléfono (opcional)";
    }
    return;
  }

  if (/catalogo|producto|oferta|precio/.test(normalizedText)) {
    appendChatMessage("Puedes explorar los productos publicados en el catálogo. Para confirmar precio o disponibilidad, consulta al equipo.", "assistant", [
      { label: "Explorar catálogo", href: "/catalogo" },
    ]);
    return;
  }

  appendChatMessage("Puedo ayudarte con métodos de pago, horario y ubicación, tarifas de delivery o pedidos. También puedes hablar con Atención al Cliente por WhatsApp.", "assistant", [
    whatsappAction(`Hola, necesito ayuda con: ${text.slice(0, 250)}`),
  ]);
}

function setChatOpen(isOpen) {
  chatPanel.hidden = !isOpen;
  chatPanel.setAttribute("aria-hidden", String(!isOpen));
  chatToggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    chatClose.focus();
    return;
  }
  waitingForOrderReference = false;
  chatInput.placeholder = "Elige un tema o escribe tu consulta…";
  chatToggle.focus();
}

chatToggle.addEventListener("click", () => setChatOpen(chatPanel.hidden));
chatClose.addEventListener("click", () => setChatOpen(false));

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitChatMessage(chatInput.value);
  chatInput.value = "";
  chatInput.focus();
});

chatQuickReplies.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chat-topic]");
  const topic = chatTopics[button?.dataset.chatTopic];
  if (!topic) return;
  appendChatMessage(topic.customerMessage, "customer");
  appendChatMessage(topic.response.text, "assistant", topic.response.actions);
  if (topic.askForOrderReference) {
    waitingForOrderReference = true;
    chatInput.placeholder = "Número de orden o teléfono (opcional)";
    chatInput.focus();
  }
});

chatMessages.addEventListener("click", (event) => {
  const paymentDetailsLink = event.target.closest("[data-open-payment-details]");
  if (!paymentDetailsLink) return;
  event.preventDefault();
  const paymentDetailsButton = document.querySelector("#open-payment-details");
  if (!paymentDetailsButton) {
    appendChatMessage("No se pudieron abrir los datos de pago. Intenta desde el proceso de compra o consulta a caja.", "assistant");
    return;
  }
  paymentDetailsButton.click();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chatPanel.hidden) setChatOpen(false);
  if (event.key !== "Tab" || chatPanel.hidden) return;
  const focusable = [...chatPanel.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)')];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
