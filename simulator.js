// simulador.js

// ===== Helpers =====
const fmtARS = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

const fmtNum = (n, digits = 2) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

function monthlyRateFromTNA(tnaPct) {
  // MVP: aproximación simple (TNA / 12).
  return (tnaPct / 100) / 12;
}

function frenchPayment(P, i, n) {
  if (i === 0) return P / n;
  const pow = Math.pow(1 + i, n);
  return P * (i * pow) / (pow - 1);
}

// ===== BCRA UVA fetch (v4) =====
// v3 está deprecada; en v4 listamos variables y buscamos "Unidad de Valor Adquisitivo (UVA)".

// ===== UI =====
const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg || ""; }

function buildSchedule({ montoArs, plazo, tnaPct, inflacionPct, uvaHoy }) {
  const i = monthlyRateFromTNA(tnaPct);
  const infl = (inflacionPct / 100);

  // Capital en UVA (se “indexa” automáticamente cuando lo pasás a pesos)
  const P_uva = montoArs / uvaHoy;

  // Cuota fija en UVA por sistema francés
  const cuota_uva = frenchPayment(P_uva, i, plazo);

  let saldo = P_uva;
  const rows = [];

  for (let m = 1; m <= Math.min(plazo, 12); m++) {
    // Interés y amortización en UVA
    const interes_uva = saldo * i;
    const capital_uva = cuota_uva - interes_uva; // amortización
    saldo = Math.max(0, saldo - capital_uva);

    // UVA estimada del mes (para convertir a pesos). Mes 1 usa UVA de hoy.
    const uvaEst = uvaHoy * Math.pow(1 + infl, (m - 1));

    // IVA: en la práctica suele calcularse sobre el interés.
    const iva_uva = interes_uva * 0.21;

    // Cuota pura (capital + interés), y cuota total en UVA (sumando IVA)
    const cuota_pura_uva = capital_uva + interes_uva; // = cuota_uva (por definición)
    const total_cuota_uva = cuota_pura_uva + iva_uva;

    // Total cuota en pesos (según UVA del mes)
    const total_cuota_ars = total_cuota_uva * uvaEst;

    rows.push({
      m,
      capital_uva,
      interes_uva,
      iva_uva,
      cuota_pura_uva,
      total_cuota_uva,
      total_cuota_ars,
      uvaEst,
      saldo
    });
  }

  return { P_uva, cuota_uva, rows };
}

function renderTable(rows) {
  const tbody = $("tabla");
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.m}</td>
      <td>${fmtNum(r.capital_uva, 4)}</td>
      <td>${fmtNum(r.interes_uva, 4)}</td>
      <td>${fmtNum(r.iva_uva, 4)}</td>
      <td>${fmtNum(r.cuota_pura_uva, 4)}</td>
      <td>${fmtNum(r.total_cuota_uva, 4)}</td>
      <td>${fmtARS(r.total_cuota_ars)}</td>
    </tr>
  `).join("");
}

function buildSummary({ montoArs, plazo, tnaPct, inflacionPct, uva, P_uva, cuota_uva, totalCuotaArs1 }) {
  return [
    `Simulador UVA (MVP)`,
    `UVA (${uva.fecha}): $${fmtNum(uva.valor, 2)} (BCRA idVariable ${uva.idVariable})`,
    `Monto: ${fmtARS(montoArs)}`,
    `Plazo: ${plazo} meses`,
    `TNA: ${fmtNum(tnaPct, 2)}%`,
    `Inflación supuesta: ${fmtNum(inflacionPct, 2)}% mensual`,
    `Capital (UVA): ${fmtNum(P_uva, 4)}`,
    `Cuota fija (UVA): ${fmtNum(cuota_uva, 4)}`,
    `1ra cuota TOTAL (ARS, incluye IVA sobre interés): ${fmtARS(totalCuotaArs1)}`
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

    // KPIs
    $("capitalUva").textContent = fmtNum(P_uva, 4);
    $("cuotaUva").textContent = fmtNum(cuota_uva, 4);

    // 1ra cuota TOTAL en ARS (sumando IVA sobre interés), usando UVA de hoy
    const first = rows[0];
    const totalCuotaArs1 = first.total_cuota_ars;
    $("cuotaArs1").textContent = fmtARS(totalCuotaArs1);

    renderTable(rows);

    // Guardar summary para copiar
    window.__summary = buildSummary({
      montoArs, plazo, tnaPct, inflacionPct, uva, P_uva, cuota_uva, totalCuotaArs1
    });

    setStatus(`Listo. UVA tomada de BCRA (idVariable ${uva.idVariable}).`);
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message || e}`);
  }
}

// Listeners
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
