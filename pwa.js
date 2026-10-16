const installAppButtons = [...document.querySelectorAll("[data-install-app]")];
let deferredInstallPrompt = null;

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

async function installApp() {
  if (!deferredInstallPrompt) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isAndroid) {
      window.location.assign("/downloads/hipermercado-kristal.apk");
      return;
    }
    if (!isIOS) {
      window.location.assign("/downloads/hipermercado-kristal.apk");
      showToast("Descargando el APK para Android. Pásalo a tu teléfono Android para instalarlo.");
      return;
    }
    showToast("En iPhone, Safari exige usar Compartir > «Añadir a pantalla de inicio»; no permite iniciar la instalación desde un botón.");
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
  showToast("Hipermercado Kristal quedó instalada en tu dispositivo.");
});

if (isAppInstalled()) {
  installAppButtons.forEach((button) => {
    button.hidden = true;
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js")
      .catch((error) => {
        console.error("No se pudo habilitar el modo app de Hipermercado Kristal.", error);
        showToast("No se pudo preparar la instalación de la app. Revisa tu conexión e inténtalo de nuevo.");
      });
  });
}
