"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PX_PER_MM = 24; // export resolution (~610 dpi)
const MM_PER_INCH = 25.4;
const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const STYLES = {
  PSA: { border: "#C50212", width: 65, height: 20, grade: "GEM MT 10", uppercase: true },
  CGC: { border: "#000022", width: 65, height: 26, grade: "10", uppercase: false },
};
const CGC_AGENCY = "CERTIFIED GUARANTY COMPANY";
const CGC_GRADES = {
  10: "GEM MINT", 9: "MINT", 8: "NM/MT", 7: "NEAR MINT", 6: "EX/NM", 5: "EXCELLENT",
  4: "VG/EX", 3: "VERY GOOD", 2: "GOOD", 1: "POOR", 0: "NO GRADE",
};
const PAPERS = { "3x5": [3, 5], "4x6": [4, 6], "5x7": [5, 7], letter: [8.5, 11] }; // inches
const PDF_MARGIN_IN = 0.25;

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let customLogoSrc = null; // uploaded logo, overrides the style's default
let current = null;       // form values + loaded logo of the last generated label

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const randomAudit = () => String(Math.floor(1e8 + Math.random() * 9e8));
const randomNumber = () => "#" + (Math.floor(Math.random() * 1000) + 1);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

// Deterministic PRNG so the fake barcode is stable for a given audit number.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Set the canvas font, shrinking it so `text` fits within maxW.
function fitFont(ctx, text, size, maxW, weight = "") {
  const font = s => `${weight} ${s}px ${FONT_FAMILY}`.trim();
  ctx.font = font(size);
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = font(size * maxW / w);
}

