// ===== Helpers =====
const fmtARS = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

const fmtNum = (n, digits = 2) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

function monthlyRateFromTNA(tnaPct) {
  // MVP: aproximación simple (TNA / 12). Si algún día querés TEA -> cambia.
  return (tnaPct / 100) / 12;
}

function frenchPayment(P, i, n) {
  if (i === 0) return P / n;
  const pow = Math.pow(1 + i, n);
  return P * (i * pow) / (pow - 1);
}

// ===== BCRA UVA fetch =====
// v3 está deprecada; en v4 buscamos el ID correcto listando y filtrando por descripción.
async function fetchUVA() {
  const listUrl = "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias?Limit=10000&Offset=0";
  const list = await (await fetch(listUrl)).json();
  const results = list.results || [];

  const uvaVar = results.find(v => {
    const d = (v.descripcion || "").toLowerCase().trim();
    return d === "unidad de valor adquisitivo (uva)" || d === "uva" || d.includes("unidad de valor adquisitivo");
  });

  if (!uvaVar) throw new Error("No encontré 'Unidad de Valor Adquisitivo (UVA)' en el listado del BCRA.");

  const id = uvaVar.idVariable;
  const detUrl = `https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/${id}?Limit=1&Offset=0`;
  const det = await (await fetch(detUrl)).json();

  const item = det.results?.[0]?.detalle?.[0];
  if (!item) throw new Error("Respuesta inesperada al pedir el detalle de UVA.");

  return { valor: Number(item.valor), fecha: item.fecha, idVariable: id, descripcion: uvaVar.descripcion };
}

// ===== UI =====
const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg || ""; }

function buildSchedule({ montoArs, plazo, tnaPct, inflacionPct, uvaHoy }) {
  const i = monthlyRateFromTNA(tnaPct);
  const infl = (inflacionPct / 100);

  const P_uva = montoArs / uvaHoy;
  const cuota_uva = frenchPayment(P_uva, i, plazo);

  let saldo = P_uva;
  const rows = [];

  for (let m = 1; m <= Math.min(plazo, 12); m++) {
    const interes = saldo * i;
    const amort = cuota_uva - interes;
    saldo = Math.max(0, saldo - amort);

    const uvaEst = uvaHoy * Math.pow(1 + infl, (m - 1)); // mes 1 usa UVA hoy
    const cuotaArs = cuota_uva * uvaEst;

    rows.push({ m, uvaEst, cuota_uva, cuotaArs, interes, amort, saldo });
  }

  return { P_uva, cuota_uva, rows };
}

function renderTable(rows) {
  const tbody = $("tabla");
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.m}</td>
      <td>${fmtNum(r.uvaEst, 2)}</td>
      <td>${fmtNum(r.cuota_uva, 4)}</td>
      <td>${fmtARS(r.cuotaArs)}</td>
      <td>${fmtNum(r.interes, 4)}</td>
      <td>${fmtNum(r.amort, 4)}</td>
      <td>${fmtNum(r.saldo, 4)}</td>
    </tr>
  `).join("");
}

function buildSummary({ montoArs, plazo, tnaPct, inflacionPct, uva, P_uva, cuota_uva }) {
  const cuotaArs1 = cuota_uva * uva.valor;
  return [
    `Simulador UVA (MVP)`,
    `UVA (${uva.fecha}): $${fmtNum(uva.valor, 2)}`,
    `Monto: ${fmtARS(montoArs)}`,
    `Plazo: ${plazo} meses`,
    `TNA: ${fmtNum(tnaPct, 2)}%`,
    `Inflación supuesta: ${fmtNum(inflacionPct, 2)}% mensual`,
    `Capital (UVA): ${fmtNum(P_uva, 4)}`,
    `Cuota fija (UVA): ${fmtNum(cuota_uva, 4)}`,
    `1ra cuota (ARS a UVA hoy): ${fmtARS(cuotaArs1)}`
  ].join("\n");
}

async function calcular() {
  try {
    setStatus("Buscando UVA en BCRA…");
    const uva = await fetchUVA();

    const montoArs = Number($("montoArs").value || 0);
    const plazo = Number($("plazo").value || 0);
    const tnaPct = Number($("tna").value || 0);
    const inflacionPct = Number($("inflacion").value || 0);

    if (montoArs <= 0 || plazo <= 0) throw new Error("Completá monto y plazo con valores válidos.");

    $("uvaActual").textContent = `$${fmtNum(uva.valor, 2)}`;
    $("uvaFecha").textContent = `Fecha: ${uva.fecha}`;

    const { P_uva, cuota_uva, rows } = buildSchedule({
      montoArs, plazo, tnaPct, inflacionPct, uvaHoy: uva.valor
    });

    $("capitalUva").textContent = fmtNum(P_uva, 4);
    $("cuotaUva").textContent = fmtNum(cuota_uva, 4);
    $("cuotaArs1").textContent = fmtARS(cuota_uva * uva.valor);

    renderTable(rows);

    // Guardar summary para copiar
    window.__summary = buildSummary({ montoArs, plazo, tnaPct, inflacionPct, uva, P_uva, cuota_uva });

    setStatus(`Listo. UVA tomada de BCRA (idVariable ${uva.idVariable}).`);
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message || e}`);
  }
}

$("btnCalcular").addEventListener("click", calcular);
$("btnCopiar").addEventListener("click", async () => {
  const text = window.__summary || "Primero calculá para generar el resumen.";
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Resumen copiado al portapapeles.");
  } catch {
    setStatus("No pude copiar automático. Seleccioná y copiá manualmente.");
  }
});

// Auto-cálculo al abrir
calcular();
