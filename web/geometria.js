// Conti di posizione senza dipendenze: li usa la pagina e li prova test/geometria.test.js.
(function (radice) {
  'use strict';
  const GRADI = Math.PI / 180;
  const A = 6378137.0;                    // semiasse dell'ellissoide WGS84, metri
  const F = 1 / 298.257223563;
  const E2 = F * (2 - F);
  const R_MEDIO = 6371008.8;              // raggio medio della Terra, metri
  const R_EQUATORE_KM = 6378.137;

  function ecef(latG, lonG, quota) {
    const lat = latG * GRADI, lon = lonG * GRADI;
    const s = Math.sin(lat), c = Math.cos(lat);
    const n = A / Math.sqrt(1 - E2 * s * s);
    return [(n + quota) * c * Math.cos(lon), (n + quota) * c * Math.sin(lon), (n * (1 - E2) + quota) * s];
  }

  // Dove si vede un punto dall'osservatore: azimut in gradi da nord verso est,
  // elevazione in gradi sopra l'orizzonte, distanza in metri.
  function osserva(oss, latG, lonG, quota) {
    const o = ecef(oss.lat, oss.lon, oss.quota || 0), p = ecef(latG, lonG, quota);
    return orizzontali(oss, p[0] - o[0], p[1] - o[1], p[2] - o[2]);
  }

  // Da uno spostamento nel sistema terrestre (metri) ad azimut, elevazione e distanza.
  function orizzontali(oss, dx, dy, dz) {
    const lat = oss.lat * GRADI, lon = oss.lon * GRADI;
    const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
    const est = -so * dx + co * dy;
    const nord = -sl * co * dx - sl * so * dy + cl * dz;
    const su = cl * co * dx + cl * so * dy + sl * dz;
    const orizzontale = Math.hypot(est, nord);
    return {
      az: (Math.atan2(est, nord) / GRADI + 360) % 360,
      el: Math.atan2(su, orizzontale) / GRADI,
      dist: Math.hypot(orizzontale, su),
    };
  }

  // Distanza dal centro della cupola, con l'orizzonte a 1. Proiezione stereografica, come nei
  // planisferi celesti: rispetto a una scala lineare allarga di metà la fascia vicina
  // all'orizzonte, dove stanno quasi tutti gli aerei, e stringe quella vicina allo zenit.
  function raggioCupola(el) {
    return Math.tan((90 - el) / 2 * GRADI);
  }

  // La cupola sul piano: zenit al centro, orizzonte sul cerchio di raggio 1.
  // Dal basso (sdraiati a guardare in su) l'est sta a sinistra del nord, come nel cielo vero;
  // dall'alto è come su una carta. `nord` è l'angolo, in senso orario dall'alto dello schermo,
  // a cui finisce il nord. Coordinate dello schermo: x verso destra, y verso il basso.
  function proietta(az, el, nord, dalBasso) {
    const r = raggioCupola(el);
    const a = az * GRADI;
    const x = (dalBasso ? -1 : 1) * Math.sin(a) * r;
    const y = -Math.cos(a) * r;
    const t = nord * GRADI, c = Math.cos(t), s = Math.sin(t);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  function distanza(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * GRADI, p2 = lat2 * GRADI;
    const dp = p2 - p1, dl = (lon2 - lon1) * GRADI;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_MEDIO * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function rilevamento(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * GRADI, p2 = lat2 * GRADI, dl = (lon2 - lon1) * GRADI;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / GRADI + 360) % 360;
  }

  // Il punto raggiunto partendo da lat/lon con la rotta data, dopo `metri` lungo il cerchio massimo.
  function avanza(latG, lonG, rottaG, metri) {
    const d = metri / R_MEDIO, t = rottaG * GRADI, p1 = latG * GRADI, l1 = lonG * GRADI;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / GRADI, lon: ((l2 / GRADI + 540) % 360) - 180 };
  }

  function differenzaAngoli(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
  }

  // Le rotte vengono da archivi compilati da volontari e a volte sono vecchie: un nominativo
  // può essere passato a un altro collegamento. Qui si guarda se l'aereo sta davvero tra
  // partenza e arrivo e se punta verso l'arrivo.
  function rottaCoerente(aereo, partenza, arrivo) {
    if (![partenza.lat, partenza.lon, arrivo.lat, arrivo.lon].every(Number.isFinite)) return null;
    const totale = distanza(partenza.lat, partenza.lon, arrivo.lat, arrivo.lon);
    const daPartenza = distanza(partenza.lat, partenza.lon, aereo.lat, aereo.lon);
    const aArrivo = distanza(aereo.lat, aereo.lon, arrivo.lat, arrivo.lon);
    const vicino = 80000;
    if (daPartenza < vicino || aArrivo < vicino) return true;     // in salita o in avvicinamento: rotte storte
    const deviazione = Math.asin(Math.sin(daPartenza / R_MEDIO) *
      Math.sin((rilevamento(partenza.lat, partenza.lon, aereo.lat, aereo.lon) -
        rilevamento(partenza.lat, partenza.lon, arrivo.lat, arrivo.lon)) * GRADI)) * R_MEDIO;
    if (Math.abs(deviazione) > Math.max(120000, 0.15 * totale)) return false;
    if (daPartenza + aArrivo > totale * 1.3 + 100000) return false;
    if (Number.isFinite(aereo.rotta) &&
      differenzaAngoli(aereo.rotta, rilevamento(aereo.lat, aereo.lon, arrivo.lat, arrivo.lon)) > 90) return false;
    return true;
  }

  function giornoGiuliano(data) {
    return data.getTime() / 86400000 + 2440587.5;
  }

  // Tempo siderale medio di Greenwich, in radianti (formula IAU 1982).
  function tempoSiderale(data) {
    const t = (giornoGiuliano(data) - 2451545.0) / 36525;
    const secondi = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
    return ((secondi % 86400 + 86400) % 86400) / 240 * GRADI;
  }

  // Direzione del Sole nel sistema equatoriale (versore), con la formula a bassa precisione
  // dell'Astronomical Almanac: basta e avanza per giorno, notte e ombra della Terra.
  function direzioneSole(data) {
    const n = giornoGiuliano(data) - 2451545.0;
    const l = (280.460 + 0.9856474 * n) * GRADI;
    const g = (357.528 + 0.9856003 * n) * GRADI;
    const lambda = l + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * GRADI;
    const eps = (23.439 - 0.0000004 * n) * GRADI;
    return [Math.cos(lambda), Math.cos(eps) * Math.sin(lambda), Math.sin(eps) * Math.sin(lambda)];
  }

  function posizioneSole(data, oss) {
    const [x, y, z] = direzioneSole(data);
    const ascensione = Math.atan2(y, x), declinazione = Math.asin(z);
    const angoloOrario = tempoSiderale(data) + oss.lon * GRADI - ascensione;
    const lat = oss.lat * GRADI;
    const el = Math.asin(Math.sin(lat) * Math.sin(declinazione) +
      Math.cos(lat) * Math.cos(declinazione) * Math.cos(angoloOrario));
    const az = Math.atan2(-Math.cos(declinazione) * Math.sin(angoloOrario),
      Math.sin(declinazione) * Math.cos(lat) - Math.cos(declinazione) * Math.sin(lat) * Math.cos(angoloOrario));
    return { az: (az / GRADI + 360) % 360, el: el / GRADI };
  }

  // Un satellite (posizione equatoriale in km) è al buio se sta dietro la Terra rispetto al Sole,
  // dentro il cilindro d'ombra.
  function inOmbra(posizioneKm, sole) {
    const p = posizioneKm.x * sole[0] + posizioneKm.y * sole[1] + posizioneKm.z * sole[2];
    if (p > 0) return false;
    const r2 = posizioneKm.x ** 2 + posizioneKm.y ** 2 + posizioneKm.z ** 2;
    return r2 - p * p < R_EQUATORE_KM ** 2;
  }

  // ---------- Luna e pianeti ----------
  // Elementi orbitali e perturbazioni di Paul Schlyter, "How to compute planetary positions":
  // un paio di primi d'arco di errore, riferiti all'equinozio della data come il tempo siderale.
  // Per ciascuno: N, i, w (gradi), a (UA; raggi terrestri per la Luna), e, M (gradi),
  // ognuno come [valore il 31/12/1999, variazione al giorno].
  const ELEMENTI = {
    Luna: [[125.1228, -0.0529538083], [5.1454, 0], [318.0634, 0.1643573223], [60.2666, 0], [0.0549, 0], [115.3654, 13.0649929509]],
    Mercurio: [[48.3313, 3.24587e-5], [7.0047, 5.0e-8], [29.1241, 1.01444e-5], [0.387098, 0], [0.205635, 5.59e-10], [168.6562, 4.0923344368]],
    Venere: [[76.6799, 2.4659e-5], [3.3946, 2.75e-8], [54.891, 1.38374e-5], [0.72333, 0], [0.006773, -1.302e-9], [48.0052, 1.6021302244]],
    Marte: [[49.5574, 2.11081e-5], [1.8497, -1.78e-8], [286.5016, 2.92961e-5], [1.523688, 0], [0.093405, 2.516e-9], [18.6021, 0.5240207766]],
    Giove: [[100.4542, 2.76854e-5], [1.303, -1.557e-7], [273.8777, 1.64505e-5], [5.20256, 0], [0.048498, 4.469e-9], [19.895, 0.0830853001]],
    Saturno: [[113.6634, 2.3898e-5], [2.4886, -1.081e-7], [339.3939, 2.97661e-5], [9.55475, 0], [0.055546, -9.499e-9], [316.967, 0.0334442282]],
    Urano: [[74.0005, 1.3978e-5], [0.7733, 1.9e-8], [96.6612, 3.0565e-5], [19.18171, -1.55e-8], [0.047318, 7.45e-9], [142.5905, 0.011725806]],
    Nettuno: [[131.7806, 3.0173e-5], [1.77, -2.55e-7], [272.8461, -6.027e-6], [30.05826, 3.313e-8], [0.008606, 2.15e-9], [260.2471, 0.005995147]],
  };
  // Magnitudine: costante e coefficienti dell'angolo di fase (Astronomical Almanac 1984, in Meeus);
  // per Saturno si aggiungono gli anelli, secondo quanto sono inclinati verso di noi.
  const LUMINOSITA = {
    Mercurio: [-0.42, 0.038, -0.000273, 0.000002], Venere: [-4.4, 0.0009, 0.000239, -0.00000065],
    Marte: [-1.52, 0.016, 0, 0], Giove: [-9.4, 0.005, 0, 0], Saturno: [-8.88, 0, 0, 0],
    Urano: [-7.19, 0, 0, 0], Nettuno: [-6.87, 0, 0, 0],
  };
  const UA_KM = 149597870.7;
  const RAGGIO_TERRESTRE_KM = 6378.14;
  const seno = (g) => Math.sin(g * GRADI), coseno = (g) => Math.cos(g * GRADI);
  const giro = (g) => ((g % 360) + 360) % 360;

  function orbita(elementi, d) {
    const [N, i, w, a, e, M] = elementi.map(([v, al_giorno]) => v + al_giorno * d);
    return { N: giro(N), i, w: giro(w), a, e, M: giro(M) };
  }

  // Equazione di Keplero: distanza e anomalia vera.
  function keplero(o) {
    let E = o.M + o.e / GRADI * seno(o.M) * (1 + o.e * coseno(o.M));
    for (let k = 0; k < 20; k++) {
      const passo = (E - o.e / GRADI * seno(E) - o.M) / (1 - o.e * coseno(E));
      E -= passo;
      if (Math.abs(passo) < 1e-8) break;
    }
    const x = o.a * (coseno(E) - o.e), y = o.a * Math.sqrt(1 - o.e * o.e) * seno(E);
    return { r: Math.hypot(x, y), v: Math.atan2(y, x) / GRADI };
  }

  // Longitudine, latitudine eclittiche (gradi) e distanza attorno al corpo centrale.
  function eclittiche(o) {
    const { r, v } = keplero(o);
    const u = v + o.w;
    const x = r * (coseno(o.N) * coseno(u) - seno(o.N) * seno(u) * coseno(o.i));
    const y = r * (seno(o.N) * coseno(u) + coseno(o.N) * seno(u) * coseno(o.i));
    const z = r * seno(u) * seno(o.i);
    return { lon: giro(Math.atan2(y, x) / GRADI), lat: Math.atan2(z, Math.hypot(x, y)) / GRADI, r };
  }

  const cartesiane = (p) => [p.r * coseno(p.lat) * coseno(p.lon), p.r * coseno(p.lat) * seno(p.lon), p.r * seno(p.lat)];

  function perturbazioni(nome, p, d) {
    const Mj = orbita(ELEMENTI.Giove, d).M, Ms = orbita(ELEMENTI.Saturno, d).M, Mu = orbita(ELEMENTI.Urano, d).M;
    if (nome === 'Giove') {
      p.lon += -0.332 * seno(2 * Mj - 5 * Ms - 67.6) - 0.056 * seno(2 * Mj - 2 * Ms + 21) + 0.042 * seno(3 * Mj - 5 * Ms + 21)
        - 0.036 * seno(Mj - 2 * Ms) + 0.022 * coseno(Mj - Ms) + 0.023 * seno(2 * Mj - 3 * Ms + 52) - 0.016 * seno(Mj - 5 * Ms - 69);
    } else if (nome === 'Saturno') {
      p.lon += 0.812 * seno(2 * Mj - 5 * Ms - 67.6) - 0.229 * coseno(2 * Mj - 4 * Ms - 2) + 0.119 * seno(Mj - 2 * Ms - 3)
        + 0.046 * seno(2 * Mj - 6 * Ms - 69) + 0.014 * seno(Mj - 3 * Ms + 32);
      p.lat += -0.02 * coseno(2 * Mj - 4 * Ms - 2) + 0.018 * seno(2 * Mj - 6 * Ms - 49);
    } else if (nome === 'Urano') {
      p.lon += 0.04 * seno(Ms - 2 * Mu + 6) + 0.035 * seno(Ms - 3 * Mu + 33) - 0.015 * seno(Mj - Mu + 20);
    }
    return p;
  }

  function luna(d, sole) {
    const o = orbita(ELEMENTI.Luna, d);
    const p = eclittiche(o);
    const Ms = sole.M, Mm = o.M;
    const Ls = sole.M + sole.w, Lm = o.M + o.w + o.N;
    const D = Lm - Ls, F = Lm - o.N;
    p.lon += -1.274 * seno(Mm - 2 * D) + 0.658 * seno(2 * D) - 0.186 * seno(Ms) - 0.059 * seno(2 * Mm - 2 * D)
      - 0.057 * seno(Mm - 2 * D + Ms) + 0.053 * seno(Mm + 2 * D) + 0.046 * seno(2 * D - Ms) + 0.041 * seno(Mm - Ms)
      - 0.035 * seno(D) - 0.031 * seno(Mm + Ms) - 0.015 * seno(2 * F - 2 * D) + 0.011 * seno(Mm - 4 * D);
    p.lat += -0.173 * seno(F - 2 * D) - 0.055 * seno(Mm - F - 2 * D) - 0.046 * seno(Mm + F - 2 * D)
      + 0.033 * seno(F + 2 * D) + 0.017 * seno(2 * Mm + F);
    p.r += -0.58 * coseno(Mm - 2 * D) - 0.46 * coseno(2 * D);
    p.r *= RAGGIO_TERRESTRE_KM;
    return p;
  }

  // Luna e pianeti visti dal centro della Terra, nel sistema equatoriale della data (km),
  // con la magnitudine e, per la Luna, la parte illuminata.
  function corpiCelesti(data) {
    const d = giornoGiuliano(data) - 2451543.5;
    const eclittica = 23.4393 - 3.563e-7 * d;
    const sole = { N: 0, i: 0, w: giro(282.9404 + 4.70935e-5 * d), a: 1, e: 0.016709 - 1.151e-9 * d, M: giro(356.047 + 0.9856002585 * d) };
    const ks = keplero(sole);
    const lonSole = giro(ks.v + sole.w);
    const xyzSole = [ks.r * coseno(lonSole), ks.r * seno(lonSole), 0];
    const equatoriali = ([x, y, z], scala) => [x * scala, (y * coseno(eclittica) - z * seno(eclittica)) * scala,
      (y * seno(eclittica) + z * coseno(eclittica)) * scala];

    const corpi = [];
    const pl = luna(d, sole);
    const allungamento = Math.acos(coseno(pl.lat) * coseno(pl.lon - lonSole)) / GRADI;
    corpi.push({
      nome: 'Luna', vettore: equatoriali(cartesiane(pl), 1), distanzaKm: pl.r,
      illuminata: (1 - coseno(allungamento)) / 2, crescente: giro(pl.lon - lonSole) < 180, allungamento,
      magnitudine: -12.7,
    });
    for (const nome of Object.keys(LUMINOSITA)) {
      const o = orbita(ELEMENTI[nome], d);
      const helio = perturbazioni(nome, eclittiche(o), d);
      const h = cartesiane(helio);
      const g = [h[0] + xyzSole[0], h[1] + xyzSole[1], h[2] + xyzSole[2]];
      const delta = Math.hypot(...g);
      const fase = Math.acos(Math.max(-1, Math.min(1, (helio.r ** 2 + delta ** 2 - ks.r ** 2) / (2 * helio.r * delta)))) / GRADI;
      const [k0, k1, k2, k3] = LUMINOSITA[nome];
      const cosAll = (g[0] * xyzSole[0] + g[1] * xyzSole[1] + g[2] * xyzSole[2]) / (delta * ks.r);
      let magnitudine = k0 + 5 * Math.log10(helio.r * delta) + k1 * fase + k2 * fase ** 2 + k3 * fase ** 3;
      if (nome === 'Saturno') {
        const t = d / 36525, lambda = Math.atan2(g[1], g[0]) / GRADI, beta = Math.asin(g[2] / delta) / GRADI;
        const i = 28.075216 - 0.012998 * t, nodo = 169.50847 + 1.394681 * t;
        const b = Math.abs(Math.asin(seno(i) * coseno(beta) * seno(lambda - nodo) - coseno(i) * seno(beta)));
        magnitudine += -2.6 * Math.sin(b) + 1.25 * Math.sin(b) ** 2;
      }
      corpi.push({
        nome, vettore: equatoriali(g, UA_KM), distanzaKm: delta * UA_KM, magnitudine,
        allungamento: Math.acos(Math.max(-1, Math.min(1, cosAll))) / GRADI,
      });
    }
    return corpi;
  }

  // Azimut ed elevazione di un corpo dato nel sistema equatoriale della data (km dal centro
  // della Terra), visto dall'osservatore: per la Luna la differenza arriva a un grado.
  function osservaCorpo(vettoreKm, data, oss) {
    const g = tempoSiderale(data), c = Math.cos(g), s = Math.sin(g);
    const [x, y, z] = vettoreKm;
    const o = ecef(oss.lat, oss.lon, oss.quota || 0);
    return orizzontali(oss, (x * c + y * s) * 1000 - o[0], (-x * s + y * c) * 1000 - o[1], z * 1000 - o[2]);
  }

  const PUNTI = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  function puntoCardinale(az) {
    return PUNTI[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  }

  const esporta = {
    osserva, raggioCupola, proietta, distanza, rilevamento, avanza, differenzaAngoli, rottaCoerente,
    tempoSiderale, direzioneSole, posizioneSole, inOmbra, corpiCelesti, osservaCorpo, puntoCardinale,
  };
  if (typeof module === 'object' && module.exports) module.exports = esporta;
  else radice.Geometria = esporta;
})(this);