// Recolor an image's opaque pixels (used to keep the white CGC logo visible on light borders).
function tint(img, color) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function download(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------------------
// Label rendering
// ---------------------------------------------------------------------------
function drawBarcode(ctx, d, x, top, bottom, maxW, unit) {
  const seed = parseInt(d.audit.replace(/\D/g, "").slice(0, 9) || "1", 10);
  const rnd = mulberry32(seed);
  const end = x + maxW;
  while (x < end) {
    const bar = Math.max(1, Math.round(unit * (0.6 + rnd() * 1.8)));
    if (x + bar > end) break;
    ctx.fillRect(x, top, bar, bottom - top);
    x += bar + Math.max(1, Math.round(unit * (0.5 + rnd() * 1.5)));
  }
}

function drawPSA(ctx, W, H, d) {
  // Border and background
  const bx = W * 0.03, by = H * 0.09;
  ctx.fillStyle = d.border;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = d.bg;
  ctx.fillRect(bx, by, W - 2 * bx, H - 2 * by);

  // Logo box, bottom centre, overlapping the bottom border
  const boxH = H * 0.27;
  const boxW = Math.min(W * 0.115, boxH * 1.9);
  const boxX = (W - boxW) / 2, boxY = H - boxH;
  ctx.fillStyle = "#e6e6e6";
  ctx.fillRect(boxX, boxY, boxW, boxH);
  if (d.logo) {
    const pad = boxH * 0.14;
    const s = Math.min((boxW - 2 * pad) / d.logo.width, (boxH - 2 * pad) / d.logo.height);
    const lw = d.logo.width * s, lh = d.logo.height * s;
    ctx.drawImage(d.logo, boxX + (boxW - lw) / 2, boxY + (boxH - lh) / 2, lw, lh);
  }

  // Text: four rows, titles on the left, details on the right
  const padX = bx + W * 0.025;
  const gap = W * 0.03;
  const fontSize = H * 0.125;
  const rowY = i => H * (0.265 + 0.165 * i);
  const maxWidth = {
    left: boxX - gap - padX,
    right: W - padX - (boxX + boxW + gap),
  };

  ctx.fillStyle = isDark(d.bg) ? "#f5f5f5" : "#1d1d1f";
  ctx.textBaseline = "middle";
  const put = (text, row, side) => {
    if (!text) return;
    fitFont(ctx, text, fontSize, maxWidth[side]);
    ctx.textAlign = side;
    ctx.fillText(text, side === "left" ? padX : W - padX, rowY(row));
  };
  put(d.title1, 0, "left");
  put(d.title2, 1, "left");
  put(d.title3, 2, "left");
  put(d.number, 0, "right");
  put(d.grade, 1, "right");
  put(d.autograph, 2, "right");
  put(d.audit, 3, "right");

  // Fake barcode under title 3
  const top = rowY(2) + fontSize * 0.75;
  const bottom = H - by - H * 0.03;
  if (bottom - top > H * 0.06) {
    drawBarcode(ctx, d, padX, top, bottom, Math.min(maxWidth.left, W * 0.3), H * 0.012);
  }
}

function drawCGC(ctx, W, H, d) {
  // Outer background (border color) with the agency strip on top
  ctx.fillStyle = d.border;
  ctx.fillRect(0, 0, W, H);
  const stripInk = isDark(d.border) ? "#ffffff" : "#111111";
  const m = W * 0.02;
  const stripH = H * 0.25;

  let textLeft = m;
  if (d.logo) {
    const maxH = stripH * 0.8, maxW = W * 0.2;
    const s = Math.min(maxH / d.logo.height, maxW / d.logo.width);
    const lw = d.logo.width * s, lh = d.logo.height * s;
    // The built-in CGC logo is white; recolor it when the border is light.
    const img = d.logoIsDefault && stripInk !== "#ffffff" ? tint(d.logo, stripInk) : d.logo;
    ctx.drawImage(img, m * 1.3, (stripH - lh) / 2, lw, lh);
    textLeft = m * 1.3 + lw + m;
  }
  ctx.fillStyle = stripInk;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  fitFont(ctx, d.agency, H * 0.075, W - m - textLeft, "bold");
  ctx.fillText(d.agency, W - m - (W - 2 * m) * 0.03, stripH * 0.52);

  // Text box
  const bx = m, by = stripH, bw = W - 2 * m, bh = H - stripH - m;
  ctx.fillStyle = d.bg;
  ctx.fillRect(bx, by, bw, bh);
  const ink = isDark(d.bg) ? "#f5f5f5" : "#1d1d1f";
  ctx.fillStyle = ink;

  const divX = bx + bw * 0.72;
  const gap = bw * 0.03;
  const padX = bx + bw * 0.03;
  ctx.fillRect(divX, by + bh * 0.1, Math.max(1, H * 0.008), bh * 0.8);

  // Bold titles
  ctx.textAlign = "left";
  const lineMax = divX - gap - padX;
  [d.title1, d.title2, d.title3].forEach((text, i) => {
    if (!text) return;
    fitFont(ctx, text, H * 0.085, lineMax, "bold");
    ctx.fillText(text, padX, by + bh * (0.17 + 0.2 * i));
  });

  // Barcode and audit number along the bottom of the box
  const bcTop = by + bh * 0.72, bcBottom = by + bh * 0.9;
  const bcW = Math.min(bw * 0.38, lineMax * 0.6);
  drawBarcode(ctx, d, padX, bcTop, bcBottom, bcW, H * 0.009);
  fitFont(ctx, d.audit, H * 0.072, divX - gap - (padX + bcW + gap));
  ctx.textBaseline = "alphabetic";
  ctx.fillText(d.audit, padX + bcW + gap, bcBottom);
  ctx.textBaseline = "middle";

  // Grade on the right
  const cx = divX + (bx + bw - divX) / 2;
  const gradeMax = bx + bw - divX - 2 * gap;
  ctx.textAlign = "center";
  fitFont(ctx, CGC_GRADES[d.grade] || "", H * 0.055, gradeMax, "bold");
  ctx.fillText(CGC_GRADES[d.grade] || "", cx, by + bh * 0.2);
  fitFont(ctx, d.grade, H * 0.3, gradeMax, "bold");
  ctx.fillText(d.grade, cx, by + bh * 0.58);
}

function drawLabel(canvas, d) {
  const W = Math.round(d.width * PX_PER_MM);
  const H = Math.round(d.height * PX_PER_MM);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  (d.style === "CGC" ? drawCGC : drawPSA)(ctx, W, H, d);
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------
const RANDOM_FIELDS = ["number", "audit"];
const edited = new Set(); // fields the user has typed in (so we stop overwriting them)

const style = () => document.querySelector("input[name=style]:checked").value;

function rerollUnlessEdited(id, generate) {
  if (!edited.has(id) || !$(id).value.trim()) {
    edited.delete(id);
    $(id).value = generate();
  }
}

// Show only the fields that apply to the selected style and update defaults.
function applyStyle() {
  const s = style();
  const cfg = STYLES[s];
  document.body.dataset.style = s;
  document.querySelectorAll("[data-style-only]").forEach(el => {
    el.hidden = el.dataset.styleOnly !== s;
  });

  const grade = $("grade");
  grade.value = "";
  grade.placeholder = cfg.grade;
  grade.type = s === "CGC" ? "number" : "text";
  grade.min = 0; grade.max = 10; grade.step = 1;
  if (s !== "CGC") ["min", "max", "step"].forEach(a => grade.removeAttribute(a));

  $("width").placeholder = cfg.width;
  $("height").placeholder = cfg.height;
  if (!edited.has("borderColor")) $("borderColor").value = cfg.border;
}

RANDOM_FIELDS.concat("borderColor").forEach(id =>
  $(id).addEventListener("input", () => edited.add(id)));
document.querySelectorAll("input[name=style]").forEach(r => r.addEventListener("change", applyStyle));

function readForm() {
  const s = style();
  const cfg = STYLES[s];
  const positive = (id, fallback) => {
    const v = parseFloat($(id).value);
    return v > 0 ? v : fallback;
  };
  const text = id => {
    const v = $(id).value.trim();
    return cfg.uppercase ? v.toUpperCase() : v;
  };

  // Number and audit are re-rolled on every Generate unless the user typed their own.
  rerollUnlessEdited("number", randomNumber);
  rerollUnlessEdited("audit", randomAudit);

  return {
    style: s,
    title1: text("title1"), title2: text("title2"), title3: text("title3"),
    number: text("number"), autograph: text("autograph"), audit: text("audit"),
    grade: $("grade").value.trim().toUpperCase() || cfg.grade,
    agency: ($("agency").value.trim() || CGC_AGENCY).toUpperCase(),
    border: $("borderColor").value, bg: $("bgColor").value,
    width: positive("width", cfg.width),
    height: positive("height", cfg.height),
  };
}

$("number").value = randomNumber();
$("audit").value = randomAudit();
applyStyle();

$("logo").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) { customLogoSrc = null; return; }
  const reader = new FileReader();
  reader.onload = () => { customLogoSrc = reader.result; };
  reader.readAsDataURL(file);
});

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const d = readForm();
  d.logoIsDefault = !customLogoSrc;
  try {
    d.logo = await loadImage(customLogoSrc || DEFAULT_LOGOS[d.style]);
  } catch {
    d.logo = null;
    alert("Could not load that logo image.");
  }
  drawLabel($("labelCanvas"), d);
  current = d;
  $("preview").hidden = false;
  $("preview").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const fileBase = () => (current.title1 || "label").replace(/[^\w-]+/g, "_").slice(0, 40) + "_label";

