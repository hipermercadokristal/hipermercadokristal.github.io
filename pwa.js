const installAppButtons = [...document.querySelectorAll("[data-install-app], [data-pwa-install]")];
const apkDownloadLinks = [...document.querySelectorAll("[data-apk-download]")];
const pwaInstallBanner = document.querySelector("#pwa-install-banner");
const announcementInstallButton = document.querySelector("#install-app-button");
let deferredInstallPrompt = null;

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

apkDownloadLinks.forEach((link) => {
  link.hidden = isAppleMobile();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isAppInstalled() && window.matchMedia("(max-width: 767px)").matches && pwaInstallBanner) {
    pwaInstallBanner.hidden = false;
  }
});

async function installApp() {
  if (!deferredInstallPrompt) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      window.location.assign("/downloads/hipermercado-kristal.apk");
      showToast("Descargando el APK para Android. Al terminar, abre el archivo para instalarlo.");
      return;
    }
    if (isAppleMobile()) {
      showToast("En iPhone, Safari exige usar Compartir > «Añadir a pantalla de inicio»; no permite iniciar la instalación desde un botón.");
    } else {
      showToast("En computadora, instala Kristal desde el menú de Chrome o Edge. El APK es solo para Android.");
    }
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
    if (outcome === "accepted" && pwaInstallBanner) pwaInstallBanner.hidden = true;
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

installAppButtons
  .filter((button) => button !== announcementInstallButton)
  .forEach((button) => {
    button.addEventListener("click", installApp);
  });
announcementInstallButton?.addEventListener("click", () => {
  showToast("En iPhone o iPad, abre esta tienda en Safari, toca Compartir y elige «Añadir a pantalla de inicio».");
});
document.querySelector(".pwa-install-dismiss")?.addEventListener("click", () => {
  if (pwaInstallBanner) pwaInstallBanner.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installAppButtons.forEach((button) => {
    button.hidden = true;
  });
  if (pwaInstallBanner) pwaInstallBanner.hidden = true;
  showToast("Hipermercado Kristal quedó instalada en tu dispositivo.");
});

if (isAppInstalled()) {
  installAppButtons.forEach((button) => {
    button.hidden = true;
  });
  if (pwaInstallBanner) pwaInstallBanner.hidden = true;
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
