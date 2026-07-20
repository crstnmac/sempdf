const state = {
  fixtures: [],
  current: null,
  pageIndex: 0,
  mode: "side",
};

const els = {
  fixtureSelect: document.querySelector("#fixtureSelect"),
  dataSetSelect: document.querySelector("#dataSetSelect"),
  renderButton: document.querySelector("#renderButton"),
  updateButton: document.querySelector("#updateButton"),
  pdfLink: document.querySelector("#pdfLink"),
  status: document.querySelector("#status"),
  pageTabs: document.querySelector("#pageTabs"),
  stage: document.querySelector("#stage"),
  baselineImage: document.querySelector("#baselineImage"),
  actualImage: document.querySelector("#actualImage"),
  overlayImage: document.querySelector("#overlayImage"),
  diffImage: document.querySelector("#diffImage"),
  diffPixels: document.querySelector("#diffPixels"),
  diffRatio: document.querySelector("#diffRatio"),
  maxDelta: document.querySelector("#maxDelta"),
  resultText: document.querySelector("#resultText"),
};

await boot();

async function boot() {
  setBusy("Loading fixtures");
  const data = await api("/api/fixtures");
  state.fixtures = data.fixtures;
  populateFixtures();
  bindEvents();
  await renderCurrent();
}

function bindEvents() {
  els.fixtureSelect.addEventListener("change", () => {
    populateDataSets();
    renderCurrent();
  });
  els.dataSetSelect.addEventListener("change", renderCurrent);
  els.renderButton.addEventListener("click", renderCurrent);
  els.updateButton.addEventListener("click", updateBaseline);
  for (const button of document.querySelectorAll(".mode")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
}

function populateFixtures() {
  els.fixtureSelect.replaceChildren(
    ...state.fixtures.map((fixture) => option(fixture.id, fixture.label)),
  );
  populateDataSets();
}

function populateDataSets() {
  const fixture = selectedFixture();
  els.dataSetSelect.replaceChildren(
    ...(fixture?.dataSets ?? []).map((dataSet) => option(dataSet.id, dataSet.label)),
  );
}

async function renderCurrent() {
  try {
    setBusy("Rendering");
    state.pageIndex = 0;
    state.current = await api("/api/render", {
      fixture: els.fixtureSelect.value,
      dataSet: els.dataSetSelect.value,
    });
    draw();
    setStatus(summaryStatus(state.current.pages), summaryClass(state.current.pages));
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

async function updateBaseline() {
  try {
    setBusy("Updating baseline");
    state.current = await api("/api/update-baseline", {
      fixture: els.fixtureSelect.value,
      dataSet: els.dataSetSelect.value,
    });
    state.pageIndex = 0;
    draw();
    setStatus("Baseline updated", "good");
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

function draw() {
  const result = state.current;
  if (!result) return;
  const page = result.pages[state.pageIndex];
  els.pageTabs.replaceChildren(
    ...result.pages.map((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Page ${item.pageNumber}`;
      button.className = index === state.pageIndex ? "active" : "";
      button.addEventListener("click", () => {
        state.pageIndex = index;
        draw();
      });
      return button;
    }),
  );

  setImage(els.actualImage, page.actualPng);
  setImage(els.baselineImage, page.baselinePng);
  setImage(els.overlayImage, page.diffPng);
  setImage(els.diffImage, page.diffPng);
  els.pdfLink.href = page.actualPdf;
  els.pdfLink.classList.toggle("disabled", !page.actualPdf);

  els.diffPixels.textContent = page.differingPixels ?? "-";
  els.diffRatio.textContent = page.differingPixelRatio == null
    ? "-"
    : `${(page.differingPixelRatio * 100).toFixed(4)}%`;
  els.maxDelta.textContent = page.maxChannelDelta ?? "-";
  els.resultText.textContent = labelForStatus(page.status);
  els.metrics?.classList?.toggle("missing", page.status === "missing-baseline");
}

function setMode(mode) {
  state.mode = mode;
  els.stage.className = `stage mode-${mode}`;
  for (const button of document.querySelectorAll(".mode")) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
}

function setImage(img, src) {
  img.toggleAttribute("hidden", !src);
  if (src) img.src = `${src}?t=${Date.now()}`;
}

function selectedFixture() {
  return state.fixtures.find((fixture) => fixture.id === els.fixtureSelect.value) ?? state.fixtures[0];
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function summaryStatus(pages) {
  if (pages.some((page) => page.status === "missing-baseline")) return "Missing baseline";
  if (pages.every((page) => page.passed)) return "Pixel match";
  return "Diff detected";
}

function summaryClass(pages) {
  if (pages.some((page) => page.status === "missing-baseline")) return "warn";
  if (pages.every((page) => page.passed)) return "good";
  return "bad";
}

function labelForStatus(status) {
  if (status === "passed") return "Pass";
  if (status === "diff") return "Diff";
  if (status === "missing-baseline") return "No baseline";
  return status;
}

function setBusy(text) {
  setStatus(text, "busy");
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}
