const installAppButtons = [...document.querySelectorAll("[data-install-app]")];
const mobileInstallBanner = document.querySelector("#mobile-install-banner");
const mobileViewport = window.matchMedia("(max-width: 767px)");
let deferredInstallPrompt = null;

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function updateMobileInstallBanner() {
  const visible = mobileViewport.matches && !isAppInstalled();
  mobileInstallBanner.hidden = !visible;
  document.body.classList.toggle("install-banner-visible", visible);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateMobileInstallBanner();
});

async function installApp() {
  if (!deferredInstallPrompt) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    showToast(isIOS
      ? "Para instalar Kristal, toca Compartir y elige «Añadir a pantalla de inicio»."
      : "Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio».");
    return;
  }

  installAppButtons.forEach((installButton) => {
    installButton.disabled = true;
  });
  try {
    const installPrompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    showToast(outcome === "accepted"
      ? "¡Listo! Hipermercado Kristal se está instalando."
      : "Puedes instalar Kristal más tarde desde el menú del navegador.");
  } catch (error) {
    console.error("No se pudo iniciar la instalación de Hipermercado Kristal.", error);
    showToast("No se pudo iniciar la instalación. Inténtalo desde el menú del navegador.");
  } finally {
    installAppButtons.forEach((installButton) => {
      installButton.disabled = false;
    });
  }
}

installAppButtons.forEach((button) => {
  button.addEventListener("click", installApp);
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installAppButtons.forEach((button) => {
    button.hidden = true;
  });
  updateMobileInstallBanner();
  showToast("Hipermercado Kristal quedó instalada en tu dispositivo.");
});

if (isAppInstalled()) {
  installAppButtons.forEach((button) => {
    button.hidden = true;
  });
}

updateMobileInstallBanner();
window.addEventListener("resize", updateMobileInstallBanner);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js")
      .catch((error) => {
        console.error("No se pudo habilitar el modo app de Hipermercado Kristal.", error);
        showToast("No se pudo preparar la instalación de la app. Revisa tu conexión e inténtalo de nuevo.");
      });
  });
}