// Draw fresh on an offscreen canvas so exports never include preview styling.
function renderExport() {
  const canvas = document.createElement("canvas");
  drawLabel(canvas, current);
  return canvas;
}

$("pngBtn").addEventListener("click", () => {
  renderExport().toBlob(blob => {
    const url = URL.createObjectURL(blob);
    download(url, fileBase() + ".png");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});

$("pdfBtn").addEventListener("click", () => $("pdfDialog").showModal());
$("pdfCancel").addEventListener("click", () => $("pdfDialog").close());

$("pdfForm").addEventListener("submit", () => {
  const [short, long] = PAPERS[$("paper").value];
  const margin = $("margins").checked ? PDF_MARGIN_IN : 0;
  const pageW = long, pageH = short; // always landscape

  // Label keeps its real size unless it won't fit the page.
  const labelW = current.width / MM_PER_INCH;
  const labelH = current.height / MM_PER_INCH;
  const scale = Math.min(1, (pageW - 2 * margin) / labelW, (pageH - 2 * margin) / labelH);

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "in", format: [pageW, pageH], orientation: "landscape" });
  pdf.addImage(renderExport().toDataURL("image/png"), "PNG", margin, margin, labelW * scale, labelH * scale);
  pdf.save(fileBase() + ".pdf");
});
