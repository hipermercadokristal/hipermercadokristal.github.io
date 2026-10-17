(() => {
  const installButton = document.querySelector("#staff-install-app");
  const installStatus = document.querySelector("#staff-install-status");
  let deferredPrompt = null;

  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function updateVisibility() {
    installButton.hidden = isInstalled();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    updateVisibility();
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      installStatus.textContent = "En Microsoft Edge o Chrome, abre el menú del navegador y elige «Instalar Hipermercado Kristal».";
      return;
    }

    installButton.disabled = true;
    try {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      await prompt.prompt();
      await prompt.userChoice;
      updateVisibility();
    } catch (error) {
      console.error("No se pudo instalar este módulo de Hipermercado Kristal.", error);
      installStatus.textContent = "No se pudo iniciar la instalación. Inténtalo desde el menú del navegador.";
    } finally {
      installButton.disabled = false;
    }
  });

  window.addEventListener("appinstalled", updateVisibility);
  updateVisibility();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js")
        .catch((error) => {
          console.error("No se pudo preparar este módulo para instalación.", error);
          installStatus.textContent = "No se pudo preparar la instalación. Revisa tu conexión.";
        });
    });
  }
})();
