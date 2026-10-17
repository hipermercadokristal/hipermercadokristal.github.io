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
    preparedRows = inputRows.map(({ cells, rowNumber }) => {
      const barcode = String(cells[fields.barcode] ?? "").trim();
      const sourceName = String(cells[fields.name] ?? "").trim();
      const explicitPresentation = fields.presentation >= 0
        ? String(cells[fields.presentation] ?? "").trim()
        : "";
      const { name, presentation } = getNameAndPresentation(sourceName, explicitPresentation);
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

      const barcodes = preparedRows.map((row) => row.barcode);
      const existingByBarcode = new Map();
      for (let index = 0; index < barcodes.length; index += 500) {
        const { data, error } = await supabase
          .from("productos")
          .select("codigo_barras,imagen_url,imagen_path,presentacion,precio_oferta,es_destacado,disponible,stock,stock_tracked")
          .in("codigo_barras", barcodes.slice(index, index + 500));
        if (error) throw error;
        data.forEach((product) => existingByBarcode.set(product.codigo_barras, product));
      }

      const products = preparedRows.map((row) => {
        const existing = existingByBarcode.get(row.barcode);
        return {
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
          imagen_url: existing?.imagen_url || "assets/products/imported-product-placeholder.svg",
          imagen_path: existing?.imagen_path || null,
          updated_at: new Date().toISOString(),
        };
      });

      for (let index = 0; index < products.length; index += 200) {
        const batch = products.slice(index, index + 200);
        const { error } = await supabase.from("productos").upsert(batch, { onConflict: "codigo_barras" });
        if (error) throw error;
        importedCount += batch.length;
        setStatus(`Inventario actualizado: ${importedCount} de ${products.length} productos…`);
      }
      setStatus(`${importedCount} productos importados o actualizados. Los productos sin foto quedan listos para completar desde el inventario.`, false, true);
      form.reset();
      preparedRows = [];
      previewRows.replaceChildren();
      previewWrap.hidden = true;
      window.dispatchEvent(new CustomEvent("kristal:inventory-imported"));
    } catch (error) {
      console.error("No se pudo completar la importación del inventario.", error);
      setStatus(
        importedCount
          ? `Se actualizaron ${importedCount} productos antes del error. Corrige el problema e importa nuevamente; los registros se actualizan por código de barras. ${error.message || ""}`
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
