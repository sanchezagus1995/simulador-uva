// simulador.js

// ===== Helpers =====
const fmtARS = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

const fmtNum = (n, digits = 2) =>
  new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function monthlyRateFromTNA(tnaPct) {
  return (Number(tnaPct) / 100) / 12;
}

function frenchPayment(P, i, n) {
  if (i === 0) return P / n;
  const pow = Math.pow(1 + i, n);
  return P * (i * pow) / (pow - 1);
}

// ===== BCRA UVA =====
async function fetchUVA() {
  const listUrl =
    "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias?Limit=10000&Offset=0";

  const listResp = await fetch(listUrl);
  const list = await listResp.json();
  const results = list.results || [];

  const uvaVar = results.find((v) => {
    const d = (v.descripcion || "").toLowerCase().trim();
    return (
      d === "unidad de valor adquisitivo (uva)" ||
      d === "uva" ||
      d.includes("unidad de valor adquisitivo")
    );
  });

  if (!uvaVar) {
    throw new Error("No encontré la variable UVA en el listado del BCRA.");
  }

  const id = uvaVar.idVariable;
  const detUrl = `https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/${id}`;

  const detResp = await fetch(detUrl);
  const det = await detResp.json();

  const serie = det.results?.[0]?.detalle || [];

  if (!serie.length) {
    throw new Error("No se encontró la serie de UVA.");
  }

  // Fecha local de Argentina, no UTC
  const hoy = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  // Tomar solo fechas <= hoy
  const seriePasadaOVigente = serie.filter((d) => d.fecha <= hoy);

  if (!seriePasadaOVigente.length) {
    throw new Error("No encontré un valor de UVA vigente para hoy o una fecha anterior.");
  }

  // Nos quedamos con la más reciente <= hoy
  const datoVigente = seriePasadaOVigente.reduce((a, b) =>
    a.fecha > b.fecha ? a : b
  );

  return {
    valor: Number(datoVigente.valor),
    fecha: datoVigente.fecha,
    idVariable: id,
    descripcion: uvaVar.descripcion,
  };
}

// ===== Cálculo =====
function buildSchedule({ montoArs, plazo, tnaPct, inflacionPct, uvaHoy }) {
  const i = monthlyRateFromTNA(tnaPct);
  const infl = Number(inflacionPct) / 100;

  const capitalInicialUva = montoArs / uvaHoy;
  const cuotaPuraUvaFija = frenchPayment(capitalInicialUva, i, plazo);

  let saldo = capitalInicialUva;
  const rows = [];

  for (let cuota = 1; cuota <= Math.min(plazo, 12); cuota++) {
    const interesUva = saldo * i;
    const capitalUva = cuotaPuraUvaFija - interesUva;
    const saldoNuevo = Math.max(0, saldo - capitalUva);

    const uvaEstimada = uvaHoy * Math.pow(1 + infl, cuota - 1);

    const ivaUva = interesUva * 0.21;
    const cuotaPuraUva = capitalUva + interesUva;
    const totalCuotaUva = cuotaPuraUva + ivaUva;
    const totalCuotaArs = totalCuotaUva * uvaEstimada;

    rows.push({
      cuota,
      capitalUva,
      interesUva,
      ivaUva,
      cuotaPuraUva,
      totalCuotaUva,
      totalCuotaArs,
      uvaEstimada,
      saldoUva: saldoNuevo,
    });

    saldo = saldoNuevo;
  }

  return {
    capitalInicialUva,
    cuotaPuraUvaFija,
    rows,
  };
}

// ===== Render =====
function renderTable(rows) {
  const tbody = $("tabla");

  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.cuota}</td>
        <td>${fmtNum(r.capitalUva, 4)}</td>
        <td>${fmtNum(r.interesUva, 4)}</td>
        <td>${fmtNum(r.ivaUva, 4)}</td>
        <td>${fmtNum(r.cuotaPuraUva, 4)}</td>
        <td>${fmtNum(r.totalCuotaUva, 4)}</td>
        <td>${fmtARS(r.totalCuotaArs)}</td>
      </tr>
    `
    )
    .join("");
}

function buildSummary({
  montoArs,
  plazo,
  tnaPct,
  inflacionPct,
  uva,
  capitalInicialUva,
  cuotaPuraUvaFija,
  totalCuotaArs1,
}) {
  return [
    "Simulador UVA",
    `UVA (${uva.fecha}): $${fmtNum(uva.valor, 2)}`,
    `Monto: ${fmtARS(montoArs)}`,
    `Plazo: ${plazo} meses`,
    `TNA: ${fmtNum(tnaPct, 2)}%`,
    `Inflación supuesta: ${fmtNum(inflacionPct, 2)}% mensual`,
    `Capital inicial (UVA): ${fmtNum(capitalInicialUva, 4)}`,
    `Cuota pura fija (UVA): ${fmtNum(cuotaPuraUvaFija, 4)}`,
    `1ra cuota total (ARS): ${fmtARS(totalCuotaArs1)}`,
  ].join("\n");
}

// ===== Principal =====
async function calcular() {
  try {
    setStatus("Buscando UVA en BCRA...");

    const montoArs = Number($("montoArs").value || 0);
    const plazo = Number($("plazo").value || 0);
    const tnaPct = Number($("tna").value || 0);
    const inflacionPct = Number($("inflacion").value || 0);

    if (montoArs <= 0 || plazo <= 0) {
      throw new Error("Completá monto y plazo con valores válidos.");
    }

    const uva = await fetchUVA();

    $("uvaActual").textContent = `$${fmtNum(uva.valor, 2)}`;
    $("uvaFecha").textContent = `Fecha: ${uva.fecha}`;

    const { capitalInicialUva, cuotaPuraUvaFija, rows } = buildSchedule({
      montoArs,
      plazo,
      tnaPct,
      inflacionPct,
      uvaHoy: uva.valor,
    });

    $("capitalUva").textContent = fmtNum(capitalInicialUva, 4);
    $("cuotaUva").textContent = fmtNum(cuotaPuraUvaFija, 4);

    const primera = rows[0];
    $("cuotaArs1").textContent = fmtARS(primera.totalCuotaArs);

    renderTable(rows);

    window.__summary = buildSummary({
      montoArs,
      plazo,
      tnaPct,
      inflacionPct,
      uva,
      capitalInicialUva,
      cuotaPuraUvaFija,
      totalCuotaArs1: primera.totalCuotaArs,
    });

    setStatus(`Listo. UVA tomada de BCRA (${uva.fecha}).`);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message || error}`);
  }
}

// ===== Eventos =====
$("btnCalcular").addEventListener("click", calcular);

$("btnCopiar").addEventListener("click", async () => {
  const text = window.__summary || "Primero calculá para generar el resumen.";

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Resumen copiado al portapapeles.");
  } catch (error) {
    console.error(error);
    setStatus("No pude copiar el resumen.");
  }
});

// Mensaje inicial
setStatus("Ingresá los datos y presioná Calcular.");
