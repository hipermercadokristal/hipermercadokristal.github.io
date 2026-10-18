(() => {
  const fallbacks = [
    {
      terms: ["viveres", "harinas", "alacena", "despensa"],
      url: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=500",
    },
    {
      terms: ["lacteos", "refrigerados"],
      url: "https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=500",
    },
    {
      terms: ["bebidas", "refrescos"],
      url: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500",
    },
    {
      terms: ["limpieza", "cuidado del hogar"],
      url: "https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=500",
    },
    {
      terms: ["cuidado personal", "higiene"],
      url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500",
    },
    {
      terms: ["charcuteria", "carnes", "carnes y aves"],
      url: "https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=500",
    },
    {
      terms: ["snacks", "golosinas", "confiteria"],
      url: "https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=500",
    },
  ];
  const normalize = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  window.KRISTAL_PRODUCT_IMAGE_FALLBACKS = Object.freeze(fallbacks.map((fallback) => Object.freeze(fallback)));
  window.getKristalProductFallbackImage = (department) => {
    const normalizedDepartment = normalize(department);
    const match = fallbacks.find(({ terms }) => terms.some((term) => normalizedDepartment.includes(normalize(term))));
    return match?.url || "/assets/products/imported-product-placeholder.svg";
  };
})();
