(function (global) {
  "use strict";

  const engine = typeof module === "object" && module.exports
    ? require("./engine.js") : global.ShobdoEngine;
  const MAX_INPUT = 48;
  const MAX_CORRECTION = 24;
  // Upper bound for the candidate list; ranking is exact > completion >
  // correction > literal transliteration. Vocabulary is a curated everyday
  // subset (244 words + variants), not a general dictionary — see README.
  const MAX_CANDIDATES = 5;

  // A small, deliberately curated everyday vocabulary, not a general dictionary.
  // First spelling is canonical; remaining spellings are common Banglish variants.
  // Order breaks equally plausible ties, so common words win deterministically.
  const vocabulary = [
    ["ami aami", "আমি"], ["tumi", "তুমি"], ["tomar tumar", "তোমার"],
    ["bhalo valo bhalO", "ভালো"], ["bangla bangala bengali", "বাংলা"],
    ["kemon kamon kemOn", "কেমন"], ["acho accho achho achO", "আছো"],
    ["amra aamra", "আমরা"], ["amar aamar", "আমার"], ["amader aamader", "আমাদের"],
    ["tomra tumra", "তোমরা"], ["tomader tumader", "তোমাদের"],
    ["apni aapni", "আপনি"], ["apnar aapnar", "আপনার"],
    ["apnara aapnara", "আপনারা"], ["apnader aapnader", "আপনাদের"],
    ["se she", "সে"], ["tar taar", "তার"], ["tara taara", "তারা"],
    ["tader taader", "তাদের"], ["eta eita", "এটা"], ["ota oita", "ওটা"],
    ["ekhane ekhaney", "এখানে"], ["okhane okhaney", "ওখানে"],
    ["ki kee", "কি"], ["keno kano kenO", "কেন"], ["kothay kothai", "কোথায়"],
    ["kokhon kakhon", "কখন"], ["kibhabe kivabe", "কীভাবে"],
    ["ha hya haa", "হ্যাঁ"], ["na naa", "না"], ["achhe ache aache", "আছে"],
    ["achi aachi", "আছি"], ["achhen achen", "আছেন"], ["chilo chhilo", "ছিল"],
    ["chilam chhilam", "ছিলাম"], ["hobe hobey", "হবে"], ["hoy hoi", "হয়"],
    ["hoye hoiye", "হয়ে"], ["holo", "হলো"], ["nei", "নেই"], ["nai", "নাই"],
    ["ebong evong", "এবং"], ["ar aar", "আর"], ["kintu kintoo", "কিন্তু"],
    ["jodi zodi", "যদি"], ["tai taai", "তাই"], ["tobe tobey", "তবে"],
    ["abar abaar", "আবার"], ["onek anek", "অনেক"], ["ektu aktu", "একটু"],
    ["khub khoob", "খুব"], ["sob shob", "সব"], ["sobai shobai", "সবাই"],
    ["kichu kichhu", "কিছু"], ["kono", "কোনো"], ["shudhu sudhu", "শুধু"],
    ["beshi besi", "বেশি"], ["kom kam", "কম"], ["boro", "বড়"],
    ["chhoto choto", "ছোট"], ["notun natun", "নতুন"], ["purono purano", "পুরোনো"],
    ["sundor shundor", "সুন্দর"], ["kharap kharaap", "খারাপ"],
    ["thik theek", "ঠিক"], ["bhul vul", "ভুল"], ["sotti shotty sotty", "সত্যি"],
    ["dhonnobad dhanyabad dhonyobad", "ধন্যবাদ"], ["dukkhito dukhito", "দুঃখিত"],
    ["swagotom shagotom", "স্বাগতম"], ["nomoskar namaskar", "নমস্কার"],
    ["salam salaam", "সালাম"], ["bondhu bandhu", "বন্ধু"],
    ["ma maa", "মা"], ["baba baaba", "বাবা"], ["bhai vai", "ভাই"],
    ["bon boon", "বোন"], ["dada daada", "দাদা"], ["didi deedee", "দিদি"],
    ["chele chhele", "ছেলে"], ["meye", "মেয়ে"], ["shishu sishu", "শিশু"],
    ["manush manus", "মানুষ"], ["poribar paribar", "পরিবার"],
    ["aj aaj", "আজ"], ["kal kaal", "কাল"], ["ekhon akhon", "এখন"],
    ["pore parey", "পরে"], ["age aage", "আগে"], ["ajke aajke", "আজকে"],
    ["gotokal gatokal", "গতকাল"], ["agamikal agamikaal", "আগামীকাল"],
    ["sokal shokal", "সকাল"], ["dupur doopur", "দুপুর"],
    ["bikel", "বিকেল"], ["sondha shondha sandhya", "সন্ধ্যা"],
    ["rat raat", "রাত"], ["din deen", "দিন"], ["shomoy somoy", "সময়"],
    ["ghonta ghanta", "ঘণ্টা"], ["shoptaho soptaho", "সপ্তাহ"],
    ["mash maash", "মাস"], ["bochor bachor", "বছর"],
    ["bari baari", "বাড়ি"], ["ghor ghar", "ঘর"], ["dorja darja", "দরজা"],
    ["janala jaanala", "জানালা"], ["rasta raasta", "রাস্তা"],
    ["shohor sohor", "শহর"], ["gram graam", "গ্রাম"], ["desh des", "দেশ"],
    ["bangladesh banglades", "বাংলাদেশ"], ["dhaka dhaaka", "ঢাকা"],
    ["kolkata kolkataa", "কলকাতা"], ["dokan dokaan", "দোকান"],
    ["bajar bazar", "বাজার"], ["school skul", "স্কুল"],
    ["college kolej", "কলেজ"], ["hashpatal haspatal hospital", "হাসপাতাল"],
    ["ofis office", "অফিস"], ["khabar khaabar", "খাবার"],
    ["bhat bhaat vat", "ভাত"], ["dal daal", "ডাল"], ["mach maach machh", "মাছ"],
    ["mangsho mangso", "মাংস"], ["dim deem", "ডিম"], ["dudh doodh", "দুধ"],
    ["cha chaa", "চা"], ["kofi coffee", "কফি"], ["pani paani", "পানি"],
    ["jol jal", "জল"], ["ruti roti", "রুটি"], ["alu aaloo aloo", "আলু"],
    ["peyaj piyaj", "পেঁয়াজ"], ["lobon laban", "লবণ"],
    ["chini cheeni", "চিনি"], ["mishti misti", "মিষ্টি"],
    ["fol phol", "ফল"], ["kola kala", "কলা"], ["aam am", "আম"],
    ["lebu leboo", "লেবু"], ["ranna rannah", "রান্না"],
    ["khai khaai", "খাই"], ["khao khaao", "খাও"], ["khabo khabO", "খাবো"],
    ["jao jaao", "যাও"], ["jabo jabO", "যাবো"], ["jai jaai", "যাই"],
    ["asho aso", "আসো"], ["esho eso", "এসো"], ["ashbo asbo", "আসবো"],
    ["kori koree", "করি"], ["koro korO", "করো"], ["korbo korbO", "করবো"],
    ["korchi korchhi", "করছি"], ["bolo bolO", "বলো"], ["bolbo bolbO", "বলবো"],
    ["bolchi bolchhi", "বলছি"], ["dekhi dekhee", "দেখি"],
    ["dekho dekhO", "দেখো"], ["dekhbo dekhbO", "দেখবো"],
    ["shuni suni", "শুনি"], ["shono sono", "শোনো"], ["jani jaanee", "জানি"],
    ["jano jaanO", "জানো"], ["bujhi bujhee", "বুঝি"], ["bujho bujhO", "বুঝো"],
    ["chai chaai", "চাই"], ["parbo parbO", "পারবো"], ["pari paari", "পারি"],
    ["dao daao", "দাও"], ["debo debO", "দেবো"], ["dibo", "দিবো"], ["nao naao", "নাও"],
    ["kinbo kinbO", "কিনবো"], ["likhi leekhi", "লিখি"], ["lekha likha", "লেখা"],
    ["pora poraa", "পড়া"], ["pori poree", "পড়ি"], ["ghum ghoom", "ঘুম"],
    ["bosho boso", "বসো"], ["cholo cholO", "চলো"], ["thako thakO", "থাকো"],
    ["bhalobashi valobashi bhalobasi", "ভালোবাসি"],
    ["bhalobasha valobasha", "ভালোবাসা"], ["kaj kaaj", "কাজ"],
    ["taka taaka", "টাকা"], ["dam daam", "দাম"], ["boi boy", "বই"],
    ["khata khaata", "খাতা"], ["kolom kalam", "কলম"], ["chithi chithhi", "চিঠি"],
    ["bhasha vasha", "ভাষা"], ["kotha kathaa", "কথা"], ["gan gaan", "গান"],
    ["golpo galpo", "গল্প"], ["chhobi chobi", "ছবি"],
    ["khela", "খেলা"], ["khobor khabor", "খবর"],
    ["nam naam", "নাম"], ["shorir sorir", "শরীর"], ["matha maatha", "মাথা"],
    ["chokh", "চোখ"], ["hat haat", "হাত"], ["pa paa", "পা"],
    ["mon", "মন"], ["shukh sukh", "সুখ"], ["koshto kosto", "কষ্ট"],
    ["hashi hasi", "হাসি"], ["kanna kaanna", "কান্না"],
    ["alo aalO", "আলো"], ["akash aakash", "আকাশ"], ["batash batas", "বাতাস"],
    ["brishti bristi", "বৃষ্টি"], ["megh meg", "মেঘ"], ["rod roud", "রোদ"],
    ["chand chaand", "চাঁদ"], ["gach gaach gachh", "গাছ"],
    ["ful phul", "ফুল"], ["pata paata", "পাতা"], ["nodi nadee", "নদী"],
    ["mati maati", "মাটি"], ["pahar pahaad", "পাহাড়"], ["pakhi paakhi", "পাখি"],
    ["biral beraal", "বিড়াল"], ["kukur kookur", "কুকুর"],
    ["gorom garam", "গরম"], ["thanda thandaa", "ঠান্ডা"],
    ["lal laal", "লাল"], ["nil neel", "নীল"], ["sobuj shobuj", "সবুজ"],
    ["shada sada", "সাদা"], ["kalo kaalO", "কালো"],
    ["ek aek", "এক"], ["dui dooi", "দুই"], ["tin teen", "তিন"],
    ["char chaar", "চার"], ["pach panch", "পাঁচ"], ["chhoy choy", "ছয়"],
    ["sat saat", "সাত"], ["at aat", "আট"], ["noy noi", "নয়"], ["dosh dos", "দশ"]
  ].map(([variants, text], order) => ({
    latin: variants.split(" ")[0], text: text.normalize("NFC"), order,
    variants: [...new Set(variants.toLowerCase().split(" "))]
  }));

  // Banded optimal-string-alignment distance: insert/delete/substitute and one
  // adjacent transposition (banlga -> bangla), with a maximum of two edits.
  function distance(a, b, maximum) {
    if (Math.abs(a.length - b.length) > maximum) return maximum + 1;
    let older;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = new Array(b.length + 1).fill(maximum + 1);
      current[0] = i;
      let minimum = maximum + 1;
      for (let j = Math.max(1, i - maximum); j <= Math.min(b.length, i + maximum); j++) {
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (older && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          current[j] = Math.min(current[j], older[j - 2] + 1);
        }
        minimum = Math.min(minimum, current[j]);
      }
      if (minimum > maximum) return maximum + 1;
      older = previous;
      previous = current;
    }
    return previous[b.length];
  }

  function eligible(latin) {
    // Suppress raw escape sequences, existing Bangla, separators and acronyms.
    // The editor/engine remains responsible for their unchanged literal output.
    return typeof latin === "string" && latin.length <= MAX_INPUT &&
      /^[A-Za-z]+$/.test(latin) && !/^[A-Z]{2,}$/.test(latin);
  }

  function getCandidates(latin, limit = MAX_CANDIDATES) {
    limit = Number.isFinite(limit) ? Math.max(0, Math.min(MAX_CANDIDATES, Math.floor(limit))) : MAX_CANDIDATES;
    if (!limit || !eligible(latin)) return [];
    const input = latin.toLowerCase();
    const maximum = input.length < 5 ? 1 : 2;
    const ranked = [];
    for (const word of vocabulary) {
      let rank = 4;
      let cost = Infinity;
      for (const variant of word.variants) {
        let variantRank = 4;
        let variantCost = Infinity;
        if (variant === input) {
          variantRank = 0;
          variantCost = 0;
        } else if (input.length >= 2 && variant.startsWith(input) &&
            variant.length - input.length <= 3) {
          variantRank = 1;
          variantCost = variant.length - input.length;
        } else if (input.length >= 3 && input.length <= MAX_CORRECTION) {
          variantCost = distance(input, variant, maximum);
          if (variantCost <= maximum) variantRank = 2;
        }
        if (variantRank < rank || (variantRank === rank && variantCost < cost)) {
          rank = variantRank;
          cost = variantCost;
        }
      }
      if (rank < 4) ranked.push({ text: word.text, latin: word.latin,
        kind: ["exact", "completion", "correction"][rank], rank, cost, order: word.order });
    }
    if (engine && typeof engine.transliterate === "function") {
      ranked.push({ text: engine.transliterate(latin), latin, kind: "literal",
        rank: 3, cost: 0, order: vocabulary.length });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.cost - b.cost || a.order - b.order);
    const seen = new Set();
    const result = [];
    for (const { text, latin: spelling, kind } of ranked) {
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push({ text, latin: spelling, kind });
      if (result.length === limit) break;
    }
    return result;
  }

  function create(onAccept) {
    if (typeof onAccept !== "function") throw new TypeError("Expected a suggestion acceptance callback.");
    let host, list, doc, view, activeRoot, observer;
    let candidates = [];
    let highlighted = 0;
    let visible = false;
    let revision = 0;
    let scrollTargets = [];
    let suppliedAnchor = null;
    let initialFieldBox = null;
    let repositionQueued = false;

    function hide() {
      revision++;
      visible = false;
      candidates = [];
      activeRoot = null;
      repositionQueued = false;
      host?.remove();
      observer?.disconnect();
      observer = null;
      for (const target of scrollTargets) target.removeEventListener("scroll", scheduleReposition, true);
      scrollTargets = [];
      view?.removeEventListener("resize", scheduleReposition);
      suppliedAnchor = null;
      initialFieldBox = null;
    }

    function choose(index, expectedRevision = revision) {
      if (expectedRevision !== revision) return;
      if (!visible || !activeRoot?.isConnected) { hide(); return; }
      const candidate = candidates[index];
      if (!candidate) return;
      // Dismiss before invoking external code: repeated clicks/reentrant events
      // can never accept this composition twice.
      hide();
      onAccept(candidate);
    }

    function highlight(index) {
      highlighted = index;
      for (const [i, option] of Array.from(list.children).entries()) {
        option.setAttribute("aria-selected", String(i === index));
      }
      list.setAttribute("aria-activedescendant", list.children[index].id);
    }

    function mount(document) {
      if (host && doc === document) return;
      doc = document;
      view = doc.defaultView;
      host = doc.createElement("div");
      host.setAttribute("data-shobdo-suggestions", "");
      // The host itself still lives in the site's DOM; important inline geometry
      // and an internal reset isolate both it and the shadow content.
      // isolation:isolate keeps the max z-index from blending with site layers.
      for (const [name, value] of Object.entries({ all: "initial", position: "fixed",
        "z-index": "2147483647", isolation: "isolate", display: "block", margin: "0", padding: "0",
        border: "0", "box-sizing": "border-box", "pointer-events": "auto",
        direction: "ltr", visibility: "visible", opacity: "1", transform: "none" })) {
        host.style.setProperty(name, value, "important");
      }
      const shadow = host.attachShadow({ mode: "open" });
      const style = doc.createElement("style");
      style.textContent = `
        :host { color-scheme: light; }
        * { box-sizing: border-box; }
        .panel { color: #17212f; background: #fff; border: 1px solid #ccd3df;
          border-radius: 8px; box-shadow: 0 4px 18px #0003; padding: 4px;
          font: 14px/1.5 system-ui, sans-serif; direction: ltr; }
        .hint { margin: 2px 6px 4px; color: #596579; font-size: 11px; }
        [role=option] { display: block; width: 100%; margin: 0; padding: 5px 8px;
          border: 0; border-radius: 4px; background: transparent; color: inherit;
          text-align: left; font: inherit; cursor: pointer; }
        [role=option][aria-selected=true] { background: #e7efff; color: #153b7a; }
        .latin { float: right; padding-left: 12px; color: #596579; font-size: 11px; }
      `;
      const panel = doc.createElement("div");
      panel.className = "panel";
      const hint = doc.createElement("div");
      hint.className = "hint";
      hint.textContent = "↑ ↓ choose · Tab accepts · Esc closes";
      list = doc.createElement("div");
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Shobdo Bangla spelling suggestions");
      panel.append(hint, list);
      shadow.append(style, panel);
      // Prevent focus/selection changes without relying on restoring selection
      // after blur. Acceptance is deliberately only on click, never pointerdown.
      host.addEventListener("pointerdown", event => event.preventDefault());
      host.addEventListener("mousedown", event => event.preventDefault());
    }

    function anchorRect(root, supplied) {
      if (supplied) return supplied;
      const selection = root.getRootNode().getSelection?.() || root.ownerDocument.getSelection?.();
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if (root.contains(range.commonAncestorContainer) &&
            typeof range.getBoundingClientRect === "function") {
          const rect = range.getBoundingClientRect();
          if (rect.width || rect.height) return rect;
        }
      }
      return root.getBoundingClientRect();
    }

    // Scroll/resize can fire many times per frame. Run the first event
    // synchronously (tests + click safety rely on it) and coalesce bursts.
    function scheduleReposition() {
      if (repositionQueued) return;
      repositionQueued = true;
      reposition();
      const release = () => { repositionQueued = false; };
      try {
        if (typeof view?.requestAnimationFrame === "function") view.requestAnimationFrame(release);
        else view?.setTimeout?.(release, 0);
      } catch (_) { repositionQueued = false; }
    }

    function reposition() {
      if (!activeRoot?.isConnected) { hide(); return; }
      const fieldBox = activeRoot.getBoundingClientRect();
      // Supplied rich-text caret coordinates follow their field during scroll.
      // Keep the same DOM options/highlight, so native auto-scroll cannot detach
      // an option halfway through a real pointer click.
      const supplied = suppliedAnchor && initialFieldBox ? {
        left: suppliedAnchor.left + fieldBox.left - initialFieldBox.left,
        top: suppliedAnchor.top + fieldBox.top - initialFieldBox.top,
        bottom: suppliedAnchor.bottom + fieldBox.top - initialFieldBox.top,
      } : null;
      const box = anchorRect(activeRoot, supplied);
      const width = Math.min(304, Math.max(0, view.innerWidth - 16));
      host.style.setProperty("width", `${width}px`, "important");
      const height = host.getBoundingClientRect().height || (candidates.length * 34 + 32);
      const left = Math.max(8, Math.min(Number(box.left) || 0, view.innerWidth - width - 8));
      const bottom = Number(box.bottom) || 0;
      const top = bottom + height + 8 <= view.innerHeight ? bottom + 4 :
        Math.max(8, Math.min(view.innerHeight - height - 8, (Number(box.top) || 0) - height - 4));
      host.style.setProperty("left", `${left}px`, "important");
      host.style.setProperty("top", `${top}px`, "important");
    }

    function show({ root, latin, rect } = {}) {
      hide();
      // document_start has no body yet. A later composition edit will try again;
      // never create an observer/timer just to wait for mounting.
      if (!root?.isConnected || !root.ownerDocument.body || !eligible(latin) || latin.length < 2) return;
      candidates = getCandidates(latin);
      if (!candidates.length) return;
      mount(root.ownerDocument);
      activeRoot = root;
      const currentRevision = revision;
      list.replaceChildren();
      candidates.forEach((candidate, index) => {
        const option = doc.createElement("button");
        option.type = "button";
        option.tabIndex = -1;
        option.id = `shobdo-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-label", `${candidate.text}, ${candidate.latin}, ${candidate.kind}`);
        option.textContent = candidate.text;
        const spelling = doc.createElement("span");
        spelling.className = "latin";
        spelling.textContent = candidate.latin;
        option.append(spelling);
        option.addEventListener("pointerenter", () => {
          if (visible && revision === currentRevision) highlight(index);
        });
        option.addEventListener("click", () => choose(index, currentRevision));
        list.append(option);
      });
      highlight(0);
      doc.body.append(host);
      suppliedAnchor = rect || null;
      initialFieldBox = root.getBoundingClientRect();
      reposition();
      visible = true;
      scrollTargets = [doc];
      // Observe open-shadow ancestors too: document observers cannot see field
      // removal or non-composed scrolling within a shadow tree.
      let tree = root.getRootNode();
      while (tree.host) {
        scrollTargets.push(tree);
        tree = tree.host.getRootNode();
      }
      for (const target of scrollTargets) target.addEventListener("scroll", scheduleReposition, true);
      view.addEventListener("resize", scheduleReposition);
      if (view.MutationObserver) {
        observer = new view.MutationObserver(() => {
          if (!activeRoot?.isConnected) hide();
        });
        // Observe body (not documentElement) plus open-shadow trees: cheaper
        // yet still catches field removal; attribute/characterData changes
        // never affect panel lifetime.
        const scope = doc.body || doc.documentElement;
        observer.observe(scope, { childList: true, subtree: true, attributes: false, characterData: false });
        for (const tree of scrollTargets.slice(1)) {
          observer.observe(tree, { childList: true, subtree: true, attributes: false, characterData: false });
        }
      }
    }

    function handleKey(event) {
      if (!visible) return false;
      if (!activeRoot?.isConnected) { hide(); return false; }
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey ||
          event.metaKey || event.altKey || event.shiftKey) return false;
      switch (event.key) {
        case "ArrowDown": highlight((highlighted + 1) % candidates.length); break;
        case "ArrowUp": highlight((highlighted + candidates.length - 1) % candidates.length); break;
        case "Tab": choose(highlighted); break;
        case "Escape": hide(); break;
        default: return false; // Especially Enter: retain native form submission.
      }
      event.preventDefault();
      return true;
    }

    return Object.freeze({ show, hide, handleKey });
  }

  const api = Object.freeze({ getCandidates, create });
  global.ShobdoSuggestions = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis);
