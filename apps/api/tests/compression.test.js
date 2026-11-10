import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { compressionMiddleware } from '../src/middleware/compression.js';

describe('HTTP Response Compression Middleware', () => {
  function createTestApp() {
    const app = express();
    app.use(compressionMiddleware({ threshold: 1024 }));

    // Small JSON (< 1KB)
    app.get('/small', (req, res) => {
      res.status(200).json({ status: 'ok', small: true });
    });

    // Large JSON (> 1KB)
    app.get('/large', (req, res) => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `item_${i}`,
        name: `Test Tenant Store #${i}`,
        description: 'Detailed description string for retail store item benchmark',
        active: true,
      }));
      res.status(200).json({ success: true, items });
    });

    // 204 No Content
    app.get('/empty', (req, res) => {
      res.status(204).end();
    });

    return app;
  }

  it('compresses JSON response exceeding 1024 bytes with gzip when client accepts it', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/large')
      .set('Accept-Encoding', 'gzip');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['vary']).toContain('Accept-Encoding');
    // Superagent automatically handles decompression of res.body
    expect(res.body.success).toBe(true);
    expect(res.body.items.length).toBe(50);
  });

  it('compresses with brotli when client requests br', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/large')
      .set('Accept-Encoding', 'br');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.body.success).toBe(true);
    expect(res.body.items.length).toBe(50);
  });

  it('does NOT compress responses under the 1024-byte threshold', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/small')
      .set('Accept-Encoding', 'gzip');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.status).toBe('ok');
  });

  it('does NOT compress when client does not send Accept-Encoding', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/large')
      .set('Accept-Encoding', 'identity');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.success).toBe(true);
  });

  it('correctly handles 204 No Content without error', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/empty')
      .set('Accept-Encoding', 'gzip');

    expect(res.status).toBe(204);
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
