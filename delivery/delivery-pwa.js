(() => {
  const installButton = document.querySelector("#delivery-install-app");
  const status = document.querySelector("#delivery-auth-status");
  let deferredPrompt = null;

  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function setInstallButtonVisibility() {
    installButton.hidden = isInstalled();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    setInstallButtonVisibility();
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        status.textContent = "Para instalar en iPhone, abre Compartir y selecciona «Añadir a pantalla de inicio».";
        status.classList.remove("error");
      } else {
        status.textContent = "Abre el menú del navegador y selecciona «Instalar aplicación» o «Añadir a pantalla de inicio».";
        status.classList.remove("error");
      }
      return;
    }

    installButton.disabled = true;
    try {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      await prompt.prompt();
      await prompt.userChoice;
      setInstallButtonVisibility();
    } catch (error) {
      console.error("No se pudo instalar Kristal Reparto.", error);
      status.textContent = "No se pudo iniciar la instalación. Inténtalo desde el menú del navegador.";
      status.classList.add("error");
    } finally {
      installButton.disabled = false;
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    setInstallButtonVisibility();
  });

  setInstallButtonVisibility();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js")
        .catch((error) => {
          console.error("No se pudo preparar Kristal Reparto para instalar.", error);
          status.textContent = "No se pudo preparar la app para instalar. Revisa tu conexión.";
          status.classList.add("error");
        });
    });
  }
})();
