(() => {
  const roleStorageKey = "kristal.auth.role";
  const destinations = {
    admin: "/admin/",
    operator: "/cashier/",
    courier: "/delivery/",
    client: "/",
  };

  function roleForUser(user) {
    const rawRole = user?.app_metadata?.role;
    if (rawRole == null || rawRole === "") return "client";
    const role = String(rawRole).toLowerCase();
    if (role === "customer") return "client";
    if (role === "cashier") return "operator";
    if (role === "delivery") return "courier";
    return Object.hasOwn(destinations, role) ? role : null;
  }

  function destinationForUser(user) {
    const role = roleForUser(user);
    return role ? destinations[role] : null;
  }

  function currentPathMatches(destination) {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const targetPath = destination.replace(/\/+$/, "") || "/";
    if (destination === "/cashier/") return path === "/cashier" || path === "/caja";
    return path === targetPath;
  }

  function isStorefrontPath() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    return [
      "/", "/index.html", "/client", "/catalogo", "/perfil", "/pedidos",
      "/nosotros", "/tienda", "/politicas", "/preguntas-resenas",
    ].includes(path)
      || path.startsWith("/client/")
      || path.startsWith("/departamento/");
  }

  function clearSavedRole() {
    try {
      window.localStorage.removeItem(roleStorageKey);
    } catch (error) {
      console.error("No se pudo limpiar el rol guardado.", error);
    }
  }

  function redirectSession(session) {
    if (!session?.user) return false;
    const role = roleForUser(session.user);
    if (!role) {
      clearSavedRole();
      return false;
    }
    try {
      window.localStorage.setItem(roleStorageKey, role);
    } catch (error) {
      console.error("No se pudo guardar el rol verificado de la sesión.", error);
    }
    const destination = destinations[role];
    if (isStorefrontPath()) {
      let authRedirect = new URL(window.location.href).searchParams.get("auth-redirect") === "1";
      try {
        authRedirect = authRedirect || window.sessionStorage.getItem("kristal.auth.redirect") === "1";
        window.sessionStorage.removeItem("kristal.auth.redirect");
      } catch (error) {
        console.error("No se pudo comprobar la navegación posterior al inicio de sesión.", error);
      }
      if (!authRedirect) return false;
      if (role === "client") {
        const url = new URL(window.location.href);
        url.searchParams.delete("auth-redirect");
        window.history.replaceState(window.history.state, "", url);
        return false;
      }
    }
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const isAdminPreview = role === "admin"
      && ["/cashier", "/caja", "/delivery"].some((route) => path === route || path.startsWith(`${route}/`));
    if (isAdminPreview) return false;
    if (!currentPathMatches(destination)) {
      window.location.replace(destination);
      return true;
    }
    return false;
  }

  window.kristalAuthRouting = { destinationForUser, redirectSession };
  const supabase = window.kristalSupabase;
  if (!supabase) return;

  supabase.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      if (data.session) redirectSession(data.session);
      else clearSavedRole();
    })
    .catch((error) => {
      console.error("No se pudo resolver el destino de la sesión.", error);
    });

  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      redirectSession(session);
      return;
    }
    if (event === "SIGNED_OUT") {
      clearSavedRole();
    }
  });
})();
