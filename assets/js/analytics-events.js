(() => {
  const scholarUser = document.currentScript.dataset.scholarUserid;

  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;

    const url = new URL(link.href, window.location.href);
    const paper = link.closest(".publications [id]");
    let eventName;
    let title;

    if (url.hostname === "scholar.google.com") {
      const owner = url.searchParams.get("user");
      const citation = url.searchParams.get("citation_for_view");
      if (owner === scholarUser && !citation) {
        eventName = "scholar-profile-click";
        title = "Google Scholar profile click";
      } else if (paper) {
        eventName = "scholar-paper-click-" + paper.id;
        title = "Google Scholar paper click";
      }
    } else if (paper && link.textContent.trim() === "PDF") {
      eventName = "paper-pdf-click-" + paper.id;
      title = "Paper PDF link click";
    }

    if (!eventName) return;
    if (window.goatcounter && typeof window.goatcounter.count === "function") {
      window.goatcounter.count({ path: eventName, title, event: true });
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", eventName.startsWith("scholar") ? "scholar_click" : "paper_pdf_click", {
        event_category: "research",
        event_label: eventName,
        transport_type: "beacon",
      });
    }
  });
})();
