import { useState, useEffect, useRef, useCallback } from "react";
import * as FS from "./firestore.js";

// Backend: Firestore (lihat src/firestore.js)
const DEFAULT_MAPEL = [
  "Bahasa Indonesia","Pendidikan Pancasila","IPAS","Matematika",
  "Seni Rupa","Bahasa Madura","Pendidikan Agama Islam","PJOK"
];
const DEFAULT_ASESMEN = [
  "Sumatif 1","Sumatif 2","Sumatif 3","Sumatif 4",
  "Sumatif 5","Sumatif 6","Sumatif 7","Sumatif 8",
  "Asesmen Akhir Semester"
];
const JENIS_SOAL_LENGKAP = ["Pilihan Ganda","Pilihan Ganda Kompleks","Benar/Salah Kompleks","Uraian/Esai"];
const GURU_PASSWORD = "guru123";
const ADMIN_PASSWORD = "admin123";
const DEMO_TOKEN = "UJIAN2024";

const TINGKAT_KELAS = ["1","2","3","4","5","6"];

// Kelas 6 default — namespace "" agar collection path Firestore tidak berubah
const KELAS_DEFAULT = { id:"kelas6", namaKelas:"Kelas 6", tingkat:"6", password:GURU_PASSWORD, namespace:"", isDefault:true };

// loadKelasList: baca dari localStorage sebagai cache cepat
function loadKelasListCache() {
  try {
    const d = JSON.parse(localStorage.getItem("adminKelasList") || "null");
    if (Array.isArray(d) && d.length > 0) return d;
  } catch {}
  return [KELAS_DEFAULT];
}
function saveKelasListCache(list) {
  try { localStorage.setItem("adminKelasList", JSON.stringify(list)); } catch {}
}

// cariKelasByPassword: cek cache localStorage dulu (cepat)
// Firestore akan di-sync di AdminPanel & saat App mount
function cariKelasByPassword(pwd) {
  if (!pwd) return null;
  return loadKelasListCache().find(k => k.password === pwd) || null;
}

// ============================================================
// KATEX — Render formula matematika
// ============================================================
let katexLoaded = false;
async function loadKatex() {
  if (katexLoaded || window.katex) return;
  if (!document.getElementById("katex-css")) {
    const link = document.createElement("link");
    link.id = "katex-css";
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
    document.head.appendChild(link);
  }
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  katexLoaded = true;
}

// Render teks dengan formula KaTeX
function MathText({ text, className = "" }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(!!window.katex);
  useEffect(() => {
    if (!window.katex) loadKatex().then(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready || !ref.current || !text) return;
    const el = ref.current;
    try {
      const segments = [];
      let remaining = String(text);
      const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
      let lastIndex = 0, match;
      while ((match = pattern.exec(remaining)) !== null) {
        if (match.index > lastIndex) segments.push({ type: "text", content: remaining.slice(lastIndex, match.index) });
        const raw = match[0];
        const isBlock = raw.startsWith("$$");
        const formula = isBlock ? raw.slice(2, -2).trim() : raw.slice(1, -1).trim();
        segments.push({ type: isBlock ? "block" : "inline", content: formula });
        lastIndex = match.index + raw.length;
      }
      if (lastIndex < remaining.length) segments.push({ type: "text", content: remaining.slice(lastIndex) });
      let html = "";
      segments.forEach(seg => {
        if (seg.type === "text") html += seg.content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        else try {
          html += window.katex.renderToString(seg.content, { displayMode: seg.type === "block", throwOnError: false });
        } catch { html += `<span style="color:#dc2626">[formula error]</span>`; }
      });
      el.innerHTML = html;
    } catch { el.textContent = text; }
  }, [text, ready]);
  if (!text) return null;
  if (!ready || !String(text).includes("$")) return <span className={className}>{text}</span>;
  return <span ref={ref} className={className} />;
}

// HtmlMathText: render HTML dari rich text editor + proses KaTeX di dalamnya
// Dipakai di TabViewSoal agar soal tampil persis seperti di halaman siswa
function HtmlMathText({ html, className = "" }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(!!window.katex);
  useEffect(() => {
    if (!window.katex) loadKatex().then(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ref.current || !html) return;
    const el = ref.current;
    // Set HTML dulu (render bold, list, br, dsb dari rich text editor)
    el.innerHTML = html || "";
    if (!ready || !window.katex) return;
    // Proses KaTeX: cari semua text node, replace $...$ dan $$...$$
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text.includes("$")) return;
        const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
        let match, lastIdx = 0, frag = document.createDocumentFragment();
        let found = false;
        while ((match = pattern.exec(text)) !== null) {
          found = true;
          if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
          const raw = match[0];
          const isBlock = raw.startsWith("$$");
          const formula = isBlock ? raw.slice(2,-2).trim() : raw.slice(1,-1).trim();
          const span = document.createElement("span");
          try { span.innerHTML = window.katex.renderToString(formula, { displayMode: isBlock, throwOnError: false }); }
          catch { span.textContent = raw; }
          frag.appendChild(span);
          lastIdx = match.index + raw.length;
        }
        if (found) {
          if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
          node.parentNode.replaceChild(frag, node);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        Array.from(node.childNodes).forEach(processNode);
      }
    };
    Array.from(el.childNodes).forEach(processNode);
  }, [html, ready]);
  return <div ref={ref} className={"prose prose-sm max-w-none " + className} />;
}

const isMapelMath = (mapel) => mapel === "Matematika";

const MATH_TOOLBAR = [
  { label:"½", insert:"\\frac{}{}", title:"Pecahan" },
  { label:"√", insert:"\\sqrt{}", title:"Akar" },
  { label:"x²", insert:"^{2}", title:"Pangkat 2" },
  { label:"xⁿ", insert:"^{}", title:"Pangkat n" },
  { label:"×", insert:"\\times ", title:"Kali" },
  { label:"÷", insert:"\\div ", title:"Bagi" },
  { label:"±", insert:"\\pm ", title:"Plus minus" },
  { label:"≤", insert:"\\leq ", title:"Kurang sama dengan" },
  { label:"≥", insert:"\\geq ", title:"Lebih sama dengan" },
  { label:"≠", insert:"\\neq ", title:"Tidak sama" },
  { label:"π", insert:"\\pi ", title:"Pi" },
  { label:"°", insert:"^{\\circ}", title:"Derajat" },
  { label:"∑", insert:"\\sum_{i=1}^{n}", title:"Sigma" },
  { label:"|x|", insert:"\\left|{}\\right|", title:"Nilai mutlak" },
  { label:"( )", insert:"\\left({}\\right)", title:"Kurung" },
];

