(() => {
  const config = window.KRISTAL_SUPABASE_CONFIG;
  if (!config?.url || !config.anonKey || !window.supabase?.createClient) {
    window.kristalSupabase = null;
    return;
  }

  window.kristalSupabase = window.supabase.createClient(config.url, config.anonKey);
})();
