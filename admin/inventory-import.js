(() => {
  const supabase = window.kristalSupabase;
  const form = document.querySelector("#inventory-import-form");
  const fileInput = document.querySelector("#inventory-import-file");
  const previewButton = document.querySelector("#inventory-import-preview");
  const submitButton = document.querySelector("#inventory-import-submit");
  const status = document.querySelector("#inventory-import-status");
  const previewWrap = document.querySelector("#inventory-import-preview-wrap");
  const previewRows = document.querySelector("#inventory-import-preview-rows");
  const reportElement = document.querySelector("#inventory-import-report");
  let preparedRows = [];
  let skippedRows = [];
  let sourceRowCount = 0;
  let consolidatedInputRows = 0;
  let dailyDealColumnsAvailable = true;

  const aliases = {
    barcode: ["codigosku", "sku", "codigodebarras", "codigo", "ean", "barcode", "codigoproducto", "plu"],
    name: ["nombreproducto", "descripcion", "descripciondelproducto", "producto", "nombre", "articulo", "item"],
    presentation: ["presentacion", "presentacionproducto", "empaque", "contenido", "tamano", "unidadmedida", "size", "presentation"],
    department: ["departamento", "categoria", "departamentocategoria", "category", "department", "rubro"],
    image: ["imagen", "imagenurl", "urlimagen", "image", "imageurl", "foto", "fotourl"],
    usd: ["precioenusd", "preciodolares", "precioendolares", "preciodolar", "priceusd", "usd", "preciousd", "preciosd"],
    ves: ["precioenves", "precioves", "precioenbs", "preciobs", "preciobsf", "bolivares", "priceves", "ves"],
    stock: ["stockactual", "stock", "existencia", "existencias", "inventario", "cantidad"],
  };
  const presentationPattern = /(?:\d+(?:[.,]\d+)?\s*(?:kgs?|g|gr|gramos?|mg|lts?|litros?|l|ml|cc|cl|oz|lbs?|unidades?|unds?|u|piezas?|packs?|paquetes?))$/i;
  const fuzzyIgnoredWords = new Set([
    "aceite", "arroz", "azucar", "bebida", "detergente", "harina", "jabon", "leche",
    "liquido", "liquida", "polvo", "producto", "refresco", "vegetal", "en", "de", "del",
    "la", "las", "el", "los", "para", "con",
  ]);

  function setStatus(message, isError = false, isSuccess = false) {
    status.textContent = message;
    status.classList.toggle("import-row-error", isError);
    status.classList.toggle("success", isSuccess);
  }

  function isMissingDailyDealColumns(error) {
    return ["42703", "PGRST204"].includes(error?.code)
      && /es_oferta_dia|oferta_dia_hasta/i.test(error.message || "");
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function normalizeSku(value) {
    return String(value ?? "").trim().toLocaleLowerCase("es-VE");
  }

  function isValidImageUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
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
    const words = (value) => String(getNameOnly(value) || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => word && !fuzzyIgnoredWords.has(word));
    const leftWords = words(left);
    const rightWords = words(right);
    const a = leftWords.join("");
    const b = rightWords.join("");
    if (!a || !b) return 0;
    if (a === b) return 1;
    const hasComparableToken = leftWords.some((leftWord) => rightWords.some((rightWord) =>
      leftWord === rightWord
      || (leftWord.length >= 4
        && rightWord.length >= 4
        && leftWord.slice(0, 3) === rightWord.slice(0, 3)
        && Math.abs(leftWord.length - rightWord.length) <= 2)));
    if (!hasComparableToken) return 0;
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
    const editSimilarity = 1 - previous[b.length] / Math.max(a.length, b.length);
    const leftSet = new Set(leftWords);
    const rightSet = new Set(rightWords);
    const commonWords = [...leftSet].filter((word) => rightSet.has(word));
    const tokenSimilarity = 2 * commonWords.length / (leftSet.size + rightSet.size);
    return Math.max(editSimilarity, tokenSimilarity * 0.88);
  }

  function getNameOnly(name) {
    return getNameAndPresentation(name, "").name;
  }

  async function loadExistingProducts() {
    const pageSize = 1000;
    const products = [];
    for (let offset = 0; ; offset += pageSize) {
      let query = supabase
        .from("productos")
        .select("id,nombre,codigo_barras,categoria_id,imagen_url,imagen_path,presentacion,precio_oferta,es_destacado,es_oferta_dia,oferta_dia_hasta,disponible,stock,stock_tracked,created_at,deleted_at,deleted_by")
        .order("id")
        .range(offset, offset + pageSize - 1);
      let { data, error } = await query;
      if (error && isMissingDailyDealColumns(error)) {
        dailyDealColumnsAvailable = false;
        query = supabase
          .from("productos")
          .select("id,nombre,codigo_barras,categoria_id,imagen_url,imagen_path,presentacion,precio_oferta,es_destacado,disponible,stock,stock_tracked,created_at,deleted_at,deleted_by")
          .order("id")
          .range(offset, offset + pageSize - 1);
        ({ data, error } = await query);
      }
      if (error) throw error;
      products.push(...data);
      if (data.length < pageSize) return products;
    }
  }

  function isPlaceholder(product) {
    return String(product.imagen_url || "").includes("imported-product-placeholder.svg");
  }

  function preferExistingProduct(left, right, categoryId) {
    const leftScore = Number(!left.deleted_at) * 4 + Number(!isPlaceholder(left)) * 2 + Number(left.categoria_id === categoryId);
    const rightScore = Number(!right.deleted_at) * 4 + Number(!isPlaceholder(right)) * 2 + Number(right.categoria_id === categoryId);
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
    skippedRows = [];
    sourceRowCount = 0;
    previewRows.replaceChildren();
    previewWrap.hidden = true;
    if (reportElement) {
      reportElement.hidden = true;
      reportElement.textContent = "";
    }
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
      if (Object.entries(candidate).every(([key, index]) => ["barcode", "stock", "presentation", "image"].includes(key) || index >= 0)) {
        headerRow = rowIndex;
        fields = candidate;
        break;
      }
    }
    if (headerRow < 0) throw new Error("No se encontraron encabezados compatibles para nombre, departamento y precios USD/VES en las primeras 20 filas.");
    const inputRows = sheetRows.slice(headerRow + 1)
      .map((cells, index) => ({ cells, rowNumber: headerRow + index + 2 }))
      .filter(({ cells }) => cells.some((cell) => String(cell ?? "").trim() !== ""));
    if (!inputRows.length) throw new Error("La hoja no contiene productos debajo de los encabezados.");
    if (inputRows.length > 10000) throw new Error("El archivo supera el límite de 10.000 filas por importación.");
    sourceRowCount = inputRows.length;

    const { data: categories, error } = await supabase.from("categorias").select("id,nombre,departamento");
    if (error) throw error;
    if (typeof window.getKristalProductFallbackImage !== "function") {
      throw new Error("No se cargó el mapeo de imágenes por departamento. Recarga Administración e inténtalo de nuevo.");
    }
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
    const parsedRows = inputRows.map(({ cells, rowNumber }) => {
      const barcode = fields.barcode >= 0 ? String(cells[fields.barcode] ?? "").trim() : "";
      const sourceName = String(cells[fields.name] ?? "").trim();
      const explicitPresentation = fields.presentation >= 0
        ? String(cells[fields.presentation] ?? "").trim()
        : "";
      const { name, presentation } = getNameAndPresentation(sourceName, explicitPresentation);
      const familyIdentity = getProductFamilyIdentity(name);
      const productIdentity = getProductIdentity(name, presentation);
      const departmentInput = String(cells[fields.department] ?? "").trim();
      const departmentKey = normalize(departmentInput);
      const existingCategory = categoryByName.get(departmentKey);
      const departmentName = existingCategory?.departamento
        || (departmentKey ? formatDepartmentName(departmentInput) : "");
      const imageUrl = fields.image >= 0 ? String(cells[fields.image] ?? "").trim() : "";
      const priceUsd = parseNumber(cells[fields.usd]);
      const priceVes = parseNumber(cells[fields.ves]);
      const stockText = fields.stock >= 0 ? String(cells[fields.stock] ?? "").trim() : "";
      const stock = stockText ? parseNumber(stockText) : null;
      const errors = [];
      if (barcode.length > 80) errors.push("código supera 80 caracteres");
      if (!name || name.length > 140) errors.push("descripción");
      if (!departmentKey) errors.push("departamento vacío");
      else if (!existingCategory && departmentName.length > 120) errors.push("departamento supera 120 caracteres");
      if (imageUrl && !isValidImageUrl(imageUrl)) errors.push("URL de imagen");
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) errors.push("precio USD");
      if (!Number.isFinite(priceVes) || priceVes < 0) errors.push("precio VES");
      if (stockText && (!Number.isFinite(stock) || stock < 0 || stock > 100000000)) errors.push("stock");
      return {
        rowNumber,
        productIdentity: familyIdentity
          ? `${familyIdentity}|${normalize(presentation || getNameAndPresentation(name, "").presentation)}`
          : productIdentity,
        barcode,
        name,
        departmentName,
        imageUrl,
        fallbackImageUrl: window.getKristalProductFallbackImage(departmentName || departmentInput),
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
    const consolidatedRows = [];
    const rowsBySku = new Map();
    const rowsByName = new Map();
    const rowsWithoutSkuByName = new Map();
    consolidatedInputRows = 0;
    parsedRows.forEach((row) => {
      const nameKey = row.productIdentity ? `name:${getProductIdentity(row.name, row.presentation)}` : "";
      const skuKey = row.barcode ? `sku:${normalizeSku(row.barcode)}` : "";
      let existingIndex = skuKey ? rowsBySku.get(skuKey) : undefined;

      if (existingIndex === undefined && skuKey && nameKey) {
        const nameOnlyIndex = rowsWithoutSkuByName.get(nameKey);
        if (nameOnlyIndex !== undefined && !consolidatedRows[nameOnlyIndex].barcode) {
          existingIndex = nameOnlyIndex;
        }
      }
      if (existingIndex === undefined && !skuKey && nameKey) {
        const matchingSkuRows = [...(rowsByName.get(nameKey) || [])]
          .filter((index) => `name:${getProductIdentity(consolidatedRows[index].name, consolidatedRows[index].presentation)}` === nameKey);
        if (matchingSkuRows.length === 1) {
          existingIndex = matchingSkuRows[0];
        } else {
          existingIndex = rowsWithoutSkuByName.get(nameKey);
        }
      }
      if (existingIndex === undefined && !row.error && nameKey) {
        const fuzzyCandidates = consolidatedRows
          .map((candidate, index) => ({
            candidate,
            index,
            similarity: getNameSimilarity(candidate.name, row.name),
          }))
          .filter(({ candidate, similarity }) => !candidate.error
            && candidate.departmentKey === row.departmentKey
            && isSamePresentation(candidate, row)
            && similarity >= 0.74
            && !(skuKey && candidate.barcode && normalizeSku(candidate.barcode) !== normalizeSku(row.barcode)))
          .sort((left, right) => right.similarity - left.similarity);
        if (fuzzyCandidates.length === 1
          || (fuzzyCandidates[0]?.similarity >= 0.84
            && fuzzyCandidates[0].similarity - (fuzzyCandidates[1]?.similarity || 0) >= 0.12)) {
          existingIndex = fuzzyCandidates[0].index;
        }
      }

      if (existingIndex !== undefined) {
        const existingRow = consolidatedRows[existingIndex];
        consolidatedRows[existingIndex] = {
          ...row,
          barcode: row.barcode || existingRow.barcode,
          imageUrl: row.imageUrl || existingRow.imageUrl,
        };
        if (nameKey && !rowsByName.has(nameKey)) rowsByName.set(nameKey, new Set());
        if (nameKey) rowsByName.get(nameKey).add(existingIndex);
        if (skuKey) rowsBySku.set(skuKey, existingIndex);
        if (nameKey && rowsWithoutSkuByName.get(nameKey) === existingIndex) rowsWithoutSkuByName.delete(nameKey);
        consolidatedInputRows += 1;
      } else {
        existingIndex = consolidatedRows.push(row) - 1;
        if (skuKey) rowsBySku.set(skuKey, existingIndex);
        if (nameKey) {
          const matchingRows = rowsByName.get(nameKey) || new Set();
          matchingRows.add(existingIndex);
          rowsByName.set(nameKey, matchingRows);
          if (!skuKey) rowsWithoutSkuByName.set(nameKey, existingIndex);
        }
      }
    });
    preparedRows = consolidatedRows;

    skippedRows = preparedRows
      .filter((row) => row.error)
      .map((row) => ({ row: row.rowNumber, sku: row.barcode || null, name: row.name, error: row.error }));
    const rowsToShow = preparedRows.length <= 100
      ? preparedRows
      : [...preparedRows.slice(0, 100), ...preparedRows.filter((row) => row.error && row.rowNumber > (preparedRows[99]?.rowNumber || 0)).slice(0, 200)];
    previewRows.innerHTML = rowsToShow.map((row) => `<tr>
      <td data-label="Fila">${row.rowNumber}</td>
      <td data-label="Código">${escapeHtml(row.barcode)}</td>
      <td data-label="Producto">${escapeHtml(row.name)}</td>
      <td data-label="Presentación">${escapeHtml(row.presentation || "—")}</td>
      <td data-label="Departamento">${escapeHtml(row.departmentName)}</td>
      <td data-label="Imagen">${row.imageUrl ? "URL del archivo" : "Conservar foto o asignar por departamento"}</td>
      <td data-label="USD">${Number.isFinite(row.priceUsd) ? row.priceUsd.toFixed(2) : "—"}</td>
      <td data-label="VES">${Number.isFinite(row.priceVes) ? row.priceVes.toFixed(2) : "—"}</td>
      <td data-label="Stock">${!row.stockColumnPresent ? "Se conserva" : row.stockTracked ? row.stock : "Sin control"}</td>
      <td data-label="Resultado" class="${row.error ? "import-row-error" : ""}">${escapeHtml(row.error || (row.categoryId ? "Listo" : "Se creará el departamento"))}</td>
    </tr>`).join("");
    previewWrap.hidden = false;
    const validRows = preparedRows.length - skippedRows.length;
    submitButton.disabled = validRows === 0;
    if (reportElement) {
      reportElement.hidden = true;
      reportElement.textContent = "";
    }
    setStatus(`${inputRows.length} filas revisadas; ${consolidatedInputRows} repetidas consolidadas por SKU, coincidencia difusa o nombre/presentación; ${validRows} listas para importar y ${skippedRows.length} se omitirán por errores de formato.${preparedRows.length > 100 ? " La vista previa muestra hasta 100 productos y filas adicionales con errores." : ""}`, skippedRows.length > 0);
  }

  async function importInventory(event) {
    event.preventDefault();
    const validRows = preparedRows.filter((row) => !row.error);
    if (!validRows.length) {
      setStatus("No hay filas válidas para importar. Corrige los errores de la vista previa e inténtalo de nuevo.", true);
      return;
    }

    submitButton.disabled = true;
    previewButton.disabled = true;
    setStatus("Preparando actualización del inventario…");
    let importedCount = 0;
    let consolidatedDuplicateCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    try {
      const missingDepartments = new Map();
      validRows.forEach((row) => {
        if (!row.categoryId && row.departmentKey && !missingDepartments.has(row.departmentKey)) {
          missingDepartments.set(row.departmentKey, row.departmentName);
        }
      });
      const categoryIdByDepartment = new Map(
        validRows
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
      const unresolvedProducts = validRows
        .filter((row) => !categoryIdByDepartment.has(row.departmentKey));
      if (unresolvedProducts.length) {
        throw new Error(`No se encontró una categoría válida para: ${[...new Set(unresolvedProducts.map((row) => row.departmentName))].join(", ")}.`);
      }

      setStatus("Buscando productos existentes por código, nombre y presentación…");
      const existingProducts = await loadExistingProducts();
      const existingByBarcode = new Map();
      const existingByIdentity = new Map();
      const existingByFamily = new Map();
      const existingByCategory = new Map();
      existingProducts.forEach((product) => {
        const categoryProducts = existingByCategory.get(product.categoria_id) || [];
        categoryProducts.push(product);
        existingByCategory.set(product.categoria_id, categoryProducts);
        if (product.codigo_barras) existingByBarcode.set(normalizeSku(product.codigo_barras), product);
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

      const matchedProducts = validRows.map((row) => row.barcode
        ? existingByBarcode.get(normalizeSku(row.barcode)) || null
        : null);
      const usedProductIds = new Set(matchedProducts.filter(Boolean).map((product) => product.id));
      const duplicateProducts = new Map();
      const imageSourceByRow = [];
      validRows.forEach((row, index) => {
        const identity = getProductIdentity(row.name, row.presentation);
        const categoryId = categoryIdByDepartment.get(row.departmentKey);
        const categoryProducts = existingByCategory.get(categoryId) || [];
        const familyIdentity = getProductFamilyIdentity(row.name);
        const familyMatches = existingByFamily.get(familyIdentity) || [];
        const findImageSources = (products) => products
          .filter((product) => !isPlaceholder(product))
          .map((product) => ({
            product,
            similarity: getNameSimilarity(getNameOnly(product.nombre), row.name),
            sameFamily: Boolean(familyIdentity && getProductFamilyIdentity(product.nombre) === familyIdentity),
          }))
          .filter(({ similarity, sameFamily }) => sameFamily || similarity >= 0.68);
        const categoryImageSources = findImageSources(categoryProducts);
        const imageSources = (categoryImageSources.length
          ? categoryImageSources
          : findImageSources(existingProducts))
          .sort((left, right) => Number(right.sameFamily) - Number(left.sameFamily)
            || right.similarity - left.similarity
            || preferExistingProduct(left.product, right.product, categoryId));
        const bestImage = imageSources[0];
        const imageIsUnambiguous = bestImage && (
          imageSources.length === 1
          || bestImage.sameFamily
          || bestImage.similarity === 1
          || bestImage.similarity - imageSources[1].similarity >= 0.12
        );
        imageSourceByRow[index] = bestImage && imageIsUnambiguous ? bestImage.product : null;
        const exactMatches = (existingByIdentity.get(identity) || [])
          .filter((product) => !usedProductIds.has(product.id))
          .sort((left, right) => preferExistingProduct(left, right, categoryId));
        const sameVariantMatches = familyMatches
          .filter((product) => !usedProductIds.has(product.id)
            && product.categoria_id === categoryId
            && isSamePresentation(product, row))
          .sort((left, right) => preferExistingProduct(left, right, categoryId));
        const fuzzyMatches = categoryProducts
          .filter((product) => !usedProductIds.has(product.id)
            && isSamePresentation(product, row))
          .map((product) => ({
            product,
            similarity: getNameSimilarity(getNameOnly(product.nombre), row.name),
          }))
          .filter(({ similarity }) => similarity >= 0.74)
          .sort((left, right) => right.similarity - left.similarity
            || preferExistingProduct(left.product, right.product, categoryId));
        const barcodeMatch = matchedProducts[index];
        let preferredVariant = exactMatches[0] || sameVariantMatches[0] || null;
        if (!preferredVariant && fuzzyMatches.length) {
          const hasUnambiguousBestMatch = fuzzyMatches.length === 1
            || (fuzzyMatches[0].similarity >= 0.84
              && fuzzyMatches[0].similarity - (fuzzyMatches[1]?.similarity || 0) >= 0.12);
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
        const duplicateUpdates = [...duplicateProducts.values()];
        const duplicateIds = duplicateUpdates.map((product) => product.id);
        setStatus(`Consolidando ${duplicateIds.length} producto${duplicateIds.length === 1 ? "" : "s"} duplicado${duplicateIds.length === 1 ? "" : "s"}…`);
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("La sesión de administración expiró. Inicia sesión de nuevo para consolidar duplicados.");
        const importedBarcodes = new Set(validRows.map((row) => normalizeSku(row.barcode)).filter(Boolean));
        const barcodeConflicts = duplicateUpdates
          .filter((product) => importedBarcodes.has(normalizeSku(product.codigo_barras)))
          .map((product) => product.id);
        if (barcodeConflicts.length) {
          const { error } = await supabase
            .from("productos")
            .update({ codigo_barras: null, updated_at: new Date().toISOString() })
            .in("id", barcodeConflicts);
          if (error) throw error;
        }
        const { error } = await supabase
          .from("productos")
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: user.id,
            disponible: false,
            es_destacado: false,
            updated_at: new Date().toISOString(),
          })
          .in("id", duplicateIds);
        if (error) throw error;
        consolidatedDuplicateCount = duplicateIds.length;
      }

      const products = validRows.map((row, index) => {
        const existing = matchedProducts[index];
        const imageSource = imageSourceByRow[index];
        const imageProduct = existing && !isPlaceholder(existing) ? existing : imageSource;
        const retainedDealEnd = existing?.oferta_dia_hasta
          ? new Date(existing.oferta_dia_hasta)
          : null;
        const existingDealExpired = Boolean(existing?.es_oferta_dia)
          && (!retainedDealEnd || retainedDealEnd <= new Date());
        const retainedSalePrice = existing?.precio_oferta !== null
          && existing?.precio_oferta !== undefined
          && !existingDealExpired
          && Number(existing.precio_oferta) < row.priceUsd
          ? existing.precio_oferta
          : null;
        const retainsActiveDeal = Boolean(existing?.es_oferta_dia
          && retainedSalePrice !== null
          && retainedDealEnd
          && retainedDealEnd > new Date());
        return {
          ...(existing ? { id: existing.id } : {}),
          codigo_barras: row.barcode || existing?.codigo_barras || null,
          deleted_at: null,
          deleted_by: null,
          nombre: row.name,
          categoria_id: categoryIdByDepartment.get(row.departmentKey),
          precio: row.priceUsd,
          precio_ves: row.priceVes,
          stock: row.stockColumnPresent ? row.stock : existing?.stock ?? null,
          stock_tracked: row.stockColumnPresent ? row.stockTracked : existing?.stock_tracked ?? false,
          disponible: existing?.disponible ?? true,
          es_destacado: existing?.es_destacado || false,
          ...(dailyDealColumnsAvailable ? {
            es_oferta_dia: retainsActiveDeal,
            oferta_dia_hasta: retainsActiveDeal ? existing.oferta_dia_hasta : null,
          } : {}),
          precio_oferta: retainedSalePrice,
          presentacion: row.presentation || existing?.presentacion || null,
          imagen_url: row.imageUrl || imageProduct?.imagen_url || row.fallbackImageUrl,
          imagen_path: row.imageUrl ? null : imageProduct?.imagen_path || null,
          updated_at: new Date().toISOString(),
        };
      });
      const totalUpdatedCount = products.filter((product) => product.id).length;
      const totalCreatedCount = products.length - totalUpdatedCount;
      const productGroups = [
        products.filter((product) => product.id),
        products.filter((product) => !product.id),
      ];

      for (const [groupIndex, group] of productGroups.entries()) {
        for (let index = 0; index < group.length; index += 200) {
          const batch = group.slice(index, index + 200);
          const { error } = await supabase.from("productos").upsert(batch, { onConflict: "id" });
          if (error) throw error;
          importedCount += batch.length;
          if (groupIndex === 0) updatedCount += batch.length;
          else createdCount += batch.length;
          setStatus(`Inventario actualizado: ${importedCount} de ${products.length} productos…`);
        }
      }
      if (updatedCount !== totalUpdatedCount || createdCount !== totalCreatedCount) {
        throw new Error("El resumen de importación no coincide con los productos confirmados por Supabase.");
      }
      const report = {
        total_rows_received: sourceRowCount,
        total_records_processed: importedCount + skippedRows.length + consolidatedInputRows,
        unique_products_written: importedCount,
        products_updated: updatedCount,
        products_created: createdCount,
        duplicate_rows_consolidated: consolidatedInputRows,
        skipped_rows: skippedRows,
      };
      showImportReport(report);
      setStatus(`Importación completada: ${importedCount} productos procesados, ${updatedCount} actualizados y ${createdCount} nuevos; ${skippedRows.length} filas omitidas.${consolidatedInputRows ? ` Se consolidaron ${consolidatedInputRows} filas repetidas usando la última fila por SKU o nombre/presentación.` : ""}${consolidatedDuplicateCount ? ` Se archivaron ${consolidatedDuplicateCount} duplicados; se conservó el historial de pedidos.` : ""} Las imágenes anteriores se conservaron cuando la URL de la fila estaba vacía.`, false, true);
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
      showImportReport({
        total_rows_received: sourceRowCount,
        total_records_processed: importedCount + skippedRows.length + consolidatedInputRows,
        unique_products_written: importedCount,
        products_updated: updatedCount,
        products_created: createdCount,
        duplicate_rows_consolidated: consolidatedInputRows,
        skipped_rows: skippedRows,
        import_error: error.message || "No se pudo completar la importación.",
      });
      submitButton.disabled = false;
    } finally {
      previewButton.disabled = false;
    }

    function showImportReport(report) {
      if (reportElement) {
        reportElement.textContent = JSON.stringify(report, null, 2);
        reportElement.hidden = false;
      }
      window.dispatchEvent(new CustomEvent("kristal:inventory-import-report", { detail: report }));
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
    skippedRows = [];
    sourceRowCount = 0;
    previewWrap.hidden = true;
    submitButton.disabled = true;
    if (reportElement) {
      reportElement.hidden = true;
      reportElement.textContent = "";
    }
    setStatus("");
  });
  form.addEventListener("submit", importInventory);
})();
