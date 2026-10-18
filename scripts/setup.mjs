import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const secret = randomBytes(32).toString('hex');
try {
  await writeFile('.env', `POSTGRES_PASSWORD=${secret}\nDATABASE_URL=postgresql://bar:${secret}@localhost:5487/bar\nAPP_ORIGIN=http://localhost:3182\nPORT=3182\nHOST=127.0.0.1\nSECURE_COOKIES=false\nAPP_NAME=Gestión\nCURRENCY=CRC\nTIME_ZONE=America/Costa_Rica\nDOMAIN=gestion.example.com\n`, { flag: 'wx', mode: 0o600 });
  console.log('.env creado con una contraseña aleatoria para PostgreSQL');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env ya existe; se conserva');
  else throw error;
}
