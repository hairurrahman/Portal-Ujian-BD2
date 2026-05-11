// ================================================================
// firestore.js — Layer API Firestore (Multi-Kelas dengan Namespace)
// ns = "" → Kelas 6 lama (data tetap aman, path tidak berubah)
// ns = "k5" → Kelas 5 (path: k5_siswa/, k5_token/, dst)
// ================================================================

export const FIREBASE_CONFIG = {
  apiKey  : "AIzaSyCnwRmJCv15nV2lFvZT8HhAzpq0a6s8rl0",
  projectId: "ujian-digital",
};

const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// ── Helpers Firestore REST ───────────────────────────────────────
function toFV(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number")  return { doubleValue: val };
  if (typeof val === "string")  return { stringValue: val };
  if (Array.isArray(val))       return { arrayValue: { values: val.map(toFV) } };
  if (typeof val === "object")  return { mapValue: { fields: objToFields(val) } };
  return { stringValue: String(val) };
}
function fromFV(fv) {
  if (!fv) return null;
  if ("nullValue"    in fv) return null;
  if ("booleanValue" in fv) return fv.booleanValue;
  if ("integerValue" in fv) return Number(fv.integerValue);
  if ("doubleValue"  in fv) return fv.doubleValue;
  if ("stringValue"  in fv) return fv.stringValue;
  if ("arrayValue"   in fv) return (fv.arrayValue.values || []).map(fromFV);
  if ("mapValue"     in fv) return fieldsToObj(fv.mapValue.fields || {});
  return null;
}
function objToFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFV(v);
  return fields;
}
function fieldsToObj(fields) {
  const obj = {};
  for (const [k, fv] of Object.entries(fields)) obj[k] = fromFV(fv);
  return obj;
}

