(() => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js")
        .catch((error) => {
          console.error("No se pudo preparar este módulo para uso sin conexión.", error);
        });
    });
  }
})();
