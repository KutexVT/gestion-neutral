import { migrate, pool } from "../server/db.js";
try {
  await migrate();
  console.log("Migraciones aplicadas");
} finally {
  await pool.end();
}