async function fsGet(path) {
  const r = await fetch(`${BASE}/${path}?key=${FIREBASE_CONFIG.apiKey}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} gagal: ${r.status}`);
  const doc = await r.json();
  if (!doc.fields) return null;
  return { id: doc.name.split("/").pop(), ...fieldsToObj(doc.fields) };
}
async function fsPatch(path, data, fields = null) {
  const url = fields
    ? `${BASE}/${path}?key=${FIREBASE_CONFIG.apiKey}&${fields.map(f => `updateMask.fieldPaths=${f}`).join("&")}`
    : `${BASE}/${path}?key=${FIREBASE_CONFIG.apiKey}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: objToFields(data) }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || `PATCH ${path} gagal: ${r.status}`);
  }
  return await r.json();
}
async function fsDelete(path) {
  const r = await fetch(`${BASE}/${path}?key=${FIREBASE_CONFIG.apiKey}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`DELETE ${path} gagal: ${r.status}`);
}
async function fsList(collection, { limit } = {}) {
  let url = `${BASE}/${collection}?key=${FIREBASE_CONFIG.apiKey}`;
  if (limit) url += `&pageSize=${limit}`;
  const docs = [];
  let pageToken = null;
  do {
    const pageUrl = pageToken ? `${url}&pageToken=${pageToken}` : url;
    const r = await fetch(pageUrl);
    if (!r.ok) throw new Error(`LIST ${collection} gagal: ${r.status}`);
    const json = await r.json();
    if (json.documents) {
      for (const doc of json.documents) {
        docs.push({ id: doc.name.split("/").pop(), ...fieldsToObj(doc.fields || {}) });
      }
    }
    pageToken = json.nextPageToken || null;
  } while (pageToken);
  return docs;
}
async function fsAdd(collection, data) {
  const r = await fetch(`${BASE}/${collection}?key=${FIREBASE_CONFIG.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: objToFields(data) }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || `ADD ${collection} gagal: ${r.status}`);
  }
  const doc = await r.json();
  return doc.name.split("/").pop();
}
async function fsQuery(collectionId, conditions = [], orderBy = null, limitN = null) {
  const where = conditions.length > 0 ? {
    compositeFilter: {
      op: "AND",
      filters: conditions.map(c => ({
        fieldFilter: {
          field: { fieldPath: c.field },
          op: c.op || "EQUAL",
          value: toFV(c.value),
        }
      }))
    }
  } : undefined;
  const query = {
    structuredQuery: {
      from: [{ collectionId }],
      ...(where ? { where } : {}),
      ...(orderBy ? { orderBy: [{ field: { fieldPath: orderBy }, direction: "ASCENDING" }] } : {}),
      ...(limitN ? { limit: limitN } : {}),
    }
  };
  const r = await fetch(`${BASE}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!r.ok) throw new Error(`Query ${collectionId} gagal: ${r.status}`);
  const rows = await r.json();
  return rows
    .filter(row => row.document)
    .map(row => ({
      id: row.document.name.split("/").pop(),
      ...fieldsToObj(row.document.fields || {}),
    }));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Namespace helper ──────────────────────────────────────────────
// ns = ""   → Kelas 6 lama, path tidak berubah sama sekali
// ns = "k5" → Kelas 5, prefix semua collection: "k5_siswa", "k5_token", dst
function col(ns, name) {
  return ns ? `${ns}_${name}` : name;
}
function cfgPath(ns, doc) {
  // config/pengaturan tetap global (shared) — hanya siswa/soal/token/hasil yang dipisah
  return `config/${doc}`;
}
function cfgNsPath(ns, doc) {
  // config per-kelas: bobot, stats, kkm, mapel, asesmen
  return ns ? `${ns}_config/${doc}` : `config/${doc}`;
}

// ── Soal collection ID ────────────────────────────────────────────
function soalCollectionId(ns, mapel, asesmen) {
  const mapelMap = {
    "Bahasa Indonesia":"BINDO","Pendidikan Pancasila":"PPKN","IPAS":"IPAS",
    "Matematika":"MTK","Seni Rupa":"SENRUPA","Bahasa Madura":"BMADURA",
    "Pendidikan Agama Islam":"PAI","PJOK":"PJOK",
  };
  const k = mapelMap[mapel] || mapel.replace(/\s+/g,"").substring(0,8).toUpperCase();
  const a = asesmen.replace(/\s+/g,"");
  const base = `soal_${k}_${a}`;
  return ns ? `${ns}_${base}` : base;
}

function tokenDocId(mapel, asesmen) {
  return `${mapel}__${asesmen}`.replace(/[^a-zA-Z0-9_\-]/g, "_");
}
function hasilDocId(nisn, mapel, asesmen, waktu) {
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9]/g,"_");
  return `${safe(nisn)}_${safe(mapel)}_${safe(asesmen)}_${safe(waktu)}`.substring(0,200);
}

// ── Default data ──────────────────────────────────────────────────
const DEFAULT_MAPEL = [
  "Bahasa Indonesia","Pendidikan Pancasila","IPAS","Matematika",
  "Seni Rupa","Bahasa Madura","Pendidikan Agama Islam","PJOK"
];
const DEFAULT_ASESMEN = [
  "Sumatif 1","Sumatif 2","Sumatif 3","Sumatif 4",
  "Sumatif 5","Sumatif 6","Sumatif 7","Sumatif 8",
  "Asesmen Akhir Semester"
];

