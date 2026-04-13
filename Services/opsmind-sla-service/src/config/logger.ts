type Meta = unknown;

function format(level: string, message: string, meta?: Meta) {
  const base = `[${new Date().toISOString()}] [${level}] ${message}`;
  if (meta === undefined) return base;
  return `${base} ${JSON.stringify(meta)}`;
}

export const logger = {
  info(message: string, meta?: Meta) {
    console.log(format("INFO", message, meta));
  },
  warn(message: string, meta?: Meta) {
    console.warn(format("WARN", message, meta));
  },
  error(message: string, meta?: Meta) {
    console.error(format("ERROR", message, meta));
  },
};
