(() => {
  function normalizeWords(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-VE")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function singularize(word) {
    if (word.length > 5 && word.endsWith("es")) return word.slice(0, -2);
    if (word.length > 4 && word.endsWith("s")) return word.slice(0, -1);
    return word;
  }

  function isCloseWordMatch(left, right) {
    if (left === right || singularize(left) === singularize(right)) return true;
    if (Math.abs(left.length - right.length) > 1 || Math.min(left.length, right.length) < 5) return false;

    let leftIndex = 0;
    let rightIndex = 0;
    let differences = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
      if (left[leftIndex] === right[rightIndex]) {
        leftIndex += 1;
        rightIndex += 1;
      } else {
        differences += 1;
        if (differences > 1) return false;
        if (left.length > right.length) leftIndex += 1;
        else if (right.length > left.length) rightIndex += 1;
        else {
          leftIndex += 1;
          rightIndex += 1;
        }
      }
    }
    if (leftIndex < left.length || rightIndex < right.length) differences += 1;
    return differences <= 1;
  }

  function matchesAllWords(keywordWords, productWords) {
    const candidates = keywordWords.map((keywordWord) =>
      productWords.flatMap((productWord, index) =>
        isCloseWordMatch(keywordWord, productWord) ? [index] : []));
    if (candidates.some((wordCandidates) => wordCandidates.length === 0)) return false;
    candidates.sort((left, right) => left.length - right.length);
    const usedProductWords = new Set();

    function matchNextWord(index) {
      if (index === candidates.length) return true;
      for (const productIndex of candidates[index]) {
        if (usedProductWords.has(productIndex)) continue;
        usedProductWords.add(productIndex);
        if (matchNextWord(index + 1)) return true;
        usedProductWords.delete(productIndex);
      }
      return false;
    }

    return matchNextWord(0);
  }

  function findKristalProductImageRule(productName, rules) {
    const productWords = normalizeWords(productName);
    const matches = [];

    (rules || []).forEach((rule) => {
      (rule.keywords || []).forEach((keyword) => {
        const keywordWords = normalizeWords(keyword);
        if (!keywordWords.length) return;
        const allWordsMatched = matchesAllWords(keywordWords, productWords);
        if (allWordsMatched) {
          matches.push({
            imageUrl: rule.image_url,
            keyword,
            wordCount: keywordWords.length,
            characterCount: keywordWords.reduce((total, word) => total + singularize(word).length, 0),
          });
        }
      });
    });

    if (!matches.length) return null;
    matches.sort((left, right) => right.wordCount - left.wordCount
      || right.characterCount - left.characterCount);
    const bestMatches = matches.filter((match) =>
      match.wordCount === matches[0].wordCount
      && match.characterCount === matches[0].characterCount);
    if (new Set(bestMatches.map((match) => match.imageUrl)).size > 1) {
      return { ambiguous: true, keyword: bestMatches.map((match) => match.keyword).join(" / ") };
    }
    return { imageUrl: bestMatches[0].imageUrl, keyword: bestMatches[0].keyword };
  }

  window.findKristalProductImageRule = findKristalProductImageRule;
})();
