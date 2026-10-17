(() => {
  const roleStorageKey = "kristal.auth.role";
  const destinations = {
    admin: "/admin/",
    operator: "/cashier/",
    courier: "/delivery/",
    client: "/client/",
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
    if (destination === "/client/") return path === "/" || path === "/client";
    if (destination === "/cashier/") return path === "/cashier" || path === "/caja";
    return path === destination.replace(/\/+$/, "");
  }

  function redirectSession(session) {
    if (!session?.user) return false;
    const role = roleForUser(session.user);
    if (!role) return false;
    try {
      window.localStorage.setItem(roleStorageKey, role);
    } catch (error) {
      console.error("No se pudo guardar el rol verificado de la sesión.", error);
    }
    const destination = destinations[role];
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
      redirectSession(data.session);
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
      try {
        window.localStorage.removeItem(roleStorageKey);
      } catch (error) {
        console.error("No se pudo limpiar el rol guardado al cerrar sesión.", error);
      }
    }
  });
})();