// ================================================================
// PENGATURAN — global (shared semua kelas)
// ================================================================
export async function getPengaturan() {
  try {
    const doc = await fsGet("config/pengaturan");
    return { status:"success", data: doc || {} };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function simpanPengaturan(data) {
  try {
    const keys = ["logoUrl","namaSekolah","namaGuru","nipGuru","kotaTTD","durasiMenit","spreadsheetUrl","fotoGuru"];
    const payload = {};
    for (const k of keys) payload[k] = data[k] !== undefined ? String(data[k]) : "";
    await fsPatch("config/pengaturan", payload);
    return { status:"success", message:"Pengaturan berhasil disimpan" };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// PENGATURAN PER KELAS (ns) — identitas guru, durasi, logo kelas
// ================================================================
export async function getPengaturanKelas(ns = "") {
  try {
    const doc = await fsGet(cfgNsPath(ns, "pengaturan"));
    return { status:"success", data: doc || {} };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function simpanPengaturanKelas(data, ns = "") {
  try {
    const keys = ["logoUrl","namaSekolah","namaGuru","nipGuru","kotaTTD","durasiMenit","fotoGuru"];
    const payload = {};
    for (const k of keys) payload[k] = data[k] !== undefined ? String(data[k]) : "";
    await fsPatch(cfgNsPath(ns, "pengaturan"), payload);
    return { status:"success", message:"Pengaturan kelas berhasil disimpan" };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// BOBOT NILAI — per kelas (ns)
// ================================================================
export async function getBobotNilai(ns = "") {
  try {
    const doc = await fsGet(cfgNsPath(ns, "bobot"));
    if (!doc) return { status:"success", data:{ bobot_objektif:"80", bobot_esai:"20" } };
    return { status:"success", data:{ bobot_objektif: doc.bobot_objektif||"80", bobot_esai: doc.bobot_esai||"20" } };
  } catch(e) { return { status:"success", data:{ bobot_objektif:"80", bobot_esai:"20" } }; }
}
export async function simpanBobotNilai({ bobot_objektif, bobot_esai }, ns = "") {
  try {
    await fsPatch(cfgNsPath(ns, "bobot"), { bobot_objektif: String(bobot_objektif), bobot_esai: String(bobot_esai) });
    return { status:"success", message:"Bobot berhasil disimpan" };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// MAPEL & ASESMEN KUSTOM — per kelas (ns)
// ================================================================
export async function getAllMapel(ns = "") {
  try {
    const doc = await fsGet(cfgNsPath(ns, "mapel"));
    const kustom = doc?.kustom || [];
    return { status:"success", data:[...DEFAULT_MAPEL, ...kustom] };
  } catch(e) { return { status:"success", data:[...DEFAULT_MAPEL] }; }
}
export async function getAllAsesmen(ns = "") {
  try {
    const doc = await fsGet(cfgNsPath(ns, "asesmen"));
    const kustom = doc?.kustom || [];
    return { status:"success", data:[...DEFAULT_ASESMEN, ...kustom] };
  } catch(e) { return { status:"success", data:[...DEFAULT_ASESMEN] }; }
}
export async function tambahMapelKustom({ nama }, ns = "") {
  try {
    const n = String(nama).trim();
    if (!n) return { status:"error", message:"Nama mapel tidak boleh kosong" };
    if (DEFAULT_MAPEL.includes(n)) return { status:"error", message:"Mapel bawaan tidak bisa ditambahkan lagi" };
    const doc = await fsGet(cfgNsPath(ns, "mapel"));
    const kustom = doc?.kustom || [];
    if (kustom.includes(n)) return { status:"error", message:"Mapel sudah ada" };
    await fsPatch(cfgNsPath(ns, "mapel"), { kustom: [...kustom, n] });
    return { status:"success", message:"Mapel kustom berhasil ditambahkan" };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function hapusMapelKustom({ nama }, ns = "") {
  try {
    const n = String(nama).trim();
    if (DEFAULT_MAPEL.includes(n)) return { status:"error", message:"Mapel bawaan tidak bisa dihapus" };
    const doc = await fsGet(cfgNsPath(ns, "mapel"));
    const kustom = (doc?.kustom || []).filter(m => m !== n);
    await fsPatch(cfgNsPath(ns, "mapel"), { kustom });
    return { status:"success", message:"Mapel kustom dihapus" };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function tambahAsesmenKustom({ nama }, ns = "") {
  try {
    const n = String(nama).trim();
    if (!n) return { status:"error", message:"Nama asesmen tidak boleh kosong" };
    if (DEFAULT_ASESMEN.includes(n)) return { status:"error", message:"Asesmen bawaan tidak bisa ditambahkan lagi" };
    const doc = await fsGet(cfgNsPath(ns, "asesmen"));
    const kustom = doc?.kustom || [];
    if (kustom.includes(n)) return { status:"error", message:"Asesmen sudah ada" };
    await fsPatch(cfgNsPath(ns, "asesmen"), { kustom: [...kustom, n] });
    return { status:"success", message:"Asesmen kustom berhasil ditambahkan" };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function hapusAsesmenKustom({ nama }, ns = "") {
  try {
    const n = String(nama).trim();
    if (DEFAULT_ASESMEN.includes(n)) return { status:"error", message:"Asesmen bawaan tidak bisa dihapus" };
    const doc = await fsGet(cfgNsPath(ns, "asesmen"));
    const kustom = (doc?.kustom || []).filter(a => a !== n);
    await fsPatch(cfgNsPath(ns, "asesmen"), { kustom });
    return { status:"success", message:"Asesmen kustom dihapus" };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// KKM — per kelas (ns)
// ================================================================
export async function getKKM(ns = "") {
  try {
    const doc = await fsGet(cfgNsPath(ns, "kkm"));
    return { status:"success", data: doc ? { ...doc } : {} };
  } catch(e) { return { status:"success", data:{} }; }
}
export async function simpanKKM({ kkm }, ns = "") {
  try {
    const payload = {};
    for (const [mapel, nilai] of Object.entries(kkm || {})) {
      if (mapel && !isNaN(nilai)) payload[mapel] = Number(nilai);
    }
    delete payload.id;
    await fsPatch(cfgNsPath(ns, "kkm"), payload);
    return { status:"success", message:"KKM berhasil disimpan" };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// SISWA — per kelas (ns)
// ================================================================
export async function getSiswa(ns = "") {
  try {
    const docs = await fsList(col(ns, "siswa"));
    return { status:"success", data: docs.map(d => ({ nisn:d.nisn||d.id, nama:d.nama||"", kelas:d.kelas||"" })) };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function getSiswaByNISN({ nisn }, ns = "") {
  try {
    const n = String(nisn).trim();
    const doc = await fsGet(`${col(ns, "siswa")}/${n}`);
    if (!doc) return { status:"error", message:"NISN tidak ditemukan" };
    return { status:"success", data:{ nisn: doc.nisn||n, nama: doc.nama||"", kelas: doc.kelas||"" } };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function tambahSiswa({ nisn, nama, kelas }, ns = "") {
  try {
    const n = String(nisn).trim();
    const existing = await fsGet(`${col(ns, "siswa")}/${n}`);
    if (existing) return { status:"error", message:"NISN sudah terdaftar!" };
    await fsPatch(`${col(ns, "siswa")}/${n}`, {
      nisn: n,
      nama: String(nama).trim(),
      kelas: String(kelas).trim(),
      terdaftar: new Date().toLocaleString("id-ID"),
    });
    return { status:"success", message:"Siswa berhasil ditambahkan" };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function hapusSiswa({ nisn }, ns = "") {
  try {
    await fsDelete(`${col(ns, "siswa")}/${String(nisn).trim()}`);
    return { status:"success", message:"Siswa berhasil dihapus" };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// TOKEN — per kelas (ns)
// ================================================================
export async function validasiToken({ mapel, asesmen, token }, ns = "") {
  try {
    const doc = await fsGet(`${col(ns, "token")}/${tokenDocId(mapel, asesmen)}`);
    if (!doc) return { status:"error", message:"Token tidak ditemukan." };
    if (doc.token?.toUpperCase() !== String(token).toUpperCase())
      return { status:"error", message:"Token tidak sesuai." };
    if (doc.aktif !== "TRUE")
      return { status:"error", aktif:"FALSE", message:"Token sedang dinonaktifkan oleh guru." };
    return { status:"success", aktif:"TRUE", message:"Token valid dan aktif." };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function getDaftarToken(ns = "") {
  try {
    const docs = await fsList(col(ns, "token"));
    return {
      status:"success",
      data: docs.map(d => ({ mapel:d.mapel||"", asesmen:d.asesmen||"", token:d.token||"", aktif:d.aktif||"FALSE" }))
    };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function simpanToken({ mapel, asesmen, token }, ns = "") {
  try {
    await fsPatch(`${col(ns, "token")}/${tokenDocId(mapel, asesmen)}`, {
      mapel, asesmen, token: String(token).toUpperCase(), aktif:"TRUE"
    });
    return { status:"success", message:"Token disimpan" };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function updateTokenStatus({ mapel, asesmen, token, status }, ns = "") {
  try {
    const doc = await fsGet(`${col(ns, "token")}/${tokenDocId(mapel, asesmen)}`);
    if (!doc) return { status:"error", message:"Token tidak ditemukan." };
    await fsPatch(`${col(ns, "token")}/${tokenDocId(mapel, asesmen)}`, { aktif: String(status).toUpperCase() }, ["aktif"]);
    return { status:"success", aktif: String(status).toUpperCase(), message:`Token berhasil di${status==="TRUE"?"aktifkan":"nonaktifkan"}.` };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function hapusToken({ mapel, asesmen }, ns = "") {
  try {
    await fsDelete(`${col(ns, "token")}/${tokenDocId(mapel, asesmen)}`);
    return { status: "success", message: "Token berhasil dihapus." };
  } catch(e) { return { status: "error", message: e.message }; }
}

export async function editToken({ mapel, asesmen, tokenLama, tokenBaru }, ns = "") {
  try {
    const doc = await fsGet(`${col(ns, "token")}/${tokenDocId(mapel, asesmen)}`);
    if (!doc) return { status:"error", message:"Token tidak ditemukan." };
    if (doc.token?.toUpperCase() !== String(tokenLama).toUpperCase())
      return { status:"error", message:"Token lama tidak sesuai." };
    await fsPatch(`${col(ns, "token")}/${tokenDocId(mapel, asesmen)}`, { token: String(tokenBaru).toUpperCase() }, ["token"]);
    return { status:"success", message:"Token berhasil diubah." };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// SOAL — per kelas (ns)
// ================================================================
export async function getSoal({ mapel, asesmen, token }, ns = "") {
  try {
    const validasi = await validasiToken({ mapel, asesmen, token }, ns);
    if (validasi.status !== "success") return validasi;
    const colId = soalCollectionId(ns, mapel, asesmen);
    const soalList = await fsList(colId);
    if (soalList.length === 0) return { status:"error", message:`Belum ada soal untuk ${mapel} - ${asesmen}.` };

    // Pisahkan objektif dan uraian
    const objektif = soalList.filter(s => s.jenisSoal !== "Uraian/Esai");
    const urai     = soalList.filter(s => s.jenisSoal === "Uraian/Esai");

    // Acak semua soal objektif (PG, PG Kompleks, Benar/Salah) sekaligus
    for (let i = objektif.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [objektif[i], objektif[j]] = [objektif[j], objektif[i]];
    }

    // Uraian tidak diacak, selalu di akhir
    return { status:"success", soal:[...objektif, ...urai] };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function getSoalGuru({ mapel, asesmen }, ns = "") {
  try {
    const colId = soalCollectionId(ns, mapel, asesmen);
    const soalList = await fsList(colId);
    return { status:"success", soal: soalList };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function tambahSoal({ mapel, asesmen, soal, gambar, jenisSoal, opsi, jawabanBenar, point, jawabanReferensi }, ns = "") {
  try {
    const colId = soalCollectionId(ns, mapel, asesmen);
    const id = genId();
    await fsPatch(`${colId}/${id}`, {
      id, soal, gambar:gambar||"", jenisSoal, opsi:opsi||"[]",
      jawabanBenar:jawabanBenar||"[]", point:Number(point)||0,
      jawabanReferensi:jawabanReferensi||"", mapel, asesmen,
    });
    return { status:"success", message:"Soal berhasil disimpan", id };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function editSoal({ id, mapel, asesmen, soal, gambar, jenisSoal, opsi, jawabanBenar, point, jawabanReferensi }, ns = "") {
  try {
    const colId = soalCollectionId(ns, mapel, asesmen);
    await fsPatch(`${colId}/${id}`, {
      soal, gambar:gambar||"", jenisSoal,
      opsi:opsi||"[]", jawabanBenar:jawabanBenar||"[]",
      point:Number(point)||0, jawabanReferensi:jawabanReferensi||"",
    }, ["soal","gambar","jenisSoal","opsi","jawabanBenar","point","jawabanReferensi"]);
    return { status:"success", message:"Soal berhasil diperbarui." };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function hapusSoal({ id, mapel, asesmen }, ns = "") {
  try {
    const colId = soalCollectionId(ns, mapel, asesmen);
    await fsDelete(`${colId}/${id}`);
    return { status:"success", message:"Soal berhasil dihapus." };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// HASIL UJIAN — per kelas (ns)
// ================================================================
export async function simpanHasil(p, ns = "") {
  try {
    const waktu = p.waktu || new Date().toLocaleString("id-ID");
    const adaEsai = p.adaEsai === true || p.adaEsai === "true";
    const docId = hasilDocId(p.nisn, p.mapel, p.asesmen, waktu);
    const payload = {
      nama:p.nama||"", nisn:String(p.nisn||""), noAbsen:String(p.noAbsen||""),
      mapel:p.mapel||"", asesmen:p.asesmen||"",
      skorObjektif:Number(p.nilai||0), skorEsai:"",
      nilaiAkhir: adaEsai ? "" : Number(p.nilai||0),
      token:p.token||"", waktu, adaEsai: adaEsai?"TRUE":"FALSE",
      jawabanEsai:p.jawabanEsai||"", detailSkorEsai:"",
      detailJawaban:p.detailJawaban||"",
    };
    await fsPatch(`${col(ns, "hasil")}/${docId}`, payload);
    return { status:"success", message:"Hasil berhasil disimpan" };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function getHasilPerMapel({ mapel }, ns = "") {
  try {
    const docs = await fsQuery(col(ns, "hasil"), [{ field:"mapel", value: mapel }]);
    return { status:"success", data: docs };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function getHasil(ns = "") {
  try {
    const docs = await fsList(col(ns, "hasil"));
    return { status:"success", data: docs };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function hapusHasil({ nisn, mapel, asesmen, waktu }, ns = "") {
  try {
    const docId = hasilDocId(nisn, mapel, asesmen, waktu);
    await fsDelete(`${col(ns, "hasil")}/${docId}`);
    return { status:"success", message:"Data hasil berhasil dihapus." };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function simpanKoreksiEsai({ nisn, mapel, asesmen, waktu, skorEsai, detailSkorEsai }, ns = "") {
  try {
    const docId = hasilDocId(nisn, mapel, asesmen, waktu);
    await fsPatch(`${col(ns, "hasil")}/${docId}`, {
      skorEsai: Number(skorEsai||0),
      detailSkorEsai: detailSkorEsai||"",
    }, ["skorEsai","detailSkorEsai"]);
    return { status:"success", message:"Koreksi berhasil disimpan" };
  } catch(e) { return { status:"error", message:e.message }; }
}

// ================================================================
// STATISTIK — per kelas (ns)
// ================================================================
export async function getStats(ns = "") {
  try {
    const [siswa, hasil] = await Promise.all([
      fsList(col(ns, "siswa")),
      fsList(col(ns, "hasil")),
    ]);
    const statsDoc = await fsGet(cfgNsPath(ns, "stats"));
    const jumlahSoal = statsDoc?.jumlahSoal || 0;
    return { status:"success", data:{ siswa:siswa.length, soal:jumlahSoal, hasil:hasil.length } };
  } catch(e) { return { status:"error", message:e.message }; }
}
export async function updateSoalCounter(delta, ns = "") {
  try {
    const doc = await fsGet(cfgNsPath(ns, "stats"));
    const cur = doc?.jumlahSoal || 0;
    await fsPatch(cfgNsPath(ns, "stats"), { jumlahSoal: Math.max(0, cur + delta) });
  } catch {}
}

// ================================================================
// MANAJEMEN KELAS — disimpan di Firestore collection "admin_kelas"
// Kelas 6 default selalu ada (namespace kosong, password guru123)
// ================================================================

const KELAS_DEFAULT_DOC = {
  id        : "kelas6",
  namaKelas : "Kelas 6",
  tingkat   : "6",
  password  : "guru123",
  namespace : "",
  isDefault : true,
};

export async function getKelasList() {
  try {
    const docs = await fsList("admin_kelas");
    const list = docs.map(d => ({
      id        : d.id,
      namaKelas : d.namaKelas  || "",
      tingkat   : d.tingkat    || "",
      password  : d.password   || "",
      namespace : (d.namespace !== undefined && d.namespace !== null) ? d.namespace : d.id + "_ns",
      isDefault : d.isDefault  === true || d.isDefault === "true" || false,
      createdAt : d.createdAt  || "",
    }));
    // Selalu pastikan kelas 6 ada
    const adaDefault = list.some(k => k.isDefault);
    if (!adaDefault) list.unshift(KELAS_DEFAULT_DOC);
    // Urutkan: default dulu, lalu urut tingkat
    list.sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : (a.tingkat||"9").localeCompare(b.tingkat||"9")));
    return { status: "success", data: list };
  } catch(e) {
    // Fallback: minimal kembalikan kelas 6 default
    return { status: "success", data: [KELAS_DEFAULT_DOC] };
  }
}

export async function tambahKelas({ namaKelas, tingkat, password, namespace }) {
  try {
    const id = "kelas_" + Date.now();
    const ns = namespace || id + "_ns";
    await fsPatch(`admin_kelas/${id}`, {
      id, namaKelas: String(namaKelas).trim(),
      tingkat: String(tingkat || ""),
      password: String(password).trim(),
      namespace: ns,
      isDefault: false,
      createdAt: new Date().toISOString(),
    });
    return { status: "success", id, namespace: ns };
  } catch(e) { return { status: "error", message: e.message }; }
}

export async function editKelas({ id, namaKelas, tingkat, password, isDefault }) {
  try {
    if (isDefault) {
      // Kelas 6: hanya boleh update password
      await fsPatch(`admin_kelas/${id}`, { password: String(password).trim() }, ["password"]);
    } else {
      await fsPatch(`admin_kelas/${id}`, {
        namaKelas : String(namaKelas).trim(),
        tingkat   : String(tingkat || ""),
        password  : String(password).trim(),
      }, ["namaKelas", "tingkat", "password"]);
    }
    return { status: "success" };
  } catch(e) { return { status: "error", message: e.message }; }
}

export async function hapusKelas({ id }) {
  try {
    await fsDelete(`admin_kelas/${id}`);
    return { status: "success" };
  } catch(e) { return { status: "error", message: e.message }; }
}

// Pastikan kelas 6 default tersimpan di Firestore (dipanggil sekali saat AdminPanel mount)
export async function ensureKelas6() {
  try {
    const existing = await fsGet("admin_kelas/kelas6");
    if (!existing) {
      await fsPatch("admin_kelas/kelas6", {
        id: "kelas6", namaKelas: "Kelas 6", tingkat: "6",
        password: "guru123", namespace: "", isDefault: true,
        createdAt: new Date().toISOString(),
      });
    }
    return { status: "success" };
  } catch(e) { return { status: "error", message: e.message }; }
}
