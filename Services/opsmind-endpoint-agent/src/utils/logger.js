function formatMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || Object.keys(meta).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch (_error) {
    return "";
  }
}

function write(level, message, meta) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}${formatMeta(meta)}`;

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
}

const logger = {
  info(message, meta) {
    write("INFO", message, meta);
  },
  warn(message, meta) {
    write("WARN", message, meta);
  },
  error(message, meta) {
    write("ERROR", message, meta);
  },
  debug(message, meta) {
    write("DEBUG", message, meta);
  },
};

module.exports = logger;
