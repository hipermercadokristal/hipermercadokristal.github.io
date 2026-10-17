(() => {
  const installButton = document.querySelector("#delivery-install-app");
  const apkDownload = document.querySelector("#delivery-apk-download");
  const status = document.querySelector("#delivery-auth-status");
  let deferredPrompt = null;

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function isAppleMobile() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function setInstallButtonVisibility() {
    const installed = isInstalled();
    installButton.hidden = installed || isAndroid() || isAppleMobile();
    apkDownload.hidden = installed || !isAndroid();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    setInstallButtonVisibility();
  });

  installButton.addEventListener("click", async () => {
    if (isAndroid()) {
      window.location.assign(apkDownload.href);
      return;
    }

    if (!deferredPrompt) {
      status.textContent = "Abre el menú del navegador y selecciona «Instalar aplicación» o «Añadir a pantalla de inicio».";
      status.classList.remove("error");
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
