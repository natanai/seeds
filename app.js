"use strict";

(() => {
  const { KEYMAP, PRESETS, matchingMethods } = SeedTools;
  const byId = (id) => document.getElementById(id);
  const app = byId("app");
  const workspace = byId("workspace");
  const gameSelect = byId("game");
  const methodSelect = byId("method");
  const keywordInput = byId("keyword");
  const seedInput = byId("seed-input");
  const keyInput = byId("key-input");
  const resultValue = byId("result-value");
  const recoveryKey = byId("recovery-key");
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const copies = [...document.querySelectorAll("[data-copy]")];
  const gameKey = "meaningful-seeds.game";
  const methodNames = { keyword: "Keyword seed", number: "Number code", fit: "Force fit" };

  function preferredGame() {
    try {
      const game = JSON.parse(localStorage.getItem(gameKey));
      if (typeof game === "string" && Object.hasOwn(PRESETS, game)) return game;
    } catch {
      // The picker also works with browser storage disabled.
    }
    return "none";
  }

  let game = preferredGame();
  let view = "encode";
  let encodeMethod = "keyword";
  let encodeId;
  let encodings = [];
  let encoding;
  const rolledSeeds = new Set();
  const keys = { encode: "", decode: "" };
  let readingId;
  let readingPage = 0;
  let readingLimit = 0;
  let phoneKeyword = "";
  let pendingKey = "";
  let tapTimer;

  for (const [id, preset] of Object.entries(PRESETS)) {
    gameSelect.add(new Option(preset.label, id));
  }
  gameSelect.value = game;

  function validateSeed(seed) {
    const invalid = PRESETS[game].validate(seed);
    if (invalid) return invalid;
    if (game === "isaac" && !ForceFit.validIsaacSeed(seed)) return "Check the seed.";
    if (game === "spelunky2" && !/^[0-9A-F]{8}$/i.test(seed)) return "Use eight hexadecimal digits.";
    return "";
  }

  function seedIdentity(seed) {
    return (PRESETS[game].numeric || game === "minecraft") && /^-?\d+$/.test(seed)
      ? BigInt(seed).toString() : seed;
  }

  function keepsSpelling(seed, keyword) {
    if (game !== "valheim") return true;
    if (ForceFit.needsRecovery(game, seed)) return false;
    const packet = ForceFit.readPacket(game, seed);
    return packet ? packet.keyword === keyword : !ForceFit.readLegacy(game, seed).olderCode;
  }

  function fitEncodings(keyword, key) {
    return ForceFit.encodeVariants(game, keyword, key).map(({ mode, backward, label, number, keyed, seed }) => {
      const words = mode === "words";
      const order = backward ? (words ? "From the last word to the first. " : "From last character to first. ") : "";
      const sequence = words ? keyword.split(" ") : [...keyword];
      return {
        id: "fit-" + number, method: "fit", value: seed, label,
        rule: words ? "Stores each word’s number and capitalization."
          : mode === "letters" ? "Stores a number for each lowercase letter and space."
            : "Stores each character, including spaces.",
        detail: order + (keyed ? "Decode with the same key." : "Decode with the seed alone."),
        example: backward ? sequence.reverse().join(words ? " " : "") : ""
      };
    });
  }

  function validEncodings(keyword) {
    if (!keyword) return [];
    const key = keys.encode;
    const fits = fitEncodings(keyword, key);
    const candidates = key && ForceFit.hasSpace(game) ? fits : [
      { id: "literal", method: "keyword", value: keyword, label: "As typed", rule: "Uses the keyword as typed." },
      ...fits
    ];
    if (!key || !ForceFit.hasSpace(game)) {
      for (const [id, method] of matchingMethods(game)) {
        const value = method.encode(keyword);
        if (value && (method.reversible || method.decode(value) === keyword)) {
          candidates.push({
            id, method: method.reversible ? "keyword" : "number", value, label: method.label, rule: method.rule
          });
        }
      }
    }

    const valid = candidates.filter(({ method, value }) => !validateSeed(value) &&
      (method === "fit" || ((game === "deadcells" || seedIdentity(value) === value) && keepsSpelling(value, keyword))));
    if (valid.length) return valid;

    return ForceFit.encodeRecovery(game, keyword).filter(({ seed }) => !validateSeed(seed))
      .map(({ seed, key }, index) => ({
        id: "recovery-" + index, method: "fit", value: seed, key, label: "Seed and key",
        rule: "The seed holds part of the keyword. The key holds the rest.",
        detail: "Enter both in Decode."
      }));
  }

  function renderEncoding() {
    const keyword = keywordInput.value;
    const choices = validEncodings(keyword);
    const available = choices.length ? new Set(choices.map(({ method }) => method))
      : new Set(["keyword", "number", ...(ForceFit.hasSpace(game) ? ["fit"] : [])]);
    const methods = Object.entries(methodNames).filter(([id]) => available.has(id));
    if (!available.has(encodeMethod)) encodeMethod = methods[0][0];
    if (methods.length !== methodSelect.options.length ||
        methods.some(([id], index) => id !== methodSelect.options[index].value)) {
      methodSelect.replaceChildren(...methods.map(([id, label]) => new Option(label, id)));
    }
    methodSelect.value = encodeMethod;
    methodSelect.disabled = methods.length < 2;

    encoding = choices.find(({ id, method }) => id === encodeId && method === encodeMethod)
      ?? choices.find(({ method }) => method === encodeMethod);
    encodeId = encoding?.id;
    encodings = [...new Map(choices.map((choice) => [seedIdentity(choice.value), choice])).values()];
    byId("choose-seed").disabled = encodings.length < 2;
    byId("explain-method").disabled = !encoding;
    byId("value-row").hidden = false;
    byId("result-label").textContent = "Seed";
    resultValue.value = encoding?.value ?? "";
    recoveryKey.value = encoding?.key ?? "";
    byId("recovery-row").hidden = !recoveryKey.value;
    setStatus(keyword && !encoding ? "Check the keyword." : "");
    showMap(resultValue.value);
  }

  function chooseSeed() {
    const current = seedIdentity(encoding.value);
    const alternatives = encodings.filter(({ value }) => seedIdentity(value) !== current);
    rolledSeeds.add(current);
    let pool = alternatives.filter(({ value }) => !rolledSeeds.has(seedIdentity(value)));
    if (!pool.length) {
      rolledSeeds.clear();
      pool = alternatives;
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    rolledSeeds.add(seedIdentity(chosen.value));
    encodeMethod = chosen.method;
    encodeId = chosen.id;
    keywordInput.blur();
    render();
  }

  function decode(seed) {
    if (!seed) return {};
    const key = keys.decode;
    const error = validateSeed(seed);
    const recovered = ForceFit.recoveryGame(key) === game ? ForceFit.readRecovery(seed, key) : null;
    if (recovered !== null) return { keyword: recovered };

    const packet = ForceFit.readPacket(game, seed, key);
    if (packet?.status === "decoded" && (game === "valheim" || packet.keyed)) {
      return { keyword: packet.keyword };
    }
    if (ForceFit.needsRecovery(game, seed) || packet?.status === "key-needed") {
      return { error: key ? "Check seed and key." : "Key required." };
    }
    if (packet?.status === "key-mismatch") return { error: "Check seed and key." };
    if (packet?.status === "copy-check") return { error: "Check the seed." };

    const older = packet ? null : ForceFit.readLegacy(game, seed);
    if (older?.olderCode) return { error: "Older short code. No keyword." };
    const readings = [];
    if (packet) readings.push({ id: "fit", label: packet.label, value: packet.keyword });
    if (!error) readings.push({ id: "literal", label: "As typed", value: seed });
    for (const { variant, keyword } of older?.readings ?? []) {
      readings.push({ id: "older-" + variant, label: "Older Force fit " + (variant + 1), value: keyword });
    }
    const methods = matchingMethods(game);
    methods.sort(([, left], [, right]) => Number(Boolean(right.reversible)) - Number(Boolean(left.reversible)));
    for (const [id, method] of methods) {
      const value = method.decode(seed);
      if (value) readings.push({ id, label: method.label, value });
    }
    return { readings, error: error || (key ? "Check seed and key." : "") };
  }

  function readingsPerPage() {
    const height = app.clientHeight;
    if (height <= 355) return app.clientWidth >= 530 ? 2 : 1;
    if (height <= 495) return 2;
    if (height <= 590) return 3;
    return 4;
  }

  function renderReadings(readings) {
    const list = byId("reading-list");
    readingLimit = readingsPerPage();
    const pages = Math.ceil(readings.length / readingLimit);
    readingPage = Math.min(readingPage, pages - 1);
    byId("reading-page").value = (readingPage + 1) + " / " + pages;
    byId("reading-pager").hidden = pages === 1;
    byId("reading-previous").disabled = readingPage === 0;
    byId("reading-next").disabled = readingPage >= pages - 1;

    const first = readingPage * readingLimit;
    const buttons = readings.slice(first, first + readingLimit).map(({ id, label, value }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reading";
      const name = document.createElement("span");
      name.textContent = label;
      const keyword = document.createElement("code");
      keyword.textContent = value;
      button.append(name, keyword);
      button.addEventListener("click", () => {
        readingId = id;
        render();
        byId("all-readings").focus({ preventScroll: true });
      });
      return button;
    });
    list.replaceChildren(...buttons);
  }

  function renderDecoding() {
    const seed = seedInput.value;
    const { keyword, readings = [], error } = decode(seed);
    const selected = readings.find(({ id }) => id === readingId);
    const showReadings = !selected && readings.length > 0;
    const value = keyword ?? selected?.value ?? "";
    seedInput.inputMode = PRESETS[game].numeric ? "numeric" : "text";
    byId("value-row").hidden = !value;
    byId("result-label").textContent = selected ? "Possible keyword" : "Keyword";
    resultValue.value = value;
    byId("all-readings").hidden = !selected;
    byId("readings").hidden = !showReadings;
    if (showReadings) renderReadings(readings);
    setStatus(!value ? error : "");
    showMap(seed);
  }

  function setStatus(message) {
    const status = byId("result-status");
    status.textContent = message ?? "";
    status.hidden = !message;
  }

  function showMap(seed) {
    const map = byId("map");
    map.hidden = game !== "valheim" || !seed || Boolean(validateSeed(seed));
    if (!map.hidden) {
      const heading = byId(view === "encode" ? "result-heading" : "decode-heading");
      if (map.parentElement !== heading) heading.append(map);
      const url = new URL("https://m.valheim-map.world/");
      url.searchParams.set("seed", seed);
      map.href = url.href;
    }
  }

  function updateCopyButtons() {
    for (const button of copies) {
      const input = byId(button.dataset.copy);
      button.disabled = !input.value || (input === seedInput && Boolean(validateSeed(input.value)));
      button.removeAttribute("data-copied");
    }
    const copyResult = copies.find(({ dataset }) => dataset.copy === "result-value");
    copyResult.setAttribute("aria-label", view === "encode" ? "Copy seed" : "Copy keyword");
  }

  function render() {
    workspace.dataset.view = view;
    for (const tab of tabs) {
      const active = tab.dataset.tab === view;
      byId(tab.dataset.tab + "-panel").hidden = !active;
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    byId("result").hidden = view === "keypad";
    byId("method-row").hidden = view !== "encode";
    byId("all-readings").hidden = true;
    byId("readings").hidden = true;
    byId("recovery-row").hidden = true;
    byId("roll").hidden = !PRESETS[game].roll;
    byId("encode-key").hidden = !ForceFit.hasSpace(game);
    for (const mode of ["encode", "decode"]) {
      const button = byId(mode + "-key");
      button.toggleAttribute("data-key", Boolean(keys[mode]));
      button.setAttribute("aria-label", keys[mode] ? "Change secret key" : "Secret key");
    }

    if (view === "keypad") {
      renderPhone();
      return;
    }
    if (view === "encode") renderEncoding();
    else renderDecoding();
    updateCopyButtons();
  }

  function navigate(nextView) {
    if (view !== nextView) document.activeElement?.blur();
    view = nextView;
    workspace.scrollTop = 0;
    render();
  }

  function useGame(format) {
    game = format;
    gameSelect.value = game;
    encodeMethod = keys.encode && ForceFit.hasSpace(game) ? "fit" : "keyword";
    encodeId = undefined;
    rolledSeeds.clear();
  }

  function resetDecoding() {
    readingId = undefined;
    readingPage = 0;
  }

  function detectGame() {
    const seed = seedInput.value;
    const key = keys.decode;
    const format = ForceFit.recoveryGame(key);
    if (format && format !== game && ForceFit.readRecovery(seed, key) !== null) useGame(format);
    else if (/^[~!+*][0-9A-Za-z]{9}$/.test(seed) && (game === "none" || PRESETS[game].validate(seed))) {
      useGame("valheim");
    }
  }

  function explainMethod() {
    if (!encoding) return;
    const { label, rule, detail, example } = encoding;
    byId("method-title").textContent = label;
    byId("method-rule").textContent = rule;
    byId("method-detail").textContent = detail ?? "";
    byId("method-detail").hidden = !detail;
    byId("method-example").textContent = example ?? "";
    byId("method-example").hidden = !example;
    byId("method-dialog").showModal();
  }

  function editKey() {
    keyInput.value = keys[view];
    byId("generate-key").hidden = view !== "encode";
    updateCopyButtons();
    byId("key-dialog").showModal();
  }

  function applyKey(event) {
    event.preventDefault();
    keys[view] = keyInput.value;
    if (view === "encode") {
      if (keys.encode) encodeMethod = "fit";
      encodeId = undefined;
      rolledSeeds.clear();
    } else {
      detectGame();
      resetDecoding();
    }
    byId("key-dialog").close();
    render();
  }

  async function copyText(text) {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // A selected field works in some embedded browsers.
      }
    }

    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    field.className = "clipboard";
    const focused = document.activeElement;
    (focused?.closest("dialog") ?? document.body).append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
      focused?.focus({ preventScroll: true });
    }
  }

  async function copyValue(button) {
    const input = byId(button.dataset.copy);
    const value = input.value;
    if (!value) return;
    const copied = await copyText(value);
    if (input.value !== value) return;
    const status = byId(input === keyInput ? "key-copy-status" : "copy-status");
    status.textContent = copied ? "Copied." : "Select Copy.";
    if (copied) {
      button.setAttribute("data-copied", "");
      setTimeout(() => button.removeAttribute("data-copied"), 1200);
    } else {
      input.focus();
      input.select();
    }
  }

  function finishTap() {
    clearTimeout(tapTimer);
    pendingKey = "";
    byId("phone-keys").querySelector("[data-pending]")?.removeAttribute("data-pending");
  }

  function renderPhone() {
    byId("phone-text").value = phoneKeyword;
    byId("use-keyword").disabled = !phoneKeyword;
  }

  function tapKey(key, button) {
    const letters = KEYMAP[key];
    if (pendingKey === key) {
      const next = (letters.indexOf(phoneKeyword.at(-1)) + 1) % letters.length;
      phoneKeyword = phoneKeyword.slice(0, -1) + letters[next];
    } else {
      phoneKeyword += letters[0];
    }
    finishTap();
    pendingKey = key;
    button.setAttribute("data-pending", "");
    tapTimer = setTimeout(finishTap, 750);
    renderPhone();
  }

  function keypadAction(action) {
    finishTap();
    if (action === "clear") phoneKeyword = "";
    if (action === "space") phoneKeyword += " ";
    if (action === "backspace") phoneKeyword = phoneKeyword.slice(0, -1);
    renderPhone();
  }

  function buildKeypad() {
    const keys = ["next", ...Object.keys(KEYMAP), "clear", "space", "backspace"];
    const label = { next: "Next", clear: "Clear", space: "Space", backspace: "Backspace" };
    for (const key of keys) {
      const button = document.createElement("button");
      button.type = "button";
      if (KEYMAP[key]) {
        const digit = document.createElement("strong");
        digit.textContent = key;
        const letters = document.createElement("small");
        letters.textContent = KEYMAP[key];
        button.append(digit, letters);
        button.addEventListener("click", () => tapKey(key, button));
      } else {
        button.textContent = key === "backspace" ? "⌫" : label[key];
        button.setAttribute("aria-label", label[key]);
        button.addEventListener("click", () => keypadAction(key));
      }
      byId("phone-keys").append(button);
    }
  }

  gameSelect.addEventListener("change", () => {
    useGame(gameSelect.value);
    resetDecoding();
    try {
      localStorage.setItem(gameKey, JSON.stringify(game));
    } catch {
      // The current selection is still applied.
    }
    render();
  });
  methodSelect.addEventListener("change", () => {
    encodeMethod = methodSelect.value;
    encodeId = undefined;
    render();
  });
  byId("explain-method").addEventListener("click", explainMethod);
  byId("encode-key").addEventListener("click", editKey);
  byId("decode-key").addEventListener("click", editKey);
  byId("key-form").addEventListener("submit", applyKey);
  keyInput.addEventListener("input", updateCopyButtons);
  byId("generate-key").addEventListener("click", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    keyInput.value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    updateCopyButtons();
  });
  for (const button of copies) button.addEventListener("click", () => copyValue(button));

  byId("choose-seed").addEventListener("click", chooseSeed);
  byId("reading-previous").addEventListener("click", () => { readingPage--; render(); });
  byId("reading-next").addEventListener("click", () => { readingPage++; render(); });
  byId("all-readings").addEventListener("click", () => {
    readingId = undefined;
    render();
    byId("reading-list").querySelector("button")?.focus({ preventScroll: true });
  });
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      if (tab.dataset.tab === "decode") resetDecoding();
      navigate(tab.dataset.tab);
    });
  }
  keywordInput.addEventListener("input", () => {
    rolledSeeds.clear();
    render();
  });
  seedInput.addEventListener("input", () => {
    detectGame();
    resetDecoding();
    render();
  });
  for (const field of [keywordInput, seedInput]) {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        field.blur();
      }
    });
  }
  for (const button of document.querySelectorAll("[data-done]")) {
    button.addEventListener("click", () => byId(button.dataset.done).blur());
  }
  byId("roll").addEventListener("click", () => {
    seedInput.blur();
    seedInput.value = PRESETS[game].roll(crypto);
    resetDecoding();
    render();
  });
  byId("use-keyword").addEventListener("click", () => {
    finishTap();
    keywordInput.value = phoneKeyword;
    rolledSeeds.clear();
    navigate("encode");
  });

  const viewport = window.visualViewport;
  function fitViewport() {
    if (viewport && viewport.scale === 1) {
      app.style.setProperty("--app-height", Math.floor(viewport.height) + "px");
    }
    app.toggleAttribute("data-typing", [keywordInput, seedInput].includes(document.activeElement));
    if (view === "decode" && !byId("readings").hidden && readingLimit !== readingsPerPage()) render();
  }
  viewport?.addEventListener("resize", fitViewport);
  window.addEventListener("resize", fitViewport);
  document.addEventListener("focusin", fitViewport);
  document.addEventListener("focusout", () => requestAnimationFrame(fitViewport));

  buildKeypad();
  fitViewport();
  render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Offline setup failed", error);
    });
  }
})();