function MathInput({ value, onChange, onPaste, rows = 3, placeholder = "Tulis teks atau formula $...$ di sini...", showToolbar = false, id }) {
  const textareaRef = useRef(null);
  const inputRef = useRef(null);
  const isMultiline = rows > 1;

  const insertAtCursor = (toInsert) => {
    const el = isMultiline ? textareaRef.current : inputRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const dollarsBefore = (before.match(/\$/g) || []).length;
    let newText;
    if (dollarsBefore % 2 === 1) {
      newText = before + toInsert + after;
    } else {
      newText = before + "$" + toInsert + "$" + after;
    }
    onChange({ target: { value: newText } });
    setTimeout(() => {
      el.focus();
      const pos = before.length + (dollarsBefore % 2 === 1 ? toInsert.length : toInsert.length + 2);
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  return (
    <div>
      {showToolbar && (
        <div className="bg-blue-50 border border-blue-200 rounded-t-xl px-2 py-1.5 flex flex-wrap gap-1 border-b-0">
          <span className="text-xs text-blue-500 font-semibold self-center mr-1">∑ Math:</span>
          {MATH_TOOLBAR.map(btn => (
            <button
              key={btn.label}
              type="button"
              title={btn.title}
              onClick={() => insertAtCursor(btn.insert)}
              className="text-xs bg-white hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold px-2 py-1 rounded-lg transition-colors"
            >
              {btn.label}
            </button>
          ))}
          <span className="text-xs text-blue-400 self-center ml-auto italic">Format: $rumus$</span>
        </div>
      )}
      {isMultiline ? (
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={onChange}
          onPaste={onPaste}
          rows={rows}
          placeholder={placeholder}
          className={`w-full border-2 border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none font-mono ${showToolbar ? "rounded-none" : "rounded-xl"}`}
        />
      ) : (
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={onChange}
          onPaste={onPaste}
          placeholder={placeholder}
          className={`w-full border-2 border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono ${showToolbar ? "rounded-none" : "rounded-xl"}`}
        />
      )}
      {showToolbar && value && value.includes("$") && (
        <div className="mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 leading-relaxed">
          <span className="text-xs text-slate-400 mr-2">Preview:</span>
          <MathText text={value} />
        </div>
      )}
    </div>
  );
}

const defaultOpsi = (jenis) => {
  if (jenis === "Benar/Salah Kompleks") return ["", "", ""];
  return ["", "", "", ""];
};

const DEMO_SOAL = {
  "Matematika_Sumatif 1": [
    { id:"1", soal:"Berapakah hasil dari 12 × 15?", gambar:"", jenisSoal:"Pilihan Ganda", opsi:JSON.stringify(["150","170","180","160"]), jawabanBenar:JSON.stringify(["180"]), point:10 },
    { id:"2", soal:"Manakah bilangan yang merupakan kelipatan 4? (pilih SEMUA yang benar)", gambar:"", jenisSoal:"Pilihan Ganda Kompleks", opsi:JSON.stringify(["12","15","20","22"]), jawabanBenar:JSON.stringify(["12","20"]), point:20 },
    { id:"3", soal:"Tentukan pernyataan berikut, Benar atau Salah?", gambar:"", jenisSoal:"Benar/Salah Kompleks", opsi:JSON.stringify(["5 × 5 = 25","3 × 8 = 21","7 + 9 = 16"]), jawabanBenar:JSON.stringify(["Benar","Salah","Benar"]), point:20 },
  ],
  "IPAS_Sumatif 1": [
    { id:"1", soal:"Apa yang dimaksud dengan fotosintesis?", gambar:"", jenisSoal:"Pilihan Ganda", opsi:JSON.stringify(["Proses pembuatan makanan pada tumbuhan dengan bantuan sinar matahari","Proses pernapasan pada hewan","Proses penyerapan air oleh akar","Proses penyerbukan pada bunga"]), jawabanBenar:JSON.stringify(["Proses pembuatan makanan pada tumbuhan dengan bantuan sinar matahari"]), point:10 },
  ],
};

function extractDriveFileId(url) {
  if (!url || typeof url !== "string") return null;
  url = url.trim();
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m2) return m2[1];
  const m3 = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  return m3 ? m3[1] : null;
}
function isDriveUrl(url) { return url && (url.includes("drive.google.com") || url.includes("docs.google.com")); }

function GambarSoal({ url, alt = "Gambar soal" }) {
  if (!url || !url.trim()) return null;
  if (isDriveUrl(url)) {
    const fileId = extractDriveFileId(url);
    if (!fileId) return <p className="text-xs text-red-500 text-center py-2">⚠️ Format link Google Drive tidak dikenali.</p>;
    return (
      <div className="relative w-full overflow-hidden" style={{ height:"220px" }}>
        <iframe src={`https://drive.google.com/file/d/${fileId}/preview`} title={alt} allow="autoplay"
          className="absolute inset-0 w-full h-full border-0" style={{ pointerEvents:"none" }} />
      </div>
    );
  }
  return <img src={url} alt={alt} className="w-full max-h-60 object-contain" onError={e => { e.target.style.display = "none"; e.target.parentNode.appendChild(<p className="text-xs text-red-500 text-center py-2">⚠️ Gambar tidak dapat dimuat.</p>); }} />;
}

function LogoSekolah({ url, className = "" }) {
  const [errCount, setErrCount] = useState(0);
  useEffect(() => setErrCount(0), [url]);
  if (!url || !url.trim() || errCount >= 3) return <span className="text-4xl select-none">🏫</span>;
  let src = url.trim();
  if (isDriveUrl(url)) {
    const fileId = extractDriveFileId(url);
    if (!fileId) return <span className="text-4xl select-none">🏫</span>;
    if (errCount === 0) src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w200-h200`;
    else if (errCount === 1) src = `https://drive.google.com/uc?export=view&id=${fileId}`;
    else src = `https://lh3.googleusercontent.com/d/${fileId}=w200-h200`;
  }
  return <img src={src} alt="Logo sekolah" className={className} referrerPolicy="no-referrer" onError={() => setErrCount(c => c + 1)} />;
}

// Helper kriteria nilai — interval bisa dikustom via KKTP
// interval: { pb: batas_atas_perlu_bimbingan, bk: batas_atas_berkembang, ck: batas_atas_cakap }
// Default: Perlu Bimbingan 0-40, Berkembang 41-65, Cakap 66-85, Mahir 86-100
const DEFAULT_KKTP = { pb: 40, bk: 65, ck: 85 };
let _kktpGlobal = { ...DEFAULT_KKTP };
function setKKTPGlobal(interval) { _kktpGlobal = { ...interval }; }

function getKriteria(nilai, interval) {
  const iv = interval || _kktpGlobal;
  if (nilai > iv.ck) return "Mahir";
  if (nilai > iv.bk) return "Cakap";
  if (nilai > iv.pb) return "Berkembang";
  return "Perlu Bimbingan";
}

function getKriteriaStyle(nilai, interval) {
  const k = getKriteria(nilai, interval);
  if (k === "Mahir") return { background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" };
  if (k === "Cakap") return { background: "#eff6ff", color: "#003082", border: "1px solid #93c5fd" };
  if (k === "Berkembang") return { background: "#fff7ed", color: "#b45309", border: "1px solid #f59e0b" };
  return { background: "#fef2f2", color: "#CC0000", border: "1px solid #fca5a5" };
}

async function unduhPDF({ siswa, hasilAkhir, soalList, jawabanSiswa, namaGuru, nipGuru, kotaTTD, namaSekolah }) {
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const tgl = new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" });
  const W = 210, margin = 18, colW = W - margin * 2;
  let y = margin;
  const checkY = (need = 10) => { if (y + need > 280) { doc.addPage(); y = margin; } };
  const wrappedText = (text, x, yy, maxW, lineH = 5) => {
    const lines = doc.splitTextToSize(String(text), maxW);
    lines.forEach((l, i) => doc.text(l, x, yy + i * lineH));
    return lines.length * lineH;
  };
  doc.setFillColor(30, 58, 138); doc.rect(0, 0, W, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("LAPORAN HASIL ASESMEN", W / 2, 11, { align: "center" });
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text(namaSekolah || "Portal Ujian Digital", W / 2, 18, { align: "center" });
  doc.setFontSize(8);
  doc.text("Aplikasi Web Asesmen — Copyright © 2026 Hairur Rahman", W / 2, 24, { align: "center" });
  y = 36;
  doc.setTextColor(30, 30, 30);
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y - 5, colW, 7, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("DATA SISWA", margin + 2, y);
  y += 6;
  const dataRows = [["Nama", siswa.nama], ["NISN", siswa.nisn], ["No. Absen", siswa.noAbsen], ["Mata Pelajaran", siswa.mapel], ["Jenis Asesmen", siswa.asesmen], ["Tanggal", tgl]];
  doc.setFontSize(9.5);
  dataRows.forEach(([k, v]) => {
    checkY(7);
    doc.setFont("helvetica", "bold"); doc.text(k, margin + 2, y);
    doc.setFont("helvetica", "normal"); doc.text(`: ${v}`, margin + 38, y);
    y += 6;
  });
  y += 4;
  checkY(32);
  const predikat = getKriteria(hasilAkhir.nilai);
  const nilaiRGB = hasilAkhir.nilai >= 75 ? [22,163,74] : hasilAkhir.nilai >= 50 ? [217,119,6] : [220,38,38];
  doc.setDrawColor(...nilaiRGB); doc.setLineWidth(0.8);
  doc.roundedRect(margin, y, colW, 28, 3, 3, "D");
  doc.setTextColor(...nilaiRGB);
  doc.setFont("helvetica", "bold"); doc.setFontSize(30);
  doc.text(String(hasilAkhir.nilai), W / 2, y + 14, { align: "center" });
  doc.setFontSize(10); doc.text(predikat, W / 2, y + 21, { align: "center" });
  doc.setTextColor(100,100,100); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(`Point: ${hasilAkhir.didapatPoint} / ${hasilAkhir.totalPoint}`, W / 2, y + 27, { align: "center" });
  y += 33;
  checkY(14);
  doc.setTextColor(30,30,30);
  doc.setFillColor(241,245,249); doc.rect(margin, y - 5, colW, 7, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("RINCIAN POIN PER SOAL", margin + 2, y);
  y += 4;
  const cols = { no:12, jenis:28, ket:80, dapat:22, maks:22 };
  const colX = { no:margin, jenis:margin+cols.no, ket:margin+cols.no+cols.jenis, dapat:margin+cols.no+cols.jenis+cols.ket, maks:margin+cols.no+cols.jenis+cols.ket+cols.dapat };
  doc.setFillColor(30,58,138); doc.rect(margin, y, colW, 7, "F");
  doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
  ["No","Jenis","Keterangan","Dapat","Maks"].forEach((h, i) => {
    const xArr = [colX.no+2, colX.jenis+1, colX.ket+1, colX.dapat+1, colX.maks+1];
    doc.text(h, xArr[i], y + 5);
  });
  y += 7;
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  hasilAkhir.detail.forEach((d, i) => {
    checkY(7);
    doc.setFillColor(...(i%2===0?[255,255,255]:[248,250,252]));
    doc.rect(margin, y-4.5, colW, 6.5, "F");
    doc.setTextColor(30,30,30);
    doc.text(String(d.no), colX.no+4, y, { align:"center" });
    doc.text(d.jenis, colX.jenis+1, y);
    doc.text(d.ket, colX.ket+1, y);
    if (d.dapat < d.max) doc.setTextColor(180,30,30);
    doc.text(String(d.dapat), colX.dapat+cols.dapat/2, y, { align:"center" });
    doc.setTextColor(30,30,30);
    doc.text(String(d.max), colX.maks+cols.maks/2, y, { align:"center" });
    y += 6.5;
  });
  checkY(8);
  doc.setFillColor(226,232,240); doc.rect(margin, y-4.5, colW, 7, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(30,30,30);
  doc.text("TOTAL", colX.ket+1, y);
  doc.text(String(hasilAkhir.didapatPoint), colX.dapat+cols.dapat/2, y, { align:"center" });
  doc.text(String(hasilAkhir.totalPoint), colX.maks+cols.maks/2, y, { align:"center" });
  y += 10;
  checkY(40);
  doc.setTextColor(30,30,30);
  const ttdX = W - margin - 50;
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  const kotaLabel = kotaTTD ? `${kotaTTD}, ${tgl}` : tgl;
  doc.text(kotaLabel, ttdX, y, { align:"center" });
  y += 5;
  doc.text(`Guru ${siswa.mapel}`, ttdX, y, { align:"center" });
  y += 22;
  doc.setDrawColor(30,30,30); doc.setLineWidth(0.4);
  doc.line(ttdX - 28, y, ttdX + 28, y);
  y += 5;
  doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text(namaGuru || "________________________", ttdX, y, { align:"center" });
  if (nipGuru) { y += 5; doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.text(`NIP. ${nipGuru}`, ttdX, y, { align:"center" }); }
  checkY(8);
  doc.setFont("helvetica","italic"); doc.setFontSize(7.5); doc.setTextColor(150,150,150);
  doc.text("Dokumen ini digenerate otomatis oleh Aplikasi Web Asesmen", W/2, 290, { align:"center" });
  const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9À-ÿ]/g, "_").replace(/_+/g,"_").replace(/^_|_$/g,"");
  const mapelKode = sanitize(siswa.mapel);
  const asesmenKode = sanitize(siswa.asesmen);
  const namaKode = sanitize(siswa.nama);
  doc.save(`${mapelKode}_${asesmenKode}_${namaKode}.pdf`);
}

// PDF gabungan untuk guru (dari rekap hasil) — objektif + uraian
async function unduhPDFGabungan({ h, namaGuru, nipGuru, kotaTTD, namaSekolah }) {
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const tgl = new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" });
  const W = 210, margin = 18, colW = W - margin * 2;
  let y = margin;
  const checkY = (need = 10) => { if (y + need > 280) { doc.addPage(); y = margin; } };
  const wrappedText = (text, x, yy, maxW, lineH = 5) => {
    const lines = doc.splitTextToSize(String(text), maxW);
    lines.forEach((l, i) => doc.text(l, x, yy + i * lineH));
    return lines.length * lineH;
  };

  // Header
  doc.setFillColor(30,58,138); doc.rect(0,0,W,28,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold"); doc.setFontSize(14);
  doc.text("LAPORAN HASIL ASESMEN", W/2, 11, { align:"center" });
  doc.setFontSize(10); doc.setFont("helvetica","normal");
  doc.text(namaSekolah || "Portal Ujian Digital", W/2, 18, { align:"center" });
  doc.setFontSize(8);
  doc.text("Aplikasi Web Asesmen — Copyright © 2026 Hairur Rahman", W/2, 24, { align:"center" });
  y = 36;

  // Data siswa
  doc.setTextColor(30,30,30);
  doc.setFillColor(241,245,249); doc.rect(margin, y-5, colW, 7, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(10);
  doc.text("DATA SISWA", margin+2, y); y += 6;
  const rows = [["Nama",h.nama],["NISN",h.nisn],["Kelas/No.Absen",h.noAbsen||"-"],["Mata Pelajaran",h.mapel],["Jenis Asesmen",h.asesmen],["Waktu Ujian",h.waktu||"-"],["Tanggal Cetak",tgl]];
  doc.setFontSize(9.5);
  rows.forEach(([k,v]) => { checkY(7); doc.setFont("helvetica","bold"); doc.text(k,margin+2,y); doc.setFont("helvetica","normal"); doc.text(`: ${v}`,margin+44,y); y+=6; });
  y+=4;

  // Kotak nilai akhir
  const nilaiAkhir = (() => {
    const obj = Number(h.skorObjektif||0);
    const esai = (h.skorEsai!==undefined && h.skorEsai!=="") ? Number(h.skorEsai) : null;
    const adaEsai = h.adaEsai==="TRUE"||h.adaEsai===true||(h.jawabanEsai&&h.jawabanEsai!==""&&h.jawabanEsai!=="[]");
    if (!adaEsai||esai===null) return obj;
    // Ambil bobot dari nilaiAkhir jika sudah tersimpan, atau hitung dari bobot default 80/20
    if (h.nilaiAkhir!==undefined && h.nilaiAkhir!=="") return Number(h.nilaiAkhir);
    return Math.round(obj*0.8 + esai*0.2);
  })();
  const predikat = nilaiAkhir>=86?"Mahir":nilaiAkhir>=66?"Cakap":nilaiAkhir>=41?"Berkembang":"Perlu Bimbingan";
  const nilaiRGB = nilaiAkhir>=75?[22,163,74]:nilaiAkhir>=50?[217,119,6]:[220,38,38];
  checkY(32);
  doc.setDrawColor(...nilaiRGB); doc.setLineWidth(0.8);
  doc.roundedRect(margin,y,colW,28,3,3,"D");
  doc.setTextColor(...nilaiRGB);
  doc.setFont("helvetica","bold"); doc.setFontSize(30);
  doc.text(String(nilaiAkhir), W/2, y+14, { align:"center" });
  doc.setFontSize(10); doc.text(predikat, W/2, y+21, { align:"center" });
  doc.setTextColor(100,100,100); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  const detailNilai = h.skorEsai!==""&&h.skorEsai!==undefined
    ? `Obj: ${h.skorObjektif}  |  Esai: ${h.skorEsai}  |  Akhir: ${nilaiAkhir}`
    : `Skor Objektif: ${h.skorObjektif}`;
  doc.text(detailNilai, W/2, y+27, { align:"center" });
  y+=33;

  // Tabel rincian objektif — pakai detailJawaban jika ada
  checkY(14);
  doc.setTextColor(30,30,30);
  doc.setFillColor(241,245,249); doc.rect(margin,y-5,colW,7,"F");
  doc.setFont("helvetica","bold"); doc.setFontSize(10);
  doc.text("HASIL OBJEKTIF", margin+2, y); y+=4;

  let detailJawabanObj = {};
  try { detailJawabanObj = JSON.parse(h.detailJawaban||"{}"); } catch {}
  const soalObjektif = Object.values(detailJawabanObj).filter(d => d.jenis !== "Uraian/Esai");

  if (soalObjektif.length > 0) {
    // Render tabel rincian per soal
    const cols = { no:12, jenis:40, ket:70, dapat:22, maks:22 };
    const colX = { no:margin, jenis:margin+cols.no, ket:margin+cols.no+cols.jenis, dapat:margin+cols.no+cols.jenis+cols.ket, maks:margin+cols.no+cols.jenis+cols.ket+cols.dapat };
    doc.setFillColor(30,58,138); doc.rect(margin,y,colW,7,"F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
    ["No","Jenis Soal","Keterangan","Dapat","Maks"].forEach((hd,i) => {
      const xArr = [colX.no+2, colX.jenis+1, colX.ket+1, colX.dapat+1, colX.maks+1];
      doc.text(hd, xArr[i], y+5);
    });
    y+=7;
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
    let totalDapat=0, totalMaks=0;
    soalObjektif.forEach((d, i) => {
      checkY(7);
      const opsiArr = (() => { try { return JSON.parse(d.opsi||"[]"); } catch { return []; } })();
      const benarArr = (() => { try { return JSON.parse(d.jawabanBenar||"[]"); } catch { return []; } })();
      const jwbSiswa = Array.isArray(d.jawaban) ? d.jawaban : (d.jawaban ? [d.jawaban] : []);
      const maks = Number(d.point)||0;
      let dapat = 0;
      if (d.jenis === "Pilihan Ganda") {
        dapat = (benarArr.length>0 && jwbSiswa[0]===benarArr[0]) ? maks : 0;
      } else if (d.jenis === "Pilihan Ganda Kompleks") {
        if (benarArr.length>0) { const benar=jwbSiswa.filter(j=>benarArr.includes(j)).length; const salah=jwbSiswa.filter(j=>!benarArr.includes(j)).length; dapat=salah>0?0:Math.round((benar/benarArr.length)*maks); }
      } else if (d.jenis === "Benar/Salah Kompleks") {
        if (benarArr.length>0) { const benar=jwbSiswa.filter((j,ii)=>j===benarArr[ii]).length; dapat=benar===benarArr.length?maks:benar>0?Math.round((benar/benarArr.length)*maks):0; }
      }
      totalDapat+=dapat; totalMaks+=maks;
      doc.setFillColor(...(i%2===0?[255,255,255]:[248,250,252]));
      doc.rect(margin,y-4.5,colW,6.5,"F");
      doc.setTextColor(30,30,30);
      doc.text(String(i+1), colX.no+4, y, { align:"center" });
      doc.text(d.jenis||"-", colX.jenis+1, y);
      const ket = dapat>=maks ? "Benar" : dapat>0 ? "Sebagian Benar" : "Salah";
      if (dapat<maks) doc.setTextColor(180,30,30); else doc.setTextColor(21,128,61);
      doc.text(ket, colX.ket+1, y);
      doc.setTextColor(30,30,30);
      if (dapat<maks) doc.setTextColor(180,30,30);
      doc.text(String(dapat), colX.dapat+cols.dapat/2, y, { align:"center" });
      doc.setTextColor(30,30,30);
      doc.text(String(maks), colX.maks+cols.maks/2, y, { align:"center" });
      y+=6.5;
    });
    // Total row
    checkY(8);
    doc.setFillColor(226,232,240); doc.rect(margin,y-4.5,colW,7,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(30,30,30);
    doc.text("TOTAL POIN", colX.ket+1, y);
    doc.text(String(totalDapat), colX.dapat+cols.dapat/2, y, { align:"center" });
    doc.text(String(totalMaks), colX.maks+cols.maks/2, y, { align:"center" });
    y+=8;
    // Skor objektif (sudah dikonversi ke 100)
    checkY(8);
    doc.setFillColor(30,58,138); doc.rect(margin,y-4,colW,7,"F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text("SKOR OBJEKTIF (skala 100):", margin+3, y);
    doc.text(String(h.skorObjektif??"-"), W-margin-3, y, { align:"right" });
    y+=10;
  } else {
    // Fallback: hanya tampilkan skor total
    doc.setFillColor(30,58,138); doc.rect(margin,y,colW,7,"F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
    doc.text("Skor Objektif", margin+4, y+5);
    doc.text(String(h.skorObjektif??"-"), W/2, y+5, { align:"center" });
    y+=12;
  }

  // Tabel uraian (jika ada)
  const adaEsai2 = h.adaEsai==="TRUE"||h.adaEsai===true||(h.jawabanEsai&&h.jawabanEsai!==""&&h.jawabanEsai!=="[]");
  if (adaEsai2) {
    checkY(14);
    doc.setTextColor(30,30,30);
    doc.setFillColor(241,245,249); doc.rect(margin,y-5,colW,7,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(10);
    doc.text("HASIL URAIAN/ESAI", margin+2, y); y+=4;

    let jawabanEsaiList = [];
    try { jawabanEsaiList = JSON.parse(h.jawabanEsai||"[]"); } catch {}
    let detailSkor = {};
    try { detailSkor = JSON.parse(h.detailSkorEsai||"{}"); } catch {}

    if (jawabanEsaiList.length > 0) {
      jawabanEsaiList.forEach((je, idx) => {
        checkY(20);
        // Nomor soal
        doc.setFillColor(30,58,138); doc.rect(margin,y-5,colW,7,"F");
        doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
        const skorSoal = detailSkor[idx]!==undefined ? `Skor: ${detailSkor[idx]}/10 (=${Math.round(Number(detailSkor[idx])*10)})` : "Belum dikoreksi";
        doc.text(`Soal Uraian ${idx+1}`, margin+3, y);
        doc.text(skorSoal, W-margin-3, y, { align:"right" });
        y+=8;
        // Soal (strip HTML tags)
        const soalTxt = String(je.soal||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
        doc.setTextColor(30,30,30); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
        doc.text("Pertanyaan:", margin+2, y); y+=5;
        doc.setFont("helvetica","normal");
        const soalLines = doc.splitTextToSize(soalTxt||"-", colW-4);
        soalLines.forEach(l => { checkY(5); doc.text(l,margin+3,y); y+=5; });
        // Kunci jawaban
        if (je.referensi) {
          checkY(8);
          const refTxt = String(je.referensi).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
          doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(21,128,61);
          doc.text("Kunci:", margin+2, y); y+=5;
          doc.setFont("helvetica","italic");
          const refLines = doc.splitTextToSize(refTxt, colW-4);
          refLines.forEach(l => { checkY(5); doc.text(l,margin+3,y); y+=5; });
        }
        // Jawaban siswa
        checkY(8);
        doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(146,64,14);
        doc.text("Jawaban Siswa:", margin+2, y); y+=5;
        doc.setFont("helvetica","normal"); doc.setTextColor(40,40,40);
        const jwbLines = doc.splitTextToSize(je.jawaban||"(tidak dijawab)", colW-4);
        jwbLines.forEach(l => { checkY(5); doc.text(l,margin+3,y); y+=5; });
        // Garis pemisah
        y+=3; checkY(5);
        doc.setDrawColor(200,200,200); doc.setLineWidth(0.2);
        doc.line(margin,y,W-margin,y); y+=6;
      });
      // Total skor esai
      checkY(10);
      doc.setFillColor(226,232,240); doc.rect(margin,y-4,colW,7,"F");
      doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(30,30,30);
      doc.text("SKOR ESAI (skala 100):", margin+3, y);
      doc.text(h.skorEsai!==undefined&&h.skorEsai!==""?String(h.skorEsai):"Belum dikoreksi", W-margin-3, y, { align:"right" });
      y+=10;
    } else {
      doc.setFont("helvetica","italic"); doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text("Tidak ada jawaban uraian.", margin+3, y); y+=10;
    }
  }

  // TTD
  checkY(40);
  doc.setTextColor(30,30,30);
  const ttdX = W-margin-50;
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  const kotaLabel = kotaTTD ? `${kotaTTD}, ${tgl}` : tgl;
  doc.text(kotaLabel, ttdX, y, { align:"center" }); y+=5;
  doc.text(`Guru ${h.mapel}`, ttdX, y, { align:"center" }); y+=22;
  doc.setDrawColor(30,30,30); doc.setLineWidth(0.4);
  doc.line(ttdX-28, y, ttdX+28, y); y+=5;
  doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text(namaGuru||"________________________", ttdX, y, { align:"center" });
  if (nipGuru) { y+=5; doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.text(`NIP. ${nipGuru}`, ttdX, y, { align:"center" }); }
  doc.setFont("helvetica","italic"); doc.setFontSize(7.5); doc.setTextColor(150,150,150);
  doc.text("Dokumen ini digenerate otomatis oleh Aplikasi Web Asesmen", W/2, 290, { align:"center" });

  // Nama file
  const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9À-ÿ]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"");
  doc.save(`${sanitize(h.mapel)}_${sanitize(h.asesmen)}_${sanitize(h.nama)}.pdf`);
}

const toastColors = { success:"#15803d", error:"#CC0000", warning:"#b45309", info:"#003082" };
function Toast({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs w-full">
      {toasts.map(t => (
        <div key={t.id} className="shadow-lg px-4 py-3 text-white text-sm font-bold flex items-start gap-3"
          style={{ backgroundColor: toastColors[t.type] || toastColors.info, borderRadius: "0", borderLeft: "4px solid rgba(255,255,255,0.4)" }}>
          <span className="text-lg leading-none mt-0.5">{t.type==="success"?"✓":t.type==="error"?"✕":t.type==="warning"?"⚠":"ℹ"}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
function useToast() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  return { toasts, addToast };
}

function AppHeader({ logoUrl, namaSekolah }) {
  return (
    <header style={{ background: "linear-gradient(135deg, #CC0000 0%, #990000 100%)", borderBottom: "4px solid #003082" }}>
      <div style={{ background: "#003082", height: "5px" }} />
      <div className="max-w-4xl mx-auto px-5 py-3 flex items-center justify-center">
        <div className="flex items-center gap-3">
          {logoUrl && (
            <img src={logoUrl} alt="Logo"
              style={{ height: "44px", width: "44px", objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
              onError={e => { e.target.style.display = "none"; }} />
          )}
          <div>
            <h1 className="text-base font-black text-white uppercase leading-tight" style={{ fontFamily: "'Georgia', serif", letterSpacing: "0.07em" }}>
              {namaSekolah || "CBT UJIAN DIGITAL"}
            </h1>
            {namaSekolah && (
              <p className="font-bold uppercase" style={{ color: "rgba(255,255,255,0.60)", marginTop: "1px", letterSpacing: "0.16em", fontSize: "0.6rem" }}>CBT UJIAN DIGITAL</p>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function GuruLogin({ onLogin }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const handle = () => {
    const kelas = cariKelasByPassword(pwd.trim());
    if (kelas) { onLogin(kelas); setErr(""); }
    else setErr("Password salah! Hubungi admin jika lupa password.");
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(160deg, #003082 0%, #001a4d 60%, #8B0000 100%)" }}>
      <div className="bg-white rounded-none shadow-2xl w-full max-w-sm text-center overflow-hidden" style={{ border: "3px solid #CC0000" }}>
        <div style={{ background: "linear-gradient(135deg, #CC0000, #990000)", padding: "24px 24px 20px" }}>
          <div className="text-4xl mb-2">🔐</div>
          <h2 className="text-xl font-black text-white tracking-wide" style={{ fontFamily: "'Georgia', serif" }}>PANEL GURU</h2>
          <p className="text-red-200 text-xs mt-1 uppercase tracking-widest">Portal Ujian Digital</p>
        </div>
        <div className="p-6">
          <p className="text-slate-600 text-sm mb-5 font-medium">Masukkan password untuk mengakses panel guru</p>
          <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key==="Enter" && handle()} placeholder="Password guru..." className="w-full border-2 border-slate-200 rounded-none px-4 py-3 text-slate-800 focus:outline-none mb-3" style={{ borderColor: "#003082", borderRadius: "0" }} />
          {err && <p className="text-red-600 text-sm mb-3 font-semibold">{err}</p>}
          <button onClick={handle} className="w-full text-white font-bold py-3 transition-colors uppercase tracking-widest text-sm" style={{ background: "#CC0000", borderRadius: "0" }}>Masuk</button>
        </div>
        <div style={{ background: "#003082", height: "6px" }} />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color="blue" }) {
  const styles = {
    blue: { background: "#eff6ff", color: "#003082", border: "1px solid #93c5fd" },
    green: { background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" },
    purple: { background: "#fef2f2", color: "#CC0000", border: "1px solid #fca5a5" },
  };
  return (
    <div className="p-4" style={{ ...styles[color], borderRadius: "0", borderLeft: `4px solid ${color === "blue" ? "#003082" : color === "green" ? "#16a34a" : "#CC0000"}` }}>
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-2xl font-black">{value}</div>
      <div className="text-xs font-bold mt-1 opacity-75 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
const inp = "w-full border-2 border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-500" + " " + "rounded-none";
const btn = (color="blue") => ({
  blue:"text-white font-bold py-2.5 px-4 text-sm transition-colors rounded-none" + " " + "bg-blue-700 hover:bg-blue-800",
  green:"text-white font-bold py-2.5 px-4 text-sm transition-colors rounded-none" + " " + "bg-green-600 hover:bg-green-700",
  red:"text-white font-bold py-2.5 px-4 text-sm transition-colors rounded-none" + " " + "bg-red-700 hover:bg-red-800",
  amber:"text-white font-bold py-2.5 px-4 text-sm transition-colors rounded-none" + " " + "bg-amber-500 hover:bg-amber-600",
  slate:"text-slate-700 font-bold py-2.5 px-4 text-sm transition-colors rounded-none" + " " + "bg-slate-200 hover:bg-slate-300",
}[color]);

// ============================================================
// API helpers
// ============================================================
async function fetchMapelList(ns="") {
  const d = await FS.getAllMapel(ns);
  return d.status === "success" ? d.data : [...DEFAULT_MAPEL];
}
async function fetchAsesmenList(ns="") {
  const d = await FS.getAllAsesmen(ns);
  return d.status === "success" ? d.data : [...DEFAULT_ASESMEN];
}
async function fetchKKTP(ns="") {
  try {
    const d = await FS.getKKM(ns);
    if (d.status === "success" && d.data && d.data.__kktp__) return d.data.__kktp__;
  } catch {}
  return { pb: 40, bk: 65, ck: 85 };
}
async function simpanKKTP(interval, ns="") {
  const d = await FS.simpanKKM({ kkm: { __kktp__: interval } }, ns);
  return d.status === "success";
}

// ============================================================
// DASHBOARD (dengan profil guru)
// ============================================================
function TabDashboard({ onNav, addToast, settings, ns="" }) {
  const [stats, setStats] = useState({ siswa:0, soal:0, hasil:0 });
  const [loadingStats, setLoadingStats] = useState(false);
  const [rekapToken, setRekapToken] = useState([]);  // [{mapel, asesmen, jumlahSoal}]
  const [loadingRekap, setLoadingRekap] = useState(false);

  useEffect(() => {
    setLoadingStats(true);
    FS.getStats(ns)
      .then(d => { if(d.status==="success") setStats(d.data); })
      .catch(()=>{})
      .finally(()=>setLoadingStats(false));

    // Load rekap soal per mapel & asesmen dari daftar token
    setLoadingRekap(true);
    FS.getDaftarToken(ns).then(async d => {
      if (d.status !== "success" || !d.data?.length) return;
      // Hitung jumlah soal per token secara paralel
      const items = await Promise.all(d.data.map(async t => {
        try {
          const s = await FS.getSoalGuru({ mapel: t.mapel, asesmen: t.asesmen }, ns);
          return { mapel: t.mapel, asesmen: t.asesmen, jumlahSoal: s.soal?.length || 0, aktif: t.aktif };
        } catch { return { mapel: t.mapel, asesmen: t.asesmen, jumlahSoal: 0, aktif: t.aktif }; }
      }));
      setRekapToken(items);
    }).catch(()=>{}).finally(()=>setLoadingRekap(false));
  }, [ns]);

  // Kelompokkan per mapel
  const rekapPerMapel = rekapToken.reduce((acc, item) => {
    if (!acc[item.mapel]) acc[item.mapel] = [];
    acc[item.mapel].push(item);
    return acc;
  }, {});

  const aksiCepat = [
    { icon:"✏️", label:"Buat Soal Baru", page:"soal", color:"bg-blue-700 hover:bg-blue-800" },
    { icon:"🔑", label:"Kelola Token", page:"mapel", color:"bg-green-600 hover:bg-green-700" },
    { icon:"📊", label:"Lihat Hasil Ujian", page:"rekap", color:"bg-purple-600 hover:bg-purple-700" },
    { icon:"👤", label:"Data Siswa", page:"siswa", color:"bg-amber-500 hover:bg-amber-600" },
  ];

  const getInitials = () => {
    const namaGuru = settings.namaGuru || "Guru";
    return namaGuru.split(" ").map(n => n[0]).join("").toUpperCase().slice(0,2);
  };

  // Handler error gambar
  const handleImageError = (e) => {
    e.target.onerror = null;
    e.target.src = `https://ui-avatars.com/api/?background=blue&color=fff&name=${getInitials()}`;
  };

  return (
    <div className="space-y-6">
      {/* Profil Guru */}
      <div className="bg-white p-5 flex items-center gap-4" style={{ border: "1px solid #e2e8f0", borderLeft: "5px solid #CC0000", borderRadius: "0" }}>
      <div className="flex-shrink-0">
  {settings.fotoGuru ? (
    <img 
      src={settings.fotoGuru} 
      alt="Foto Guru" 
      className="w-20 h-20 rounded-full object-cover shadow-md" 
      style={{ border: "3px solid #CC0000" }}
      onError={(e) => { e.target.onerror = null; e.target.src = `https://ui-avatars.com/api/?background=CC0000&color=fff&name=${getInitials()}`; }}
    />
  ) : (
    <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md" style={{ background: "linear-gradient(135deg,#CC0000,#003082)" }}>
      {getInitials()}
    </div>
  )}
</div>
        <div className="flex-1">
          <h2 className="text-xl font-extrabold text-slate-800">Selamat Datang, {settings.namaGuru || "Guru"}!</h2>
          <p className="text-sm text-slate-500">{settings.namaSekolah || "Portal Ujian Digital"}</p>
          {settings.nipGuru && <p className="text-xs text-slate-400 mt-1">NIP: {settings.nipGuru}</p>}
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard icon="👤" label="Total Siswa" value={loadingStats ? "..." : stats.siswa} color="blue" />
        <StatCard icon="📝" label="Bank Soal" value={loadingStats ? "..." : stats.soal} color="green" />
        <StatCard icon="📋" label="Hasil Ujian" value={loadingStats ? "..." : stats.hasil} color="purple" />
      </div>

      {/* Aksi cepat */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: "#003082" }}>⚡ Aksi Cepat</h3>
        <div className="grid grid-cols-2 gap-3">
          {aksiCepat.map((a, idx) => (
            <button key={a.page} onClick={() => onNav(a.page)} className="text-white p-4 text-left transition-colors flex items-center gap-3" style={{ background: idx === 0 ? "#CC0000" : idx === 1 ? "#003082" : idx === 2 ? "#7c3aed" : "#d97706", borderRadius: "0", borderBottom: "3px solid rgba(0,0,0,0.2)" }}>
              <span className="text-2xl">{a.icon}</span>
              <span className="font-bold text-sm">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Rekap Soal per Mapel & Asesmen */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: "#003082" }}>📚 Rekap Soal per Mapel</h3>
          {loadingRekap && <span className="text-xs text-slate-400">⏳ Memuat...</span>}
        </div>
        {!loadingRekap && Object.keys(rekapPerMapel).length === 0 ? (
          <div className="p-4 text-xs text-center text-slate-400" style={{ border:"1px dashed #cbd5e1", borderRadius:"0" }}>
            Belum ada soal. Tambahkan token & soal di menu <strong>Manajemen Mapel</strong> dan <strong>Input Soal</strong>.
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(rekapPerMapel).map(([mapel, asesmen_list]) => (
              <div key={mapel} style={{ border:"1px solid #e2e8f0", borderLeft:"4px solid #003082", borderRadius:"0", background:"#fff" }}>
                <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom:"1px solid #f1f5f9", background:"#eff6ff" }}>
                  <p className="font-black text-sm" style={{ color:"#003082" }}>📖 {mapel}</p>
                  <span className="text-xs font-bold px-2 py-0.5" style={{ background:"#003082", color:"#fff", borderRadius:"0" }}>
                    {asesmen_list.reduce((sum,a)=>sum+a.jumlahSoal,0)} soal
                  </span>
                </div>
                <div className="divide-y divide-slate-50">
                  {asesmen_list.map((a, i) => (
                    <div key={i} className="px-4 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{a.asesmen}</span>
                        <span className="text-xs font-bold px-1.5 py-0.5" style={{ background: a.aktif==="TRUE"?"#f0fdf4":"#f1f5f9", color: a.aktif==="TRUE"?"#15803d":"#94a3b8", borderRadius:"0", border:`1px solid ${a.aktif==="TRUE"?"#86efac":"#cbd5e1"}` }}>
                          {a.aktif==="TRUE"?"Aktif":"Nonaktif"}
                        </span>
                      </div>
                      <span className="text-xs font-bold" style={{ color: a.jumlahSoal>0?"#003082":"#94a3b8" }}>
                        {a.jumlahSoal} soal
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 text-xs space-y-1" style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderLeft: "4px solid #003082", borderRadius: "0" }}>
        <p className="font-bold uppercase tracking-wide" style={{ color: "#003082" }}>💡 Cara Kerja Aplikasi</p>
        <p>1. Tambahkan siswa di menu <strong>Data Siswa</strong></p>
        <p>2. Input soal di menu <strong>Input Soal</strong></p>
        <p>3. Buat token ujian di <strong>Manajemen Mapel</strong></p>
        <p>4. Siswa login dengan NISN + Token</p>
        <p>5. Koreksi esai & lihat nilai di <strong>Rekap Hasil</strong></p>
      </div>
    </div>
  );
}

// ============================================================
// DATA SISWA (import/export XLSX)
// ============================================================
function TabSiswa({ scriptUrl, addToast, ns="" }) {
  const [daftarSiswa, setDaftarSiswa] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [nisn, setNisn] = useState("");
  const [nama, setNama] = useState("");
  const [kelas, setKelas] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const fetchSiswa = async () => {
    setLoading(true);
    try { const d = await FS.getSiswa(ns); if (d.status==="success") setDaftarSiswa(d.data || []); } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchSiswa(); }, []);
  const handleTambah = async () => {
    if (!nisn.trim() || !nama.trim() || !kelas.trim()) return addToast("Semua field harus diisi!", "error");
    setSaving(true);
    try {
      const d = await FS.tambahSiswa({ nisn:nisn.trim(), nama:nama.trim(), kelas:kelas.trim() }, ns);
      if (d.status==="success") { addToast("Siswa berhasil ditambahkan!", "success"); setNisn(""); setNama(""); setKelas(""); setShowForm(false); fetchSiswa(); }
      else addToast(d.message || "Gagal", "error");
    } catch { addToast("Tidak terhubung ke server", "warning"); } finally { setSaving(false); }
  };
  const handleHapus = async (nisnTarget) => {
    if (!window.confirm(`Hapus siswa NISN ${nisnTarget}?`)) return;
    try {
      await FS.hapusSiswa({ nisn:nisnTarget }, ns);
      addToast("Siswa dihapus!", "success"); fetchSiswa();
    } catch { addToast("Gagal menghapus siswa", "error"); }
  };
  const handleDownloadTemplate = async () => {
    try {
      if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const wb = window.XLSX.utils.book_new();
      const wsData = [["NISN", "Nama", "Kelas"], ["1234567890", "Contoh Nama Siswa", "5A"], ["0987654321", "Contoh Siswa Dua", "5B"]];
      const ws = window.XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 10 }];
      window.XLSX.utils.book_append_sheet(wb, ws, "Data Siswa");
      window.XLSX.writeFile(wb, "template_import_siswa.xlsx");
      addToast("✅ Template XLSX berhasil diunduh!", "success");
    } catch (err) { addToast("Gagal membuat template: " + err.message, "error"); }
  };
  const handleFileImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    addToast("Membaca file...", "info");
    try {
      if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (rows.length < 2) return addToast("File kosong atau tidak ada data siswa.", "error");
      const header = rows[0].map(h => String(h).toLowerCase().trim());
      const nisnCol = header.findIndex(h => h.includes("nisn"));
      const namaCol = header.findIndex(h => h.includes("nama"));
      const kelasCol = header.findIndex(h => h.includes("kelas"));
      if (nisnCol < 0 || namaCol < 0) return addToast("Kolom NISN atau Nama tidak ditemukan.", "error");
      const siswaList = [];
      for (let i=1; i<rows.length; i++) {
        const row = rows[i];
        const nisnVal = String(row[nisnCol] || "").trim();
        const namaVal = String(row[namaCol] || "").trim();
        const kelasVal = kelasCol >= 0 ? String(row[kelasCol] || "").trim() : "";
        if (nisnVal && namaVal) siswaList.push({ nisn: nisnVal, nama: namaVal, kelas: kelasVal });
      }
      if (siswaList.length === 0) return addToast("Tidak ada data valid dalam file.", "error");
      let sukses = 0, gagal = 0;
      for (const s of siswaList) {
        try { const d = await FS.tambahSiswa(s, ns); if (d.status === "success") sukses++; else gagal++; } catch { gagal++; }
      }
      addToast(`✅ Import selesai: ${sukses} berhasil, ${gagal} gagal (duplikasi NISN dilewati).`, sukses > 0 ? "success" : "error");
      fetchSiswa();
    } catch (err) { addToast("Gagal membaca file: " + err.message, "error"); } finally { setImporting(false); }
  };
  const filtered = daftarSiswa.filter(s => s.nama?.toLowerCase().includes(search.toLowerCase()) || s.nisn?.includes(search) || s.kelas?.includes(search));
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black uppercase tracking-wide" style={{ color: "#003082" }}>Data Siswa</h2>
          <p className="text-sm text-slate-500">{daftarSiswa.length} siswa terdaftar</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleDownloadTemplate} className="font-bold py-2 px-4 text-sm" style={{ background: "#f1f5f9", color: "#475569", borderRadius: "0", border: "1px solid #cbd5e1" }}>📥 Download Template</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="font-bold py-2 px-4 text-sm disabled:opacity-50" style={{ background: "#f0fdf4", color: "#15803d", borderRadius: "0", border: "1px solid #86efac" }}>
            {importing ? <><span className="w-4 h-4 border-2 border-green-400 border-t-green-700 rounded-full animate-spin inline-block" /> Mengimpor...</> : <>📤 Import XLSX/CSV</>}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileImport} />
          <button onClick={() => setShowForm(v => !v)} className={btn(showForm ? "slate" : "blue")}>{showForm ? "✕ Batal" : "➕ Tambah Manual"}</button>
        </div>
      </div>
      <div className="p-3 text-xs space-y-1" style={{ background: "#f0fdf4", border: "1px solid #86efac", borderLeft: "4px solid #16a34a", borderRadius: "0", color: "#15803d" }}>
        <p className="font-bold mb-1">📋 Cara Import Massal:</p>
        <p>1. Klik <strong>Download Template</strong> → buka di Excel/Google Sheets</p>
        <p>2. Isi data siswa (NISN, Nama, Kelas) sesuai kolom</p>
        <p>3. Simpan sebagai <strong>.xlsx</strong> atau <strong>.csv</strong></p>
        <p>4. Klik <strong>Import XLSX/CSV</strong> → pilih file → data otomatis masuk</p>
      </div>
      {showForm && (
        <div className="p-5 space-y-4" style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderLeft: "4px solid #003082", borderRadius: "0" }}>
          <h3 className="font-bold text-sm uppercase tracking-wide" style={{ color: "#003082" }}>Tambah Siswa Manual</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="NISN"><input value={nisn} onChange={e=>setNisn(e.target.value)} placeholder="10 digit NISN" className={inp} maxLength={20} /></Field>
            <Field label="Nama Lengkap"><input value={nama} onChange={e=>setNama(e.target.value)} placeholder="Nama lengkap siswa" className={inp} /></Field>
            <Field label="Kelas"><input value={kelas} onChange={e=>setKelas(e.target.value)} placeholder="Contoh: 5A, 6B" className={inp} /></Field>
          </div>
          <button onClick={handleTambah} disabled={saving} className={btn("green") + " w-full"}>{saving ? "Menyimpan..." : "💾 Simpan Siswa"}</button>
        </div>
      )}
      <div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Cari siswa (nama/NISN/kelas)..." className={inp + " mb-3"} />
        {loading ? <div className="text-center py-8 text-slate-400">Memuat data siswa...</div>
        : filtered.length === 0 ? <div className="text-center py-8 text-slate-400">{daftarSiswa.length === 0 ? "Belum ada siswa. Tambah manual atau import dari Excel." : "Tidak ada siswa yang cocok."}</div>
        : <div className="overflow-x-auto" style={{ border: "1px solid #e2e8f0", borderRadius: "0" }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: "#003082" }} className="text-white"><th className="px-4 py-3 text-left">NISN</th><th className="px-4 py-3 text-left">Nama</th><th className="px-4 py-3 text-left">Kelas</th><th className="px-4 py-3 text-center">Aksi</th></tr></thead>
              <tbody>{filtered.map((s, i) => (
                <tr key={s.nisn} style={{ background: i%2===0 ? "#fff" : "#f8fafc" }}>
                  <td className="px-4 py-3 font-mono text-xs">{s.nisn}</td><td className="px-4 py-3 font-medium">{s.nama}</td><td className="px-4 py-3">{s.kelas}</td>
                  <td className="px-4 py-3 text-center"><button onClick={() => handleHapus(s.nisn)} className="text-xs font-bold px-2 py-1" style={{ color: "#CC0000", borderRadius: "0" }}>Hapus</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        }
      </div>
    </div>
  );
}

// ============================================================
// MANAJEMEN MAPEL & ASESMEN (dengan toggle switch token, edit token)
// ============================================================
function TabMapel({ scriptUrl, addToast, mapelList, setMapelList, asesmenList, setAsesmenList, ns="" }) {
  // State Copy Soal
  const [showCopySoal, setShowCopySoal] = useState(false);
  const [copySumber, setCopySumber] = useState({ mapel: "", asesmen: "" });
  const [copyTujuan, setCopyTujuan] = useState({ mapel: "", asesmen: "" });
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyProgress, setCopyProgress] = useState({ total: 0, done: 0 });

  const handleCopySoal = async () => {
    if (!copySumber.mapel || !copySumber.asesmen) return addToast("Pilih mapel & asesmen sumber!", "error");
    if (!copyTujuan.mapel || !copyTujuan.asesmen) return addToast("Pilih mapel & asesmen tujuan!", "error");
    if (copySumber.mapel === copyTujuan.mapel && copySumber.asesmen === copyTujuan.asesmen)
      return addToast("Sumber dan tujuan tidak boleh sama!", "error");

    setCopyLoading(true);
    setCopyProgress({ total: 0, done: 0 });
    try {
      // Ambil semua soal dari sumber
      const res = await FS.getSoalGuru({ mapel: copySumber.mapel, asesmen: copySumber.asesmen }, ns);
      if (res.status !== "success" || !res.soal?.length) {
        addToast("Tidak ada soal di sumber yang dipilih!", "error");
        setCopyLoading(false); return;
      }
      const soalList = res.soal;
      setCopyProgress({ total: soalList.length, done: 0 });

      // Copy satu per satu ke tujuan
      let sukses = 0, gagal = 0;
      for (const s of soalList) {
        try {
          const d = await FS.tambahSoal({
            mapel: copyTujuan.mapel,
            asesmen: copyTujuan.asesmen,
            soal: s.soal || "",
            gambar: s.gambar || "",
            jenisSoal: s.jenisSoal || "Pilihan Ganda",
            opsi: s.opsi || "[]",
            jawabanBenar: s.jawabanBenar || "[]",
            point: Number(s.point) || 0,
            jawabanReferensi: s.jawabanReferensi || "",
          }, ns);
          if (d.status === "success") { sukses++; FS.updateSoalCounter(1, ns); }
          else gagal++;
        } catch { gagal++; }
        setCopyProgress(p => ({ ...p, done: p.done + 1 }));
      }
      addToast(`✅ Copy selesai: ${sukses} soal berhasil, ${gagal} gagal.`, sukses > 0 ? "success" : "error");
      if (sukses > 0) setShowCopySoal(false);
    } catch (e) {
      addToast("Gagal: " + e.message, "error");
    } finally {
      setCopyLoading(false);
    }
  };
  const [newMapel, setNewMapel] = useState("");
  const [newAsesmen, setNewAsesmen] = useState("");
  const [tokenMapel, setTokenMapel] = useState(mapelList[0] || "");
  const [tokenAsesmen, setTokenAsesmen] = useState(asesmenList[0] || "");
  const [tokenValue, setTokenValue] = useState("");
  const [daftarToken, setDaftarToken] = useState([]);
  const [loadToken, setLoadToken] = useState(false);
  // KKTP global
  const [kktp, setKktp] = useState({ pb: 40, bk: 65, ck: 85 });
  const [kktpLoading, setKktpLoading] = useState(false);
  const [kktpSaving, setKktpSaving] = useState(false);
  // Modal edit token
  const [editModal, setEditModal] = useState(null);
  const [editTokenValue, setEditTokenValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadKKTP = async () => {
    setKktpLoading(true);
    const data = await fetchKKTP(ns);
    setKktp(data);
    setKKTPGlobal(data);
    setKktpLoading(false);
  };
  useEffect(() => { loadKKTP(); }, []);

  const handleKKTPChange = (key, value) => {
    const v = value === "" ? "" : Number(value);
    setKktp(prev => ({ ...prev, [key]: v }));
  };

  const handleSaveKKTP = async () => {
    // Validasi urutan
    if (kktp.pb >= kktp.bk || kktp.bk >= kktp.ck) {
      return addToast("Interval harus berurutan: Perlu Bimbingan < Berkembang < Cakap < Mahir", "error");
    }
    setKktpSaving(true);
    const success = await simpanKKTP(kktp, ns);
    if (success) { setKKTPGlobal(kktp); addToast("KKTP berhasil disimpan!", "success"); }
    else addToast("Gagal menyimpan KKTP", "error");
    setKktpSaving(false);
  };

  const handleTambahMapel = async () => {
    const m = newMapel.trim();
    if (!m) return addToast("Nama mapel tidak boleh kosong!", "error");
    if (mapelList.includes(m)) return addToast("Mapel sudah ada!", "warning");
    try {
      const d = await FS.tambahMapelKustom({ nama:m }, ns);
      if (d.status === "success") {
        addToast(`Mapel "${m}" ditambahkan!`, "success");
        setNewMapel("");
        const newMapels = await fetchMapelList(ns);
        setMapelList(newMapels);
        loadKKTP();
      } else addToast(d.message, "error");
    } catch { addToast("Gagal terhubung ke server", "error"); }
  };
  const handleHapusMapel = async (m) => {
    if (DEFAULT_MAPEL.includes(m)) return addToast("Mapel bawaan tidak bisa dihapus.", "warning");
    if (!window.confirm(`Hapus mapel "${m}"?`)) return;
    try {
      const d = await FS.hapusMapelKustom({ nama:m }, ns);
      if (d.status === "success") {
        addToast(`Mapel "${m}" dihapus.`, "success");
        const newMapels = await fetchMapelList(ns);
        setMapelList(newMapels);
        loadKKTP();
      } else addToast(d.message, "error");
    } catch { addToast("Gagal terhubung ke server", "error"); }
  };
  const handleTambahAsesmen = async () => {
    const a = newAsesmen.trim();
    if (!a) return addToast("Nama asesmen tidak boleh kosong!", "error");
    if (asesmenList.includes(a)) return addToast("Asesmen sudah ada!", "warning");
    try {
      const d = await FS.tambahAsesmenKustom({ nama:a }, ns);
      if (d.status === "success") {
        addToast(`Asesmen "${a}" ditambahkan!`, "success");
        setNewAsesmen("");
        const newAsesmens = await fetchAsesmenList(ns);
        setAsesmenList(newAsesmens);
      } else addToast(d.message, "error");
    } catch { addToast("Gagal terhubung ke server", "error"); }
  };
  const handleHapusAsesmen = async (a) => {
    if (DEFAULT_ASESMEN.includes(a)) return addToast("Asesmen bawaan tidak bisa dihapus.", "warning");
    if (!window.confirm(`Hapus asesmen "${a}"?`)) return;
    try {
      const d = await FS.hapusAsesmenKustom({ nama:a }, ns);
      if (d.status === "success") {
        addToast(`Asesmen "${a}" dihapus.`, "success");
        const newAsesmens = await fetchAsesmenList(ns);
        setAsesmenList(newAsesmens);
      } else addToast(d.message, "error");
    } catch { addToast("Gagal terhubung ke server", "error"); }
  };

  const fetchToken = async () => {
    setLoadToken(true);
    try { const d = await FS.getDaftarToken(ns); if (d.status==="success") setDaftarToken(d.data || []); } catch {} finally { setLoadToken(false); }
  };
  useEffect(() => { fetchToken(); }, []);

  const handleSimpanToken = async () => {
    if (!tokenValue.trim()) return addToast("Isi token terlebih dahulu!", "error");
    try {
      const d = await FS.simpanToken({ mapel:tokenMapel, asesmen:tokenAsesmen, token:tokenValue.toUpperCase() }, ns);
      if (d.status==="success") { addToast(`Token "${tokenValue.toUpperCase()}" disimpan!`, "success"); setTokenValue(""); fetchToken(); }
      else addToast(d.message, "error");
    } catch { addToast(`Demo: Token "${tokenValue}" (belum terhubung)`, "warning"); }
  };

  // Update status token (aktif/nonaktif)
  const handleHapusToken = async (mapel, asesmen) => {
    if (!window.confirm(`Hapus token untuk ${mapel} - ${asesmen}?`)) return;
    try {
      const d = await FS.hapusToken({ mapel, asesmen }, ns);
      if (d.status === "success") { addToast("Token dihapus! ✅", "success"); fetchToken(); }
      else addToast(d.message || "Gagal hapus token", "error");
    } catch { addToast("Gagal hapus token", "error"); }
  };

  const handleToggleStatus = async (mapel, asesmen, token, currentStatus) => {
    // Optimistic UI update dulu
    setDaftarToken(prev => prev.map(t =>
      t.mapel === mapel && t.asesmen === asesmen && t.token === token
        ? { ...t, aktif: currentStatus === "TRUE" ? "FALSE" : "TRUE" }
        : t
    ));
    try {
      const newStatus = currentStatus === "TRUE" ? "FALSE" : "TRUE";
      const result = await FS.updateTokenStatus({ mapel, asesmen, token, status: newStatus }, ns);
      if (result.status === "success") {
        addToast(`Token ${newStatus === "TRUE" ? "✅ diaktifkan" : "🔒 dinonaktifkan"}!`, "success");
        fetchToken(); // refresh dari server untuk sinkron
      } else {
        // Rollback jika gagal
        setDaftarToken(prev => prev.map(t =>
          t.mapel === mapel && t.asesmen === asesmen && t.token === token
            ? { ...t, aktif: currentStatus }
            : t
        ));
        addToast(result.message || "Gagal mengubah status token", "error");
      }
    } catch (error) {
      console.error(error);
      // Rollback jika error
      setDaftarToken(prev => prev.map(t =>
        t.mapel === mapel && t.asesmen === asesmen && t.token === token
          ? { ...t, aktif: currentStatus }
          : t
      ));
      addToast("Gagal mengubah status token", "error");
    }
  };

  // Edit token
  const openEditModal = (t) => {
    setEditModal({ mapel: t.mapel, asesmen: t.asesmen, token: t.token });
    setEditTokenValue(t.token);
  };
  const closeEditModal = () => {
    setEditModal(null);
    setEditTokenValue("");
  };
  const handleEditToken = async () => {
    if (!editTokenValue.trim()) return addToast("Token tidak boleh kosong!", "error");
    setEditSaving(true);
    try {
      const d = await FS.editToken({ mapel:editModal.mapel, asesmen:editModal.asesmen, tokenLama:editModal.token, tokenBaru:editTokenValue.toUpperCase() }, ns);
      if (d.status === "success") {
        addToast("Token berhasil diubah!", "success");
        fetchToken();
        closeEditModal();
      } else {
        addToast(d.message || "Gagal mengubah token", "error");
      }
    } catch (error) {
      addToast("Gagal terhubung ke server", "error");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black uppercase tracking-wide" style={{ color: "#003082" }}>Manajemen Mapel & Token</h2>
        <p className="text-sm text-slate-500">Kelola mata pelajaran, asesmen, token, dan KKM.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-white p-5 space-y-4" style={{ border: "1px solid #e2e8f0", borderTop: "3px solid #003082", borderRadius: "0" }}>
          <h3 className="font-bold uppercase tracking-wide text-sm" style={{ color: "#003082" }}>📚 Mata Pelajaran</h3>
          <div className="flex gap-2"><input value={newMapel} onChange={e=>setNewMapel(e.target.value)} placeholder="Tambah mapel baru..." className={inp + " flex-1"} onKeyDown={e=>e.key==="Enter" && handleTambahMapel()} /><button onClick={handleTambahMapel} className={btn("blue")}>+ Tambah</button></div>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {mapelList.map(m => (
              <div key={m} className="flex items-center justify-between px-3 py-2" style={{ background: "#f8fafc", borderLeft: "3px solid #003082", marginBottom: "2px" }}>
                <div className="flex items-center gap-2"><span className="text-sm font-medium text-slate-700">{m}</span>{!DEFAULT_MAPEL.includes(m) && <span className="text-xs px-1.5 py-0.5 font-medium" style={{ background: "#eff6ff", color: "#003082", borderRadius: "0" }}>Kustom</span>}</div>
                {!DEFAULT_MAPEL.includes(m) && <button onClick={() => handleHapusMapel(m)} className="text-xs font-medium" style={{ color: "#CC0000" }}>Hapus</button>}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">Total: {mapelList.length} mapel ({mapelList.length - DEFAULT_MAPEL.length} kustom)</p>
        </div>
        <div className="bg-white p-5 space-y-4" style={{ border: "1px solid #e2e8f0", borderTop: "3px solid #CC0000", borderRadius: "0" }}>
          <h3 className="font-bold uppercase tracking-wide text-sm" style={{ color: "#CC0000" }}>📋 Jenis Asesmen</h3>
          <div className="flex gap-2"><input value={newAsesmen} onChange={e=>setNewAsesmen(e.target.value)} placeholder="Tambah asesmen baru..." className={inp + " flex-1"} onKeyDown={e=>e.key==="Enter" && handleTambahAsesmen()} /><button onClick={handleTambahAsesmen} className={btn("blue")}>+ Tambah</button></div>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {asesmenList.map(a => (
              <div key={a} className="flex items-center justify-between px-3 py-2" style={{ background: "#f8fafc", borderLeft: "3px solid #CC0000", marginBottom: "2px" }}>
                <div className="flex items-center gap-2"><span className="text-sm font-medium text-slate-700">{a}</span>{!DEFAULT_ASESMEN.includes(a) && <span className="text-xs px-1.5 py-0.5 font-medium" style={{ background: "#fef2f2", color: "#CC0000", borderRadius: "0" }}>Kustom</span>}</div>
                {!DEFAULT_ASESMEN.includes(a) && <button onClick={() => handleHapusAsesmen(a)} className="text-xs font-medium" style={{ color: "#CC0000" }}>Hapus</button>}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">Total: {asesmenList.length} asesmen ({asesmenList.length - DEFAULT_ASESMEN.length} kustom)</p>
        </div>
      </div>

      {/* KKTP Settings */}
      <div className="bg-white p-5 space-y-4" style={{ border: "1px solid #e2e8f0", borderTop: "3px solid #16a34a", borderRadius: "0" }}>
        <div>
          <h3 className="font-bold uppercase tracking-wide text-sm" style={{ color: "#15803d" }}>🎯 Kriteria Ketercapaian Tujuan Pembelajaran (KKTP)</h3>
          <p className="text-xs text-slate-500 mt-1">Atur batas atas setiap level &mdash; berlaku untuk <strong>semua mata pelajaran</strong>. Nilai di atas batas tertinggi = Mahir.</p>
        </div>
        {kktpLoading ? <p className="text-xs text-slate-400">Memuat KKTP...</p> : (
          <div className="space-y-3">
            {/* Visualisasi rentang */}
            <div className="flex rounded overflow-hidden text-xs font-bold text-white text-center" style={{ height: "28px" }}>
              <div style={{ flex: kktp.pb, background: "#CC0000" }} className="flex items-center justify-center truncate px-1">Perlu Bimbingan<br/>0–{kktp.pb}</div>
              <div style={{ flex: kktp.bk - kktp.pb, background: "#d97706" }} className="flex items-center justify-center truncate px-1">Berkembang<br/>{kktp.pb+1}–{kktp.bk}</div>
              <div style={{ flex: kktp.ck - kktp.bk, background: "#003082" }} className="flex items-center justify-center truncate px-1">Cakap<br/>{kktp.bk+1}–{kktp.ck}</div>
              <div style={{ flex: 100 - kktp.ck, background: "#16a34a" }} className="flex items-center justify-center truncate px-1">Mahir<br/>{kktp.ck+1}–100</div>
            </div>

            {/* Input batas atas per level */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { key: "pb", label: "Batas Atas Perlu Bimbingan", color: "#CC0000", desc: "0 – nilai ini" },
                { key: "bk", label: "Batas Atas Berkembang", color: "#d97706", desc: `${kktp.pb+1} – nilai ini` },
                { key: "ck", label: "Batas Atas Cakap", color: "#003082", desc: `${kktp.bk+1} – nilai ini` },
              ].map(({ key, label, color, desc }) => (
                <div key={key}>
                  <label className="text-xs font-semibold block mb-1" style={{ color }}>{label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={1} max={99}
                      value={kktp[key]}
                      onChange={e => handleKKTPChange(key, e.target.value)}
                      className="w-20 border-2 px-2 py-1.5 text-sm text-center font-bold focus:outline-none"
                      style={{ borderColor: color, borderRadius: "0", color }}
                    />
                    <span className="text-xs text-slate-400">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-400 bg-slate-50 px-3 py-2" style={{ borderLeft: "3px solid #16a34a" }}>
              <strong>Mahir:</strong> {kktp.ck + 1} &ndash; 100 &nbsp;|&nbsp; Pastikan nilai berurutan: Perlu Bimbingan &lt; Berkembang &lt; Cakap.
            </div>
            )}
          </div>
        )}
        <button onClick={handleSaveKKTP} disabled={kktpSaving} className={btn("green") + " w-full md:w-auto"}>{kktpSaving ? "Menyimpan..." : "💾 Simpan KKTP"}</button>
      </div>

      <div className="p-3 text-xs" style={{ background: "#f0fdf4", border: "1px solid #86efac", borderLeft: "4px solid #16a34a", borderRadius: "0", color: "#15803d" }}>✅ Mapel dan asesmen kustom otomatis tersedia di login, input soal, dan rekap hasil.</div>
      
      {/* Token Management */}
      <div className="bg-white p-5 space-y-4" style={{ border: "1px solid #e2e8f0", borderTop: "3px solid #d97706", borderRadius: "0" }}>
        <h3 className="font-bold uppercase tracking-wide text-sm" style={{ color: "#b45309" }}>🔑 Token Ujian</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Mata Pelajaran"><select value={tokenMapel} onChange={e=>setTokenMapel(e.target.value)} className={inp}>{mapelList.map(m=><option key={m}>{m}</option>)}</select></Field>
          <Field label="Asesmen"><select value={tokenAsesmen} onChange={e=>setTokenAsesmen(e.target.value)} className={inp}>{asesmenList.map(a=><option key={a}>{a}</option>)}</select></Field>
          <Field label="Token"><input value={tokenValue} onChange={e=>setTokenValue(e.target.value.toUpperCase())} placeholder="Contoh: MTK2024" className={inp + " uppercase tracking-widest font-mono font-bold"} /></Field>
        </div>
        <button onClick={handleSimpanToken} className={btn("green") + " w-full md:w-auto"}>🔑 Simpan Token</button>
        
        <div>
          <div className="flex items-center justify-between mb-2"><p className="text-xs font-bold text-slate-600 uppercase">Daftar Token Aktif</p><button onClick={fetchToken} className="text-xs" style={{ color: "#003082" }}>🔄 Refresh</button></div>
          {loadToken ? <p className="text-xs text-slate-400">Memuat...</p> : daftarToken.length === 0 ? <p className="text-xs text-slate-400">Belum ada token</p> : (
            <div className="overflow-x-auto" style={{ border: "1px solid #e2e8f0", borderRadius: "0" }}>
              <table className="w-full text-xs">
                <thead><tr style={{ background: "#003082" }} className="text-white"><th className="px-3 py-2 text-left">Mapel</th><th className="px-3 py-2 text-left">Asesmen</th><th className="px-3 py-2 text-left">Token</th><th className="px-3 py-2 text-center">Status</th><th className="px-3 py-2 text-center">Edit</th><th className="px-3 py-2 text-center">Hapus</th></tr></thead>
                <tbody>{daftarToken.map((t, i) => (
                  <tr key={i} style={{ background: i%2===0 ? "#fff" : "#f8fafc" }}>
                    <td className="px-3 py-2">{t.mapel}</td>
                    <td className="px-3 py-2">{t.asesmen}</td>
                    <td className="px-3 py-2 font-mono font-bold" style={{ color: "#003082" }}>{t.token}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => handleToggleStatus(t.mapel, t.asesmen, t.token, t.aktif)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${t.aktif === "TRUE" ? "bg-green-500" : "bg-gray-300"}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${t.aktif === "TRUE" ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                      <span className="ml-2 text-xs font-medium">{t.aktif === "TRUE" ? "Aktif" : "Nonaktif"}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => openEditModal(t)} className="text-xs font-bold px-2 py-1" style={{ background:"#eff6ff", color:"#003082", borderRadius:"0" }}>✏️</button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => handleHapusToken(t.mapel, t.asesmen)} className="text-xs font-bold px-2 py-1" style={{ background:"#fef2f2", color:"#CC0000", borderRadius:"0" }}>🗑️</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── COPY SOAL ── */}
      <div className="bg-white p-5 space-y-4" style={{ border: "1px solid #e2e8f0", borderTop: "3px solid #7c3aed", borderRadius: "0" }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold uppercase tracking-wide text-sm" style={{ color: "#7c3aed" }}>📋 Copy Soal</h3>
            <p className="text-xs text-slate-500 mt-0.5">Salin semua soal (teks, gambar, jawaban) dari satu mapel/asesmen ke mapel/asesmen lain.</p>
          </div>
          <button onClick={() => setShowCopySoal(v => !v)} className="text-xs font-bold px-3 py-1.5"
            style={{ background: showCopySoal ? "#f1f5f9" : "#7c3aed", color: showCopySoal ? "#475569" : "#fff", borderRadius: "0" }}>
            {showCopySoal ? "✕ Tutup" : "📋 Buka"}
          </button>
        </div>

        {showCopySoal && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Sumber */}
              <div className="p-4 space-y-3" style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderLeft: "4px solid #CC0000", borderRadius: "0" }}>
                <p className="font-bold text-sm" style={{ color: "#CC0000" }}>📖 Mapel Sumber (yang di-copy)</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Mata Pelajaran</label>
                  <select value={copySumber.mapel} onChange={e => setCopySumber(s => ({ ...s, mapel: e.target.value, asesmen: "" }))} className={inp}>
                    <option value="">-- Pilih Mapel --</option>
                    {mapelList.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Asesmen</label>
                  <select value={copySumber.asesmen} onChange={e => setCopySumber(s => ({ ...s, asesmen: e.target.value }))} className={inp} disabled={!copySumber.mapel}>
                    <option value="">-- Pilih Asesmen --</option>
                    {asesmenList.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Tujuan */}
              <div className="p-4 space-y-3" style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderLeft: "4px solid #003082", borderRadius: "0" }}>
                <p className="font-bold text-sm" style={{ color: "#003082" }}>🎯 Mapel Tujuan (tempat copy)</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Mata Pelajaran</label>
                  <select value={copyTujuan.mapel} onChange={e => setCopyTujuan(s => ({ ...s, mapel: e.target.value, asesmen: "" }))} className={inp}>
                    <option value="">-- Pilih Mapel --</option>
                    {mapelList.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Asesmen</label>
                  <select value={copyTujuan.asesmen} onChange={e => setCopyTujuan(s => ({ ...s, asesmen: e.target.value }))} className={inp} disabled={!copyTujuan.mapel}>
                    <option value="">-- Pilih Asesmen --</option>
                    {asesmenList.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Panah indikator */}
            {copySumber.mapel && copySumber.asesmen && copyTujuan.mapel && copyTujuan.asesmen && (
              <div className="text-center text-sm font-bold py-2" style={{ color: "#7c3aed" }}>
                📖 {copySumber.mapel} / {copySumber.asesmen}
                <span className="mx-3">→</span>
                🎯 {copyTujuan.mapel} / {copyTujuan.asesmen}
              </div>
            )}

            {/* Progress bar saat copy */}
            {copyLoading && copyProgress.total > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Menyalin soal...</span>
                  <span>{copyProgress.done}/{copyProgress.total}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full" style={{ height: "8px" }}>
                  <div className="rounded-full transition-all" style={{ height: "8px", background: "#7c3aed", width: `${Math.round((copyProgress.done / copyProgress.total) * 100)}%` }} />
                </div>
              </div>
            )}

            <button
              onClick={handleCopySoal}
              disabled={copyLoading || !copySumber.mapel || !copySumber.asesmen || !copyTujuan.mapel || !copyTujuan.asesmen}
              className="w-full font-bold py-3 text-sm text-white disabled:opacity-50"
              style={{ background: copyLoading ? "#6d28d9" : "#7c3aed", borderRadius: "0" }}>
              {copyLoading ? `⏳ Menyalin... (${copyProgress.done}/${copyProgress.total})` : "📋 Mulai Copy Soal"}
            </button>

            <div className="p-3 text-xs" style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", borderLeft: "3px solid #7c3aed", borderRadius: "0" }}>
              <p className="font-bold" style={{ color: "#6d28d9" }}>ℹ️ Catatan:</p>
              <p className="text-slate-600">• Semua soal (teks, gambar, opsi, jawaban, point) akan disalin ke tujuan</p>
              <p className="text-slate-600">• Soal di tujuan tidak dihapus — soal baru ditambahkan ke yang sudah ada</p>
              <p className="text-slate-600">• Proses tidak bisa dibatalkan setelah dimulai</p>
            </div>
          </div>
        )}
      </div>

      {/* Modal Edit Token */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e=>{ if(e.target===e.currentTarget) closeEditModal(); }}>
          <div className="bg-white shadow-2xl w-full max-w-md p-6" style={{ border: "2px solid #003082", borderRadius: "0" }}>
            <div className="flex items-center gap-2 mb-4" style={{ borderBottom: "3px solid #CC0000", paddingBottom: "10px" }}>
              <span className="text-lg">✏️</span>
              <h3 className="text-lg font-black uppercase tracking-wide" style={{ color: "#003082" }}>Edit Token</h3>
            </div>
            <div className="space-y-4">
              <Field label="Mata Pelajaran"><input value={editModal.mapel} disabled className={inp + " bg-slate-100"} /></Field>
              <Field label="Asesmen"><input value={editModal.asesmen} disabled className={inp + " bg-slate-100"} /></Field>
              <Field label="Token Baru">
                <input value={editTokenValue} onChange={e=>setEditTokenValue(e.target.value.toUpperCase())} placeholder="Token baru" className={inp + " uppercase tracking-widest font-mono font-bold"} />
              </Field>
              <div className="flex gap-3 pt-2">
                <button onClick={closeEditModal} className={btn("slate") + " flex-1"}>Batal</button>
                <button onClick={handleEditToken} disabled={editSaving} className={btn("blue") + " flex-1"}>{editSaving ? "Menyimpan..." : "Simpan"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// RICH TEXT EDITOR dengan toolbar (bold, italic, list, formula)
// ============================================================
function RichTextEditor({ value, onChange, placeholder = "Tulis soal di sini..." }) {
  const editorRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showListMenu, setShowListMenu] = useState(false);
  const [showAlignMenu, setShowAlignMenu] = useState(false);
  const listMenuRef = useRef(null);
  const alignMenuRef = useRef(null);

  // Tutup popup saat klik di luar
  useEffect(() => {
    const handler = (e) => {
      if (listMenuRef.current && !listMenuRef.current.contains(e.target)) setShowListMenu(false);
      if (alignMenuRef.current && !alignMenuRef.current.contains(e.target)) setShowAlignMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Inisialisasi editor saat mount
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = value || "";
    }
  }, []);

  // Reset konten editor saat value dikosongkan dari luar (setelah simpan soal)
  useEffect(() => {
    if (!value && editorRef.current && editorRef.current.innerHTML !== "") {
      editorRef.current.innerHTML = "";
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;
      const node = selection.getRangeAt(0).startContainer;
      const isInList = node.parentElement?.closest?.("li") || node.closest?.("li");
      if (isInList) {
        e.preventDefault();
        document.execCommand("insertParagraph", false);
        setTimeout(() => {
          const newSelection = window.getSelection();
          if (newSelection.rangeCount) {
            const newNode = newSelection.getRangeAt(0).startContainer;
            const newLi = newNode.parentElement?.closest?.("li");
            if (newLi && newLi.innerText.trim() === "") newLi.remove();
          }
        }, 10);
      }
    }
  };

  const execCommand = (command, val = null) => {
    document.execCommand(command, false, val);
    handleInput();
    editorRef.current?.focus();
  };

  const handleFontSize = (size) => {
    // execCommand fontSize hanya mendukung 1-7; kita pakai span style
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) { editorRef.current?.focus(); return; }
    const span = document.createElement("span");
    span.style.fontSize = size + "pt";
    try {
      range.surroundContents(span);
    } catch {
      // Jika selection multi-node, fallback ke execCommand
      document.execCommand("fontSize", false, "7");
      // Ganti font-size yang dihasilkan browser
      editorRef.current?.querySelectorAll("font[size='7']").forEach(el => {
        el.removeAttribute("size");
        el.style.fontSize = size + "pt";
      });
    }
    handleInput();
    editorRef.current?.focus();
  };

  const handleFont = (font) => {
    execCommand("fontName", font);
  };

  const handleBlur = () => { setIsFocused(false); handleInput(); };
  const handleFocus = () => setIsFocused(true);

  const hasFormula = () => value && /\$[^$]+\$/.test(value);
  const stripHtml = (html) => { const t = document.createElement("div"); t.innerHTML = html; return t.textContent || t.innerText || ""; };
  const plainText = stripHtml(value || "");
  const isEmpty = !value || value === "<br>" || value === "";

  return (
    <div className="space-y-2">
      <div className="border-2 border-slate-200 rounded-xl overflow-hidden focus-within:border-blue-500 transition-colors relative">
        {/* TOOLBAR */}
        <div className="bg-slate-50 border-b border-slate-200 px-2 py-1 flex flex-wrap gap-1 items-center">
          
          {/* Bold & Italic */}
          <button type="button" onClick={() => execCommand("bold")} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 font-bold" title="Bold"><span className="font-bold text-sm">B</span></button>
          <button type="button" onClick={() => execCommand("italic")} className="p-1.5 rounded hover:bg-slate-200 text-slate-600" title="Italic"><span className="italic text-sm">I</span></button>

          <div className="w-px h-5 bg-slate-300 mx-0.5 self-center" />

          {/* Font Arial */}
          <button type="button" onClick={() => handleFont("Arial")} className="px-2 py-1 rounded hover:bg-slate-200 text-slate-600 text-xs font-medium" title="Font Arial" style={{ fontFamily: "Arial" }}>Arial</button>

          <div className="w-px h-5 bg-slate-300 mx-0.5 self-center" />

          {/* Ukuran Teks Dropdown */}
          <select
            title="Ukuran Tulisan"
            onChange={e => { if (e.target.value) { handleFontSize(e.target.value); e.target.value = ""; } }}
            defaultValue=""
            className="text-xs px-1 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:border-slate-400 focus:outline-none cursor-pointer"
            style={{ maxWidth: "58px" }}
          >
            <option value="" disabled>Ukuran</option>
            {[10, 11, 12, 13, 14].map(s => <option key={s} value={s}>{s}pt</option>)}
          </select>

          <div className="w-px h-5 bg-slate-300 mx-0.5 self-center" />

          {/* List — popup kecil */}
          <div className="relative" ref={listMenuRef}>
            <button
              type="button"
              onClick={() => setShowListMenu(v => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-200 text-slate-600 text-xs font-medium"
              title="List"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
              <span>List</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {showListMenu && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 shadow-lg rounded-lg overflow-hidden" style={{ minWidth: "140px" }}>
                <button type="button" onClick={() => { execCommand("insertOrderedList"); setShowListMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="7" style={{fontSize:"7px",fill:"currentColor",stroke:"none"}}>1.</text><text x="2" y="13" style={{fontSize:"7px",fill:"currentColor",stroke:"none"}}>2.</text><text x="2" y="19" style={{fontSize:"7px",fill:"currentColor",stroke:"none"}}>3.</text></svg>
                  Penomoran (1, 2, 3)
                </button>
                <button type="button" onClick={() => { execCommand("insertUnorderedList"); setShowListMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                  Bullet (•)
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-slate-300 mx-0.5 self-center" />

          {/* Rata Teks — popup kecil */}
          <div className="relative" ref={alignMenuRef}>
            <button
              type="button"
              onClick={() => setShowAlignMenu(v => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-200 text-slate-600 text-xs font-medium"
              title="Rata Teks"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
              <span>Rata</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {showAlignMenu && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 shadow-lg rounded-lg overflow-hidden" style={{ minWidth: "150px" }}>
                {[
                  { label: "Rata Kiri", cmd: "justifyLeft", icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg> },
                  { label: "Rata Tengah", cmd: "justifyCenter", icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg> },
                  { label: "Rata Kanan", cmd: "justifyRight", icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg> },
                  { label: "Rata Kanan-Kiri", cmd: "justifyFull", icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> },
                ].map(({ label, cmd, icon }) => (
                  <button key={cmd} type="button"
                    onClick={() => { execCommand(cmd); setShowAlignMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium">
                    {icon}{label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="w-full px-4 py-3 text-sm text-slate-800 focus:outline-none min-h-[120px] max-h-[300px] overflow-y-auto"
          style={{ lineHeight: "1.6" }}
        />
        
        {/* Placeholder hanya muncul saat kosong dan tidak fokus */}
        {isEmpty && !isFocused && (
          <div className="absolute text-slate-400 text-sm px-4 py-3 pointer-events-none" style={{ top: "calc(2rem + 10px)", left: 0 }}>
            Tulis soal di sini...
          </div>
        )}
      </div>
      
      {/* Preview formula */}
      {value && value.trim() !== "" && hasFormula() && (
        <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-green-500 rounded-full"></span>
            Preview Formula:
          </p>
          <div className="text-sm text-slate-700 bg-white p-3 rounded-lg border border-green-100">
            <MathText text={plainText} />
          </div>
          <p className="text-xs text-green-600 mt-2 italic">✓ LaTeX $...$ akan di-render saat ujian</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// HELPER: parse opsi yang bisa string lama ATAU object {text,img}
// ============================================================
function getOpsiText(o) {
  if (!o) return "";
  if (typeof o === "object" && o !== null) return o.text || "";
  return String(o);
}
function getOpsiImg(o) {
  if (!o) return "";
  if (typeof o === "object" && o !== null) return o.img || "";
  return "";
}
function makeOpsiObj(text, img) {
  // Jika tidak ada gambar, simpan string biasa agar backward-compatible
  if (!img) return text;
  return { text, img };
}

// ===== KOMPONEN MINI IMAGE UNTUK OPSI JAWABAN =====
function OpsiImageInserter({ img, onImgChange, addToast }) {
  const [mode, setMode] = useState(null); // null | "url" | "upload"
  const [urlInput, setUrlInput] = useState("");
  const [compressing, setCompressing] = useState(false);
  const fileRef = useRef(null);

  const compressToWebP = (file, targetKB = 200) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const image = new Image();
      image.onload = () => {
        const MAX_SIDE = 800;
        let w = image.width, h = image.height;
        if (w > MAX_SIDE || h > MAX_SIDE) {
          if (w > h) { h = Math.round(h * MAX_SIDE / w); w = MAX_SIDE; }
          else { w = Math.round(w * MAX_SIDE / h); h = MAX_SIDE; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(image, 0, 0, w, h);
        let lo = 0.1, hi = 0.92, best = null;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          const data = canvas.toDataURL("image/webp", mid);
          const kb = Math.round((data.length * 3) / 4 / 1024);
          if (kb <= targetKB) { best = data; lo = mid; } else hi = mid;
        }
        resolve(best || canvas.toDataURL("image/webp", 0.1));
      };
      image.onerror = reject;
      image.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return addToast("File harus berupa gambar!", "error");
    setCompressing(true);
    try {
      const webp = await compressToWebP(file, 200);
      onImgChange(webp);
      setMode(null);
      addToast("✅ Gambar opsi dikompres (WebP)", "success");
    } catch { addToast("Gagal memproses gambar", "error"); }
    finally { setCompressing(false); e.target.value = ""; }
  };

  const handleUrl = () => {
    if (!urlInput.trim()) return addToast("URL tidak boleh kosong!", "error");
    onImgChange(urlInput.trim());
    setUrlInput("");
    setMode(null);
    addToast("✅ URL gambar opsi disimpan", "success");
  };

  if (img) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <img src={img} alt="opsi" className="h-12 object-contain border border-slate-200 rounded" style={{ maxWidth: "120px" }} />
        <button type="button" onClick={() => onImgChange("")} className="text-xs text-red-500 hover:text-red-700 font-bold">✕ Hapus</button>
      </div>
    );
  }

  return (
    <div className="mt-1">
      {!mode && (
        <div className="flex gap-1">
          <button type="button" onClick={() => setMode("upload")} className="text-xs px-2 py-1 font-medium" style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: "0" }}>🖼 Upload</button>
          <button type="button" onClick={() => setMode("url")} className="text-xs px-2 py-1 font-medium" style={{ background: "#eff6ff", color: "#003082", border: "1px solid #93c5fd", borderRadius: "0" }}>🔗 URL</button>
        </div>
      )}
      {mode === "upload" && (
        <div className="flex items-center gap-2 mt-1">
          <input ref={fileRef} type="file" accept="image/*,.webp" onChange={handleFile} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={compressing} className="text-xs px-3 py-1 font-medium" style={{ background: "#003082", color: "#fff", borderRadius: "0" }}>
            {compressing ? "⏳ Kompres..." : "📁 Pilih File"}
          </button>
          <button type="button" onClick={() => setMode(null)} className="text-xs text-slate-400 hover:text-slate-600">Batal</button>
        </div>
      )}
      {mode === "url" && (
        <div className="flex items-center gap-2 mt-1">
          <input type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://..." className="flex-1 text-xs px-2 py-1 border border-slate-200 focus:outline-none focus:border-blue-400" style={{ borderRadius: "0" }} />
          <button type="button" onClick={handleUrl} className="text-xs px-2 py-1 font-bold" style={{ background: "#003082", color: "#fff", borderRadius: "0" }}>OK</button>
          <button type="button" onClick={() => setMode(null)} className="text-xs text-slate-400">✕</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TAB INPUT SOAL (LENGKAP)
// ============================================================
// ===== KOMPONEN INSERT GAMBAR =====
// Mendukung URL langsung, Google Drive URL, dan upload file (auto-compress ke WebP ≤200KB)
function ImageInserter({ gambar, setGambar, addToast }) {
  const [mode, setMode] = useState(null); // null | "url" | "upload"
  const [urlInput, setUrlInput] = useState(gambar || "");
  const [compressing, setCompressing] = useState(false);
  const [preview, setPreview] = useState(gambar || null);
  const fileRef = useRef(null);

  // Reset state internal saat parent mengosongkan gambar (setelah simpan soal)
  useEffect(() => {
    if (!gambar) {
      setPreview(null);
      setUrlInput("");
      setMode(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [gambar]);

  // Kompresi gambar ke WebP ≤ targetKB
  const compressToWebP = (file, targetKB = 200) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX_SIDE = 1200;
        let w = img.width, h = img.height;
        if (w > MAX_SIDE || h > MAX_SIDE) {
          if (w > h) { h = Math.round(h * MAX_SIDE / w); w = MAX_SIDE; }
          else { w = Math.round(w * MAX_SIDE / h); h = MAX_SIDE; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        // Binary search kualitas agar ≤ targetKB
        let lo = 0.1, hi = 0.92, best = null;
        const tryQuality = q => canvas.toDataURL("image/webp", q);
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const data = tryQuality(mid);
          const kb = Math.round((data.length * 3) / 4 / 1024);
          if (kb <= targetKB) { best = data; lo = mid; }
          else hi = mid;
        }
        if (!best) best = tryQuality(0.1); // fallback kualitas minimum
        resolve(best);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return addToast("File harus berupa gambar!", "error");
    const origKB = Math.round(file.size / 1024);
    setCompressing(true);
    addToast(`⏳ Mengkompresi gambar (${origKB}KB → WebP ≤200KB)...`, "info");
    try {
      const webpData = await compressToWebP(file, 200);
      const finalKB = Math.round((webpData.length * 3) / 4 / 1024);
      setGambar(webpData);
      setPreview(webpData);
      setMode(null);
      addToast(`✅ Gambar dikompres: ${origKB}KB → ${finalKB}KB (WebP)`, "success");
    } catch {
      addToast("Gagal memproses gambar.", "error");
    } finally {
      setCompressing(false);
      e.target.value = "";
    }
  };

  const handleUrlConfirm = () => {
    if (!urlInput.trim()) return addToast("URL tidak boleh kosong!", "error");
    setGambar(urlInput.trim());
    setPreview(urlInput.trim());
    setMode(null);
    addToast("✅ URL gambar disimpan", "success");
  };

  const handleRemove = () => {
    setGambar(""); setPreview(null); setUrlInput(""); setMode(null);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#003082" }}>🖼 Gambar Soal</span>
        <span className="text-xs text-slate-400">(opsional)</span>
      </div>

      {/* Tombol insert */}
      {!preview && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === "url" ? null : "url")}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors"
            style={{ background: mode === "url" ? "#003082" : "#eff6ff", color: mode === "url" ? "#fff" : "#003082", border: "1.5px solid #93c5fd", borderRadius: "0" }}
          >
            🔗 Dari URL
          </button>
          <button
            type="button"
            onClick={() => { setMode(mode === "upload" ? null : "upload"); if (mode !== "upload") setTimeout(() => fileRef.current?.click(), 50); }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors"
            style={{ background: mode === "upload" ? "#CC0000" : "#fef2f2", color: mode === "upload" ? "#fff" : "#CC0000", border: "1.5px solid #fca5a5", borderRadius: "0" }}
            disabled={compressing}
          >
            {compressing ? <><span className="w-3 h-3 border-2 border-red-300 border-t-red-600 rounded-full animate-spin inline-block" /> Mengkompresi...</> : "📤 Upload & Kompresi"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {/* Input URL */}
      {mode === "url" && !preview && (
        <div className="mt-2 flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleUrlConfirm()}
            placeholder="https://drive.google.com/... atau URL gambar langsung"
            className={inp + " flex-1"}
            autoFocus
          />
          <button onClick={handleUrlConfirm} className={btn("blue")}>✓ Simpan</button>
          <button onClick={() => setMode(null)} className={btn("slate")}>✕</button>
        </div>
      )}

      {/* Preview gambar */}
      {preview && (
        <div className="mt-2 relative inline-block">
          <div style={{ border: "2px solid #e2e8f0", borderRadius: "0", overflow: "hidden", maxWidth: "320px" }}>
            <GambarSoal url={preview} />
          </div>
          <button
            onClick={handleRemove}
            className="absolute top-1 right-1 text-white text-xs font-bold px-1.5 py-0.5"
            style={{ background: "#CC0000", borderRadius: "0" }}
            title="Hapus gambar"
          >✕</button>
          <p className="text-xs text-slate-400 mt-1">
            {gambar?.startsWith("data:") ? "📦 Gambar WebP (tersimpan base64)" : "🔗 Gambar dari URL"}
          </p>
        </div>
      )}
    </div>
  );
}

function TabInputSoal({ scriptUrl, addToast, mapelList, asesmenList, ns="" }) {
  mapelList = mapelList || DEFAULT_MAPEL;
  asesmenList = asesmenList || DEFAULT_ASESMEN;
  const [soal, setSoal] = useState("");
  const [gambar, setGambar] = useState("");
  const [point, setPoint] = useState(3); // PG default = 3
  const [mapel, setMapel] = useState(mapelList[0]);
  const [asesmen, setAsesmen] = useState(asesmenList[0]);
  const [jenisSoal, setJenisSoal] = useState("Pilihan Ganda");
  const [opsi, setOpsi] = useState(["", "", "", ""]);
  const [jawabanBenar, setJawabanBenar] = useState([]);
  const [jawabanReferensi, setJawabanReferensi] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGantiJenis = j => {
    setJenisSoal(j);
    if (j === "Benar/Salah Kompleks") setOpsi(["", "", ""]);
    else if (j === "Uraian/Esai") setOpsi([]);
    else setOpsi(["", "", "", ""]);
    setJawabanBenar([]);
    setJawabanReferensi("");
    // Default point per jenis soal
    if (j === "Pilihan Ganda") setPoint(3);
    else if (j === "Pilihan Ganda Kompleks") setPoint(6);
    else if (j === "Benar/Salah Kompleks") setPoint(6);
    else setPoint(0); // Uraian/Esai
  };

  const handleOpsiChange = (i, v) => { const a = [...opsi]; a[i] = makeOpsiObj(v, getOpsiImg(a[i])); setOpsi(a); };
  const handleOpsiImgChange = (i, img) => { const a = [...opsi]; a[i] = makeOpsiObj(getOpsiText(a[i]), img); setOpsi(a); };
  const handleAddOpsi = () => setOpsi([...opsi, ""]);
  const handleRemoveOpsi = i => { setOpsi(opsi.filter((_, idx) => idx !== i)); setJawabanBenar(jawabanBenar.filter(j => j !== getOpsiText(opsi[i]))); };
  const handleJawabanPG = v => setJawabanBenar([v]);
  const handleJawabanPGK = v => setJawabanBenar(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);
  const handleJawabanBS = (idx, val) => { const arr = [...(jawabanBenar.length === opsi.length ? jawabanBenar : opsi.map(() => ""))]; arr[idx] = val; setJawabanBenar(arr); };
  
  const handleOpsiPaste = (e, startIdx) => {
    const text = e.clipboardData.getData("text");
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length <= 1) return;
    e.preventDefault();
    const newOpsi = [...opsi];
    lines.forEach((line, i) => {
      const idx = startIdx + i;
      if (idx < newOpsi.length) newOpsi[idx] = makeOpsiObj(line, getOpsiImg(newOpsi[idx]));
      else newOpsi.push(line);
    });
    setOpsi(newOpsi);
    addToast(`✅ ${lines.length} opsi di-paste sekaligus!`, "success");
  };

  const handleSubmit = async () => {
    if (!soal.trim()) return addToast("Soal tidak boleh kosong!", "error");
    
    if (jenisSoal !== "Uraian/Esai") {
      if (!point || isNaN(point) || point <= 0) return addToast("Point harus diisi dengan angka positif!", "error");
    }
    
    if (jenisSoal !== "Uraian/Esai") {
      if (opsi.filter(o => getOpsiText(o).trim()).length < 2) return addToast("Minimal 2 opsi!", "error");
      if (jawabanBenar.length === 0) return addToast("Pilih jawaban benar!", "error");
    }
    
    const payload = {
      action: "tambahSoal",
      mapel, asesmen, soal, gambar, jenisSoal,
      opsi: jenisSoal === "Uraian/Esai" ? "[]" : JSON.stringify(opsi.filter(o => getOpsiText(o).trim())),
      jawabanBenar: jenisSoal === "Uraian/Esai" ? "[]" : JSON.stringify(jawabanBenar),
      jawabanReferensi: jenisSoal === "Uraian/Esai" ? jawabanReferensi : "",
      point: jenisSoal === "Uraian/Esai" ? 0 : Number(point)
    };
    
    setLoading(true);
    try {
      const d = await FS.tambahSoal(payload, ns);
      if (d.status === "success") {
        FS.updateSoalCounter(1, ns);
        addToast("Soal berhasil disimpan! ✅", "success");
        // Reset semua field soal — form bersih siap input berikutnya
        setSoal("");
        setGambar("");
        setJawabanBenar([]);
        setJawabanReferensi("");
        if (jenisSoal === "Benar/Salah Kompleks") setOpsi(["", "", ""]);
        else if (jenisSoal === "Uraian/Esai") setOpsi([]);
        else setOpsi(["", "", "", ""]);
        // Reset point ke default per jenis soal
        if (jenisSoal === "Pilihan Ganda") setPoint(3);
        else if (jenisSoal === "Pilihan Ganda Kompleks") setPoint(6);
        else if (jenisSoal === "Benar/Salah Kompleks") setPoint(6);
        else setPoint(0);
      } else addToast(d.message || "Gagal menyimpan", "error");
    } catch { addToast("Mode Demo: Belum terhubung ke Apps Script", "warning"); }
    finally { setLoading(false); }
  };

  const isMath = isMapelMath(mapel);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black uppercase tracking-wide" style={{ color: "#003082" }}>Input Soal</h2>
        <p className="text-sm text-slate-500">Tambahkan soal ke bank soal. Gunakan toolbar untuk format teks dan rumus matematika.</p>
      </div>
      
      <div className="bg-white p-6 space-y-5" style={{ border: "1px solid #e2e8f0", borderTop: "3px solid #CC0000", borderRadius: "0" }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mata Pelajaran">
            <select value={mapel} onChange={e => setMapel(e.target.value)} className={inp}>
              {mapelList.map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Jenis Asesmen">
            <select value={asesmen} onChange={e => setAsesmen(e.target.value)} className={inp}>
              {asesmenList.map(a => <option key={a}>{a}</option>)}
            </select>
          </Field>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jenis Soal">
            <select value={jenisSoal} onChange={e => handleGantiJenis(e.target.value)} className={inp}>
              {JENIS_SOAL_LENGKAP.map(j => <option key={j}>{j}</option>)}
            </select>
          </Field>
          <Field label="Point/Nilai" hint={jenisSoal === "Pilihan Ganda" ? "Default: 3" : jenisSoal === "Pilihan Ganda Kompleks" ? "Default: 6" : jenisSoal === "Benar/Salah Kompleks" ? "Default: 6" : "Ditentukan saat koreksi"}>
            <input 
              type="number" 
              value={point} 
              onChange={e => setPoint(Number(e.target.value))} 
              min={jenisSoal === "Uraian/Esai" ? 0 : 1}
              placeholder={jenisSoal === "Pilihan Ganda" ? "3" : jenisSoal === "Pilihan Ganda Kompleks" ? "6" : jenisSoal === "Benar/Salah Kompleks" ? "6" : "0"}
              className={inp} 
              disabled={jenisSoal === "Uraian/Esai"}
            />
            {jenisSoal === "Uraian/Esai" && (
              <p className="text-xs text-amber-600 mt-1">⚠️ Point tidak digunakan untuk soal uraian, nilai ditentukan guru saat koreksi.</p>
            )}
          </Field>
        </div>
        
        <Field label="Pertanyaan">
          <RichTextEditor 
            value={soal} 
            onChange={setSoal} 
            placeholder="Tulis soal di sini... Gunakan toolbar untuk bold, list, atau formula $$rumus$$"
          />
        </Field>

        {/* Insert Gambar */}
        <ImageInserter gambar={gambar} setGambar={setGambar} addToast={addToast} />
        
        {/* Opsi Jawaban - hanya untuk soal non-esai */}
        {jenisSoal !== "Uraian/Esai" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-slate-600">Opsi Jawaban</p>
                <p className="text-xs text-blue-500">💡 Ctrl+V di Opsi A untuk paste banyak sekaligus</p>
              </div>
              <button onClick={handleAddOpsi} className="text-xs px-3 py-1 font-medium" style={{ background: "#eff6ff", color: "#003082", borderRadius: "0", border: "1px solid #93c5fd" }}>+ Tambah Opsi</button>
            </div>
            <div className="space-y-3">
              {opsi.map((o, i) => {
                const oText = getOpsiText(o);
                const oImg = getOpsiImg(o);
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-7 h-7 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-2" style={{ background: "#003082", color: "#fff", borderRadius: "0" }}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    <div className="flex-1">
                      <MathInput 
                        value={oText} 
                        onChange={e => handleOpsiChange(i, e.target.value)} 
                        onPaste={e => handleOpsiPaste(e, i)} 
                        rows={1} 
                        placeholder={`Opsi ${String.fromCharCode(65 + i)}`} 
                        showToolbar={isMath} 
                      />
                      {isMath && oText && oText.includes("$") && 
                        <div className="mt-0.5 px-2 py-1 bg-slate-50 rounded-lg text-xs"><MathText text={oText} /></div>
                      }
                      <OpsiImageInserter img={oImg} onImgChange={img => handleOpsiImgChange(i, img)} addToast={addToast} />
                    </div>
                    {jenisSoal === "Pilihan Ganda" && 
                      <input type="radio" name="pg" checked={jawabanBenar[0] === oText} onChange={() => handleJawabanPG(oText)} className="w-4 h-4 mt-2.5" />
                    }
                    {jenisSoal === "Pilihan Ganda Kompleks" && 
                      <input type="checkbox" checked={jawabanBenar.includes(oText)} onChange={() => handleJawabanPGK(oText)} className="w-4 h-4 mt-2.5" />
                    }
                    {jenisSoal === "Benar/Salah Kompleks" && (
                      <div className="flex gap-1 flex-shrink-0 mt-1.5">
                        <button onClick={() => handleJawabanBS(i, "Benar")} className={`text-xs px-2 py-1 font-bold`} style={{ background: jawabanBenar[i] === "Benar" ? "#16a34a" : "#e2e8f0", color: jawabanBenar[i] === "Benar" ? "#fff" : "#475569", borderRadius: "0" }}>B</button>
                        <button onClick={() => handleJawabanBS(i, "Salah")} className={`text-xs px-2 py-1 font-bold`} style={{ background: jawabanBenar[i] === "Salah" ? "#CC0000" : "#e2e8f0", color: jawabanBenar[i] === "Salah" ? "#fff" : "#475569", borderRadius: "0" }}>S</button>
                      </div>
                    )}
                    {opsi.length > 2 && 
                      <button onClick={() => handleRemoveOpsi(i)} className="text-red-400 hover:text-red-600 text-xl mt-1.5">×</button>
                    }
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Jawaban referensi untuk esai */}
        {jenisSoal === "Uraian/Esai" && (
          <Field label="Kunci Jawaban Referensi (opsional)" hint="Membantu guru saat mengoreksi. Tidak ditampilkan ke siswa.">
            <textarea 
              value={jawabanReferensi} 
              onChange={e => setJawabanReferensi(e.target.value)} 
              rows={3} 
              placeholder="Tuliskan jawaban ideal/kata kunci sebagai referensi koreksi..." 
              className={inp + " resize-none"} 
            />
          </Field>
        )}
        
        <button onClick={handleSubmit} disabled={loading} className={btn("blue") + " w-full py-3 text-base"}>
          {loading ? "Menyimpan..." : "💾 Simpan Soal ke Spreadsheet"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// REKAP HASIL UJIAN (dengan koreksi esai & bobot fleksibel)
// ============================================================
const mapelKodeMap = {
  "Bahasa Indonesia":"BINDO","Pendidikan Pancasila":"PPKN","IPAS":"IPAS",
  "Matematika":"MTK","Seni Rupa":"SENRUPA","Bahasa Madura":"BMADURA",
  "Pendidikan Agama Islam":"PAI","PJOK":"PJOK",
};
function getMapelKode(mapel) { return mapelKodeMap[mapel] || mapel.replace(/\s+/g,"").substring(0,8).toUpperCase(); }

// ================================================================
// TAB VIEW SOAL — pratinjau + edit soal guru
// ================================================================
function TabViewSoal({ scriptUrl, addToast, mapelList, asesmenList, ns="" }) {
  const [filterMapel, setFilterMapel] = useState(mapelList[0] || "");
  const [filterAsesmen, setFilterAsesmen] = useState(asesmenList[0] || "");
  const [soalList, setSoalList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandId, setExpandId] = useState(null);
  const [hapusId, setHapusId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // --- State edit soal ---
  const [editId, setEditId] = useState(null);       // id soal yang sedang diedit
  const [editData, setEditData] = useState(null);   // salinan data soal untuk diedit
  const [saving, setSaving] = useState(false);

  const badgeJenis = {
    "Pilihan Ganda":         { bg: "#eff6ff", color: "#003082", border: "#93c5fd" },
    "Pilihan Ganda Kompleks":{ bg: "#f5f3ff", color: "#7c3aed", border: "#c4b5fd" },
    "Benar/Salah Kompleks":  { bg: "#fff7ed", color: "#b45309", border: "#fcd34d" },
    "Uraian/Esai":           { bg: "#f0fdf4", color: "#15803d", border: "#86efac" },
  };

  const parseArr = (raw) => { try { return JSON.parse(raw || "[]"); } catch { return []; } };

  // ---- Fetch ----
  const fetchSoal = async () => {
    setLoading(true); setSoalList([]);
    try {
      const d = await FS.getSoalGuru({ mapel:filterMapel, asesmen:filterAsesmen }, ns);
      if (d.status === "success") setSoalList(d.soal || []);
      else addToast(d.message || "Gagal memuat soal", "error");
    } catch { addToast("Gagal terhubung ke server", "error"); }
    finally { setLoading(false); }
  };

  // ---- Hapus ----
  const handleHapusSoal = async (id) => {
    setDeleting(true);
    try {
      const d = await FS.hapusSoal({ id, mapel:filterMapel, asesmen:filterAsesmen }, ns);
      if (d.status === "success") {
        FS.updateSoalCounter(-1, ns);
        addToast("✅ Soal berhasil dihapus", "success");
        setSoalList(prev => prev.filter(s => s.id !== id));
        setHapusId(null);
        if (expandId === id) setExpandId(null);
      } else addToast(d.message || "Gagal menghapus soal", "error");
    } catch { addToast("Gagal terhubung", "error"); }
    finally { setDeleting(false); }
  };

  // ---- Buka modal edit ----
  const openEdit = (s) => {
    setEditId(s.id);
    setEditData({
      soal: s.soal || "",
      gambar: s.gambar || "",
      jenisSoal: s.jenisSoal || "Pilihan Ganda",
      point: s.point ?? 10,
      opsi: parseArr(s.opsi),
      jawabanBenar: parseArr(s.jawabanBenar),
      jawabanReferensi: s.jawabanReferensi || "",
    });
    setExpandId(null);
  };

  const closeEdit = () => { setEditId(null); setEditData(null); };

  // Helper update editData
  const setED = (patch) => setEditData(prev => ({ ...prev, ...patch }));

  const handleOpsiChange = (i, v) => {
    const a = [...editData.opsi]; a[i] = makeOpsiObj(v, getOpsiImg(a[i])); setED({ opsi: a });
  };
  const handleOpsiImgChange = (i, img) => {
    const a = [...editData.opsi]; a[i] = makeOpsiObj(getOpsiText(a[i]), img); setED({ opsi: a });
  };
  const handleAddOpsi = () => setED({ opsi: [...editData.opsi, ""] });
  const handleRemoveOpsi = (i) => {
    const removed = getOpsiText(editData.opsi[i]);
    setED({
      opsi: editData.opsi.filter((_, idx) => idx !== i),
      jawabanBenar: editData.jawabanBenar.filter(j => j !== removed),
    });
  };
  const handleJawabanPG  = (v) => setED({ jawabanBenar: [v] });
  const handleJawabanPGK = (v) => setED({ jawabanBenar: editData.jawabanBenar.includes(v) ? editData.jawabanBenar.filter(x => x !== v) : [...editData.jawabanBenar, v] });
  const handleJawabanBS  = (idx, val) => {
    const arr = [...(editData.jawabanBenar.length === editData.opsi.length ? editData.jawabanBenar : editData.opsi.map(() => ""))];
    arr[idx] = val; setED({ jawabanBenar: arr });
  };
  const handleGantiJenis = (j) => {
    setED({
      jenisSoal: j,
      opsi: j === "Benar/Salah Kompleks" ? ["", "", ""] : j === "Uraian/Esai" ? [] : ["", "", "", ""],
      jawabanBenar: [],
      point: j === "Uraian/Esai" ? 0 : 10,
    });
  };

  // ---- Simpan edit ----
  const handleSaveEdit = async () => {
    if (!editData.soal.trim()) return addToast("Soal tidak boleh kosong!", "error");
    if (editData.jenisSoal !== "Uraian/Esai") {
      if (editData.opsi.filter(o => getOpsiText(o).trim()).length < 2) return addToast("Minimal 2 opsi!", "error");
      if (editData.jawabanBenar.length === 0) return addToast("Pilih jawaban benar!", "error");
    }
    setSaving(true);
    try {
      const payload = {
        id: editId,
        mapel: filterMapel,
        asesmen: filterAsesmen,
        soal: editData.soal,
        gambar: editData.gambar,
        jenisSoal: editData.jenisSoal,
        opsi: editData.jenisSoal === "Uraian/Esai" ? "[]" : JSON.stringify(editData.opsi.filter(o => getOpsiText(o).trim())),
        jawabanBenar: editData.jenisSoal === "Uraian/Esai" ? "[]" : JSON.stringify(editData.jawabanBenar),
        jawabanReferensi: editData.jenisSoal === "Uraian/Esai" ? editData.jawabanReferensi : "",
        point: editData.jenisSoal === "Uraian/Esai" ? 0 : Number(editData.point),
      };
      const d = await FS.editSoal(payload, ns);
      if (d.status === "success") {
        addToast("✅ Soal berhasil diperbarui!", "success");
        // Update soal di list lokal
        setSoalList(prev => prev.map(s => s.id === editId ? {
          ...s,
          soal: editData.soal,
          gambar: editData.gambar,
          jenisSoal: editData.jenisSoal,
          point: editData.point,
          opsi: payload.opsi,
          jawabanBenar: payload.jawabanBenar,
          jawabanReferensi: payload.jawabanReferensi,
        } : s));
        closeEdit();
      } else addToast(d.message || "Gagal menyimpan", "error");
    } catch { addToast("Gagal terhubung ke server", "error"); }
    finally { setSaving(false); }
  };

  // ---- Render opsi di mode VIEW ----
  const renderOpsiView = (s, opsiArr, jawabanArr) => {
    if (s.jenisSoal === "Pilihan Ganda" || s.jenisSoal === "Pilihan Ganda Kompleks") {
      return opsiArr.map((o, oi) => {
        const oText = getOpsiText(o);
        const oImg = getOpsiImg(o);
        const isCorrect = s.jenisSoal === "Pilihan Ganda" ? jawabanArr[0] === oText : jawabanArr.includes(oText);
        return (
          <div key={oi} className="flex items-start gap-2 px-3 py-2" style={{ background: isCorrect ? "#f0fdf4" : "#f8fafc", border: `1px solid ${isCorrect ? "#86efac" : "#e2e8f0"}`, borderRadius: "0" }}>
            <span className="w-6 h-6 flex items-center justify-center text-xs font-black flex-shrink-0" style={{ background: isCorrect ? "#16a34a" : "#003082", color: "#fff", borderRadius: "0" }}>{String.fromCharCode(65 + oi)}</span>
            <div className="flex-1">
              <span className="text-sm"><HtmlMathText html={oText} /></span>
              {oImg && <img src={oImg} alt="opsi" className="mt-1 max-h-20 object-contain rounded border border-slate-200" />}
            </div>
            {isCorrect && <span className="text-xs font-bold" style={{ color: "#16a34a" }}>✓ Benar</span>}
          </div>
        );
      });
    }
    if (s.jenisSoal === "Benar/Salah Kompleks") {
      return opsiArr.map((o, oi) => {
        const oText = getOpsiText(o);
        const oImg = getOpsiImg(o);
        return (
          <div key={oi} className="flex items-center gap-3 px-3 py-2" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "0" }}>
            <span className="text-xs font-bold text-slate-500 w-5">{oi + 1}.</span>
            <div className="flex-1">
              <span className="text-sm"><HtmlMathText html={oText} /></span>
              {oImg && <img src={oImg} alt="opsi" className="mt-1 max-h-16 object-contain rounded border border-slate-200" />}
            </div>
            <span className="text-xs font-black px-2 py-1" style={{ background: jawabanArr[oi] === "Benar" ? "#16a34a" : jawabanArr[oi] === "Salah" ? "#CC0000" : "#e2e8f0", color: jawabanArr[oi] ? "#fff" : "#94a3b8", borderRadius: "0" }}>
              {jawabanArr[oi] || "—"}
            </span>
          </div>
        );
      });
    }
    return null;
  };

  // ---- Render opsi di mode EDIT ----
  const renderOpsiEdit = () => {
    if (!editData) return null;
    const { jenisSoal, opsi, jawabanBenar } = editData;
    if (jenisSoal === "Uraian/Esai") return null;
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#003082" }}>Opsi Jawaban</p>
          <button onClick={handleAddOpsi} className="text-xs px-3 py-1 font-medium" style={{ background: "#eff6ff", color: "#003082", borderRadius: "0", border: "1px solid #93c5fd" }}>+ Tambah Opsi</button>
        </div>
        <div className="space-y-2">
          {opsi.map((o, i) => {
            const oText = getOpsiText(o);
            const oImg = getOpsiImg(o);
            return (
              <div key={i} className="flex items-start gap-2">
                <span className="w-7 h-7 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-2" style={{ background: "#003082", color: "#fff", borderRadius: "0" }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <div className="flex-1">
                  <textarea
                    value={oText}
                    onChange={e => handleOpsiChange(i, e.target.value)}
                    rows={2}
                    className="w-full border-2 border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
                    style={{ borderRadius: "0" }}
                    placeholder={`Opsi ${String.fromCharCode(65 + i)}`}
                  />
                  <OpsiImageInserter img={oImg} onImgChange={img => handleOpsiImgChange(i, img)} addToast={addToast} />
                </div>
                {jenisSoal === "Pilihan Ganda" && (
                  <input type="radio" name="edit_pg" checked={jawabanBenar[0] === oText && oText.trim() !== ""} onChange={() => handleJawabanPG(oText)} className="w-4 h-4 mt-3" title="Jawaban benar" />
                )}
                {jenisSoal === "Pilihan Ganda Kompleks" && (
                  <input type="checkbox" checked={jawabanBenar.includes(oText) && oText.trim() !== ""} onChange={() => handleJawabanPGK(oText)} className="w-4 h-4 mt-3" title="Jawaban benar" />
                )}
                {jenisSoal === "Benar/Salah Kompleks" && (
                  <div className="flex gap-1 flex-shrink-0 mt-2">
                    <button onClick={() => handleJawabanBS(i, "Benar")} className="text-xs px-2 py-1 font-bold" style={{ background: jawabanBenar[i] === "Benar" ? "#16a34a" : "#e2e8f0", color: jawabanBenar[i] === "Benar" ? "#fff" : "#475569", borderRadius: "0" }}>B</button>
                    <button onClick={() => handleJawabanBS(i, "Salah")} className="text-xs px-2 py-1 font-bold" style={{ background: jawabanBenar[i] === "Salah" ? "#CC0000" : "#e2e8f0", color: jawabanBenar[i] === "Salah" ? "#fff" : "#475569", borderRadius: "0" }}>S</button>
                  </div>
                )}
                {opsi.length > 2 && (
                  <button onClick={() => handleRemoveOpsi(i)} className="text-red-400 hover:text-red-600 text-xl mt-1.5 flex-shrink-0">×</button>
                )}
              </div>
            );
          })}
        </div>
        {jenisSoal === "Pilihan Ganda" && <p className="text-xs text-slate-400 mt-1">🔘 Pilih radio = jawaban benar</p>}
        {jenisSoal === "Pilihan Ganda Kompleks" && <p className="text-xs text-slate-400 mt-1">☑️ Centang semua jawaban benar</p>}
        {jenisSoal === "Benar/Salah Kompleks" && <p className="text-xs text-slate-400 mt-1">Klik B/S untuk menentukan jawaban tiap pernyataan</p>}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black uppercase tracking-wide" style={{ color: "#003082" }}>Lihat & Edit Soal</h2>
        <p className="text-sm text-slate-500">Pratinjau, edit, dan hapus soal — HTML & rumus ditampilkan sempurna</p>
      </div>

      {/* Filter */}
      <div className="bg-white p-4 flex flex-wrap gap-3 items-end" style={{ border: "1px solid #e2e8f0", borderLeft: "4px solid #003082", borderRadius: "0" }}>
        <div>
          <label className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "#003082" }}>Mata Pelajaran</label>
          <select value={filterMapel} onChange={e => setFilterMapel(e.target.value)} className={inp + " w-48"}>
            {mapelList.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "#003082" }}>Asesmen</label>
          <select value={filterAsesmen} onChange={e => setFilterAsesmen(e.target.value)} className={inp + " w-48"}>
            {asesmenList.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <button onClick={fetchSoal} disabled={loading} className={btn("blue") + " disabled:opacity-50"}>
          {loading ? "⏳ Memuat..." : "🔍 Tampilkan Soal"}
        </button>
      </div>

      {/* Info count */}
      {soalList.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-bold" style={{ color: "#003082" }}>{soalList.length} soal ditemukan</span>
          {["Pilihan Ganda","Pilihan Ganda Kompleks","Benar/Salah Kompleks","Uraian/Esai"].map(j => {
            const c = soalList.filter(s => s.jenisSoal === j).length;
            if (!c) return null;
            const bj = badgeJenis[j] || {};
            return <span key={j} className="text-xs font-bold px-2 py-0.5" style={{ background: bj.bg, color: bj.color, border: `1px solid ${bj.border}`, borderRadius: "0" }}>{j}: {c}</span>;
          })}
        </div>
      )}

      {/* Daftar soal */}
      {loading && <div className="text-center py-10 text-slate-400">⏳ Memuat soal...</div>}
      {!loading && soalList.length === 0 && (
        <div className="text-center py-14 text-slate-400">
          <p className="text-3xl mb-2">📋</p>
          <p>Pilih mapel &amp; asesmen lalu klik <strong>Tampilkan Soal</strong>.</p>
        </div>
      )}

      {!loading && soalList.length > 0 && (
        <div className="space-y-3">
          {soalList.map((s, i) => {
            const opsiArr    = parseArr(s.opsi);
            const jawabanArr = parseArr(s.jawabanBenar);
            const bj = badgeJenis[s.jenisSoal] || badgeJenis["Pilihan Ganda"];
            const isExpand   = expandId === s.id;

            return (
              <div key={s.id} className="bg-white" style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${bj.color}`, borderRadius: "0" }}>

                {/* ── Header kartu ── */}
                <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                    <span className="font-black text-slate-700 text-sm flex-shrink-0">#{i + 1}</span>
                    <span className="text-xs font-bold px-2 py-0.5 flex-shrink-0" style={{ background: bj.bg, color: bj.color, border: `1px solid ${bj.border}`, borderRadius: "0" }}>{s.jenisSoal}</span>
                    {s.jenisSoal !== "Uraian/Esai" && (
                      <span className="text-xs px-2 py-0.5 font-bold flex-shrink-0" style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: "0" }}>⭐ {s.point} poin</span>
                    )}
                    {s.gambar && (
                      <span className="text-xs px-2 py-0.5 font-medium flex-shrink-0" style={{ background: "#fff7ed", color: "#b45309", border: "1px solid #fcd34d", borderRadius: "0" }}>🖼 Gambar</span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => { openEdit(s); }}
                      className="text-xs font-bold px-2 py-1"
                      style={{ background: "#fffbeb", color: "#b45309", borderRadius: "0", border: "1px solid #fcd34d" }}
                    >✏️ Edit</button>
                    <button
                      onClick={() => setExpandId(isExpand ? null : s.id)}
                      className="text-xs font-bold px-2 py-1"
                      style={{ background: isExpand ? "#003082" : "#eff6ff", color: isExpand ? "#fff" : "#003082", borderRadius: "0", border: "1px solid #93c5fd" }}
                    >{isExpand ? "▲ Tutup" : "▼ Detail"}</button>
                    <button
                      onClick={() => setHapusId(s.id)}
                      className="text-xs font-bold px-2 py-1"
                      style={{ background: "#fef2f2", color: "#CC0000", borderRadius: "0", border: "1px solid #fca5a5" }}
                    >🗑</button>
                  </div>
                </div>

                {/* ── Preview singkat soal (selalu tampil, render HTML+KaTeX) ── */}
                <div className="px-4 py-3 text-sm text-slate-800 leading-relaxed">
                  <HtmlMathText html={s.soal} />
                </div>

                {/* ── Detail expand ── */}
                {isExpand && (
                  <div className="px-4 pb-5 space-y-4" style={{ borderTop: "2px dashed #e2e8f0", paddingTop: "14px" }}>

                    {/* Gambar */}
                    {s.gambar && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "#003082" }}>🖼 Gambar Soal</p>
                        <GambarSoal url={s.gambar} />
                      </div>
                    )}

                    {/* Pilihan jawaban */}
                    {opsiArr.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "#003082" }}>Pilihan Jawaban</p>
                        <div className="space-y-1.5">
                          {renderOpsiView(s, opsiArr, jawabanArr)}
                        </div>
                      </div>
                    )}

                    {/* Referensi esai */}
                    {s.jenisSoal === "Uraian/Esai" && s.jawabanReferensi && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "#003082" }}>📝 Kunci Referensi Guru</p>
                        <div className="text-sm text-slate-700 p-3" style={{ background: "#fff7ed", border: "1px solid #fcd34d", borderRadius: "0" }}>
                          <HtmlMathText html={s.jawabanReferensi} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================================
          MODAL EDIT SOAL
      ============================================================ */}
      {editId && editData && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-3 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div className="bg-white w-full max-w-2xl shadow-2xl my-4" style={{ border: "2px solid #003082", borderRadius: "0" }}>

            {/* Header modal */}
            <div className="flex items-center justify-between px-5 py-4" style={{ background: "#003082" }}>
              <div>
                <h3 className="text-white font-black uppercase tracking-wide">✏️ Edit Soal</h3>
                <p className="text-blue-200 text-xs mt-0.5">#{soalList.findIndex(s => s.id === editId) + 1} — {filterMapel} / {filterAsesmen}</p>
              </div>
              <button onClick={closeEdit} className="text-white text-xl font-bold hover:opacity-70">✕</button>
            </div>

            <div className="p-5 space-y-5">

              {/* Jenis soal & point */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "#003082" }}>Jenis Soal</label>
                  <select value={editData.jenisSoal} onChange={e => handleGantiJenis(e.target.value)} className={inp}>
                    {JENIS_SOAL_LENGKAP.map(j => <option key={j}>{j}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "#003082" }}>Point / Nilai</label>
                  <input
                    type="number"
                    value={editData.point}
                    onChange={e => setED({ point: Number(e.target.value) })}
                    min={editData.jenisSoal === "Uraian/Esai" ? 0 : 1}
                    disabled={editData.jenisSoal === "Uraian/Esai"}
                    className={inp}
                    style={{ background: editData.jenisSoal === "Uraian/Esai" ? "#f8fafc" : undefined }}
                  />
                </div>
              </div>

              {/* Pertanyaan — RichTextEditor */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "#003082" }}>Pertanyaan</label>
                <RichTextEditor
                  value={editData.soal}
                  onChange={v => setED({ soal: v })}
                  placeholder="Tulis soal di sini..."
                />
                {/* Preview render HTML+KaTeX */}
                {editData.soal && (
                  <div className="mt-2 p-3 text-sm text-slate-800 leading-relaxed" style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "0" }}>
                    <p className="text-xs font-bold text-green-700 mb-1">👁 Preview (tampilan siswa):</p>
                    <HtmlMathText html={editData.soal} />
                  </div>
                )}
              </div>

              {/* Gambar */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "#003082" }}>Gambar (opsional)</label>
                <ImageInserter gambar={editData.gambar} setGambar={v => setED({ gambar: v })} addToast={addToast} />
              </div>

              {/* Opsi jawaban */}
              {renderOpsiEdit()}

              {/* Referensi esai */}
              {editData.jenisSoal === "Uraian/Esai" && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "#003082" }}>Kunci Referensi (opsional)</label>
                  <textarea
                    value={editData.jawabanReferensi}
                    onChange={e => setED({ jawabanReferensi: e.target.value })}
                    rows={3}
                    className={inp + " resize-none"}
                    placeholder="Tuliskan jawaban ideal / kata kunci sebagai referensi koreksi..."
                  />
                </div>
              )}

              {/* Tombol aksi */}
              <div className="flex gap-3 pt-2" style={{ borderTop: "1px solid #e2e8f0" }}>
                <button onClick={closeEdit} className={btn("slate") + " flex-1"}>Batal</button>
                <button onClick={handleSaveEdit} disabled={saving} className={btn("blue") + " flex-1"}>
                  {saving ? "⏳ Menyimpan..." : "💾 Simpan Perubahan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus soal */}
      {hapusId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm p-6 shadow-2xl" style={{ border: "2px solid #CC0000", borderRadius: "0" }}>
            <p className="font-black text-lg mb-2" style={{ color: "#CC0000" }}>🗑 Hapus Soal?</p>
            <p className="text-sm text-slate-600 mb-5">Soal ini akan dihapus permanen dari spreadsheet dan tidak bisa dikembalikan.</p>
            <div className="flex gap-3">
              <button onClick={() => setHapusId(null)} className={btn("slate") + " flex-1"}>Batal</button>
              <button onClick={() => handleHapusSoal(hapusId)} disabled={deleting} className={btn("red") + " flex-1"}>{deleting ? "Menghapus..." : "Ya, Hapus"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabRekap({ scriptUrl, addToast, mapelList, asesmenList, ns="", settings={} }) {
  mapelList = mapelList || DEFAULT_MAPEL;
  asesmenList = asesmenList || DEFAULT_ASESMEN;
  const [hasil, setHasil] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterMapel, setFilterMapel] = useState("Semua");
  const [filterAsesmen, setFilterAsesmen] = useState("Semua");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [modalKoreksi, setModalKoreksi] = useState(null);
  const [skorPerSoal, setSkorPerSoal] = useState({});
  const [savingKoreksi, setSavingKoreksi] = useState(false);
  const [bobotObj, setBobotObj] = useState(80);
  const [bobotEsai, setBobotEsai] = useState(20);
  const [bobotLoading, setBobotLoading] = useState(false);
  const [bobotSaving, setBobotSaving] = useState(false);
  const [konfirmHapus, setKonfirmHapus] = useState(null);
  const [deletingHasil, setDeletingHasil] = useState(false);

  const handleHapusHasil = async () => {
    if (!konfirmHapus) return;
    setDeletingHasil(true);
    try {
      const d = await FS.hapusHasil({ nisn:konfirmHapus.nisn, mapel:konfirmHapus.mapel, asesmen:konfirmHapus.asesmen, waktu:konfirmHapus.waktu }, ns);
      if (d.status === "success") {
        addToast("✅ Data hasil berhasil dihapus", "success");
        setHasil(prev => prev.filter(h => !(h.nisn === konfirmHapus.nisn && h.mapel === konfirmHapus.mapel && h.asesmen === konfirmHapus.asesmen && h.waktu === konfirmHapus.waktu)));
        setKonfirmHapus(null);
      } else addToast(d.message || "Gagal menghapus", "error");
    } catch { addToast("Gagal terhubung", "error"); }
    finally { setDeletingHasil(false); }
  };

  const loadBobot = async () => {
    setBobotLoading(true);
    try {
      const data = await FS.getBobotNilai(ns);
      if (data.status === "success") {
        setBobotObj(Number(data.data.bobot_objektif) || 80);
        setBobotEsai(Number(data.data.bobot_esai) || 20);
      }
    } catch {} finally { setBobotLoading(false); }
  };

  const saveBobot = async () => {
    setBobotSaving(true);
    try {
      const d = await FS.simpanBobotNilai({ bobot_objektif: bobotObj, bobot_esai: bobotEsai }, ns);
      if (d.status === "success") addToast("Bobot berhasil disimpan!", "success");
      else addToast("Gagal menyimpan bobot", "error");
    } catch { addToast("Gagal terhubung ke server", "error"); }
    setBobotSaving(false);
  };

  useEffect(() => { loadBobot(); }, []);

  const fetchHasil = async (targetMapel = "Semua") => {
    setLoading(true);
    try {
      if (targetMapel === "Semua") {
        const d = await FS.getHasil(ns);
        setHasil(d.status === "success" ? (d.data || []) : []);
      } else {
        const d = await FS.getHasilPerMapel({ mapel: targetMapel }, ns);
        setHasil(d.status === "success" ? (d.data || []) : []);
      }
    } catch { setHasil([]); } finally { setLoading(false); }
  };
  useEffect(() => { fetchHasil(); }, []);

  const handleFilterMapel = (m) => { setFilterMapel(m); fetchHasil(m); };

  // Filter + sort A-Z berdasarkan nama
  const filtered = hasil
    .filter(h => {
      if (filterAsesmen !== "Semua" && h.asesmen !== filterAsesmen) return false;
      if (search && !h.nama?.toLowerCase().includes(search.toLowerCase()) && !h.nisn?.includes(search)) return false;
      return true;
    })
    .sort((a, b) => (a.nama || "").localeCompare(b.nama || "", "id", { sensitivity: "base" }));

  const hitungNilaiAkhir = (h) => {
    const obj = Number(h.skorObjektif || 0);
    const esai = (h.skorEsai !== undefined && h.skorEsai !== "") ? Number(h.skorEsai) : null;
    const adaEsai = h.adaEsai === "TRUE" || h.adaEsai === true || (h.jawabanEsai && h.jawabanEsai !== "" && h.jawabanEsai !== "[]");
    if (!adaEsai) return obj;
    if (esai !== null) return Math.round(obj * (bobotObj/100) + esai * (bobotEsai/100));
    return obj;
  };

  const handleExportXLSX = async () => {
    if (filtered.length === 0) return addToast("Tidak ada data untuk diekspor.", "warning");
    setExporting(true);
    try {
      if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const wb = window.XLSX.utils.book_new();
      const mapelGroups = {};
      filtered.forEach(h => { const key = h.mapel || "Lainnya"; if (!mapelGroups[key]) mapelGroups[key] = []; mapelGroups[key].push(h); });
      Object.entries(mapelGroups).forEach(([mapelNama, rows]) => {
        const wsData = [["No","Waktu","NISN","Nama","Kelas","Asesmen","Skor Objektif","Skor Esai","Nilai Akhir","Keterangan"],
          ...rows.map((h, i) => { const nilaiAkhir = hitungNilaiAkhir(h); const ket = getKriteria(nilaiAkhir); return [i+1, h.waktu||"", h.nisn||"", h.nama||"", h.noAbsen||"", h.asesmen||"", Number(h.skorObjektif||0), h.skorEsai !== undefined && h.skorEsai !== "" ? Number(h.skorEsai) : "-", nilaiAkhir, ket]; }),
          [], ["","","","","","Rata-rata","","", Math.round(rows.reduce((s, h) => s + hitungNilaiAkhir(h), 0) / rows.length)],
          ["","","","","","Nilai Tertinggi","","", Math.max(...rows.map(h => hitungNilaiAkhir(h)))],
          ["","","","","","Nilai Terendah","","", Math.min(...rows.map(h => hitungNilaiAkhir(h)))],
          ["","","","","","Jumlah Mahir/Cakap","","", rows.filter(h => hitungNilaiAkhir(h) >= 66).length],
        ];
        const ws = window.XLSX.utils.aoa_to_sheet(wsData);
        ws["!cols"] = [{wch:5},{wch:18},{wch:14},{wch:25},{wch:10},{wch:16},{wch:14},{wch:10},{wch:12},{wch:14}];
        const sheetName = getMapelKode(mapelNama).substring(0,31);
        window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
      const wsGabungan = window.XLSX.utils.aoa_to_sheet([["No","Waktu","NISN","Nama","Kelas","Mapel","Asesmen","Skor Objektif","Skor Esai","Nilai Akhir","Keterangan"],
        ...filtered.map((h, i) => { const nilaiAkhir = hitungNilaiAkhir(h); const ket = getKriteria(nilaiAkhir); return [i+1, h.waktu||"", h.nisn||"", h.nama||"", h.noAbsen||"", h.mapel||"", h.asesmen||"", Number(h.skorObjektif||0), h.skorEsai !== undefined && h.skorEsai !== "" ? Number(h.skorEsai) : "-", nilaiAkhir, ket]; })]);
      wsGabungan["!cols"] = [{wch:5},{wch:18},{wch:14},{wch:25},{wch:10},{wch:20},{wch:16},{wch:14},{wch:10},{wch:12},{wch:14}];
      window.XLSX.utils.book_append_sheet(wb, wsGabungan, "GABUNGAN");
      const tgl = new Date().toISOString().slice(0,10);
      window.XLSX.writeFile(wb, `Rekap_Hasil_Ujian_${tgl}.xlsx`);
      addToast(`✅ Export berhasil! ${filtered.length} data diekspor ke XLSX.`, "success");
    } catch (err) { addToast("Gagal export: " + err.message, "error"); } finally { setExporting(false); }
  };

  const handleSimpanKoreksi = async () => {
    if (!modalKoreksi) return;
    setSavingKoreksi(true);
    try {
      // Skor guru: 1-10, konversi ke 0-100 untuk perhitungan nilai akhir
      const nilaiPer100 = Object.fromEntries(
        Object.entries(skorPerSoal).map(([k, v]) => [k, Math.round((Number(v) || 0) * 10)])
      );
      const totalEsai = Object.values(nilaiPer100).reduce((a,b) => a + b, 0);
      const jumlahEsai = Object.keys(nilaiPer100).length;
      const rerataSkorEsai = jumlahEsai > 0 ? Math.round(totalEsai / jumlahEsai) : 0;
      const d = await FS.simpanKoreksiEsai({
        nisn:modalKoreksi.nisn, mapel:modalKoreksi.mapel,
        asesmen:modalKoreksi.asesmen, waktu:modalKoreksi.waktu,
        skorEsai:rerataSkorEsai,
        detailSkorEsai:JSON.stringify(skorPerSoal) // simpan skor asli 1-10
      }, ns);
      if (d.status==="success") { addToast("Koreksi berhasil disimpan!", "success"); setModalKoreksi(null); setSkorPerSoal({}); fetchHasil(filterMapel); }
      else addToast(d.message||"Gagal","error");
    } catch { addToast("Gagal terhubung","error"); } finally { setSavingKoreksi(false); }
  };

  const asesmenTersedia = ["Semua", ...new Set(hasil.map(h=>h.asesmen).filter(Boolean))];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black uppercase tracking-wide" style={{ color: "#003082" }}>Rekap Hasil Ujian</h2>
          <p className="text-sm text-slate-500">{filtered.length} data ditampilkan</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => fetchHasil(filterMapel)} className={btn("slate")}>🔄 Refresh</button>
          <button onClick={handleExportXLSX} disabled={exporting || filtered.length===0} className={btn("green") + " disabled:opacity-50"}>{exporting ? "Mengekspor..." : "📥 Export XLSX"}</button>
        </div>
      </div>

      {/* Bobot Settings */}
      <div className="bg-white p-4 flex flex-wrap items-end gap-4" style={{ border: "1px solid #e2e8f0", borderLeft: "4px solid #d97706", borderRadius: "0" }}>
        <div className="flex-1 min-w-[120px]">
          <label className="text-xs font-semibold text-slate-600 block mb-1">Bobot Nilai Objektif (%)</label>
          <input type="number" min={0} max={100} value={bobotObj} onChange={e => setBobotObj(Math.min(100, Math.max(0, Number(e.target.value))))} className={inp + " w-28"} />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="text-xs font-semibold text-slate-600 block mb-1">Bobot Nilai Esai (%)</label>
          <input type="number" min={0} max={100} value={bobotEsai} onChange={e => setBobotEsai(Math.min(100, Math.max(0, Number(e.target.value))))} className={inp + " w-28"} />
        </div>
        <button onClick={saveBobot} disabled={bobotSaving} className={btn("blue") + " h-10"}>{bobotSaving ? "Menyimpan..." : "💾 Simpan Bobot"}</button>
        <p className="text-xs text-slate-400">* Bobot digunakan untuk menghitung nilai akhir jika ada esai. Total harus 100%.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Cari nama/NISN..." className={inp + " flex-1 min-w-48"} />
        <select value={filterMapel} onChange={e=>handleFilterMapel(e.target.value)} className={inp + " w-auto"}><option>Semua</option>{mapelList.map(m=><option key={m}>{m}</option>)}</select>
        <select value={filterAsesmen} onChange={e=>setFilterAsesmen(e.target.value)} className={inp + " w-auto"}>{asesmenTersedia.map(a=><option key={a}>{a}</option>)}</select>
      </div>
      {loading ? <div className="text-center py-10 text-slate-400"><div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-2" />Memuat data hasil ujian...</div>
      : filtered.length === 0 ? <div className="text-center py-10 text-slate-400">{hasil.length===0 ? "Belum ada hasil ujian." : "Tidak ada data yang cocok dengan filter."}</div>
      : <div className="overflow-x-auto" style={{ border: "1px solid #e2e8f0", borderRadius: "0" }}>
          <table className="w-full text-xs">
            <thead><tr style={{ background: "#003082" }} className="text-white"><th className="px-3 py-3 text-left">Waktu</th><th className="px-3 py-3 text-left">NISN</th><th className="px-3 py-3 text-left">Nama</th><th className="px-3 py-3 text-left">Mapel</th><th className="px-3 py-3 text-left">Asesmen</th><th className="px-3 py-3 text-center">Skor Obj.</th><th className="px-3 py-3 text-center">Skor Esai</th><th className="px-3 py-3 text-center">Nilai Akhir</th><th className="px-3 py-3 text-center">Keterangan</th><th className="px-3 py-3 text-center">Aksi</th></tr></thead>
            <tbody>{filtered.map((h, i) => {
              const nilaiAkhir = hitungNilaiAkhir(h);
              const sudahKoreksi = h.skorEsai !== undefined && h.skorEsai !== "";
              const adaEsai = h.adaEsai === "TRUE" || h.adaEsai === true || (h.jawabanEsai && h.jawabanEsai !== "" && h.jawabanEsai !== "[]");
              const keterangan = getKriteria(nilaiAkhir);
              const ketStyle = { ...getKriteriaStyle(nilaiAkhir), borderRadius: "0" };
              return (
                <tr key={i} style={{ background: i%2===0 ? "#fff" : "#f8fafc" }}>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{h.waktu}</td>
                  <td className="px-3 py-2.5 font-mono">{h.nisn}</td>
                  <td className="px-3 py-2.5 font-medium">{h.nama}</td>
                  <td className="px-3 py-2.5">{h.mapel}</td>
                  <td className="px-3 py-2.5">{h.asesmen}</td>
                  <td className="px-3 py-2.5 text-center font-bold" style={{ color: "#003082" }}>{h.skorObjektif ?? "-"}</td>
                  <td className="px-3 py-2.5 text-center">{!adaEsai ? <span className="text-slate-300">—</span> : sudahKoreksi ? <span className="font-bold text-green-600">{h.skorEsai}</span> : <span className="font-bold" style={{ color: "#b45309" }}>Belum</span>}</td>
                  <td className="px-3 py-2.5 text-center"><span className="font-black text-sm" style={{ color: nilaiAkhir>=86 ? "#15803d" : nilaiAkhir>=66 ? "#003082" : nilaiAkhir>=41 ? "#b45309" : "#CC0000" }}>{nilaiAkhir}</span></td>
                  <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 text-xs font-bold" style={ketStyle}>{keterangan}</span></td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      {/* Download PDF — selalu tersedia, fleksibel */}
                      <button
                        onClick={async () => { try { await unduhPDFGabungan({ h, namaGuru: settings.namaGuru||"", nipGuru: settings.nipGuru||"", kotaTTD: settings.kotaTTD||"", namaSekolah: settings.namaSekolah||"" }); } catch(e) { addToast("Gagal download PDF: "+e.message, "error"); } }}
                        className="text-xs font-bold px-2 py-1"
                        style={{ background:"#eff6ff", color:"#003082", borderRadius:"0", border:"1px solid #93c5fd" }}
                        title="Download PDF Hasil">
                        📥
                      </button>
                      {adaEsai && <button onClick={() => { setModalKoreksi(h); setSkorPerSoal({}); }} className="text-xs font-bold px-2 py-1" style={{ background: sudahKoreksi ? "#f0fdf4" : "#fff7ed", color: sudahKoreksi ? "#15803d" : "#b45309", borderRadius: "0", border: `1px solid ${sudahKoreksi ? "#86efac" : "#fcd34d"}` }}>{sudahKoreksi ? "✏️" : "📝"}</button>}
                      <button onClick={() => setKonfirmHapus(h)} className="text-xs font-bold px-2 py-1" style={{ background: "#fef2f2", color: "#CC0000", borderRadius: "0", border: "1px solid #fca5a5" }} title="Hapus data ini">🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      }
      {modalKoreksi && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e=>{ if(e.target===e.currentTarget) setModalKoreksi(null); }}>
          <div className="bg-white shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ border: "2px solid #003082", borderRadius: "0" }}>
            <div className="sticky top-0 bg-white px-6 py-4 flex items-center justify-between" style={{ borderBottom: "3px solid #CC0000" }}>
              <div>
                <h3 className="font-black uppercase tracking-wide" style={{ color: "#003082" }}>📝 Koreksi Esai</h3>
                <p className="text-xs text-slate-500">{modalKoreksi.nama} — {modalKoreksi.mapel} / {modalKoreksi.asesmen}</p>
              </div>
              <button onClick={() => setModalKoreksi(null)} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="p-4" style={{ background: "#fff7ed", border: "1px solid #fcd34d", borderLeft: "4px solid #d97706", borderRadius: "0" }}>
                <p className="text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: "#b45309" }}>Jawaban Esai Siswa</p>
                {(() => {
                  let jawabanEsaiList = [];
                  try { jawabanEsaiList = JSON.parse(modalKoreksi.jawabanEsai || "[]"); } catch(e) { jawabanEsaiList = []; }
                  if (jawabanEsaiList.length === 0) return <p className="text-xs" style={{ color: "#b45309" }}>Tidak ada jawaban esai.</p>;
                  return (
                    <div className="space-y-3">
                      {jawabanEsaiList.map((je, idx) => (
                        <div key={idx} className="bg-white p-3 space-y-2" style={{ border: "1px solid #fcd34d", borderRadius: "0" }}>
                          <div className="text-xs font-semibold text-slate-700 mb-1">
                            <span className="font-black" style={{ color:"#b45309" }}>Soal {idx+1}:</span>
                            <div
                              className="mt-1 prose prose-sm max-w-none text-slate-700"
                              style={{ lineHeight:"1.6" }}
                              dangerouslySetInnerHTML={{ __html: je.soal || "" }}
                            />
                          </div>
                          {je.referensi && (
                            <div className="text-xs text-slate-500 italic p-2" style={{ background:"#f8fafc", borderLeft:"3px solid #94a3b8", borderRadius:"0" }}>
                              <span className="font-bold not-italic">Kunci Jawaban:</span>
                              <div dangerouslySetInnerHTML={{ __html: je.referensi }} />
                            </div>
                          )}
                          <div className="text-sm text-slate-800 p-2 whitespace-pre-wrap" style={{ background: "#fff7ed", borderRadius: "0", minHeight:"40px" }}>{je.jawaban || <span className="text-slate-400 italic">(tidak dijawab)</span>}</div>
                          <div className="space-y-2 pt-1">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold uppercase tracking-wide" style={{ color:"#b45309" }}>Nilai (1–10):</label>
                              {skorPerSoal[idx] && (
                                <span className="text-xs font-bold px-2 py-0.5" style={{ background:"#003082", color:"#fff", borderRadius:"0" }}>
                                  = {Math.round(Number(skorPerSoal[idx]) * 10)} / 100
                                </span>
                              )}
                            </div>
                            {/* Tombol 1-10 */}
                            <div className="flex gap-1 flex-wrap">
                              {[1,2,3,4,5,6,7,8,9,10].map(n => {
                                const aktif = Number(skorPerSoal[idx]) === n;
                                const warna = n <= 4 ? "#CC0000" : n <= 6 ? "#d97706" : n <= 8 ? "#003082" : "#16a34a";
                                return (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setSkorPerSoal(p => ({ ...p, [idx]: n }))}
                                    className="w-9 h-9 font-black text-sm transition-all"
                                    style={{
                                      background: aktif ? warna : "#f8fafc",
                                      color: aktif ? "#fff" : warna,
                                      border: `2px solid ${warna}`,
                                      borderRadius: "0",
                                      transform: aktif ? "scale(1.15)" : "scale(1)",
                                    }}
                                  >{n}</button>
                                );
                              })}
                            </div>
                            {/* Panduan warna */}
                            <div className="flex gap-3 text-xs" style={{ color:"#94a3b8" }}>
                              <span><span style={{ color:"#CC0000" }}>■</span> 1–4 Kurang</span>
                              <span><span style={{ color:"#d97706" }}>■</span> 5–6 Cukup</span>
                              <span><span style={{ color:"#003082" }}>■</span> 7–8 Baik</span>
                              <span><span style={{ color:"#16a34a" }}>■</span> 9–10 Sempurna</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              {/* Ringkasan nilai esai */}
              {Object.keys(skorPerSoal).length > 0 && (() => {
                const nilaiPer100 = Object.values(skorPerSoal).map(v => Math.round(Number(v||0)*10));
                const rata = Math.round(nilaiPer100.reduce((a,b)=>a+b,0) / nilaiPer100.length);
                return (
                  <div className="p-3 flex items-center justify-between" style={{ background:"#f0fdf4", border:"1px solid #86efac", borderLeft:"4px solid #16a34a", borderRadius:"0" }}>
                    <div className="text-xs text-slate-600 space-y-0.5">
                      <p className="font-bold" style={{ color:"#15803d" }}>📊 Ringkasan Nilai Esai</p>
                      <p>Skor: {Object.values(skorPerSoal).join(" + ")} (skala 1–10)</p>
                      <p>Konversi: {nilaiPer100.join(" + ")} (skala 100) → rata-rata <strong>{rata}</strong></p>
                    </div>
                    <div className="text-3xl font-black" style={{ color:"#15803d" }}>{rata}</div>
                  </div>
                );
              })()}
              <div className="flex gap-3">
                <button onClick={()=>{setModalKoreksi(null);setSkorPerSoal({});}} className={btn("slate") + " flex-1"}>Batal</button>
                <button onClick={handleSimpanKoreksi} disabled={savingKoreksi || Object.keys(skorPerSoal).length === 0} className={btn("green") + " flex-1"}>{savingKoreksi ? "Menyimpan..." : "✅ Simpan Koreksi"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {konfirmHapus && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm p-6 shadow-2xl" style={{ border: "2px solid #CC0000", borderRadius: "0" }}>
            <p className="font-black text-lg mb-1" style={{ color: "#CC0000" }}>🗑 Hapus Data Hasil?</p>
            <p className="text-sm text-slate-600 mb-1">Data berikut akan dihapus permanen:</p>
            <div className="p-3 mb-4 text-sm" style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0" }}>
              <p className="font-bold text-slate-800">{konfirmHapus.nama} ({konfirmHapus.nisn})</p>
              <p className="text-slate-600">{konfirmHapus.mapel} — {konfirmHapus.asesmen}</p>
              <p className="text-slate-400 text-xs">{konfirmHapus.waktu}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setKonfirmHapus(null)} className={btn("slate") + " flex-1"}>Batal</button>
              <button onClick={handleHapusHasil} disabled={deletingHasil} className={btn("red") + " flex-1"}>{deletingHasil ? "Menghapus..." : "Ya, Hapus"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PENGATURAN UJIAN
// ============================================================
function TabPengaturan({ settings, onSaveSettings, addToast, ns="" }) {
  const [logoPreview, setLogoPreview]     = useState(settings.logoUrl || "");
  const [logoBase64, setLogoBase64]       = useState(settings.logoUrl || "");
  const [logoConverting, setLogoConverting] = useState(false);
  const [namaInput, setNamaInput]         = useState(settings.namaSekolah || "");
  const [namaGuruInput, setNamaGuruInput] = useState(settings.namaGuru || "");
  const [nipGuruInput, setNipGuruInput]   = useState(settings.nipGuru || "");
  const [kotaTTDInput, setKotaTTDInput]   = useState(settings.kotaTTD || "");
  const [fotoPreview, setFotoPreview]     = useState(settings.fotoGuru || "");
  const [fotoBase64, setFotoBase64]       = useState(settings.fotoGuru || "");
  const [durasiInput, setDurasiInput]     = useState(settings.durasiMenit || 60);
  const [saving, setSaving]               = useState(false);

  const jam = Math.floor(durasiInput / 60);
  const menit = Number(durasiInput) % 60;
  const durasiDisplay = jam > 0 ? `${jam} jam${menit > 0 ? " " + menit + " menit" : ""}` : `${menit} menit`;

  const getInitials = () => (namaGuruInput || settings.namaGuru || "G").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  // ── Konversi gambar ke WebP via canvas ──────────────────────────
  const toWebP = (file, maxSize = 256) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/webp", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });

  // ── Upload logo sekolah (konversi webp, max 512px) ──────────────
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return addToast("File harus berupa gambar!", "error");
    if (file.size > 5 * 1024 * 1024) return addToast("Ukuran file maks 5MB!", "error");
    setLogoConverting(true);
    try {
      const webp = await toWebP(file, 512);
      setLogoPreview(webp);
      setLogoBase64(webp);
      addToast("✅ Logo dikonversi ke WebP!", "success");
    } catch { addToast("Gagal memproses gambar.", "error"); }
    finally { setLogoConverting(false); e.target.value = ""; }
  };

  // ── Upload foto guru (konversi webp, max 256px) ─────────────────
  const handleFotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return addToast("File harus berupa gambar!", "error");
    if (file.size > 5 * 1024 * 1024) return addToast("Ukuran file maks 5MB!", "error");
    try {
      const webp = await toWebP(file, 256);
      setFotoPreview(webp);
      setFotoBase64(webp);
      addToast("✅ Foto guru dikonversi ke WebP!", "success");
    } catch { addToast("Gagal memproses foto.", "error"); }
    finally { e.target.value = ""; }
  };

  // ── Simpan ──────────────────────────────────────────────────────
  const handleSave = async () => {
    const durasi = Number(durasiInput);
    if (!durasi || durasi < 1 || durasi > 300) return addToast("Durasi harus 1–300 menit!", "error");
    const newSettings = {
      logoUrl      : logoBase64,
      namaSekolah  : namaInput,
      namaGuru     : namaGuruInput,
      nipGuru      : nipGuruInput,
      kotaTTD      : kotaTTDInput,
      durasiMenit  : durasi,
      fotoGuru     : fotoBase64,
    };
    onSaveSettings(newSettings);
    setSaving(true);
    try {
      const d = await FS.simpanPengaturanKelas(newSettings, ns);
      if (d.status === "success") addToast("✅ Pengaturan kelas disimpan ke Firestore!", "success");
      else addToast("Tersimpan lokal. Gagal sinkron Firestore.", "warning");
    } catch { addToast("Pengaturan disimpan lokal.", "info"); }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black uppercase tracking-wide" style={{ color: "#003082" }}>Pengaturan Ujian</h2>
        <p className="text-sm text-slate-500">Identitas sekolah, guru, dan durasi ujian</p>
      </div>

      <div className="bg-white p-6 space-y-6" style={{ border: "1px solid #e2e8f0", borderTop: "3px solid #003082", borderRadius: "0" }}>

        {/* ── Logo Sekolah ── */}
        <Field label="Logo Sekolah" hint="Upload gambar (JPG/PNG/WebP/SVG) — otomatis dikonversi ke WebP">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Preview */}
            <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 80, height: 80, background: "#f8fafc", border: "2px dashed #cbd5e1" }}>
              {logoPreview
                ? <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain p-1" />
                : <span className="text-2xl">🏫</span>
              }
            </div>
            {/* Upload zone */}
            <div className="flex-1 min-w-[200px]">
              <label className="flex flex-col items-center justify-center gap-1 cursor-pointer py-3 px-4 transition-colors"
                style={{ background: "#eff6ff", border: "2px dashed #93c5fd", borderRadius: "0" }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleLogoUpload({ target: { files: [f], value: "" } }); }}
              >
                {logoConverting
                  ? <span className="text-xs font-bold" style={{ color: "#003082" }}>⏳ Mengkonversi...</span>
                  : <>
                      <span className="text-2xl">📁</span>
                      <span className="text-xs font-bold" style={{ color: "#003082" }}>Klik atau drag & drop</span>
                      <span className="text-xs text-slate-400">JPG · PNG · WebP · SVG · max 5MB</span>
                    </>
                }
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </label>
              {logoPreview && (
                <button onClick={() => { setLogoPreview(""); setLogoBase64(""); }} className="mt-2 text-xs font-medium" style={{ color: "#CC0000" }}>✕ Hapus logo</button>
              )}
            </div>
          </div>
        </Field>

        {/* ── Nama Sekolah ── */}
        <Field label="Nama Sekolah">
          <input value={namaInput} onChange={e => setNamaInput(e.target.value)} placeholder="SD Negeri ..." className={inp} />
        </Field>

        {/* ── Nama & NIP Guru ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nama Guru" hint="Untuk kolom TTD di PDF">
            <input value={namaGuruInput} onChange={e => setNamaGuruInput(e.target.value)} placeholder="Nama lengkap guru" className={inp} />
          </Field>
          <Field label="NIP Guru">
            <input value={nipGuruInput} onChange={e => setNipGuruInput(e.target.value)} placeholder="198XXXXXXXX" className={inp + " font-mono"} />
          </Field>
        </div>

        {/* ── Foto Guru ── */}
        <Field label="Foto Guru" hint="Upload foto profil — otomatis dikonversi ke WebP 256×256px">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-shrink-0">
              {fotoPreview
                ? <img src={fotoPreview} alt="Foto Guru" className="w-20 h-20 rounded-full object-cover shadow-md" style={{ border: "3px solid #CC0000" }} />
                : <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md" style={{ background: "linear-gradient(135deg,#CC0000,#003082)" }}>{getInitials()}</div>
              }
            </div>
            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="flex items-center gap-2 cursor-pointer px-3 py-2 text-xs font-bold"
                style={{ background: "#fff7ed", border: "1px solid #fcd34d", color: "#b45309", borderRadius: "0", display: "inline-flex" }}>
                📷 Upload Foto
                <input type="file" accept="image/*" className="hidden" onChange={handleFotoUpload} />
              </label>
              {fotoPreview && (
                <button onClick={() => { setFotoPreview(""); setFotoBase64(""); }} className="block text-xs font-medium" style={{ color: "#CC0000" }}>✕ Hapus foto</button>
              )}
            </div>
          </div>
        </Field>

        {/* ── Kota TTD ── */}
        <Field label="Kota Penandatangan">
          <input value={kotaTTDInput} onChange={e => setKotaTTDInput(e.target.value)} placeholder="Sumenep" className={inp} />
        </Field>

        {/* ── Durasi ── */}
        <div className="p-5 space-y-3" style={{ background: "#fff7ed", border: "1px solid #fcd34d", borderLeft: "4px solid #d97706", borderRadius: "0" }}>
          <div className="flex items-center gap-2">
            <span className="text-xl">⏱️</span>
            <h4 className="font-bold text-sm" style={{ color: "#92400e" }}>Durasi Waktu Ujian</h4>
          </div>
          <div className="flex items-center gap-3">
            <input type="number" value={durasiInput} onChange={e => setDurasiInput(e.target.value)} min={1} max={300}
              className="w-24 border-2 px-3 py-3 text-center font-extrabold text-2xl focus:outline-none bg-white"
              style={{ borderColor: "#f59e0b", color: "#92400e", borderRadius: "0" }} />
            <div>
              <p className="text-sm font-bold" style={{ color: "#92400e" }}>menit</p>
              <p className="text-xs" style={{ color: "#b45309" }}>= {durasiDisplay}</p>
            </div>
          </div>
          <input type="range" min={10} max={180} step={5} value={durasiInput} onChange={e => setDurasiInput(Number(e.target.value))} className="w-full accent-amber-500" />
          <div className="flex flex-wrap gap-2">
            {[{l:"30 mnt",v:30},{l:"45 mnt",v:45},{l:"1 jam",v:60},{l:"1.5 jam",v:90},{l:"2 jam",v:120}].map(({l,v}) => (
              <button key={v} onClick={() => setDurasiInput(v)} className="text-xs px-3 py-2 font-bold"
                style={{ background: Number(durasiInput)===v ? "#d97706" : "#fff", color: Number(durasiInput)===v ? "#fff" : "#b45309", border: "1px solid #fcd34d", borderRadius: "0" }}>{l}</button>
            ))}
          </div>
        </div>

        {/* ── Simpan ── */}
        <button onClick={handleSave} disabled={saving} className={btn("blue") + " w-full py-3 text-base disabled:opacity-50"}>
          {saving ? "⏳ Menyimpan..." : "💾 Simpan Pengaturan"}
        </button>

        <div className="p-4 text-xs space-y-1" style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderLeft: "4px solid #003082", borderRadius: "0" }}>
          <p className="font-bold uppercase tracking-wide" style={{ color: "#003082" }}>🔥 Sinkron via Firestore</p>
          <p style={{ color: "#1e40af" }}>Pengaturan tersimpan di Firestore dan otomatis termuat di semua perangkat saat membuka halaman.</p>
          <p className="mt-1" style={{ color: "#b45309" }}>⚠️ Logo & foto guru disimpan sebagai base64 WebP — ukuran kecil & terkompresi otomatis.</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MODAL PILIH LOGIN — muncul saat logo diklik 5x
// ============================================================
function ModalPilihLogin({ onPilihGuru, onPilihAdmin, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="bg-white shadow-2xl w-full max-w-xs mx-4 overflow-hidden" style={{ border: "3px solid #003082", borderRadius: "0" }}>
        <div style={{ background: "linear-gradient(135deg,#003082,#001a4d)", padding: "20px 24px 16px" }}>
          <h2 className="text-base font-black text-white tracking-wide text-center" style={{ fontFamily:"'Georgia',serif" }}>AKSES PANEL</h2>
          <p className="text-blue-200 text-xs mt-1 uppercase tracking-widest text-center">Pilih mode login</p>
        </div>
        <div className="p-5 space-y-3">
          <button onClick={onPilihGuru} className="w-full text-white font-bold py-4 text-sm flex items-center gap-3 px-5" style={{ background:"#CC0000", borderRadius:"0" }}>
            <span className="text-2xl">🎓</span>
            <div className="text-left">
              <p className="font-black">Login sebagai Guru</p>
              <p className="text-xs opacity-80 font-normal">Kelola soal, siswa & hasil ujian</p>
            </div>
          </button>
          <button onClick={onPilihAdmin} className="w-full text-white font-bold py-4 text-sm flex items-center gap-3 px-5" style={{ background:"#d97706", borderRadius:"0" }}>
            <span className="text-2xl">⚙️</span>
            <div className="text-left">
              <p className="font-black">Login sebagai Admin</p>
              <p className="text-xs opacity-80 font-normal">Kelola kelas & password</p>
            </div>
          </button>
          <button onClick={onClose} className="w-full font-bold py-2 text-sm" style={{ background:"#f1f5f9", color:"#475569", borderRadius:"0" }}>✕ Batal</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ADMIN LOGIN
// ============================================================
function AdminLogin({ onLogin, onBack }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const getAdminPwd = () => { try { return localStorage.getItem("adminPwd") || ADMIN_PASSWORD; } catch { return ADMIN_PASSWORD; } };
  const handle = () => {
    if (pwd.trim() === getAdminPwd()) { onLogin(); setErr(""); }
    else setErr("Password admin salah!");
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(160deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%)" }}>
      <div className="bg-white shadow-2xl w-full max-w-sm text-center overflow-hidden" style={{ border:"3px solid #f59e0b", borderRadius:"0" }}>
        <div style={{ background:"linear-gradient(135deg,#f59e0b,#d97706)", padding:"24px 24px 20px" }}>
          <div className="text-4xl mb-2">⚙️</div>
          <h2 className="text-xl font-black text-white tracking-wide" style={{ fontFamily:"'Georgia',serif" }}>PANEL ADMIN</h2>
          <p className="text-yellow-100 text-xs mt-1 uppercase tracking-widest">Manajemen Kelas</p>
        </div>
        <div className="p-6">
          <p className="text-slate-600 text-sm mb-5 font-medium">Masukkan password administrator</p>
          <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} placeholder="Password admin..." className="w-full border-2 px-4 py-3 text-slate-800 focus:outline-none mb-3" style={{ borderColor:"#f59e0b", borderRadius:"0" }} />
          {err && <p className="text-red-600 text-sm mb-3 font-semibold">{err}</p>}
          <button onClick={handle} className="w-full text-white font-bold py-3 uppercase tracking-widest text-sm mb-3" style={{ background:"#d97706", borderRadius:"0" }}>Masuk sebagai Admin</button>
          <button onClick={onBack} className="w-full font-bold py-2 text-sm" style={{ background:"#f1f5f9", color:"#475569", borderRadius:"0" }}>← Kembali</button>
        </div>
        <div style={{ background:"#d97706", height:"6px" }} />
      </div>
    </div>
  );
}

// ============================================================
// ADMIN PANEL — Manajemen Kelas + Pengaturan
// ============================================================
function AdminPanel({ addToast, onLogout }) {
  const [kelasList, setKelasListState] = useState(() => loadKelasListCache());
  const [loadingKelas, setLoadingKelas] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ namaKelas:"", tingkat:"", password:"", isDefault:false });
  const [delConfirm, setDelConfirm] = useState(null);
  const [showPwd, setShowPwd] = useState({});
  const [tabAktif, setTabAktif] = useState("kelas");
  const [pwdLama, setPwdLama] = useState("");
  const [pwdBaru, setPwdBaru] = useState("");
  const [pwdKonfirm, setPwdKonfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const getAdminPwd = () => { try { return localStorage.getItem("adminPwd") || ADMIN_PASSWORD; } catch { return ADMIN_PASSWORD; } };
  const resetForm = () => { setForm({ namaKelas:"", tingkat:"", password:"", isDefault:false }); setEditId(null); setShowForm(false); };

  // Load kelas dari Firestore saat AdminPanel mount
  const fetchKelas = async () => {
    setLoadingKelas(true);
    try {
      await FS.ensureKelas6(); // pastikan kelas 6 ada di Firestore
      const res = await FS.getKelasList();
      if (res.status === "success") {
        setKelasListState(res.data);
        saveKelasListCache(res.data); // sync cache
      }
    } catch(e) { addToast("Gagal load kelas dari Firestore", "warning"); }
    finally { setLoadingKelas(false); }
  };
  useEffect(() => { fetchKelas(); }, []);

  const handleSimpan = async () => {
    if (!form.namaKelas.trim() && !form.isDefault) return addToast("Nama kelas harus diisi!", "error");
    if (!form.password.trim()) return addToast("Password kelas harus diisi!", "error");
    if (form.password.trim() === getAdminPwd()) return addToast("Password tidak boleh sama dengan password admin!", "error");
    const dupPwd = kelasList.find(k => k.password === form.password.trim() && k.id !== editId);
    if (dupPwd) return addToast(`Password sudah dipakai kelas lain (${dupPwd.namaKelas})!`, "error");
    if (!editId && kelasList.some(k => k.namaKelas.toLowerCase() === form.namaKelas.trim().toLowerCase())) return addToast("Nama kelas sudah ada!", "error");

    setSaving(true);
    try {
      if (editId) {
        const kelasTarget = kelasList.find(k => k.id === editId);
        const d = await FS.editKelas({ id:editId, namaKelas:form.namaKelas, tingkat:form.tingkat, password:form.password.trim(), isDefault:kelasTarget?.isDefault });
        if (d.status !== "success") return addToast(d.message || "Gagal menyimpan", "error");
        addToast("Kelas berhasil diperbarui! ✅", "success");
      } else {
        const d = await FS.tambahKelas({ namaKelas:form.namaKelas.trim(), tingkat:form.tingkat, password:form.password.trim() });
        if (d.status !== "success") return addToast(d.message || "Gagal menyimpan", "error");
        addToast("Kelas berhasil ditambahkan! ✅", "success");
      }
      await fetchKelas(); // reload dari Firestore
      resetForm();
    } catch(e) { addToast("Gagal: " + e.message, "error"); }
    finally { setSaving(false); }
  };

  const handleEdit = (k) => {
    setForm({ namaKelas:k.namaKelas, tingkat:k.tingkat||"", password:k.password||"", isDefault:k.isDefault||false });
    setEditId(k.id); setShowForm(true);
  };

  const handleHapus = async (id) => {
    if (kelasList.find(k=>k.id===id)?.isDefault) return addToast("Kelas 6 default tidak bisa dihapus!", "error");
    setSaving(true);
    try {
      const d = await FS.hapusKelas({ id });
      if (d.status === "success") { addToast("Kelas dihapus.", "success"); await fetchKelas(); }
      else addToast(d.message || "Gagal hapus", "error");
    } catch(e) { addToast("Gagal: " + e.message, "error"); }
    finally { setSaving(false); setDelConfirm(null); }
  };

  const handleGantiPwd = () => {
    if (pwdLama !== getAdminPwd()) return addToast("Password lama salah!", "error");
    if (pwdBaru.length < 6) return addToast("Password baru minimal 6 karakter!", "error");
    if (pwdBaru !== pwdKonfirm) return addToast("Konfirmasi tidak cocok!", "error");
    try { localStorage.setItem("adminPwd", pwdBaru); } catch {}
    addToast("Password admin berhasil diubah! ✅", "success");
    setPwdLama(""); setPwdBaru(""); setPwdKonfirm("");
  };

  const inpAdmin = "w-full border-2 px-3 py-2 text-sm focus:outline-none rounded-none";
  const inpLight = inpAdmin + " bg-white border-slate-300 text-slate-800 focus:border-yellow-500";
  const inpDark = inpAdmin + " border-white/20 text-white focus:border-yellow-400";
  const inpDarkBg = { background:"rgba(255,255,255,0.08)", color:"white" };

  return (
    <div className="min-h-screen" style={{ background:"linear-gradient(160deg,#1a1a2e 0%,#16213e 100%)" }}>
      <header className="text-white px-5 py-4 flex items-center justify-between sticky top-0 z-20" style={{ background:"rgba(0,0,0,0.4)", borderBottom:"1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg" style={{ background:"#f59e0b" }}>⚙️</div>
          <div>
            <p className="font-black text-sm tracking-wide">Panel Admin</p>
            <p className="text-xs opacity-60">Manajemen Kelas</p>
          </div>
        </div>
        <button onClick={onLogout} className="text-xs font-bold px-3 py-1.5" style={{ background:"rgba(255,255,255,0.1)", borderRadius:"0", color:"#fca5a5", border:"1px solid rgba(255,255,255,0.2)" }}>🚪 Keluar</button>
      </header>

      <div className="flex" style={{ borderBottom:"1px solid rgba(255,255,255,0.1)" }}>
        {[{ id:"kelas", label:"🏫 Manajemen Kelas" }, { id:"settings", label:"🔐 Pengaturan Admin" }].map(t => (
          <button key={t.id} onClick={()=>setTabAktif(t.id)} className="px-5 py-3 text-sm font-bold transition-colors"
            style={{ color:tabAktif===t.id?"#f59e0b":"rgba(255,255,255,0.5)", borderBottom:tabAktif===t.id?"2px solid #f59e0b":"2px solid transparent", borderRadius:"0", background:"transparent" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 md:p-8 max-w-3xl mx-auto">

        {tabAktif === "kelas" && (
          <div className="space-y-5">
            <div className="p-4 flex items-start gap-3" style={{ background:"rgba(22,163,74,0.15)", border:"1px solid rgba(22,163,74,0.4)", borderLeft:"4px solid #16a34a", borderRadius:"0" }}>
              <span className="text-2xl">✅</span>
              <div>
                <p className="font-bold text-white text-sm">Kelas 6 — Default (Data Lama Terlindungi)</p>
                <p className="text-xs mt-0.5" style={{ color:"rgba(255,255,255,0.6)" }}>Password: <code className="bg-black/30 px-1 rounded text-green-300">guru123</code> — data soal & siswa Kelas 6 di Firestore tetap aman dan tidak akan berubah.</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Daftar Kelas</h2>
                <p className="text-xs" style={{ color:"rgba(255,255,255,0.5)" }}>{kelasList.length} kelas terdaftar</p>
              </div>
              <button onClick={()=>{ resetForm(); setShowForm(v=>!v); }} className="font-bold py-2 px-4 text-sm text-white"
                style={{ background:showForm&&!editId?"#475569":"#d97706", borderRadius:"0" }}>
                {showForm&&!editId?"✕ Batal":"➕ Tambah Kelas"}
              </button>
            </div>

            {showForm && (
              <div className="p-5 space-y-4" style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(245,158,11,0.4)", borderLeft:"4px solid #f59e0b", borderRadius:"0" }}>
                <h3 className="font-bold text-sm uppercase tracking-wide" style={{ color:"#fbbf24" }}>{editId?"✏️ Edit Kelas":"➕ Tambah Kelas Baru"}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {form.isDefault ? (
                    <div className="md:col-span-2 p-3 text-xs" style={{ background:"rgba(22,163,74,0.15)", border:"1px solid rgba(22,163,74,0.4)", borderRadius:"0" }}>
                      <p className="font-bold" style={{ color:"#86efac" }}>🔒 Kelas 6 Default — Nama & tingkat terkunci</p>
                      <p style={{ color:"rgba(255,255,255,0.6)" }}>Hanya password yang bisa diubah untuk melindungi data Firestore lama.</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-bold mb-1" style={{ color:"rgba(255,255,255,0.7)" }}>Nama Kelas *</label>
                        <input value={form.namaKelas} onChange={e=>setForm(f=>({...f,namaKelas:e.target.value}))} placeholder="Contoh: Kelas 5, Kelas 4A" className={inpDark} style={inpDarkBg} />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1" style={{ color:"rgba(255,255,255,0.7)" }}>Tingkat Kelas</label>
                        <select value={form.tingkat} onChange={e=>setForm(f=>({...f,tingkat:e.target.value,namaKelas:f.namaKelas||(e.target.value?`Kelas ${e.target.value}`:"")}))}
                          className={inpDark} style={{ background:"#1e2a4a", color:"white" }}>
                          <option value="">-- Pilih Tingkat --</option>
                          {TINGKAT_KELAS.map(t => (
                            <option key={t} value={t} disabled={kelasList.some(k=>k.tingkat===t&&k.id!==editId)}>
                              Kelas {t}{kelasList.some(k=>k.tingkat===t&&k.id!==editId)?" (sudah ada)":""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1" style={{ color:"rgba(255,255,255,0.7)" }}>
                    Password Login Guru * <span className="font-normal opacity-60 ml-1">— digunakan guru untuk masuk ke panel kelas ini</span>
                  </label>
                  <div className="relative">
                    <input type={showPwd.form?"text":"password"} value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))}
                      placeholder="Buat password unik untuk kelas ini" className={inpDark+" pr-10"} style={inpDarkBg} />
                    <button type="button" onClick={()=>setShowPwd(p=>({...p,form:!p.form}))} className="absolute right-2 top-1/2 -translate-y-1/2 text-sm opacity-60 hover:opacity-100">
                      {showPwd.form?"🙈":"👁"}
                    </button>
                  </div>
                </div>
                <div className="p-3 text-xs" style={{ background:"rgba(59,130,246,0.15)", border:"1px solid rgba(59,130,246,0.3)", borderRadius:"0" }}>
                  <p className="font-bold" style={{ color:"#93c5fd" }}>ℹ️ Setelah kelas ditambahkan:</p>
                  <p style={{ color:"rgba(255,255,255,0.6)" }}>Guru ketik password ini di halaman login → masuk Panel Guru dengan database baru (kosong, terpisah dari kelas lain).</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleSimpan} disabled={saving} className="flex-1 text-white font-bold py-2.5 text-sm" style={{ background: saving?"#92400e":"#d97706", borderRadius:"0" }}>
                    {saving ? "⏳ Menyimpan..." : `💾 ${editId?"Perbarui":"Simpan"} Kelas`}
                  </button>
                  <button onClick={resetForm} disabled={saving} className="px-4 font-bold py-2.5 text-sm" style={{ background:"rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.7)", borderRadius:"0" }}>Batal</button>
                </div>
              </div>
            )}

            {loadingKelas ? (
              <div className="text-center py-8" style={{ color:"rgba(255,255,255,0.4)" }}>⏳ Memuat data kelas dari Firestore...</div>
            ) : (
              <div className="space-y-2">
                {kelasList.map(k => (
                  <div key={k.id} className="p-4 flex items-center gap-4"
                    style={{ background:"rgba(255,255,255,0.05)", border:`1px solid ${k.isDefault?"rgba(22,163,74,0.4)":"rgba(255,255,255,0.1)"}`, borderLeft:`4px solid ${k.isDefault?"#16a34a":"#d97706"}`, borderRadius:"0" }}>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-lg flex-shrink-0"
                      style={{ background:k.isDefault?"#16a34a":"#d97706" }}>
                      {k.tingkat||k.namaKelas.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black text-white">{k.namaKelas}</p>
                        {k.isDefault && <span className="text-xs font-bold px-2 py-0.5" style={{ background:"rgba(22,163,74,0.2)", color:"#86efac", border:"1px solid rgba(22,163,74,0.4)", borderRadius:"0" }}>DEFAULT</span>}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-xs" style={{ color:"rgba(255,255,255,0.4)" }}>Password guru:</span>
                        <code className="text-xs px-1" style={{ background:"rgba(0,0,0,0.3)", color:showPwd[k.id]?"#fbbf24":"rgba(255,255,255,0.4)" }}>
                          {showPwd[k.id]?k.password:"••••••••"}
                        </code>
                        <button type="button" onClick={()=>setShowPwd(p=>({...p,[k.id]:!p[k.id]}))} className="text-xs opacity-50 hover:opacity-100 ml-0.5">
                          {showPwd[k.id]?"🙈":"👁"}
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={()=>handleEdit(k)} className="text-xs font-bold px-2 py-1.5" style={{ background:"rgba(255,255,255,0.1)", color:"#93c5fd", borderRadius:"0" }}>✏️</button>
                      {!k.isDefault && <button onClick={()=>setDelConfirm(k.id)} className="text-xs font-bold px-2 py-1.5" style={{ background:"rgba(204,0,0,0.2)", color:"#fca5a5", borderRadius:"0" }}>🗑️</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tabAktif === "settings" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-wide">Pengaturan Admin</h2>
              <p className="text-xs" style={{ color:"rgba(255,255,255,0.5)" }}>Ubah password akun administrator</p>
            </div>
            <div className="p-5 space-y-4" style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(245,158,11,0.3)", borderLeft:"4px solid #f59e0b", borderRadius:"0" }}>
              <h3 className="font-bold text-sm uppercase" style={{ color:"#fbbf24" }}>🔐 Ganti Password Admin</h3>
              {[{label:"Password Lama",val:pwdLama,set:setPwdLama,ph:"Masukkan password lama"},
                {label:"Password Baru",val:pwdBaru,set:setPwdBaru,ph:"Minimal 6 karakter"},
                {label:"Konfirmasi Password Baru",val:pwdKonfirm,set:setPwdKonfirm,ph:"Ulangi password baru"}].map(f=>(
                <div key={f.label}>
                  <label className="block text-xs font-bold mb-1" style={{ color:"rgba(255,255,255,0.7)" }}>{f.label}</label>
                  <input type="password" value={f.val} onChange={e=>f.set(e.target.value)} placeholder={f.ph} className={inpDark} style={inpDarkBg} />
                </div>
              ))}
              <button onClick={handleGantiPwd} className="w-full text-white font-bold py-2.5 text-sm" style={{ background:"#d97706", borderRadius:"0" }}>🔑 Ganti Password Admin</button>
            </div>
            <div className="p-4 text-xs space-y-1.5" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"0" }}>
              <p className="font-bold text-white">ℹ️ Info Sistem</p>
              <p style={{ color:"rgba(255,255,255,0.5)" }}>• Akses Admin: klik logo 5x → pilih Admin → masukkan password</p>
              <p style={{ color:"rgba(255,255,255,0.5)" }}>• Password admin default: <code className="bg-black/30 px-1 text-yellow-300">admin123</code></p>
              <p style={{ color:"rgba(255,255,255,0.5)" }}>• Kelas 6 default (password <code className="bg-black/30 px-1 text-green-300">guru123</code>) tidak bisa dihapus</p>
              <p style={{ color:"rgba(255,255,255,0.5)" }}>• Setiap kelas punya database Firestore sendiri — benar-benar terpisah</p>
            </div>
          </div>
        )}
      </div>

      {delConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background:"rgba(0,0,0,0.7)" }}>
          <div className="bg-white p-6 w-full max-w-xs shadow-2xl" style={{ border:"2px solid #CC0000", borderRadius:"0" }}>
            <p className="font-bold text-slate-800 mb-1">Hapus Kelas?</p>
            <p className="text-sm text-slate-500 mb-4">Guru tidak bisa login ke kelas ini lagi. Data soal & siswa di Firestore tidak ikut terhapus.</p>
            <div className="flex gap-3">
              <button onClick={()=>handleHapus(delConfirm)} disabled={saving} className="flex-1 text-white font-bold py-2 text-sm" style={{ background: saving?"#7f1d1d":"#CC0000", borderRadius:"0" }}>
                {saving ? "⏳ Menghapus..." : "Ya, Hapus"}
              </button>
              <button onClick={()=>setDelConfirm(null)} disabled={saving} className="flex-1 font-bold py-2 text-sm" style={{ background:"#e2e8f0", color:"#475569", borderRadius:"0" }}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// GURU PANEL (sidebar)
// ============================================================
function GuruPanel({ addToast, onLogout, settings, onSaveSettings, mapelList, setMapelList, asesmenList, setAsesmenList, kelasAktif }) {
  const [activePage, setActivePage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navItems = [
    { id:"dashboard", icon:"🏠", label:"Dashboard" }, { id:"siswa", icon:"👤", label:"Data Siswa" },
    { id:"mapel", icon:"📚", label:"Manajemen Mapel" }, { id:"soal", icon:"✏️", label:"Input Soal" },
    { id:"viewsoal", icon:"👁", label:"Lihat Soal" },
    { id:"rekap", icon:"📊", label:"Rekap Hasil" }, { id:"pengaturan", icon:"⚙️", label:"Pengaturan Ujian" },
  ];
  const ns = kelasAktif?.namespace ?? "";
  const namaKelasPanel = kelasAktif?.namaKelas || "Kelas 6";

  // Settings per kelas — terpisah dari settings global
  const [kelasSettings, setKelasSettings] = useState(settings);

  const saveKelasSettings = async (newS) => {
    setKelasSettings(newS);
    // Simpan ke localStorage dengan key per ns
    const lsKey = ns ? `appSettings_${ns}` : "appSettings";
    try { localStorage.setItem(lsKey, JSON.stringify(newS)); } catch {}
    // Simpan ke Firestore namespace kelas
    try { await FS.simpanPengaturanKelas(newS, ns); } catch {}
  };

  // Refresh mapel, asesmen, dan settings per kelas saat ns berubah
  useEffect(() => {
    // Load settings kelas dari localStorage dulu (cepat)
    const lsKey = ns ? `appSettings_${ns}` : "appSettings";
    try {
      const cached = JSON.parse(localStorage.getItem(lsKey) || "null");
      if (cached && Object.keys(cached).length > 0) setKelasSettings(cached);
    } catch {}
    // Lalu load dari Firestore (akurat)
    FS.getPengaturanKelas(ns).then(data => {
      if (data.status === "success" && data.data && Object.keys(data.data).length > 0) {
        const remote = data.data;
        const merged = {
          logoUrl      : remote.logoUrl       || settings.logoUrl || "",
          namaSekolah  : remote.namaSekolah   || settings.namaSekolah || "",
          namaGuru     : remote.namaGuru      || "",
          nipGuru      : remote.nipGuru       || "",
          kotaTTD      : remote.kotaTTD       || "",
          durasiMenit  : remote.durasiMenit   ? Number(remote.durasiMenit) : 60,
          fotoGuru     : remote.fotoGuru      || "",
        };
        setKelasSettings(merged);
        try { localStorage.setItem(lsKey, JSON.stringify(merged)); } catch {}
      }
    }).catch(() => {});
    // Refresh mapel & asesmen
    Promise.all([fetchMapelList(ns), fetchAsesmenList(ns)]).then(([mapels, asesmens]) => {
      setMapelList(mapels);
      setAsesmenList(asesmens);
    }).catch(() => {});
  }, [ns]);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5" style={{ borderBottom: "1px solid #1e3a8a", background: "#002266" }}>
        <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "#93c5fd" }}>Panel Guru</p>
        <p className="font-black text-base mt-0.5 text-white" style={{ fontFamily: "'Georgia', serif" }}>{settings.namaSekolah || "Portal Ujian"}</p>
        <div className="mt-2 px-2 py-1 inline-block" style={{ background:"#CC0000" }}>
          <p className="text-xs font-black text-white tracking-wide">🏫 {namaKelasPanel}</p>
        </div>
        <div style={{ width: "40px", height: "3px", background: "#fbbf24", marginTop: "8px" }} />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">{navItems.map(n => (<button key={n.id} onClick={() => { setActivePage(n.id); setSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-left ${activePage===n.id ? "text-white" : "hover:text-white"}`} style={{ background: activePage===n.id ? "#CC0000" : "transparent", color: activePage===n.id ? "#fff" : "#93c5fd", borderRadius: "0", borderLeft: activePage===n.id ? "4px solid #fff" : "4px solid transparent" }}><span className="text-lg w-6 text-center">{n.icon}</span><span>{n.label}</span></button>))}</nav>
      <div className="px-3 py-4" style={{ borderTop: "1px solid #1e3a8a" }}><button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors" style={{ color: "#fca5a5", borderRadius: "0" }}><span className="text-lg">🚪</span><span>Keluar</span></button></div>
    </div>
  );
  const pageProps = { addToast, settings: kelasSettings, onSaveSettings: saveKelasSettings, mapelList, setMapelList, asesmenList, setAsesmenList, ns };
  return (
    <div className="min-h-screen flex" style={{ background: "#f1f5f9" }}>
      <aside className="hidden md:flex flex-col w-60 flex-shrink-0 fixed inset-y-0 left-0 z-30" style={{ background: "#003082" }}><SidebarContent /></aside>
      {sidebarOpen && (<div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)}><div className="absolute inset-0 bg-black/60" /><aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col z-50" style={{ background: "#003082" }} onClick={e => e.stopPropagation()}><SidebarContent /></aside></div>)}
      <div className="flex-1 md:ml-60 flex flex-col min-h-screen">
        <header className="md:hidden text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-20" style={{ background: "#CC0000" }}><button onClick={() => setSidebarOpen(true)} className="text-white/80 hover:text-white p-1"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg></button><span className="font-bold uppercase tracking-wide text-sm">{navItems.find(n=>n.id===activePage)?.label}</span></header>
        <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full">
          {activePage==="dashboard" && <TabDashboard onNav={setActivePage} addToast={addToast} settings={kelasSettings} ns={ns} />}
          {activePage==="siswa" && <TabSiswa {...pageProps} />}
          {activePage==="mapel" && <TabMapel {...pageProps} />}
          {activePage==="soal" && <TabInputSoal {...pageProps} />}
          {activePage==="viewsoal" && <TabViewSoal {...pageProps} />}
          {activePage==="rekap" && <TabRekap {...pageProps} />}
          {activePage==="pengaturan" && <TabPengaturan {...pageProps} />}
        </main>
      </div>
    </div>
  );
}

// ============================================================
// HALAMAN SISWA (login)
// ============================================================
function HalamanSiswa({ onMulaiUjian, onGuruMode, onAdminMode, mapelList = DEFAULT_MAPEL, asesmenList = DEFAULT_ASESMEN, logoUrl, namaSekolah }) {
  const [nisn, setNisn] = useState("");
  const [namaLookup, setNamaLookup] = useState("");
  const [kelasLookup, setKelasLookup] = useState("");
  const [lookupStatus, setLookupStatus] = useState("");
  const [mapel, setMapel] = useState(mapelList[0]);
  const [asesmen, setAsesmen] = useState(asesmenList[0]);
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const lookupTimer = useRef(null);

  // Cari NISN di semua kelas (semua namespace)
  const [nsFound, setNsFound] = useState("");
  const handleNisnChange = (val) => {
    setNisn(val);
    setNamaLookup(""); setKelasLookup(""); setLookupStatus(""); setNsFound("");
    clearTimeout(lookupTimer.current);
    if (val.trim().length < 4) return;
    lookupTimer.current = setTimeout(async () => {
      setLookupStatus("loading");
      try {
        // Ambil daftar kelas langsung dari Firestore (paling akurat)
        // Fallback ke cache jika Firestore gagal
        let kelasList = [];
        try {
          const res = await FS.getKelasList();
          if (res.status === "success" && res.data?.length > 0) {
            kelasList = res.data;
            saveKelasListCache(kelasList); // update cache
          }
        } catch {}
        // Fallback ke cache jika Firestore gagal
        if (kelasList.length === 0) kelasList = loadKelasListCache();

        // Cari NISN di semua kelas secara paralel (lebih cepat)
        const hasil = await Promise.all(
          kelasList.map(async (kelas) => {
            const ns = kelas.namespace ?? "";
            try {
              const data = await FS.getSiswaByNISN({ nisn: val.trim() }, ns);
              if (data.status === "success" && data.data) {
                return { found: true, nama: data.data.nama || "", kelas: data.data.kelas || "", ns };
              }
            } catch {}
            return { found: false };
          })
        );

        const ketemu = hasil.find(h => h.found);
        if (ketemu) {
          setNamaLookup(ketemu.nama);
          setKelasLookup(ketemu.kelas);
          setNsFound(ketemu.ns);
          setLookupStatus("found");
        } else {
          setLookupStatus("notfound");
        }
      } catch {
        setLookupStatus("notfound");
      }
    }, 600);
  };

  const handle = async () => {
    setErr("");
    if (!nisn.trim()) return setErr("NISN harus diisi!");
    if (!namaLookup && lookupStatus !== "found") return setErr("NISN tidak ditemukan dalam database siswa. Hubungi guru.");
    if (!token.trim()) return setErr("Token harus diisi!");

    setLoginLoading(true);
    try {
      const data = await FS.validasiToken({ mapel, asesmen, token: token.trim() }, nsFound);
      if (data.status === "error") { setErr(data.message || "Token tidak valid atau sudah dinonaktifkan!"); setLoginLoading(false); return; }
      if (data.aktif === "FALSE") { setErr("Token ini sedang dinonaktifkan oleh guru. Hubungi gurumu."); setLoginLoading(false); return; }
    } catch {
      // Jika gagal fetch, biarkan lanjut
    }
    setLoginLoading(false);
    onMulaiUjian({ nama: namaLookup, nisn, noAbsen: kelasLookup, mapel, asesmen, token, ns: nsFound });
  };

  const animationStyles = `
    @keyframes slideUpFade {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-slide-up-fade {
      animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
  `;

  const [logoTapCount, setLogoTapCount] = useState(0);
  const [showPilihLogin, setShowPilihLogin] = useState(false);
  const logoTapTimer = useRef(null);
  const handleLogoClick = () => {
    const next = logoTapCount + 1;
    setLogoTapCount(next);
    clearTimeout(logoTapTimer.current);
    if (next >= 5) { setLogoTapCount(0); setShowPilihLogin(true); return; }
    logoTapTimer.current = setTimeout(() => setLogoTapCount(0), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start relative font-sans pt-6 pb-6" style={{ background: "linear-gradient(160deg, #003082 0%, #001a4d 60%, #8B0000 100%)" }}>
      <style>{animationStyles}</style>
      {showPilihLogin && (
        <ModalPilihLogin
          onPilihGuru={() => { setShowPilihLogin(false); onGuruMode(); }}
          onPilihAdmin={() => { setShowPilihLogin(false); onAdminMode(); }}
          onClose={() => setShowPilihLogin(false)}
        />
      )}
      <div className="relative z-10 w-full max-w-[440px] px-4 flex flex-col items-center">
        
        {/* Header (Logo + Nama Sekolah + Title) */}
        <div className="flex flex-col items-center mb-4 text-center w-full justify-center">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" onClick={handleLogoClick} className="w-[104px] h-[104px] object-contain drop-shadow-lg cursor-pointer select-none" style={{ marginBottom: "4px" }} />
          ) : (
            <div onClick={handleLogoClick} className="w-[104px] h-[104px] bg-white rounded-full flex items-center justify-center text-5xl shadow-lg border-2 border-white/30 cursor-pointer select-none" style={{ marginBottom: "4px" }}>
              🎓
            </div>
          )}
          {namaSekolah ? (
            <p className="text-[15px] font-extrabold text-white uppercase tracking-wide drop-shadow" style={{ marginBottom: "10px" }}>{namaSekolah}</p>
          ) : (
            <p className="text-[14px] font-bold text-white/80 uppercase tracking-widest" style={{ marginBottom: "10px" }}>CBT Application</p>
          )}
          <h1 className="text-[13px] font-semibold tracking-[0.2em] text-red-300 uppercase">Portal Ujian Digital</h1>
        </div>

        {/* Card Login */}
        <div className="bg-white w-full overflow-hidden animate-slide-up-fade" style={{ borderRadius: "0", border: "3px solid #CC0000", boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }}>
          
          {/* Card Header strip — sama dengan GuruLogin */}
          <div style={{ background: "linear-gradient(135deg, #CC0000, #990000)", padding: "16px 24px 14px" }}>
            <h2 className="text-[17px] font-black text-white tracking-wide text-center" style={{ fontFamily: "'Georgia', serif" }}>LOGIN SISWA</h2>
            <p className="text-red-200 text-xs mt-0.5 uppercase tracking-widest text-center">Masukkan data untuk memulai ujian</p>
          </div>

          <div className="px-8 pt-5 pb-5">
            <div className="space-y-4">
              {/* NISN */}
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"></path></svg>
                </div>
                <input
                  type="text"
                  value={nisn}
                  onChange={e => handleNisnChange(e.target.value)}
                  placeholder="NISN"
                  className="w-full pl-9 pr-4 py-2 bg-transparent border-b-2 text-gray-700 text-[15px] focus:outline-none transition-colors"
                  style={{ borderColor: "#003082", borderTop: "none", borderLeft: "none", borderRight: "none" }}
                />
                {lookupStatus === "loading" && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#CC0000", borderTopColor: "transparent" }}></div>
                )}
              </div>
              {lookupStatus === "found" && (
                <div className="text-xs font-semibold text-green-600 pl-9 -mt-2">
                  ✓ {namaLookup} {kelasLookup ? `— ${kelasLookup}` : ""}
                </div>
              )}
              {lookupStatus === "notfound" && nisn.trim().length >= 4 && (
                <div className="text-xs font-semibold text-red-500 pl-9 -mt-2">
                  ✕ NISN tidak ditemukan
                </div>
              )}

              {/* Mapel & Asesmen */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                  </div>
                  <select value={mapel} onChange={e => setMapel(e.target.value)} className="w-full pl-8 pr-1 py-2 bg-transparent border-b-2 text-gray-600 text-[13px] focus:outline-none transition-colors cursor-pointer" style={{ appearance: "none", borderColor: "#003082", borderTop: "none", borderLeft: "none", borderRight: "none" }}>
                    {mapelList.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                  </div>
                  <select value={asesmen} onChange={e => setAsesmen(e.target.value)} className="w-full pl-8 pr-1 py-2 bg-transparent border-b-2 text-gray-600 text-[13px] focus:outline-none transition-colors cursor-pointer" style={{ appearance: "none", borderColor: "#003082", borderTop: "none", borderLeft: "none", borderRight: "none" }}>
                    {asesmenList.map(a => <option key={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Token */}
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path></svg>
                </div>
                <input
                  type="text"
                  value={token}
                  onChange={e => setToken(e.target.value.toUpperCase())}
                  placeholder="Token Ujian"
                  className="w-full pl-9 pr-8 py-2 bg-transparent border-b-2 text-gray-700 text-[15px] focus:outline-none transition-colors uppercase tracking-widest font-bold"
                  style={{ borderColor: "#003082", borderTop: "none", borderLeft: "none", borderRight: "none" }}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none">
                   <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"></path></svg>
                </div>
              </div>
              
              {err && (
                <div className="text-[13px] font-semibold" style={{ color: "#CC0000" }}>
                  ⚠ {err}
                </div>
              )}

              <div className="pt-1">
                <button
                  onClick={handle}
                  disabled={lookupStatus === "loading" || !nisn.trim() || loginLoading}
                  className="w-full text-white font-bold py-3 transition-colors flex justify-center items-center text-[15px] disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-widest"
                  style={{ background: "#CC0000", borderRadius: "0" }}
                >
                  {loginLoading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span> : null}
                  Mulai Ujian
                </button>
              </div>
            </div>
          </div>

          {/* Bottom strip biru — sama dengan GuruLogin */}
          <div style={{ background: "#003082", height: "6px" }} />
        </div>
        
        {/* Teks Footer Bawah */}
        <div className="mt-5 flex flex-col items-center">
          <p className="text-[12px] text-white/40 font-medium">Copyright © 2026 Hairur Rahman</p>
        </div>

      </div>
    </div>
  );
}

// ============================================================
// Render HTML dengan dukungan KaTeX
// ============================================================
function RenderHTML({ html, className = "" }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(!!window.katex);

  useEffect(() => {
    if (!window.katex) {
      loadKatex().then(() => setReady(true)).catch(() => setReady(false));
    }
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || !html) return;
    
    const renderMathInElement = (element) => {
      if (!window.katex) return;
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (node.parentElement?.closest?.(".katex")) return NodeFilter.FILTER_REJECT;
            if (/\$[^$]+\$/.test(node.textContent)) return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      const nodesToReplace = [];
      while (walker.nextNode()) nodesToReplace.push(walker.currentNode);
      
      nodesToReplace.forEach(textNode => {
        const text = textNode.textContent;
        const regex = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
        let lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }
          const formula = match[1] || match[2];
          const isBlock = !!match[1];
          try {
            const span = document.createElement("span");
            span.innerHTML = window.katex.renderToString(formula, {
              displayMode: isBlock,
              throwOnError: false
            });
            fragment.appendChild(span);
          } catch (e) {
            fragment.appendChild(document.createTextNode(match[0]));
          }
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        textNode.parentNode.replaceChild(fragment, textNode);
      });
    };
    
    renderMathInElement(containerRef.current);
  }, [html, ready]);

  if (!html) return null;
  
  return (
    <div 
      ref={containerRef}
      className={`prose prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ============================================================
// HALAMAN UJIAN (HalamanUjian)
// ============================================================
function HalamanUjian({ siswa, addToast, onSelesai, durasiMenit, namaGuru, nipGuru, kotaTTD, namaSekolah, ns="" }) {
  // Gunakan ns dari object siswa jika ada (siswa login langsung), atau dari prop
  const nsEfektif = siswa?.ns ?? ns;
  const [soalList, setSoalList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [jawaban, setJawaban] = useState({});
  const [tabViolation, setTabViolation] = useState(0);
  const [diskualifikasi, setDiskualifikasi] = useState(false);
  const [diskualifikasiAlasan, setDiskualifikasiAlasan] = useState("tab");
  const durasiDetik = (Number(durasiMenit) || 60) * 60;
  const [waktu, setWaktu] = useState(durasiDetik);
  const [submitted, setSubmitted] = useState(false);
  const [hasilAkhir, setHasilAkhir] = useState(null);
  const timerRef = useRef(null);
  const MAX_VIOLATION = 3;

  const [showKonfirmasi, setShowKonfirmasi] = useState(true);
  const [ujianDimulai, setUjianDimulai] = useState(false);
  const violationCountRef = useRef(0);

  // Fetch soal dari server
  useEffect(() => {
    const fetchSoal = async () => {
      setLoading(true);
      try {
        const data = await FS.getSoal({ mapel:siswa.mapel, asesmen:siswa.asesmen, token:siswa.token }, nsEfektif);
        if (data.status === "success" && data.soal?.length > 0) setSoalList(data.soal);
        else { addToast(data.message || "Soal tidak tersedia.", "error"); setLoading(false); return; }
      } catch { addToast("Gagal terhubung ke server.", "error"); setLoading(false); return; }
      finally { setLoading(false); }
    };
    fetchSoal();
  }, []);

  // Timer ujian
  useEffect(() => {
    if (!ujianDimulai || submitted || diskualifikasi) return;
    timerRef.current = setInterval(() => {
      setWaktu(t => {
        if (t <= 1) { clearInterval(timerRef.current); handleSubmit(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [ujianDimulai, submitted, diskualifikasi]);

  // === Wake Lock: layar tetap menyala selama ujian ===
  useEffect(() => {
    if (!ujianDimulai || submitted || diskualifikasi) return;
    let wakeLock = null;
    const requestWake = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch (e) { /* browser tidak support, abaikan */ }
    };
    requestWake();
    const onVisChange = () => { if (!document.hidden && !wakeLock?.released) requestWake(); };
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      if (wakeLock && !wakeLock.released) wakeLock.release().catch(() => {});
    };
  }, [ujianDimulai, submitted, diskualifikasi]);

  // === Deteksi pelanggaran: pindah tab, blur window, split screen ===
  useEffect(() => {
    if (!ujianDimulai) return;

    const triggerViolation = (alasan) => {
      if (submitted || diskualifikasi) return;
      violationCountRef.current += 1;
      const count = violationCountRef.current;
      setTabViolation(count);
      if (count >= MAX_VIOLATION) {
        setDiskualifikasiAlasan(alasan);
        setDiskualifikasi(true);
        clearInterval(timerRef.current);
        addToast("Sesi ujian diakhiri. Kamu telah diskualifikasi!", "error");
      } else {
        addToast(`⚠️ Peringatan ${count}/${MAX_VIOLATION}: ${
          alasan === "tab" ? "Jangan berpindah tab!" :
          alasan === "blur" ? "Jangan keluar dari halaman ujian!" :
          "Jangan menggunakan split screen!"
        }`, "warning");
      }
    };

    // 1. Pindah tab (visibilitychange)
    const onVisChange = () => {
      if (document.hidden) triggerViolation("tab");
    };
    document.addEventListener("visibilitychange", onVisChange);

    // 2. Keluar browser / minimize / split screen (window blur)
    const onBlur = () => {
      // Cek apakah window mengecil (split screen) dengan membandingkan ukuran
      const isSplit = window.innerWidth < window.screen.width * 0.75;
      triggerViolation(isSplit ? "split" : "blur");
    };
    window.addEventListener("blur", onBlur);

    // 3. Resize window kecil drastis = split screen
    let lastWidth = window.innerWidth;
    const onResize = () => {
      const current = window.innerWidth;
      if (current < lastWidth * 0.75) {
        triggerViolation("split");
      }
      lastWidth = current;
    };
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
    };
  }, [ujianDimulai, submitted, diskualifikasi]);


  const formatWaktu = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // Hitung nilai objektif
  const hitungNilai = () => {
    let totalPoint = 0, didapatPoint = 0;
    const detail = [];
    let adaEsai = false;
    soalList.forEach((s, idx) => {
      const pt = Number(s.point) || 0;
      totalPoint += pt;
      const jwb = jawaban[s.id];

      if (s.jenisSoal === "Uraian/Esai") {
        adaEsai = true;
        detail.push({ no: idx + 1, jenis: "Esai", dapat: 0, max: pt, ket: jwb ? "Dijawab (menunggu koreksi)" : "Tidak dijawab" });
        return;
      }

      const benar = JSON.parse(s.jawabanBenar || "[]");
      if (!jwb) {
        detail.push({ no: idx + 1, jenis: s.jenisSoal, dapat: 0, max: pt, ket: "Tidak dijawab" });
        return;
      }

      if (s.jenisSoal === "Pilihan Ganda") {
        const dapat = jwb[0] === benar[0] ? pt : 0;
        didapatPoint += dapat;
        detail.push({ no: idx + 1, jenis: "PG", dapat, max: pt, ket: dapat > 0 ? "Benar" : "Salah" });
      } else if (s.jenisSoal === "Pilihan Ganda Kompleks") {
        const opsiAll = JSON.parse(s.opsi || "[]");
        const jml = opsiAll.length;
        if (!jml) return;
        let skor = 0;
        opsiAll.forEach(o => { const t = getOpsiText(o); if (benar.includes(t) === jwb.includes(t)) skor++; });
        const dapat = Math.round((pt * skor / jml) * 100) / 100;
        didapatPoint += dapat;
        detail.push({ no: idx + 1, jenis: "PGK", dapat, max: pt, ket: `${skor}/${jml} opsi tepat` });
      } else {
        const jml = benar.length;
        if (!jml) return;
        let skor = 0;
        benar.forEach((jb, i) => { if (jwb[i] === jb) skor++; });
        const dapat = Math.round((pt * skor / jml) * 100) / 100;
        didapatPoint += dapat;
        detail.push({ no: idx + 1, jenis: "B/S", dapat, max: pt, ket: `${skor}/${jml} benar` });
      }
    });
    didapatPoint = Math.round(didapatPoint * 100) / 100;
    const totalObjektif = soalList.filter(s => s.jenisSoal !== "Uraian/Esai").reduce((a, s) => a + Number(s.point || 0), 0);
    const nilai = totalObjektif > 0 ? Math.round((didapatPoint / totalObjektif) * 100) : 0;
    return { totalPoint, didapatPoint, nilai, detail, adaEsai };
  };

  // Submit ujian
  const handleSubmit = async (autoSubmit = false) => {
    if (submitted) return;
    clearInterval(timerRef.current);
    const { nilai, didapatPoint, totalPoint, detail, adaEsai } = hitungNilai();
    setHasilAkhir({ nilai, didapatPoint, totalPoint, detail, adaEsai });
    setSubmitted(true);

    const jawabanEsaiList = soalList
      .filter(s => s.jenisSoal === "Uraian/Esai")
      .map((s) => ({ soal: s.soal, referensi: s.jawabanReferensi || "", jawaban: jawaban[s.id] || "" }));

    try {
      // Simpan detail jawaban per soal agar bisa dipakai untuk PDF guru
      const detailJawaban = {};
      soalList.forEach(s => { detailJawaban[s.id] = { jawaban: jawaban[s.id]||[], jenis: s.jenisSoal, soal: s.soal||"", opsi: s.opsi||"[]", jawabanBenar: s.jawabanBenar||"[]", point: s.point||0 }; });
      await FS.simpanHasil({
        nama: siswa.nama, nisn: siswa.nisn, noAbsen: siswa.noAbsen,
        mapel: siswa.mapel, asesmen: siswa.asesmen,
        nilai, adaEsai,
        jawabanEsai: adaEsai ? JSON.stringify(jawabanEsaiList) : "",
        detailJawaban: JSON.stringify(detailJawaban),
        token: siswa.token,
        waktu: new Date().toLocaleString("id-ID")
      }, nsEfektif);
    } catch { /* gagal simpan — log saja */ }
    if (!autoSubmit) addToast("Ujian berhasil dikumpulkan! 🎉", "success");
  };

  const soal = soalList[currentIdx];
  const opsiList = soal ? JSON.parse(soal.opsi || "[]") : [];
  const pctDone = soalList.length > 0 ? Math.round(((currentIdx + 1) / soalList.length) * 100) : 0;
  const [pdfLoading, setPdfLoading] = useState(false);

  const handleUnduhPDF = async () => {
    setPdfLoading(true);
    try {
      await unduhPDF({ siswa, hasilAkhir, soalList, jawabanSiswa: jawaban, namaGuru, nipGuru, kotaTTD, namaSekolah });
    } catch (e) {
      addToast("Gagal membuat PDF.", "error");
    } finally { setPdfLoading(false); }
  };

  // === JENDELA KONFIRMASI sebelum ujian ===
  if (showKonfirmasi) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
        <div className="bg-white w-full max-w-md shadow-2xl overflow-hidden" style={{ borderRadius: "0", border: "3px solid #CC0000" }}>
          <div className="text-white text-center py-6 px-6" style={{ background: "linear-gradient(135deg,#CC0000,#8B0000)", borderBottom: "4px solid #003082" }}>
            <div className="text-5xl mb-3">⚠️</div>
            <h2 className="text-xl font-black uppercase tracking-widest" style={{ fontFamily: "'Georgia', serif" }}>PERHATIAN PENTING</h2>
            <p className="text-red-200 text-xs mt-1 uppercase tracking-widest">Baca sebelum memulai ujian</p>
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex gap-3 items-start p-3" style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderLeft: "4px solid #CC0000", borderRadius: "0" }}>
                <span className="text-lg flex-shrink-0">🚫</span>
                <p><strong className="text-red-700">Dilarang berpindah tab, keluar browser, atau menggunakan split screen</strong> selama ujian berlangsung. Setiap jenis pelanggaran diberi toleransi <strong>{MAX_VIOLATION} kali</strong> — setelah itu sesi ujian langsung diakhiri dan kamu dinyatakan diskualifikasi.</p>
              </div>
              <div className="flex gap-3 items-start p-3" style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderLeft: "4px solid #003082", borderRadius: "0" }}>
                <span className="text-lg flex-shrink-0">📱</span>
                <p><strong className="text-blue-700">Layar perangkatmu akan dijaga tetap menyala</strong> selama ujian berlangsung secara otomatis oleh sistem.</p>
              </div>
              <div className="flex gap-3 items-start p-3" style={{ background: "#f0fdf4", border: "1px solid #86efac", borderLeft: "4px solid #16a34a", borderRadius: "0" }}>
                <span className="text-lg flex-shrink-0">✅</span>
                <p>Pastikan koneksi internet stabil, waktu cukup, dan kamu siap mengerjakan <strong>{siswa.mapel} — {siswa.asesmen}</strong> selama <strong>{durasiMenit} menit</strong>.</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 text-center">Dengan menekan "Mulai Ujian", kamu menyatakan siap dan memahami seluruh peraturan di atas.</p>
            <div className="flex gap-3 pt-1">
              <button onClick={onSelesai} className="flex-1 font-bold py-3 text-sm" style={{ background: "#e2e8f0", color: "#475569", borderRadius: "0" }}>← Kembali</button>
              <button onClick={() => { setShowKonfirmasi(false); setUjianDimulai(true); }} className="flex-1 text-white font-black py-3 text-sm uppercase tracking-widest" style={{ background: "linear-gradient(135deg,#003082,#001a4d)", borderRadius: "0", letterSpacing: "0.15em" }}>
                🚀 Mulai Ujian
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
        <p className="text-slate-600 font-medium">Memuat soal...</p>
      </div>
    );
  }

  if (diskualifikasi) {
    const pesanAlasan = {
      tab: `Kamu terdeteksi berpindah ke tab atau aplikasi lain sebanyak ${MAX_VIOLATION} kali selama sesi ujian berlangsung. Tindakan ini melanggar tata tertib integritas ujian.`,
      blur: `Kamu terdeteksi keluar dari halaman ujian — misalnya meminimalkan browser atau beralih ke aplikasi lain — sebanyak ${MAX_VIOLATION} kali. Sistem secara otomatis mengakhiri sesimu.`,
      split: `Kamu terdeteksi menggunakan fitur split screen atau mengubah ukuran jendela browser secara signifikan sebanyak ${MAX_VIOLATION} kali. Hal ini tidak diperkenankan selama ujian berlangsung.`,
    };
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(160deg,#1a0000,#3d0000)" }}>
        <div className="bg-white w-full max-w-sm shadow-2xl overflow-hidden text-center" style={{ border: "3px solid #CC0000", borderRadius: "0" }}>
          <div className="py-8 px-6" style={{ background: "linear-gradient(135deg,#CC0000,#8B0000)", borderBottom: "4px solid #003082" }}>
            <div className="text-6xl mb-3">🚫</div>
            <h2 className="text-2xl font-black text-white uppercase tracking-widest" style={{ fontFamily: "'Georgia', serif" }}>Sesi Diakhiri</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="py-3 px-4" style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0" }}>
              <p className="font-black text-lg" style={{ color: "#CC0000" }}>DISKUALIFIKASI</p>
              <p className="text-slate-600 text-sm mt-2 leading-relaxed">
                {pesanAlasan[diskualifikasiAlasan] || pesanAlasan.tab}
              </p>
            </div>
            <div className="text-xs text-slate-500 p-3 text-left" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "0" }}>
              <p className="font-bold text-slate-700 mb-1">📋 Hasil ujian ini tidak akan tersimpan.</p>
              <p>Hubungi guru kamu untuk informasi lebih lanjut mengenai tindak lanjut yang akan diberikan.</p>
            </div>
            <button onClick={onSelesai} className="w-full text-white font-bold py-3 text-sm uppercase tracking-widest" style={{ background: "#003082", borderRadius: "0" }}>← Kembali ke Beranda</button>
          </div>
        </div>
      </div>
    );
  }

  if (submitted && hasilAkhir) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white shadow-xl overflow-hidden" style={{ border: "2px solid #003082", borderRadius: "0" }}>
          <div style={{ background: hasilAkhir.nilai >= 75 ? "linear-gradient(135deg,#16a34a,#15803d)" : hasilAkhir.nilai >= 50 ? "linear-gradient(135deg,#d97706,#b45309)" : "linear-gradient(135deg,#CC0000,#8B0000)", padding: "32px 24px", textAlign: "center", borderBottom: "4px solid #003082" }}>
            <div className="text-6xl mb-3">{hasilAkhir.nilai >= 75 ? "🎉" : hasilAkhir.nilai >= 50 ? "👍" : "📚"}</div>
            <p className="text-white/80 text-sm font-medium uppercase tracking-widest">Nilai Kamu</p>
            <p className="text-7xl font-black text-white" style={{ fontFamily: "'Georgia', serif" }}>{hasilAkhir.nilai}</p>
          </div>
          <div className="p-6 space-y-4">
            <p className="font-black text-slate-800 text-lg text-center uppercase tracking-wide">{siswa.nama}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: "Mapel", val: siswa.mapel },
                { label: "Asesmen", val: siswa.asesmen },
                { label: "Point", val: `${hasilAkhir.didapatPoint} / ${hasilAkhir.totalPoint}` },
                { label: "Jumlah Soal", val: `${soalList.length} soal` }
              ].map(s => (
                <div key={s.label} className="p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "0" }}>
                  <p className="text-slate-500 text-xs uppercase tracking-wide">{s.label}</p>
                  <p className="font-bold text-slate-700 text-sm">{s.val}</p>
                </div>
              ))}
            </div>
            <div className="p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "0" }}>
              <p className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">📊 Rincian Poin Per Soal</p>
              <div className="space-y-1">
                {hasilAkhir.detail.map(d => (
                  <div key={d.no} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Soal {d.no} <span className="text-slate-400">({d.jenis})</span></span>
                    <span className="font-medium text-slate-700">{d.ket} → {d.dapat}/{d.max} poin</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-3 text-sm font-bold text-center" style={{ background: hasilAkhir.nilai >= 75 ? "#f0fdf4" : hasilAkhir.nilai >= 50 ? "#fff7ed" : "#fef2f2", color: hasilAkhir.nilai >= 75 ? "#15803d" : hasilAkhir.nilai >= 50 ? "#b45309" : "#CC0000", border: `1px solid ${hasilAkhir.nilai >= 75 ? "#86efac" : hasilAkhir.nilai >= 50 ? "#fcd34d" : "#fca5a5"}`, borderRadius: "0" }}>
              {hasilAkhir.nilai >= 75 ? "🌟 Luar biasa! Kamu berhasil!" : hasilAkhir.nilai >= 50 ? "👍 Cukup baik! Terus belajar ya!" : "📖 Jangan menyerah, belajar lebih giat!"}
            </div>
            {hasilAkhir.adaEsai && (
              <div className="p-3 text-xs text-center" style={{ background: "#eff6ff", border: "1px solid #93c5fd", color: "#003082", borderRadius: "0" }}>
                ✏️ <strong>Ada soal uraian</strong> — nilai akhir akan diperbarui setelah guru mengoreksi jawaban esaimu.
              </div>
            )}
            <button onClick={handleUnduhPDF} disabled={pdfLoading} className="w-full text-white font-bold py-3 transition-all shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-60" style={{ background: "#003082", borderRadius: "0" }}>
              {pdfLoading ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block"></span> Membuat PDF...</> : <>📥 Download PDF Hasil</>}
            </button>
            <button onClick={onSelesai} className="w-full font-bold py-3 transition-colors" style={{ background: "#e2e8f0", color: "#475569", borderRadius: "0" }}>← Kembali ke Beranda</button>
          </div>
        </div>
      </div>
    );
  }

  if (!soal) return <div className="text-center py-10 text-slate-500">Soal tidak tersedia</div>;

  return (
    <div className="w-full max-w-2xl mx-auto px-2 py-3">
      {/* Header ujian */}
      <div className="flex items-center justify-between mb-3 bg-white shadow px-4 py-3" style={{ borderLeft: "4px solid #CC0000", borderRadius: "0" }}>
        <div>
          <p className="text-xs text-slate-500 font-medium">{siswa.mapel} • {siswa.asesmen}</p>
          <p className="text-sm font-bold text-slate-800">{siswa.nama}</p>
        </div>
        <div className="flex items-center gap-2">
          {tabViolation > 0 && <span className="text-xs px-2 py-1 font-bold" style={{ background: "#fff7ed", color: "#b45309", border: "1px solid #f59e0b" }}>⚠️ {tabViolation}/{MAX_VIOLATION}</span>}
          <div className={`font-mono font-extrabold text-lg px-3 py-1 ${waktu < 300 ? "animate-pulse" : ""}`} style={{ background: waktu < 300 ? "#fef2f2" : waktu < durasiDetik / 2 ? "#fff7ed" : "#eff6ff", color: waktu < 300 ? "#CC0000" : waktu < durasiDetik / 2 ? "#b45309" : "#003082", border: `2px solid ${waktu < 300 ? "#CC0000" : waktu < durasiDetik / 2 ? "#f59e0b" : "#003082"}`, borderRadius: "0" }}>
            ⏱ {formatWaktu(waktu)}
          </div>
        </div>
      </div>

      {/* Progress dan navigasi soal */}
      <div className="mb-4 bg-white shadow px-4 py-3" style={{ borderLeft: "4px solid #003082", borderRadius: "0" }}>
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Soal {currentIdx + 1} dari {soalList.length}</span>
          <span>{pctDone}%</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2.5 mb-3">
          <div className="bg-red-700 h-2.5 transition-all duration-500" style={{ width: `${pctDone}%` }} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {soalList.map((s, i) => (
            <button key={i} onClick={() => setCurrentIdx(i)} className={`w-8 h-8 text-xs font-bold transition-colors ${i === currentIdx ? "text-white" : jawaban[s.id] ? "text-green-700 border border-green-300" : "text-slate-500"}`} style={{ background: i === currentIdx ? "#CC0000" : jawaban[s.id] ? "#dcfce7" : "#f1f5f9", borderRadius: "0" }}>
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Konten soal */}
      <div className="bg-white shadow-lg mb-4" style={{ borderTop: "3px solid #CC0000", borderRadius: "0" }}>
        {/* Baris atas: nomor soal + badge jenis */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 flex-wrap">
          <span className="text-white text-xs font-black px-2.5 py-1 flex-shrink-0" style={{ background: "#CC0000" }}>{currentIdx + 1}</span>
          <span className="text-xs px-2 py-0.5 font-bold uppercase tracking-wide" style={{ background: "#003082", color: "#fff", borderRadius: "0" }}>
            {soal.jenisSoal}
          </span>
          {soal.jenisSoal !== "Uraian/Esai" && (
            <span className="text-xs px-2 py-0.5 font-bold" style={{ background: "#fef9c3", color: "#854d0e", border: "1px solid #ca8a04", borderRadius: "0" }}>⭐ {soal.point} poin</span>
          )}
          {soal.jenisSoal === "Uraian/Esai" && (
            <span className="text-xs px-2 py-0.5 font-bold" style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #ea580c", borderRadius: "0" }}>✏️ Koreksi manual</span>
          )}
        </div>

        {/* Teks soal — full width, tidak disempitkan oleh nomor di samping */}
        <div className="px-4 pb-3 text-slate-800 font-medium leading-relaxed prose prose-sm max-w-none text-base">
          <RenderHTML html={soal.soal} />
        </div>

        {/* Gambar soal */}
        {soal.gambar && soal.gambar.trim() && (
          <div className="px-4 pb-4"><GambarSoal url={soal.gambar} alt="Gambar soal" /></div>
        )}

        {/* Separator tipis sebelum opsi */}
        <div style={{ borderTop: "1px solid #f1f5f9" }} />

        {/* Area opsi dengan padding yang konsisten */}
        <div className="px-4 py-4">

        {/* Pilihan Ganda */}
        {soal.jenisSoal === "Pilihan Ganda" && (
          <div className="space-y-2">
            {opsiList.map((o, i) => {
              const oText = getOpsiText(o);
              const oImg = getOpsiImg(o);
              const sel = jawaban[soal.id]?.[0] === oText;
              return (
                <button key={i} onClick={() => setJawaban(p => ({ ...p, [soal.id]: [oText] }))} className="w-full flex items-start gap-3 px-4 py-3 text-left transition-all" style={{ border: sel ? "2px solid #CC0000" : "2px solid #d1d5db", background: sel ? "#fef2f2" : "#fff", borderRadius: "0" }}>
                  <span className="w-8 h-8 flex items-center justify-center text-sm font-extrabold flex-shrink-0" style={{ background: sel ? "#CC0000" : "#f1f5f9", color: sel ? "#fff" : "#475569", borderRadius: "0" }}>{String.fromCharCode(65 + i)}</span>
                  <div className="flex-1">
                    <span className="text-sm font-medium" style={{ color: sel ? "#9b1c1c" : "#1e293b" }}><MathText text={oText} /></span>
                    {oImg && <img src={oImg} alt="opsi" className="mt-2 max-h-24 object-contain rounded" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Pilihan Ganda Kompleks */}
        {soal.jenisSoal === "Pilihan Ganda Kompleks" && (
          <div className="space-y-2">
            <p className="text-xs font-bold mb-2 px-3 py-1.5" style={{ color: "#003082", background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "0" }}>✅ Pilih SEMUA jawaban yang benar — skor parsial per opsi</p>
            {opsiList.map((o, i) => {
              const oText = getOpsiText(o);
              const oImg = getOpsiImg(o);
              const sel = (jawaban[soal.id] || []).includes(oText);
              return (
                <button key={i} onClick={() => setJawaban(p => {
                  const prev = p[soal.id] || [];
                  return { ...p, [soal.id]: prev.includes(oText) ? prev.filter(x => x !== oText) : [...prev, oText] };
                })} className="w-full flex items-start gap-3 px-4 py-3 text-left transition-all" style={{ border: sel ? "2px solid #003082" : "2px solid #d1d5db", background: sel ? "#eff6ff" : "#fff", borderRadius: "0" }}>
                  <input type="checkbox" checked={sel} onChange={() => { }} className="w-5 h-5 border-slate-300 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <span className="text-sm font-medium"><MathText text={oText} /></span>
                    {oImg && <img src={oImg} alt="opsi" className="mt-2 max-h-24 object-contain rounded" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Benar/Salah Kompleks */}
        {soal.jenisSoal === "Benar/Salah Kompleks" && (
          <div className="space-y-3">
            <p className="text-xs font-bold mb-2 px-3 py-1.5" style={{ color: "#9a3412", background: "#fff7ed", border: "1px solid #fb923c", borderRadius: "0" }}>Tentukan Benar atau Salah — skor parsial per pernyataan</p>
            {opsiList.map((o, i) => {
              const oText = getOpsiText(o);
              const oImg = getOpsiImg(o);
              const val = (jawaban[soal.id] || [])[i];
              return (
                <div key={i} className="flex items-start gap-3 p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "0" }}>
                  <span className="text-xs text-slate-500 font-bold w-5 flex-shrink-0 pt-0.5">{i + 1}.</span>
                  <div className="flex-1">
                    <p className="text-sm text-slate-700"><MathText text={oText} /></p>
                    {oImg && <img src={oImg} alt="opsi" className="mt-1 max-h-16 object-contain rounded" />}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {["Benar", "Salah"].map(v => (
                      <button key={v} onClick={() => setJawaban(p => {
                        const arr = [...(p[soal.id] || opsiList.map(() => ""))];
                        arr[i] = v;
                        return { ...p, [soal.id]: arr };
                      })} className="px-3 py-1.5 text-xs font-bold transition-colors" style={{ background: val === v ? (v === "Benar" ? "#16a34a" : "#CC0000") : "#e2e8f0", color: val === v ? "#fff" : "#475569", borderRadius: "0" }}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Uraian/Esai */}
        {soal.jenisSoal === "Uraian/Esai" && (
          <div className="space-y-3">
            <p className="text-xs font-bold px-3 py-1.5" style={{ color: "#003082", background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "0" }}>
              ✏️ Soal Uraian — Tulis jawaban kamu di bawah ini. Nilai ditentukan oleh guru.
            </p>
            <textarea
              value={jawaban[soal.id] || ""}
              onChange={e => setJawaban(p => ({ ...p, [soal.id]: e.target.value }))}
              rows={6}
              placeholder="Tulis jawabanmu di sini..."
              className="w-full px-4 py-3 text-sm text-slate-800 leading-relaxed resize-none focus:outline-none"
              style={{ border: "2px solid #003082", borderRadius: "0" }}
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>{(jawaban[soal.id] || "").length} karakter</span>
              <span className={jawaban[soal.id] ? "font-semibold" : ""} style={{ color: jawaban[soal.id] ? "#16a34a" : undefined }}>
                {jawaban[soal.id] ? "✓ Sudah dijawab" : "Belum dijawab"}
              </span>
            </div>
          </div>
        )}
        </div>{/* end px-4 py-4 */}
      </div>{/* end card soal */}

      {/* Tombol navigasi */}
      <div className="flex gap-3">
        <button onClick={() => setCurrentIdx(i => Math.max(0, i - 1))} disabled={currentIdx === 0} className="flex-1 font-bold py-3 transition-colors disabled:opacity-30" style={{ background: "#e2e8f0", color: "#475569", borderRadius: "0" }}>
          ← Sebelumnya
        </button>
        {currentIdx < soalList.length - 1 ? (
          <button onClick={() => setCurrentIdx(i => i + 1)} className="flex-1 text-white font-bold py-3 transition-colors" style={{ background: "#003082", borderRadius: "0" }}>
            Berikutnya →
          </button>
        ) : (
          <button onClick={() => handleSubmit(false)} className="flex-1 text-white font-bold py-3 transition-all shadow-md" style={{ background: "#16a34a", borderRadius: "0" }}>
            🏁 Kumpulkan
          </button>
        )}
      </div>
      <p className="text-center text-xs text-slate-400 mt-3">Terjawab: {Object.keys(jawaban).length}/{soalList.length} soal</p>
    </div>
  );
}

// ============================================================
// APP UTAMA
// ============================================================
export default function App() {
  const { toasts, addToast } = useToast();
  const [mode, setMode] = useState("siswa");
  const [siswa, setSiswa] = useState(null);
  const [settings, setSettings] = useState(() => { try { return JSON.parse(localStorage.getItem("appSettings") || "{}"); } catch { return {}; } });
  const [mapelList, setMapelList] = useState([...DEFAULT_MAPEL]);
  const [asesmenList, setAsesmenList] = useState([...DEFAULT_ASESMEN]);
  const handleSetMapelList = (list) => { setMapelList(list); try { localStorage.setItem("customMapel", JSON.stringify(list)); } catch {} };
  const handleSetAsesmenList = (list) => { setAsesmenList(list); try { localStorage.setItem("customAsesmen", JSON.stringify(list)); } catch {} };
  
  useEffect(() => {
    // Load pengaturan dari Firestore saat startup
    FS.getPengaturan().then(data => {
      if (data.status === "success" && data.data && Object.keys(data.data).length > 0) {
        const remote = data.data;
        const merged = {
          logoUrl: remote.logoUrl || "",
          namaSekolah: remote.namaSekolah || "",
          namaGuru: remote.namaGuru || "",
          nipGuru: remote.nipGuru || "",
          kotaTTD: remote.kotaTTD || "",
          durasiMenit: remote.durasiMenit ? Number(remote.durasiMenit) : 60,
          spreadsheetUrl: remote.spreadsheetUrl || "",
          fotoGuru: remote.fotoGuru || ""
        };
        setSettings(merged);
        try { localStorage.setItem("appSettings", JSON.stringify(merged)); } catch {}
      }
    }).catch(()=>{});
    // fetchMapelList/fetchAsesmenList dipanggil tanpa ns di init — akan di-refresh saat GuruPanel mount
    Promise.all([fetchMapelList(), fetchAsesmenList()]).then(([mapels, asesmens]) => {
      setMapelList(mapels); setAsesmenList(asesmens);
    }).catch(()=>{});
  }, []);
  
  const [kelasAktif, setKelasAktif] = useState(null);

  // Sync daftar kelas dari Firestore ke localStorage saat App pertama load
  // Agar cariKelasByPassword selalu pakai data terbaru
  useEffect(() => {
    FS.getKelasList().then(res => {
      if (res.status === "success" && res.data?.length > 0) {
        saveKelasListCache(res.data);
      }
    }).catch(() => {});
  }, []);

  const saveSettings = s => { setSettings(s); try { localStorage.setItem("appSettings", JSON.stringify(s)); } catch {} };
  const handleMulaiUjian = async (data) => { setSiswa(data); setMode("ujian"); try { const el = document.documentElement; if (el.requestFullscreen) await el.requestFullscreen(); else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen(); } catch {} };
  const handleSelesaiUjian = async () => { setSiswa(null); setMode("siswa"); try { if (document.fullscreenElement || document.webkitFullscreenElement) { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) await document.webkitExitFullscreen(); } } catch {} };
  const handleGuruLogin = (kelas) => { setKelasAktif(kelas); setMode("guru"); };
  const handleGuruLogout = () => { setKelasAktif(null); setMode("siswa"); };

  return (
    <div className="min-h-screen bg-gray-100">
      <Toast toasts={toasts} />
      {mode !== "guru" && mode !== "guruLogin" && mode !== "siswa" && mode !== "adminLogin" && mode !== "admin" && <AppHeader logoUrl={settings.logoUrl} namaSekolah={settings.namaSekolah} />}
      <main className="pb-10">
        {mode === "siswa" && <HalamanSiswa onMulaiUjian={handleMulaiUjian} onGuruMode={() => setMode("guruLogin")} onAdminMode={() => setMode("adminLogin")} mapelList={mapelList} asesmenList={asesmenList} logoUrl={settings.logoUrl} namaSekolah={settings.namaSekolah} />}
        {mode === "ujian" && siswa && <HalamanUjian siswa={siswa} addToast={addToast} onSelesai={handleSelesaiUjian} ns={siswa?.ns ?? ""} durasiMenit={settings.durasiMenit || 60} namaGuru={settings.namaGuru || ""} nipGuru={settings.nipGuru || ""} kotaTTD={settings.kotaTTD || ""} namaSekolah={settings.namaSekolah || ""} />}
        {mode === "guruLogin" && <GuruLogin onLogin={handleGuruLogin} />}
        {mode === "guru" && kelasAktif && <GuruPanel addToast={addToast} onLogout={handleGuruLogout} settings={settings} onSaveSettings={saveSettings} mapelList={mapelList} setMapelList={handleSetMapelList} asesmenList={asesmenList} setAsesmenList={handleSetAsesmenList} kelasAktif={kelasAktif} />}
        {mode === "adminLogin" && <AdminLogin onLogin={() => setMode("admin")} onBack={() => setMode("siswa")} />}
        {mode === "admin" && <AdminPanel addToast={addToast} onLogout={() => setMode("siswa")} />}
      </main>
    </div>
  );
}