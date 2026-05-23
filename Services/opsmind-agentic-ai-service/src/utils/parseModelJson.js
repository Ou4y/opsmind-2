function stripCodeFences(text) {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractFirstJsonObject(text) {
  const startIndex = text.indexOf("{");

  if (startIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function createParseError() {
  const error = new Error("Failed to parse model JSON output.");
  error.code = "MODEL_PARSE_FAILURE";
  return error;
}

function parseModelJson(rawText) {
  if (typeof rawText !== "string") {
    throw createParseError();
  }

  const cleanedText = stripCodeFences(rawText);

  try {
    return JSON.parse(cleanedText);
  } catch (_error) {
    const firstJsonObject = extractFirstJsonObject(cleanedText);

    if (!firstJsonObject) {
      throw createParseError();
    }

    try {
      return JSON.parse(firstJsonObject);
    } catch (_nestedError) {
      throw createParseError();
    }
  }
}

module.exports = {
  parseModelJson,
};
