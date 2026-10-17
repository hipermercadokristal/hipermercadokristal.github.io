(() => {
  const sections = document.querySelectorAll([
    ".dashboard > .sales-summary",
    ".dashboard > .panel",
    ".delivery-dashboard > #delivery-status-panel",
    ".delivery-dashboard > #delivery-manual-code-form",
    ".delivery-dashboard > #delivery-order-list",
  ].join(","));

  for (const section of sections) {
    const headingId = section.getAttribute("aria-labelledby");
    const heading = headingId ? document.getElementById(headingId) : null;
    const title = heading?.textContent.trim()
      || section.getAttribute("aria-label")
      || "Sección";
    const details = document.createElement("details");
    details.className = "staff-collapsible";
    details.dataset.staffCollapseSource = section.id || title;

    const summary = document.createElement("summary");
    summary.textContent = title;
    details.append(summary);
    section.before(details);
    details.append(section);
    section.classList.add("staff-collapsible-content");
  }

  document.querySelector("#product-form-details")?.classList.add("staff-collapsible");

  function syncHiddenSections() {
    document.querySelectorAll("details.staff-collapsible[data-staff-collapse-source]").forEach((details) => {
      const content = details.querySelector(".staff-collapsible-content");
      const shouldHide = Boolean(content?.hidden);
      if (details.hidden !== shouldHide) details.hidden = shouldHide;
    });
  }

  syncHiddenSections();
  new MutationObserver(syncHiddenSections).observe(document.body, {
    attributes: true,
    attributeFilter: ["hidden"],
    subtree: true,
  });
})();
