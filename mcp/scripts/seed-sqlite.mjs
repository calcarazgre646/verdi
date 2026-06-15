#!/usr/bin/env node
// Builds a local SQLite database shaped like a JDE World data library, for the
// read-only open core. A REAL database you control: no IBM i, no client.
// Usage: node scripts/seed-sqlite.mjs [path]   (default: ./jdfdata.sqlite)
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const out = resolve(process.argv[2] || "jdfdata.sqlite");
const db = new DatabaseSync(out);

db.exec(`
DROP TABLE IF EXISTS F4101;
DROP TABLE IF EXISTS F41021;
DROP TABLE IF EXISTS F0101;
DROP TABLE IF EXISTS F4211;
DROP TABLE IF EXISTS F9210;

-- Item Master
CREATE TABLE F4101 (IMITM INTEGER, IMLITM TEXT, IMDSC1 TEXT, IMSRP1 TEXT);
-- Item Location (quantities)
CREATE TABLE F41021 (LIITM INTEGER, LIMCU TEXT, LILOTN TEXT, LIPQOH INTEGER, LIPCOM INTEGER);
-- Address Book
CREATE TABLE F0101 (ABAN8 INTEGER, ABALPH TEXT, ABAT1 TEXT, ABTAX TEXT);
-- Sales Order Detail (SDUPRC = unit price, stored as integer with implied decimals)
CREATE TABLE F4211 (SDDOCO INTEGER, SDLNID INTEGER, SDAN8 INTEGER, SDLITM TEXT,
                    SDUORG INTEGER, SDSOQS INTEGER, SDTRDJ INTEGER, SDNXTR TEXT, SDUPRC INTEGER);
-- Data Dictionary field specifications (data item -> type/size/DISPLAY decimals).
-- DTDD (display decimals) is the gotcha: it lives here, NOT in the column scale.
-- Map JDE_DD_QUERY to the real DD on a live install (confirm against F9210).
CREATE TABLE F9210 (DTAI TEXT, DTDESC TEXT, DTDT TEXT, DTDS INTEGER, DTDD INTEGER);
`);

const ins = (sql, rows) => { const s = db.prepare(sql); for (const r of rows) s.run(...r); };

ins(`INSERT INTO F4101 VALUES (?,?,?,?)`, [
  [60001, "JEAN-ACM-32", "Acme Slim Jean 32", "ACM"],
  [60002, "JEAN-GLX-34", "Globex Brooklyn Jean 34", "GLX"],
  [60003, "TSHIRT-ACM-M", "Acme Logo Tee M", "ACM"],
]);
ins(`INSERT INTO F41021 VALUES (?,?,?,?,?)`, [
  [60001, "  TIENDA01", "", 4200, 200],
  [60002, "  TIENDA01", "", 1300, 50],
  [60001, "  TIENDA02", "", 900, 0],
]);
ins(`INSERT INTO F0101 VALUES (?,?,?,?)`, [
  [4242, "Acme Distribution SA", "C", "80012345-6"],
  [5101, "Globex Supplies SRL", "V", "80098765-4"],
]);
ins(`INSERT INTO F4211 VALUES (?,?,?,?,?,?,?,?,?)`, [
  // SDTRDJ Julian (126166 = 2026-06-15); SDUPRC 125000 -> 12.5000 (UPRC has 4 decimals)
  [501001, 1, 4242, "JEAN-ACM-32", 10, 4, 126166, "520", 125000],
  [501001, 2, 4242, "JEAN-GLX-34", 6, 6, 126166, "999", 89900],
]);
ins(`INSERT INTO F9210 VALUES (?,?,?,?,?)`, [
  // data item, description, data type, size, DISPLAY decimals
  ["AN8", "Address Number", "Numeric", 8, 0],
  ["ITM", "Short Item Number", "Numeric", 8, 0],
  ["LITM", "2nd Item Number", "String", 25, 0],
  ["DOCO", "Document (Order No)", "Numeric", 8, 0],
  ["LNID", "Line Number", "Numeric", 6, 0],
  ["UORG", "Quantity Ordered", "Numeric", 15, 0],
  ["SOQS", "Quantity Shipped", "Numeric", 15, 0],
  ["PQOH", "Quantity On Hand", "Numeric", 15, 0],
  ["PCOM", "Quantity Committed", "Numeric", 15, 0],
  ["TRDJ", "Order Date (Julian)", "Date", 6, 0],
  ["AA", "Amount", "Numeric", 15, 2],
  ["U", "Quantity", "Numeric", 15, 0],
  ["UPRC", "Unit Price", "Numeric", 15, 4], // 4 display decimals: 125000 -> 12.5000
]);

db.close();
console.log("seeded", out);
