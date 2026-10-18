-- This independent copy uses selectable profiles without passwords.
ALTER TABLE users DROP COLUMN password_hash;
DROP TABLE login_attempts;
INSERT INTO users(username,name,role) VALUES ('owner','Dueño','admin'),('staff','Mesero','waiter');
