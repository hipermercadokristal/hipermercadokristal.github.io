(() => {
  const supabase = window.kristalSupabase;
  const loginForm = document.querySelector("#login-form");
  const googleButton = document.querySelector("#google-sign-in-button");
  const status = document.querySelector("#login-status");
  const roleChoices = [...document.querySelectorAll("[data-role-choice]")];
  const allowedRoles = new Set(["client", "operator", "courier", "admin"]);

  function selectRole(role) {
    const selectedRole = allowedRoles.has(role) ? role : "client";
    roleChoices.forEach((choice) => {
      choice.setAttribute("aria-pressed", String(choice.dataset.roleChoice === selectedRole));
    });
    const url = new URL(window.location.href);
    url.searchParams.set("role", selectedRole);
    window.history.replaceState({}, "", url);
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function routeSession(session) {
    if (!session) return false;
    if (!window.kristalAuthRouting?.redirectSession(session)) {
      setStatus("La cuenta inició sesión, pero no tiene un rol reconocido. Contacta al administrador.", true);
    }
    return true;
  }

  const requestedRole = new URLSearchParams(window.location.search).get("role");
  selectRole(requestedRole);
  roleChoices.forEach((choice) => {
    choice.addEventListener("click", () => selectRole(choice.dataset.roleChoice));
  });

  if (!supabase) {
    setStatus("El inicio de sesión no está disponible. Inténtalo de nuevo más tarde.", true);
    loginForm.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
    googleButton.disabled = true;
    return;
  }

  supabase.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      if (data.session) routeSession(data.session);
    })
    .catch((error) => {
      console.error("No se pudo comprobar la sesión existente.", error);
      setStatus(error.message || "No se pudo comprobar tu sesión.", true);
    });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setStatus("Validando tu cuenta…");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.elements.email.value.trim(),
        password: loginForm.elements.password.value,
      });
      if (error) throw error;
      routeSession(data.session);
    } catch (error) {
      console.error("No se pudo iniciar sesión.", error);
      setStatus(error.message || "No se pudo iniciar sesión.", true);
      submitButton.disabled = false;
    }
  });

  googleButton.addEventListener("click", async () => {
    googleButton.disabled = true;
    setStatus("Conectando con Google…");
    try {
      try {
        window.sessionStorage.setItem("kristal.auth.redirect", "1");
      } catch (error) {
        console.error("No se pudo guardar el destino de la sesión antes de abrir Google.", error);
        throw new Error("No se pudo guardar el destino de tu sesión. Habilita el almacenamiento del navegador e inténtalo de nuevo.");
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error) {
      try {
        window.sessionStorage.removeItem("kristal.auth.redirect");
      } catch (cleanupError) {
        console.error("No se pudo limpiar el destino temporal de autenticación.", cleanupError);
      }
      console.error("No se pudo iniciar sesión con Google.", error);
      setStatus(error.message || "No se pudo iniciar sesión con Google.", true);
      googleButton.disabled = false;
    }
  });
})();
