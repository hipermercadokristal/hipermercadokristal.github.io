(() => {
  const supabase = window.kristalSupabase;
  const form = document.querySelector("#inventory-import-form");
  const fileInput = document.querySelector("#inventory-import-file");
  const previewButton = document.querySelector("#inventory-import-preview");
  const submitButton = document.querySelector("#inventory-import-submit");
  const status = document.querySelector("#inventory-import-status");
  const previewWrap = document.querySelector("#inventory-import-preview-wrap");
  const previewRows = document.querySelector("#inventory-import-preview-rows");
  let preparedRows = [];

  const aliases = {
    barcode: ["codigodebarras", "codigo", "ean", "barcode", "codigoproducto", "plu"],
    name: ["descripcion", "descripciondelproducto", "producto", "nombre", "articulo", "item"],
    presentation: ["presentacion", "presentacionproducto", "empaque", "contenido", "tamano", "unidadmedida", "size", "presentation"],
    department: ["departamento", "categoria", "departamentocategoria", "category", "department", "rubro"],
    usd: ["precioenusd", "preciodolares", "precioendolares", "preciodolar", "priceusd", "usd", "preciousd", "preciosd"],
    ves: ["precioenves", "precioves", "precioenbs", "preciobs", "preciobsf", "bolivares", "priceves", "ves"],
    stock: ["stockactual", "stock", "existencia", "existencias", "inventario", "cantidad"],
  };
  const presentationPattern = /(?:\d+(?:[.,]\d+)?\s*(?:kgs?|g|gr|gramos?|mg|lts?|litros?|l|ml|cc|cl|oz|lbs?|unidades?|unds?|u|piezas?|packs?|paquetes?))$/i;

  function setStatus(message, isError = false, isSuccess = false) {
    status.textContent = message;
    status.classList.toggle("import-row-error", isError);
    status.classList.toggle("success", isSuccess);
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function formatDepartmentName(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("es-VE")
      .replace(/(^|[\s-])(\p{L})/gu, (_match, separator, letter) =>
        `${separator}${letter.toLocaleUpperCase("es-VE")}`);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let text = String(value ?? "").trim().replace(/[^\d,.-]/g, "");
    if (!text) return NaN;
    const comma = text.lastIndexOf(",");
    const period = text.lastIndexOf(".");
    if (comma >= 0 && period >= 0) {
      text = comma > period
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
    } else if (comma >= 0) {
      text = text.replace(",", ".");
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : NaN;
  }

  function getNameAndPresentation(name, explicitPresentation) {
    const cleanName = String(name ?? "").trim().replace(/(^|[^\d])\s+kg(?:s)?[.,;:]?$/i, "$1").trim();
    if (explicitPresentation) return { name: cleanName || name, presentation: explicitPresentation };
    const match = cleanName.match(presentationPattern);
    if (!match) return { name: cleanName, presentation: "" };
    const baseName = cleanName.slice(0, match.index).replace(/[\s,;:/-]+$/, "").trim();
    return baseName
      ? { name: baseName, presentation: match[0].trim() }
      : { name: cleanName, presentation: "" };
  }

  function getProductIdentity(name, presentation) {
    const parsed = getNameAndPresentation(name, "");
    const normalizedName = normalize(parsed.name);
    const normalizedPresentation = normalize(presentation || parsed.presentation);
    return normalizedName ? `${normalizedName}|${normalizedPresentation}` : "";
  }

  function getProductFamilyIdentity(name) {
    const parsedName = getNameAndPresentation(name, "").name;
    const words = String(parsedName ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.includes("leche")) {
      const milkDescriptors = new Set(["completa", "descremada", "entera", "en", "liquida", "polvo", "semidescremada"]);
      const familyWords = words.filter((word) => !milkDescriptors.has(word));
      return familyWords.length > 1 ? familyWords.join(" ") : "";
    }
    return "";
  }

  function getNormalizedPresentation(name, presentation) {
    return normalize(presentation || getNameAndPresentation(name, "").presentation);
  }

  function isSamePresentation(leftProduct, rightProduct) {
    return getNormalizedPresentation(leftProduct.nombre, leftProduct.presentacion)
      === getNormalizedPresentation(rightProduct.name, rightProduct.presentation);
  }

  function getNameSimilarity(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (Math.abs(a.length - b.length) > 2) return 0;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
        );
      }
      previous = current;
    }
    return 1 - previous[b.length] / Math.max(a.length, b.length);
  }

  function getNameOnly(name) {
    return getNameAndPresentation(name, "").name;
  }

  async function loadExistingProducts() {
    const pageSize = 1000;
    const products = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("productos")
        .select("id,nombre,codigo_barras,categoria_id,imagen_url,imagen_path,presentacion,precio_oferta,es_destacado,disponible,stock,stock_tracked,created_at")
        .is("deleted_at", null)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      products.push(...data);
      if (data.length < pageSize) return products;
    }
  }

  function isPlaceholder(product) {
    return String(product.imagen_url || "").includes("imported-product-placeholder.svg");
  }

  function preferExistingProduct(left, right, categoryId) {
    const leftScore = Number(!isPlaceholder(left)) * 2 + Number(left.categoria_id === categoryId);
    const rightScore = Number(!isPlaceholder(right)) * 2 + Number(right.categoria_id === categoryId);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return String(left.created_at || "").localeCompare(String(right.created_at || ""));
  }

  function findFieldIndex(headers, keys) {
    const normalizedHeaders = headers.map(normalize);
    for (const key of keys) {
      const match = normalizedHeaders.indexOf(key);
      if (match >= 0) return match;
    }
    return -1;
  }

  async function prepareImport() {
    submitButton.disabled = true;
    preparedRows = [];
    previewRows.replaceChildren();
    previewWrap.hidden = true;
    if (!window.XLSX) throw new Error("No se cargó el lector Excel. Recarga Administración e inténtalo de nuevo.");
    if (!supabase) throw new Error("No hay conexión con Supabase.");
    const file = fileInput.files[0];
    if (!file) throw new Error("Selecciona un archivo Excel o CSV.");
    if (file.size > 20 * 1024 * 1024) throw new Error("El archivo no puede superar 20 MB.");

    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("El archivo no contiene una hoja de inventario.");
    const sheetRows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    if (!sheetRows.length) throw new Error("La primera hoja del archivo está vacía.");
    let headerRow = -1;
    let fields = null;
    for (let rowIndex = 0; rowIndex < Math.min(sheetRows.length, 20); rowIndex += 1) {
      const candidate = Object.fromEntries(
        Object.entries(aliases).map(([key, values]) => [key, findFieldIndex(sheetRows[rowIndex], values)]),
      );
      if (Object.entries(candidate).every(([key, index]) => ["stock", "presentation"].includes(key) || index >= 0)) {
        headerRow = rowIndex;
        fields = candidate;
        break;
      }
    }
    if (headerRow < 0) throw new Error("No se encontraron encabezados compatibles para código de barras, descripción, departamento y precios USD/VES en las primeras 20 filas.");
    const inputRows = sheetRows.slice(headerRow + 1)
      .map((cells, index) => ({ cells, rowNumber: headerRow + index + 2 }))
      .filter(({ cells }) => cells.some((cell) => String(cell ?? "").trim() !== ""));
    if (!inputRows.length) throw new Error("La hoja no contiene productos debajo de los encabezados.");
    if (inputRows.length > 10000) throw new Error("El archivo supera el límite de 10.000 filas por importación.");

    const { data: categories, error } = await supabase.from("categorias").select("id,nombre,departamento");
    if (error) throw error;
    const categoryByName = new Map();
    for (const category of categories) {
      const name = normalize(category.nombre);
      const department = normalize(category.departamento);
      if (!categoryByName.has(name) || name === department) {
        categoryByName.set(name, category);
      }
      if (name === department || !categoryByName.has(department)) {
        categoryByName.set(department, category);
      }
    }
    const seenBarcodes = new Set();
    const seenProductIdentities = new Set();
    preparedRows = inputRows.map(({ cells, rowNumber }) => {
      const barcode = String(cells[fields.barcode] ?? "").trim();
      const sourceName = String(cells[fields.name] ?? "").trim();
      const explicitPresentation = fields.presentation >= 0
        ? String(cells[fields.presentation] ?? "").trim()
        : "";
      const { name, presentation } = getNameAndPresentation(sourceName, explicitPresentation);
      const familyIdentity = getProductFamilyIdentity(name);
      const productIdentity = familyIdentity
        ? `${familyIdentity}|${normalize(presentation || getNameAndPresentation(name, "").presentation)}`
        : getProductIdentity(name, presentation);
      const departmentInput = String(cells[fields.department] ?? "").trim();
      const departmentKey = normalize(departmentInput);
      const existingCategory = categoryByName.get(departmentKey);
      const departmentName = existingCategory?.departamento
        || (departmentKey ? formatDepartmentName(departmentInput) : "");
      const priceUsd = parseNumber(cells[fields.usd]);
      const priceVes = parseNumber(cells[fields.ves]);
      const stockText = fields.stock >= 0 ? String(cells[fields.stock] ?? "").trim() : "";
      const stock = stockText ? parseNumber(stockText) : null;
      const errors = [];
      if (!barcode || barcode.length > 80) errors.push("código");
      else if (seenBarcodes.has(barcode)) errors.push("código duplicado");
      else seenBarcodes.add(barcode);
      if (productIdentity && seenProductIdentities.has(productIdentity)) errors.push("producto y presentación duplicados en el archivo");
      else if (productIdentity) seenProductIdentities.add(productIdentity);
      if (!name || name.length > 140) errors.push("descripción");
      if (!departmentKey) errors.push("departamento vacío");
      else if (!existingCategory && departmentName.length > 120) errors.push("departamento supera 120 caracteres");
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) errors.push("precio USD");
      if (!Number.isFinite(priceVes) || priceVes < 0) errors.push("precio VES");
      if (stockText && (!Number.isFinite(stock) || stock < 0 || stock > 100000000)) errors.push("stock");
      return {
        rowNumber,
        barcode,
        name,
        departmentName,
        categoryId: existingCategory?.id || null,
        departmentKey,
        priceUsd,
        priceVes,
        stock,
        stockTracked: stockText !== "",
        stockColumnPresent: fields.stock >= 0,
        presentation,
        error: errors.join(", "),
      };
    });

    const invalidRows = preparedRows.filter((row) => row.error);
    const rowsToShow = preparedRows.length <= 100
      ? preparedRows
      : [...preparedRows.slice(0, 100), ...invalidRows.filter((row) => row.rowNumber > (preparedRows[99]?.rowNumber || 0)).slice(0, 200)];
    previewRows.innerHTML = rowsToShow.map((row) => `<tr>
      <td data-label="Fila">${row.rowNumber}</td>
      <td data-label="Código">${escapeHtml(row.barcode)}</td>
      <td data-label="Producto">${escapeHtml(row.name)}</td>
      <td data-label="Presentación">${escapeHtml(row.presentation || "—")}</td>
      <td data-label="Departamento">${escapeHtml(row.departmentName)}</td>
      <td data-label="USD">${Number.isFinite(row.priceUsd) ? row.priceUsd.toFixed(2) : "—"}</td>
      <td data-label="VES">${Number.isFinite(row.priceVes) ? row.priceVes.toFixed(2) : "—"}</td>
      <td data-label="Stock">${!row.stockColumnPresent ? "Se conserva" : row.stockTracked ? row.stock : "Sin control"}</td>
      <td data-label="Resultado" class="${row.error ? "import-row-error" : ""}">${escapeHtml(row.error || (row.categoryId ? "Listo" : "Se creará el departamento"))}</td>
    </tr>`).join("");
    previewWrap.hidden = false;
    const invalidCount = preparedRows.filter((row) => row.error).length;
    submitButton.disabled = invalidCount > 0;
    setStatus(`${preparedRows.length} filas revisadas; ${invalidCount} con errores.${preparedRows.length > 100 ? ` La vista previa muestra las primeras 100 y hasta 200 filas con error.${invalidCount > 300 ? " Corrige también las demás filas marcadas en el archivo." : ""}` : ""}`, invalidCount > 0);
  }

  async function importInventory(event) {
    event.preventDefault();
    const invalidRows = preparedRows.filter((row) => row.error);
    if (!preparedRows.length || invalidRows.length) {
      setStatus("Primero corrige y vuelve a revisar las filas marcadas.", true);
      return;
    }

    submitButton.disabled = true;
    previewButton.disabled = true;
    setStatus("Preparando actualización del inventario…");
    let importedCount = 0;
    let consolidatedDuplicateCount = 0;
    try {
      const missingDepartments = new Map();
      preparedRows.forEach((row) => {
        if (!row.categoryId && row.departmentKey && !missingDepartments.has(row.departmentKey)) {
          missingDepartments.set(row.departmentKey, row.departmentName);
        }
      });
      const categoryIdByDepartment = new Map(
        preparedRows
          .filter((row) => row.categoryId)
          .map((row) => [row.departmentKey, row.categoryId]),
      );
      if (missingDepartments.size) {
        setStatus(`Creando ${missingDepartments.size} departamento${missingDepartments.size === 1 ? "" : "s"} nuevo${missingDepartments.size === 1 ? "" : "s"}…`);
        const { data: resolvedDepartments, error: categoryError } = await supabase.rpc(
          "resolve_inventory_departments",
          { p_names: [...missingDepartments.values()] },
        );
        if (categoryError) throw categoryError;
        (resolvedDepartments || []).forEach((department) => {
          categoryIdByDepartment.set(department.normalized_department, department.category_id);
        });
        const unresolvedDepartments = [...missingDepartments.keys()]
          .filter((key) => !categoryIdByDepartment.has(key));
        if (unresolvedDepartments.length) {
          throw new Error(`Supabase no devolvió la categoría creada para: ${unresolvedDepartments.map((key) => missingDepartments.get(key)).join(", ")}.`);
        }
      }
      const unresolvedProducts = preparedRows
        .filter((row) => !categoryIdByDepartment.has(row.departmentKey));
      if (unresolvedProducts.length) {
        throw new Error(`No se encontró una categoría válida para: ${[...new Set(unresolvedProducts.map((row) => row.departmentName))].join(", ")}.`);
      }

      setStatus("Buscando productos existentes por código, nombre y presentación…");
      const existingProducts = await loadExistingProducts();
      const existingByBarcode = new Map();
      const existingByIdentity = new Map();
      const existingByFamily = new Map();
      existingProducts.forEach((product) => {
        if (product.codigo_barras) existingByBarcode.set(product.codigo_barras, product);
        const identity = getProductIdentity(product.nombre, product.presentacion);
        if (identity) {
          const matches = existingByIdentity.get(identity) || [];
          matches.push(product);
          existingByIdentity.set(identity, matches);
        }
        const familyIdentity = getProductFamilyIdentity(product.nombre);
        if (familyIdentity) {
          const family = existingByFamily.get(familyIdentity) || [];
          family.push(product);
          existingByFamily.set(familyIdentity, family);
        }
      });

      const matchedProducts = preparedRows.map((row) => existingByBarcode.get(row.barcode) || null);
      const usedProductIds = new Set(matchedProducts.filter(Boolean).map((product) => product.id));
      const duplicateProducts = new Map();
      const imageSourceByRow = [];
      preparedRows.forEach((row, index) => {
        const identity = getProductIdentity(row.name, row.presentation);
        const categoryId = categoryIdByDepartment.get(row.departmentKey);
        const familyIdentity = getProductFamilyIdentity(row.name);
        const familyMatches = existingByFamily.get(familyIdentity) || [];
        const imageSources = [...familyMatches].sort((left, right) => preferExistingProduct(left, right, categoryId));
        imageSourceByRow[index] = imageSources.find((product) => !isPlaceholder(product)) || null;
        const exactMatches = (existingByIdentity.get(identity) || [])
          .filter((product) => !usedProductIds.has(product.id))
          .sort((left, right) => preferExistingProduct(left, right, categoryId));
        const sameVariantMatches = familyMatches
          .filter((product) => !usedProductIds.has(product.id) && isSamePresentation(product, row))
          .sort((left, right) => preferExistingProduct(left, right, categoryId));
        const fuzzyMatches = existingProducts
          .filter((product) => !usedProductIds.has(product.id)
            && product.categoria_id === categoryId
            && isSamePresentation(product, row))
          .map((product) => ({
            product,
            similarity: getNameSimilarity(getNameOnly(product.nombre), row.name),
          }))
          .filter(({ similarity }) => similarity >= 0.92)
          .sort((left, right) => right.similarity - left.similarity
            || preferExistingProduct(left.product, right.product, categoryId));
        const barcodeMatch = matchedProducts[index];
        let preferredVariant = exactMatches[0] || sameVariantMatches[0] || null;
        if (!preferredVariant && fuzzyMatches.length) {
          const hasUnambiguousBestMatch = fuzzyMatches.length === 1
            || fuzzyMatches[0].similarity - fuzzyMatches[1].similarity >= 0.08;
          if (hasUnambiguousBestMatch) preferredVariant = fuzzyMatches[0].product;
        }
        if (barcodeMatch && isPlaceholder(barcodeMatch) && preferredVariant && !isPlaceholder(preferredVariant)) {
          matchedProducts[index] = preferredVariant;
          duplicateProducts.set(barcodeMatch.id, barcodeMatch);
        } else if (!barcodeMatch && preferredVariant) {
          matchedProducts[index] = preferredVariant;
        }
        const canonical = matchedProducts[index];
        if (!canonical) return;
        usedProductIds.add(canonical.id);
        [...(existingByIdentity.get(identity) || []), ...sameVariantMatches, ...(barcodeMatch ? [barcodeMatch] : [])]
          .forEach((product) => {
            if (product.id !== canonical.id) duplicateProducts.set(product.id, product);
          });
      });

      if (duplicateProducts.size) {
        const duplicateIds = [...duplicateProducts.keys()];
        setStatus(`Consolidando ${duplicateIds.length} producto${duplicateIds.length === 1 ? "" : "s"} duplicado${duplicateIds.length === 1 ? "" : "s"}…`);
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("La sesión de administración expiró. Inicia sesión de nuevo para consolidar duplicados.");
        const importedBarcodes = new Set(preparedRows.map((row) => row.barcode));
        const duplicateUpdates = [...duplicateProducts.values()].map((product) => ({
          ...product,
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
          disponible: false,
          es_destacado: false,
          codigo_barras: importedBarcodes.has(product.codigo_barras) ? null : product.codigo_barras,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase
          .from("productos")
          .upsert(duplicateUpdates, { onConflict: "id" });
        if (error) throw error;
        consolidatedDuplicateCount = duplicateIds.length;
      }

      const products = preparedRows.map((row, index) => {
        const existing = matchedProducts[index];
        const imageSource = imageSourceByRow[index];
        const imageProduct = existing && !isPlaceholder(existing) ? existing : imageSource;
        return {
          ...(existing ? { id: existing.id } : {}),
          codigo_barras: row.barcode,
          nombre: row.name,
          categoria_id: categoryIdByDepartment.get(row.departmentKey),
          precio: row.priceUsd,
          precio_ves: row.priceVes,
          stock: row.stockColumnPresent ? row.stock : existing?.stock ?? null,
          stock_tracked: row.stockColumnPresent ? row.stockTracked : existing?.stock_tracked ?? false,
          disponible: existing?.disponible ?? true,
          es_destacado: existing?.es_destacado || false,
          precio_oferta: existing?.precio_oferta !== null
            && existing?.precio_oferta !== undefined
            && Number(existing.precio_oferta) < row.priceUsd
            ? existing.precio_oferta
            : null,
          presentacion: row.presentation || existing?.presentacion || null,
          imagen_url: imageProduct?.imagen_url || "assets/products/imported-product-placeholder.svg",
          imagen_path: imageProduct?.imagen_path || null,
          updated_at: new Date().toISOString(),
        };
      });
      const updatedCount = products.filter((product) => product.id).length;
      const createdCount = products.length - updatedCount;
      const productGroups = [
        products.filter((product) => product.id),
        products.filter((product) => !product.id),
      ];

      for (const group of productGroups) {
        for (let index = 0; index < group.length; index += 200) {
          const batch = group.slice(index, index + 200);
          const { error } = await supabase.from("productos").upsert(batch, { onConflict: "id" });
          if (error) throw error;
          importedCount += batch.length;
          setStatus(`Inventario actualizado: ${importedCount} de ${products.length} productos…`);
        }
      }
      setStatus(`Importación completada: ${updatedCount} productos actualizados y ${createdCount} nuevos.${consolidatedDuplicateCount ? ` Se archivaron ${consolidatedDuplicateCount} duplicados; se conservó el historial de pedidos.` : ""} Los productos sin foto quedan listos para completar desde el inventario.`, false, true);
      form.reset();
      preparedRows = [];
      previewRows.replaceChildren();
      previewWrap.hidden = true;
      window.dispatchEvent(new CustomEvent("kristal:inventory-imported"));
    } catch (error) {
      console.error("No se pudo completar la importación del inventario.", error);
      const partialProgress = [];
      if (importedCount) partialProgress.push(`Se procesaron ${importedCount} productos`);
      if (consolidatedDuplicateCount) partialProgress.push(`se archivaron ${consolidatedDuplicateCount} productos duplicados`);
      setStatus(
        partialProgress.length
          ? `${partialProgress.join(" y ")} antes del error. Corrige el problema e importa nuevamente; se buscan coincidencias por código, nombre y presentación. ${error.message || ""}`
          : error.message || "No se pudo importar el inventario.",
        true,
      );
      submitButton.disabled = false;
    } finally {
      previewButton.disabled = false;
    }
  }

  previewButton.addEventListener("click", () => {
    prepareImport().catch((error) => {
      console.error("No se pudo leer el archivo de inventario.", error);
      setStatus(error.message || "No se pudo leer el archivo.", true);
    });
  });
  fileInput.addEventListener("change", () => {
    preparedRows = [];
    previewWrap.hidden = true;
    submitButton.disabled = true;
    setStatus("");
  });
  form.addEventListener("submit", importInventory);
})();
