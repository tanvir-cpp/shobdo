(function (root) {
  "use strict";

  const phonetic = typeof module === "object" && module.exports
    ? require("./vendor/avro.js")
    : root.OmicronLab?.Avro?.Phonetic;

  if (!phonetic || typeof phonetic.parse !== "function") {
    throw new Error("Load vendor/avro.js before engine.js.");
  }

  // Avro's lower-case 'o' is an inherent vowel, not an explicit ও/ো.
  // These whole-word aliases cover common colloquial input, while all other
  // words retain the upstream contextual rules and case-sensitive controls.
  const aliases = new Map([
    ["acho", "achO"],
    ["tomar", "tOmar"],
    ["bhalo", "bhalO"],
    ["valo", "valO"]
  ]);
  // Uppercase vowel/conjunct controls remain available alongside acronyms.
  const phoneticControls = new Set(["OI", "OU", "NG", "NN", "DD", "TT"]);

  function transliterateWord(word) {
    if (/^[A-Z]{2,}$/.test(word) && !phoneticControls.has(word)) {
      return word;
    }
    const input = aliases.get(word) || word;
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
