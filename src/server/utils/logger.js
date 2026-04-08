function line(level, message, meta = {}) {
  const payload = {
    level,
    message,
    ...meta,
    time: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
}

export const logger = {
  info(message, meta) {
    line("info", message, meta);
  },
  warn(message, meta) {
    line("warn", message, meta);
  },
  error(message, meta) {
    line("error", message, meta);
  },
};
