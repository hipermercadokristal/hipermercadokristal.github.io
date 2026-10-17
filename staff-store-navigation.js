(() => {
  const supabase = window.kristalSupabase;
  const returnBar = document.querySelector("#staff-store-return");
  const returnLink = document.querySelector("#staff-store-return-link");
  const adminSwitcherWrap = document.querySelector("#admin-view-switcher-wrap");
  const adminSwitchers = [
    document.querySelector("#admin-view-switcher"),
    document.querySelector("#staff-profile-view-switcher"),
  ].filter(Boolean);
  const panelByRole = {
    admin: { label: "Administrador", path: "/admin/" },
    operator: { label: "Caja", path: "/caja/" },
    courier: { label: "Delivery", path: "/delivery/" },
  };

  function updateStaffNavigation(session) {
    const rawRole = session?.user?.app_metadata?.role;
    const role = rawRole === "cashier" ? "operator" : rawRole === "delivery" ? "courier" : rawRole;
    const panel = panelByRole[role];
    document.body.classList.toggle("has-staff-navigation", Boolean(panel));
    if (returnBar) returnBar.hidden = !panel;
    if (returnLink && panel) {
      returnLink.href = panel.path;
      returnLink.textContent = `← Volver a Panel ${panel.label}`;
    }
    if (adminSwitcherWrap) adminSwitcherWrap.hidden = role !== "admin";
    document.querySelector("#staff-profile-shortcuts")?.toggleAttribute("hidden", role !== "admin");
  }

  for (const switcher of adminSwitchers) {
    switcher.addEventListener("change", () => {
      const destination = switcher.value;
      if (destination) window.location.assign(destination);
    });
  }

  if (!supabase) return;
  supabase.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      updateStaffNavigation(data.session);
    })
    .catch((error) => {
      console.error("No se pudo mostrar la navegación de personal en la tienda.", error);
    });

  supabase.auth.onAuthStateChange((_event, session) => updateStaffNavigation(session));
})();
