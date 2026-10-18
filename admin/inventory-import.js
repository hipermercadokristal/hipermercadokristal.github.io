(() => {
  const supabase = window.kristalSupabase;
  const form = document.querySelector("#inventory-import-form");
  const fileInput = document.querySelector("#inventory-import-file");
  const previewButton = document.querySelector("#inventory-import-preview");
  const submitButton = document.querySelector("#inventory-import-submit");
  const resetExistingImagesInput = document.querySelector("#inventory-import-reset-existing-images");
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
    id: ["id", "productid", "idproducto", "uuid"],
    barcode: ["codigosku", "sku", "codigodebarras", "codigo", "ean", "barcode", "codigoproducto", "codigoarticulo", "codarticulo", "codigointerno", "artcodigo", "plu"],
    name: ["nombreproducto", "descripcion", "descripciondelproducto", "descripcionarticulo", "artdescripcion", "producto", "nombre", "articulo", "item"],
    presentation: ["presentacion", "presentacionproducto", "empaque", "contenido", "tamano", "unidadmedida", "size", "presentation"],
    department: ["departamento", "categoria", "departamentocategoria", "artcategoria", "category", "department", "rubro", "familia"],
    image: ["imagen", "imagenurl", "urlimagen", "image", "imageurl", "foto", "fotourl"],
    usd: ["precioenusd", "preciodolares", "precioendolares", "preciodolar", "priceusd", "usd", "preciousd", "preciosd", "artpreciopvp"],
    retailPrice: ["pvp", "preciopublico", "preciodeventaalpublico", "precioventa", "preciodeventa", "precio"],
    sale: ["preciooferta", "precioespecial", "preciopromocion", "pricesale", "saleprice", "oferta"],
    ves: ["precioenves", "precioves", "precioenbs", "preciobs", "preciobsf", "bolivares", "priceves", "ves", "pvpves", "pvpbs", "pvpbolivares"],
    stock: ["stockactual", "stock", "existencia", "existencias", "existenciaactual", "artexistencia", "inventario", "cantidad", "cantidadactual", "cant"],
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

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
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
        .select("id,nombre,codigo_barras,categoria_id,imagen_url,imagen_path,presentacion,precio,precio_oferta,es_destacado,es_oferta_dia,oferta_dia_hasta,disponible,stock,stock_tracked,created_at,deleted_at,deleted_by")
        .order("id")
        .range(offset, offset + pageSize - 1);
      let { data, error } = await query;
      if (error && isMissingDailyDealColumns(error)) {
        dailyDealColumnsAvailable = false;
        query = supabase
          .from("productos")
          .select("id,nombre,codigo_barras,categoria_id,imagen_url,imagen_path,presentacion,precio,precio_oferta,es_destacado,disponible,stock,stock_tracked,created_at,deleted_at,deleted_by")
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

  async function fetchCurrentBcvRate() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`La consulta de la tasa BCV respondió ${response.status}.`);
      const data = await response.json();
      const rate = Number(data.promedio);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new TypeError("La tasa BCV recibida no es válida.");
      }
      return rate;
    } finally {
      window.clearTimeout(timeout);
    }
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
      const hasRequiredFields = candidate.name >= 0
        && candidate.department >= 0
        && (candidate.usd >= 0 || candidate.ves >= 0 || candidate.retailPrice >= 0);
      if (hasRequiredFields) {
        headerRow = rowIndex;
        fields = candidate;
        break;
      }
    }
    if (headerRow < 0) throw new Error("No se encontraron encabezados compatibles. Se requiere descripción/nombre, categoría/departamento y un precio USD, VES o PVP.");
    const inputRows = sheetRows.slice(headerRow + 1)
      .map((cells, index) => ({ cells, rowNumber: headerRow + index + 2 }))
      .filter(({ cells }) => cells.some((cell) => String(cell ?? "").trim() !== ""));
    if (!inputRows.length) throw new Error("La hoja no contiene productos debajo de los encabezados.");
    if (inputRows.length > 10000) throw new Error("El archivo supera el límite de 10.000 filas por importación.");
    sourceRowCount = inputRows.length;
    const importsVesOnly = fields.usd < 0 && (fields.ves >= 0 || fields.retailPrice >= 0);
    const bcvRate = importsVesOnly ? await fetchCurrentBcvRate() : null;

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
    const parsedRows = inputRows.map(({ cells, rowNumber }) => {
      const barcode = fields.barcode >= 0 ? String(cells[fields.barcode] ?? "").trim() : "";
      const productId = fields.id >= 0 ? String(cells[fields.id] ?? "").trim() : "";
      const sourceName = String(cells[fields.name] ?? "").trim();
      const explicitPresentation = fields.presentation >= 0
        ? String(cells[fields.presentation] ?? "").trim()
        : "";
      const { name, presentation } = getNameAndPresentation(sourceName, explicitPresentation);
      const familyIdentity = getProductFamilyIdentity(name);
      const productIdentity = getProductIdentity(name, presentation);
      const departmentInput = String(cells[fields.department] ?? "").trim();
      const departmentNameOverride = window.getKristalProductDepartment(name, departmentInput);
      const departmentKey = normalize(departmentNameOverride);
      const existingCategory = categoryByName.get(departmentKey);
      const departmentName = existingCategory?.departamento
        || (departmentKey ? formatDepartmentName(departmentNameOverride) : "");
      const imageUrl = fields.image >= 0 ? String(cells[fields.image] ?? "").trim() : "";
      const usdText = fields.usd >= 0 ? String(cells[fields.usd] ?? "").trim() : "";
      const vesText = fields.ves >= 0 ? String(cells[fields.ves] ?? "").trim() : "";
      const retailPriceText = fields.retailPrice >= 0 ? String(cells[fields.retailPrice] ?? "").trim() : "";
      const priceVesText = vesText || retailPriceText;
      const priceVes = priceVesText ? parseNumber(priceVesText) : null;
      const unroundedPriceUsd = usdText
        ? parseNumber(usdText)
        : Number.isFinite(priceVes) && bcvRate
          ? priceVes / bcvRate
          : NaN;
      const priceUsd = Number.isFinite(unroundedPriceUsd)
        ? Math.round((unroundedPriceUsd + Number.EPSILON) * 100) / 100
        : unroundedPriceUsd;
      const saleText = fields.sale >= 0 ? String(cells[fields.sale] ?? "").trim() : "";
      const salePrice = saleText ? parseNumber(saleText) : null;
      const stockText = fields.stock >= 0 ? String(cells[fields.stock] ?? "").trim() : "";
      const stock = stockText ? parseNumber(stockText) : null;
      const errors = [];
      if (barcode.length > 80) errors.push("código supera 80 caracteres");
      if (!name || name.length > 140) errors.push("descripción");
      if (!departmentKey) errors.push("departamento vacío");
      else if (!existingCategory && departmentName.length > 120) errors.push("departamento supera 120 caracteres");
      if (imageUrl && !isValidImageUrl(imageUrl)) errors.push("URL de imagen");
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) errors.push("precio USD");
      else if (priceUsd < 0.01) errors.push("PVP convertido a menos de US$ 0,01; confirma moneda y tasa");
      if (saleText && (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= priceUsd)) {
        errors.push("precio de oferta (debe ser menor al regular)");
      }
      if (priceVesText && (!Number.isFinite(priceVes) || priceVes < 0)) errors.push("precio VES/PVP");
      if (stockText && (!Number.isFinite(stock) || stock < 0 || stock > 100000000)) errors.push("stock");
      return {
        rowNumber,
        productId,
        productIdentity: familyIdentity
          ? `${familyIdentity}|${normalize(presentation || getNameAndPresentation(name, "").presentation)}`
          : productIdentity,
        barcode,
        name,
        departmentName,
        imageUrl,
        categoryId: existingCategory?.id || null,
        departmentKey,
        priceUsd,
        salePrice,
        salePriceProvided: Boolean(saleText),
        priceVes,
        priceVesProvided: Boolean(priceVesText),
        bcvRateUsed: importsVesOnly ? bcvRate : null,
        stock,
        stockTracked: stockText !== "",
        stockColumnPresent: fields.stock >= 0,
        presentation,
        error: errors.join(", "),
      };
    });
    const consolidatedRows = [];
    const rowsByProductId = new Map();
    const rowsBySku = new Map();
    const rowsByName = new Map();
    const rowsWithoutSkuByName = new Map();
    consolidatedInputRows = 0;
    parsedRows.forEach((row) => {
      const nameKey = row.productIdentity ? `name:${getProductIdentity(row.name, row.presentation)}` : "";
      const skuKey = row.barcode ? `sku:${normalizeSku(row.barcode)}` : "";
      const productIdKey = row.productId ? `id:${row.productId.toLowerCase()}` : "";
      let existingIndex = productIdKey ? rowsByProductId.get(productIdKey) : undefined;
      if (existingIndex === undefined && skuKey) existingIndex = rowsBySku.get(skuKey);

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
          productId: row.productId || existingRow.productId,
          barcode: row.barcode || existingRow.barcode,
          imageUrl: row.imageUrl || existingRow.imageUrl,
          salePrice: row.salePriceProvided ? row.salePrice : existingRow.salePrice,
          salePriceProvided: row.salePriceProvided || existingRow.salePriceProvided,
          priceVes: row.priceVesProvided ? row.priceVes : existingRow.priceVes,
          priceVesProvided: row.priceVesProvided || existingRow.priceVesProvided,
          stock: row.stockTracked ? row.stock : existingRow.stock,
          stockTracked: row.stockTracked || existingRow.stockTracked,
        };
        if (nameKey && !rowsByName.has(nameKey)) rowsByName.set(nameKey, new Set());
        if (nameKey) rowsByName.get(nameKey).add(existingIndex);
        if (skuKey) rowsBySku.set(skuKey, existingIndex);
        if (productIdKey) rowsByProductId.set(productIdKey, existingIndex);
        if (nameKey && rowsWithoutSkuByName.get(nameKey) === existingIndex) rowsWithoutSkuByName.delete(nameKey);
        consolidatedInputRows += 1;
      } else {
        existingIndex = consolidatedRows.push(row) - 1;
        if (skuKey) rowsBySku.set(skuKey, existingIndex);
        if (productIdKey) rowsByProductId.set(productIdKey, existingIndex);
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
      <td data-label="Imagen">${row.imageUrl ? "URL del archivo" : "Se conserva existente o se asigna marcador neutro"}</td>
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
    setStatus(`${inputRows.length} filas revisadas; ${consolidatedInputRows} repetidas consolidadas por ID, SKU, coincidencia difusa o nombre/presentación; ${validRows} listas para importar y ${skippedRows.length} se omitirán por errores de formato.${importsVesOnly ? ` PVP en Bs. convertido a USD con BCV ${bcvRate.toFixed(2)}.` : ""}${preparedRows.length > 100 ? " La vista previa muestra hasta 100 productos y filas adicionales con errores." : ""}`, skippedRows.length > 0);
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
        (Array.isArray(resolvedDepartments) ? resolvedDepartments : []).forEach((department) => {
          if (department?.normalized_department && department?.category_id) {
            categoryIdByDepartment.set(normalize(department.normalized_department), department.category_id);
          }
        });

        const unresolvedDepartments = [...missingDepartments.keys()]
          .filter((key) => !categoryIdByDepartment.get(key));
        if (unresolvedDepartments.length) {
          const { data: refreshedCategories, error: refreshError } = await supabase
            .from("categorias")
            .select("id,nombre,departamento");
          if (refreshError) throw refreshError;
          const availableCategories = Array.isArray(refreshedCategories) ? refreshedCategories : [];
          unresolvedDepartments.forEach((key) => {
            const category = availableCategories.find((item) => normalize(item.nombre) === key)
              || availableCategories.find((item) => normalize(item.departamento) === key);
            if (category?.id) categoryIdByDepartment.set(key, category.id);
          });
        }

        const stillUnresolvedDepartments = [...missingDepartments.keys()]
          .filter((key) => !categoryIdByDepartment.get(key));
        if (stillUnresolvedDepartments.length) {
          throw new Error(`No se pudo resolver la categoría de: ${stillUnresolvedDepartments.map((key) => missingDepartments.get(key)).join(", ")}. Ejecuta el archivo actualizado supabase-inventory-import.sql en Supabase y vuelve a importar.`);
        }
      }
      const unresolvedProducts = validRows
        .filter((row) => !categoryIdByDepartment.get(row.departmentKey));
      if (unresolvedProducts.length) {
        throw new Error(`No se encontró una categoría válida para: ${[...new Set(unresolvedProducts.map((row) => row.departmentName))].join(", ")}. No se guardó ningún producto.`);
      }

      setStatus("Buscando productos existentes por código, nombre y presentación…");
      const existingProducts = await loadExistingProducts();
      const existingById = new Map(existingProducts.map((product) => [String(product.id).toLowerCase(), product]));
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

      const matchedProducts = validRows.map((row) => existingById.get(row.productId.toLowerCase())
        || (row.barcode ? existingByBarcode.get(normalizeSku(row.barcode)) : null)
        || null);
      const usedProductIds = new Set(matchedProducts.filter(Boolean).map((product) => product.id));
      validRows.forEach((row, index) => {
        const identity = getProductIdentity(row.name, row.presentation);
        const categoryId = categoryIdByDepartment.get(row.departmentKey);
        const categoryProducts = existingByCategory.get(categoryId) || [];
        const familyIdentity = getProductFamilyIdentity(row.name);
        const familyMatches = existingByFamily.get(familyIdentity) || [];
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
        const identifierMatch = matchedProducts[index];
        let preferredVariant = exactMatches[0] || sameVariantMatches[0] || null;
        if (!preferredVariant && fuzzyMatches.length) {
          const hasUnambiguousBestMatch = fuzzyMatches.length === 1
            || (fuzzyMatches[0].similarity >= 0.84
              && fuzzyMatches[0].similarity - (fuzzyMatches[1]?.similarity || 0) >= 0.12);
          if (hasUnambiguousBestMatch) preferredVariant = fuzzyMatches[0].product;
        }
        if (!identifierMatch && !row.barcode && preferredVariant) {
          matchedProducts[index] = preferredVariant;
        }
        const canonical = matchedProducts[index];
        if (!canonical) return;
        usedProductIds.add(canonical.id);
      });

      const existingUpdates = [];
      const newProducts = [];
      validRows.forEach((row, index) => {
        const existing = matchedProducts[index];
        if (existing) {
          const update = {
            id: existing.id,
            nombre: row.name,
            precio: row.priceUsd,
            precio_oferta: row.salePrice,
            precio_oferta_provided: row.salePriceProvided,
            precio_ves: row.priceVes,
            precio_ves_provided: row.priceVesProvided,
            stock: row.stock,
            stock_provided: row.stockTracked,
            reset_image: Boolean(resetExistingImagesInput?.checked && !row.imageUrl),
          };
          existingUpdates.push(update);
          return;
        }

        newProducts.push({
          ...(isUuid(row.productId) ? { id: row.productId } : {}),
          codigo_barras: row.barcode || null,
          nombre: row.name,
          categoria_id: categoryIdByDepartment.get(row.departmentKey),
          precio: row.priceUsd,
          precio_ves: row.priceVes,
          stock: row.stockColumnPresent ? row.stock : null,
          stock_tracked: row.stockTracked,
          disponible: true,
          es_destacado: false,
          ...(dailyDealColumnsAvailable ? { es_oferta_dia: false, oferta_dia_hasta: null } : {}),
          precio_oferta: row.salePriceProvided ? row.salePrice : null,
          presentacion: row.presentation || null,
          imagen_url: row.imageUrl || "/assets/products/imported-product-placeholder.svg",
          imagen_path: null,
          updated_at: new Date().toISOString(),
        });
      });

      const batchSize = 200;
      for (let index = 0; index < existingUpdates.length; index += batchSize) {
        const batch = existingUpdates.slice(index, index + batchSize);
        const { data, error } = await supabase.rpc("apply_inventory_product_updates", {
          p_products: batch,
        });
        if (error) throw error;
        if (data !== batch.length) {
          throw new Error(`Supabase confirmó ${data} de ${batch.length} actualizaciones en el bloque actual.`);
        }
        importedCount += data;
        updatedCount += data;
        setStatus(`Actualizando productos existentes: ${importedCount} de ${validRows.length}…`);
      }
      for (let index = 0; index < newProducts.length; index += batchSize) {
        const batch = newProducts.slice(index, index + batchSize);
        const { error } = await supabase.from("productos").upsert(batch, { onConflict: "id" });
        if (error) throw error;
        importedCount += batch.length;
        createdCount += batch.length;
        setStatus(`Inventario actualizado: ${importedCount} de ${validRows.length} productos…`);
      }
      if (updatedCount !== existingUpdates.length || createdCount !== newProducts.length) {
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
      setStatus(`Importación completada: ${importedCount} productos procesados, ${updatedCount} actualizados y ${createdCount} nuevos; ${skippedRows.length} filas omitidas.${consolidatedInputRows ? ` Se consolidaron ${consolidatedInputRows} filas repetidas usando la última fila por ID, SKU o nombre/presentación.` : ""} Las fotos de productos existentes se conservaron${resetExistingImagesInput?.checked ? ", excepto las filas sin foto del archivo seleccionadas para corregir con el marcador neutro" : ""}; las imágenes de productos nuevos sin foto también usan el marcador neutro.`, false, true);
      if (resetExistingImagesInput) resetExistingImagesInput.checked = false;
      form.reset();
      preparedRows = [];
      previewRows.replaceChildren();
      previewWrap.hidden = true;
      window.dispatchEvent(new CustomEvent("kristal:inventory-imported"));
    } catch (error) {
      console.error("No se pudo completar la importación del inventario.", error);
      const partialProgress = [];
      if (importedCount) partialProgress.push(`Se procesaron ${importedCount} productos`);
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
