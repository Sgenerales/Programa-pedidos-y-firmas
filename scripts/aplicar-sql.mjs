#!/usr/bin/env node
/**
 * Ejecuta un archivo .sql contra el proyecto de Supabase usando la
 * Management API. Sin dependencias y sin CLI.
 *
 *   node scripts/aplicar-sql.mjs supabase/migrations/2026...sql
 *
 * Lee las credenciales de .env.local (ignorado por git) y nunca las
 * imprime. El token requerido es un Personal Access Token (sbp_...);
 * la clave publicable no sirve para DDL, a propósito.
 */

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const ENV_FILE = '.env.local';
const API = 'https://api.supabase.com';

function leerEnv(archivo) {
  let crudo;
  try {
    crudo = readFileSync(archivo, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const linea of crudo.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const i = limpia.indexOf('=');
    if (i < 0) continue;
    out[limpia.slice(0, i).trim()] = limpia
      .slice(i + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function fallar(mensaje, ayuda) {
  console.error(`\n  ✕ ${mensaje}`);
  if (ayuda) console.error(`\n${ayuda}`);
  console.error('');
  exit(1);
}

const archivoSql = argv[2];
if (!archivoSql) fallar('Falta el archivo .sql a ejecutar.', '  node scripts/aplicar-sql.mjs <archivo.sql>');

const env = { ...leerEnv(ENV_FILE), ...process.env };
const token = env.SUPABASE_ACCESS_TOKEN;
const url = env.VITE_SUPABASE_URL;

if (!url) fallar(`No encontré VITE_SUPABASE_URL en ${ENV_FILE}.`);
if (!token) {
  fallar(
    `No encontré SUPABASE_ACCESS_TOKEN en ${ENV_FILE}.`,
    [
      '  1. Generá un token en https://supabase.com/dashboard/account/tokens',
      `  2. Agregá esta línea al final de ${ENV_FILE} (ya está ignorado por git):`,
      '',
      '       SUPABASE_ACCESS_TOKEN=sbp_tu_token_aca',
      '',
      '  El prefijo VITE_ se omite a propósito: sin él, Vite nunca lo',
      '  incluye en el bundle del navegador.',
    ].join('\n'),
  );
}

const ref = new URL(url).hostname.split('.')[0];
let sql;
try {
  sql = readFileSync(archivoSql, 'utf8');
} catch {
  fallar(`No pude leer ${archivoSql}.`);
}

console.log(`\n  Proyecto : ${ref}`);
console.log(`  Archivo  : ${archivoSql} (${sql.split(/\r?\n/).length} líneas)`);
console.log('  Ejecutando…\n');

const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});

const texto = await res.text();
let cuerpo;
try {
  cuerpo = JSON.parse(texto);
} catch {
  cuerpo = texto;
}

if (!res.ok) {
  const detalle = typeof cuerpo === 'string' ? cuerpo : (cuerpo.message ?? JSON.stringify(cuerpo));
  fallar(
    `Supabase respondió HTTP ${res.status}.`,
    `  ${detalle}\n\n${
      res.status === 401
        ? '  El token es inválido o fue revocado. Generá uno nuevo.'
        : res.status === 404
          ? `  El proyecto "${ref}" no existe o el token no tiene acceso a él.`
          : '  Revisá el SQL: el mensaje de arriba viene de Postgres.'
    }`,
  );
}

console.log('  ✓ Ejecutado sin errores.\n');
if (Array.isArray(cuerpo) && cuerpo.length) {
  console.log(JSON.stringify(cuerpo, null, 2));
  console.log('');
}
