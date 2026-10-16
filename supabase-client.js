(() => {
  const config = window.KRISTAL_SUPABASE_CONFIG;
  if (!config?.url || !config.anonKey || !window.supabase?.createClient) {
    window.kristalSupabase = null;
    return;
  }

  console.info(
    "[Kristal Auth] URI de redirección autorizada en Google Cloud Console:",
    `${config.url.replace(/\/+$/, "")}/auth/v1/callback`,
  );
  window.kristalSupabase = window.supabase.createClient(config.url, config.anonKey);
})();
