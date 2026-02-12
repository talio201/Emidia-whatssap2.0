<<<<<<< HEAD

import request from 'supertest';
import app from './index.js';

describe('API Backend - Testes básicos', () => {
  it('GET /status deve retornar status do backend', async () => {
    const res = await request(app).get('/status');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('ready');
  });

  it('GET /contacts sem autenticação deve falhar', async () => {
    const res = await request(app).get('/contacts');
=======
import request from 'supertest';
// Certifique-se de que seu index.js exporta o 'app' (ex: export default app ou module.exports = app)
import app from './index.js'; 

describe('API Backend - Testes Básicos', () => {
  
  it('GET /status deve retornar status do backend', async () => {
    const res = await request(app).get('/status');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('ready');
  });

  it('GET /contacts sem autenticação deve retornar 401', async () => {
    const res = await request(app).get('/contacts');
    // Agora que você corrigiu a rota no index.js, ela deve retornar 401 ou 403
>>>>>>> a20ebc8135170b45ffa0563a09f4e2ea0ef5283c
    expect([401, 403]).toContain(res.statusCode);
  });

  it('POST /send sem token deve falhar', async () => {
<<<<<<< HEAD
    const res = await request(app).post('/send').send({ message: 'Teste' });
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe('API Backend - Funcionalidades principais', () => {
  it('POST /schedule sem token deve falhar', async () => {
    const res = await request(app).post('/schedule').send({ numbers: ["5511999999999"], message: "Teste", sendAt: new Date().toISOString() });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('POST /upload sem token deve falhar', async () => {
    const res = await request(app).post('/upload').send({ filename: "teste.txt", base64: "dGVzdGU=", mime: "text/plain" });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('POST /campaigns sem nome deve retornar erro', async () => {
    const res = await request(app).post('/campaigns').send({ message: "Teste" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /groups/create sem dados deve retornar erro', async () => {
    const res = await request(app).post('/groups/create').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /replies deve retornar 200', async () => {
    const res = await request(app).get('/replies');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('replies');
  });
});
=======
    const res = await request(app).post('/send').send({
      number: '5511999999999',
      message: 'Teste'
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
>>>>>>> a20ebc8135170b45ffa0563a09f4e2ea0ef5283c
