(function (root) {
  "use strict";

  const phonetic = typeof module === "object" && module.exports
    ? require("./vendor/avro.js")
    : root.OmicronLab?.Avro?.Phonetic;

  if (!phonetic || typeof phonetic.parse !== "function") {
    throw new Error("Load vendor/avro.js before engine.js.");
  }

  // Vendored upstream autocorrect dictionary (vendor/autodict.js), when it was
  // loaded before this file. Absence is fine: the engine still works with the
  // local aliases below (e.g. isolated vm tests load only avro.js + engine.js).
  let autocorrect = null;
  if (typeof module === "object" && module.exports) {
    try {
      const loaded = require("./vendor/autodict.js");
      if (loaded instanceof Map) autocorrect = loaded;
    } catch (_) { /* Optional dictionary; local aliases suffice. */ }
  } else if (root.OmicronLab?.Avro?.Autocorrect instanceof Map) {
    autocorrect = root.OmicronLab.Avro.Autocorrect;
  }

  // Avro's lower-case 'o' is an inherent vowel, not an explicit ও/ো.
  // These whole-word aliases cover common colloquial input, while all other
  // words retain the upstream contextual rules and case-sensitive controls.
  // They take precedence over the autocorrect dictionary where they overlap
  // (verified to agree: sona/sOnar).
  const aliases = new Map([
    ["acho", "achO"],
    ["tomar", "tOmar"],
    ["bhalo", "bhalO"],
    ["valo", "valO"],
    ["sona", "sOna"],
    ["sonar", "sOnar"]
  ]);
  // Uppercase two-letter sequences reserved by Avro's phonetic rules for
  // specific vowels (OI, OU) and conjuncts (NG, NN, DD, TT). These pass
  // through transliterate() instead of being treated as acronyms. When
  // upgrading vendor/avro.js, verify this set against the Avro phonetic
  // spec and add any new uppercase controls here to keep them functional.
  const phoneticControls = new Set(["OI", "OU", "NG", "NN", "DD", "TT"]);

  function transliterateWord(word) {
    if (/^[A-Z]{2,}$/.test(word) && !phoneticControls.has(word)) {
      return word;
    }
    const input = aliases.get(word) || autocorrect?.get(word) || word;
    // Normalize generated Bangla only; existing text must remain untouched.
    return phonetic.parse(input).normalize("NFC");
  }

  function transliterate(text) {
    if (typeof text !== "string") {
      throw new TypeError("ShobdoEngine.transliterate expects a string.");
    }
    // Parse each Latin word in context. Everything else, including punctuation,
    // digits, whitespace, emoji and existing Bangla, passes through verbatim.
    return text.replace(/[A-Za-z]+/g, transliterateWord);
  }

  const engine = Object.freeze({ transliterate });
  root.ShobdoEngine = engine;
  if (typeof module === "object" && module.exports) {
    module.exports = engine;
  }
})(globalThis);
