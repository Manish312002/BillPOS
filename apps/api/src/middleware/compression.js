import zlib from 'node:zlib';

/**
 * High-performance, zero-dependency HTTP response compression middleware
 * utilizing Node.js built-in `node:zlib`.
 *
 * Requirements:
 * - Respects client `Accept-Encoding` header (gzip, br, deflate).
 * - Only compresses eligible responses >= 1024 bytes (1 KB threshold).
 * - Strictly skips non-compressible or already compressed responses.
 * - Preserves status codes, headers, and handles HEAD / 204 / 304 correctly.
 * - Appends `Vary: Accept-Encoding`.
 */
export function compressionMiddleware({
  threshold = 1024,
  level = 6,
} = {}) {
  return function compression(req, res, next) {
    // 1. Skip HEAD / OPTIONS requests
    if (req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const acceptEncoding = (req.headers['accept-encoding'] || '').toLowerCase();

    // Determine preferred compression algorithm
    let encoder = null;
    let contentEncoding = null;

    if (acceptEncoding.includes('gzip')) {
      contentEncoding = 'gzip';
      encoder = (buf) => zlib.gzipSync(buf, { level });
    } else if (acceptEncoding.includes('br')) {
      contentEncoding = 'br';
      encoder = (buf) => zlib.brotliCompressSync(buf);
    } else if (acceptEncoding.includes('deflate')) {
      contentEncoding = 'deflate';
      encoder = (buf) => zlib.deflateSync(buf, { level });
    }

    // Always vary on Accept-Encoding for caching proxies
    const currentVary = res.getHeader('Vary');
    if (!currentVary) {
      res.setHeader('Vary', 'Accept-Encoding');
    } else if (!currentVary.includes('Accept-Encoding')) {
      res.setHeader('Vary', `${currentVary}, Accept-Encoding`);
    }

    // If client does not accept compression or no supported encoder, continue normally
    if (!encoder) {
      return next();
    }

    const originalSend = res.send.bind(res);

    res.send = function (body) {
      // Restore original send to prevent recursion
      res.send = originalSend;

      // Skip 204 No Content, 304 Not Modified, or empty body
      if (res.statusCode === 204 || res.statusCode === 304 || body === undefined || body === null) {
        return originalSend(body);
      }

      // Avoid double compression
      if (res.getHeader('Content-Encoding')) {
        return originalSend(body);
      }

      // Determine Content-Type
      let contentType = res.getHeader('Content-Type');
      if (!contentType && typeof body === 'object' && !Buffer.isBuffer(body)) {
        contentType = 'application/json; charset=utf-8';
        res.setHeader('Content-Type', contentType);
      }

      const contentTypeStr = typeof contentType === 'string' ? contentType : '';
      const isCompressible =
        contentTypeStr.includes('application/json') ||
        contentTypeStr.includes('text/') ||
        contentTypeStr.includes('application/javascript') ||
        contentTypeStr.includes('application/xml');

      if (!isCompressible) {
        return originalSend(body);
      }

      let buffer;
      if (Buffer.isBuffer(body)) {
        buffer = body;
      } else if (typeof body === 'string') {
        buffer = Buffer.from(body, 'utf8');
      } else if (typeof body === 'object') {
        buffer = Buffer.from(JSON.stringify(body), 'utf8');
      } else {
        buffer = Buffer.from(String(body), 'utf8');
      }

      // Check size threshold
      if (buffer.length < threshold) {
        return originalSend(body);
      }

      try {
        const compressed = encoder(buffer);
        res.setHeader('Content-Encoding', contentEncoding);
        res.removeHeader('Content-Length');
        return originalSend(compressed);
      } catch {
        // Fallback safely to uncompressed body on zlib error
        return originalSend(body);
      }
    };

    next();
  };
}
