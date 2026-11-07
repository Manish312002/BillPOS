/**
 * Request Logger Middleware
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`
      );
    }
  });

  next();
}

export default requestLogger;
