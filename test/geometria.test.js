// node test/geometria.test.js
'use strict';
const assert = require('assert');
const G = require('../web/geometria.js');

const vicino = (a, b, tolleranza, cosa) => assert.ok(Math.abs(a - b) <= tolleranza, `${cosa}: ${a} invece di ${b}`);
const milano = { lat: 45.4642, lon: 9.19, quota: 120 };
let prove = 0;
function prova(nome, f) { f(); prove++; console.log('ok  ' + nome); }

prova('un aereo sulla verticale sta allo zenit', () => {
  const v = G.osserva(milano, milano.lat, milano.lon, 10120);
  vicino(v.el, 90, 0.01, 'elevazione');
  vicino(v.dist, 10000, 1, 'distanza');
});

prova('punti cardinali: a nord azimut 0, a est 90, a sud 180, a ovest 270', () => {
  const quota = 10000;
  vicino(G.osserva(milano, milano.lat + 0.3, milano.lon, quota).az, 0, 0.5, 'nord');
  vicino(G.osserva(milano, milano.lat, milano.lon + 0.4, quota).az, 90, 0.5, 'est');
  vicino(G.osserva(milano, milano.lat - 0.3, milano.lon, quota).az, 180, 0.5, 'sud');
  vicino(G.osserva(milano, milano.lat, milano.lon - 0.4, quota).az, 270, 0.5, 'ovest');
});

prova("a 100 km un aereo a 10 km di quota è a circa 5° (con la curvatura della Terra)", () => {
  const p = G.avanza(milano.lat, milano.lon, 45, 100000);
  const v = G.osserva(milano, p.lat, p.lon, 10120);
  // atan(10/100) = 5,7°; la Terra curva abbassa il punto di circa 0,8 km, 0,45°
  vicino(v.el, 5.2, 0.2, 'elevazione');
  vicino(v.az, 45, 0.5, 'azimut');
});

prova('dal basso est a sinistra del nord; dall alto a destra', () => {
  const nord = G.proietta(0, 0, 0, true);
  vicino(nord.x, 0, 1e-9, 'nord x'); vicino(nord.y, -1, 1e-9, 'nord in alto');
  assert.ok(G.proietta(90, 0, 0, true).x < -0.99, 'dal basso est a sinistra');
  assert.ok(G.proietta(90, 0, 0, false).x > 0.99, 'dall alto est a destra');
  const zenit = G.proietta(123, 90, 0, true);
  vicino(Math.hypot(zenit.x, zenit.y), 0, 1e-9, 'zenit al centro');
  const a45 = G.proietta(10, 45, 0, true);
  vicino(Math.hypot(a45.x, a45.y), Math.SQRT2 - 1, 1e-9, '45° a tan(22,5°) del raggio');
  // la fascia tra 0° e 10° prende più posto che con una scala lineare (0,111)
  assert.ok(1 - G.raggioCupola(10) > 0.16, 'orizzonte allargato');
});

prova('la rotazione porta il nord dove si dice, in senso orario', () => {
  const destra = G.proietta(0, 0, 90, true);
  vicino(destra.x, 1, 1e-9, 'nord a destra'); vicino(destra.y, 0, 1e-9, 'nord a destra');
  const basso = G.proietta(0, 0, 180, true);
  vicino(basso.y, 1, 1e-9, 'nord in basso');
});

prova('avanza e distanza tornano', () => {
  const p = G.avanza(45, 9, 90, 50000);
  vicino(G.distanza(45, 9, p.lat, p.lon), 50000, 1, 'distanza');
  vicino(G.rilevamento(45, 9, p.lat, p.lon), 90, 0.01, 'rotta');
});

prova('Sole: a mezzogiorno del solstizio sull equatore a Greenwich è alto 66,6°', () => {
  const s = G.posizioneSole(new Date(Date.UTC(2026, 5, 21, 12, 2)), { lat: 0, lon: 0 });
  vicino(s.el, 66.56, 0.3, 'elevazione');
  vicino(G.differenzaAngoli(s.az, 0), 0, 2, 'azimut verso nord');
});

prova('Sole: Roma, 21 marzo 2026 alle 5:02 UTC, poco prima dell alba', () => {
  // Valori di riferimento calcolati con PyEphem 4 (senza rifrazione): -2,678° e 87,281°
  const s = G.posizioneSole(new Date(Date.UTC(2026, 2, 21, 5, 2)), { lat: 41.9, lon: 12.5 });
  vicino(s.el, -2.678, 0.05, 'elevazione');
  vicino(s.az, 87.281, 0.1, 'azimut');
});

prova("ombra della Terra: dietro la Terra al buio, davanti al Sole", () => {
  const sole = [1, 0, 0];
  assert.strictEqual(G.inOmbra({ x: -6800, y: 0, z: 0 }, sole), true);
  assert.strictEqual(G.inOmbra({ x: 6800, y: 0, z: 0 }, sole), false);
  assert.strictEqual(G.inOmbra({ x: -6800, y: 7000, z: 0 }, sole), false);
});

prova('rotta coerente: un volo Parigi-Firenze sopra le Alpi verso sud-est sì, verso nord no', () => {
  const cdg = { lat: 49.0128, lon: 2.55 }, flr = { lat: 43.81, lon: 11.2051 };
  const sopraLeAlpi = { lat: 46.2, lon: 7.0, rotta: 130 };
  assert.strictEqual(G.rottaCoerente(sopraLeAlpi, cdg, flr), true);
  assert.strictEqual(G.rottaCoerente({ ...sopraLeAlpi, rotta: 330 }, cdg, flr), false);
  const sullAtlantico = { lat: 50, lon: -20, rotta: 270 };
  assert.strictEqual(G.rottaCoerente(sullAtlantico, cdg, flr), false);
  assert.strictEqual(G.rottaCoerente(sopraLeAlpi, { lat: null, lon: null }, flr), null);
});

prova('Luna e pianeti da La Spezia come PyEphem 4 (senza rifrazione)', () => {
  const spezia = { lat: 44.1025, lon: 9.8241, quota: 5 };
  const confronta = (quando, attesi) => {
    const data = new Date(quando);
    const corpi = Object.fromEntries(G.corpiCelesti(data).map((c) => [c.nome, c]));
    for (const [nome, [az, el, tolleranza]] of Object.entries(attesi)) {
      const v = G.osservaCorpo(corpi[nome].vettore, data, spezia);
      vicino(G.differenzaAngoli(v.az, az) * Math.cos(el * Math.PI / 180), 0, tolleranza, `${nome} azimut`);
      vicino(v.el, el, tolleranza, `${nome} elevazione`);
    }
    return corpi;
  };
  confronta('2026-10-11T19:30:00Z', {
    Luna: [274.637, -29.605, 0.1], Mercurio: [264.719, -21.741, 0.05], Venere: [268.138, -29.085, 0.05],
    Marte: [12.662, -25.471, 0.05], Giove: [358.534, -30.937, 0.05], Saturno: [120.659, 29.977, 0.05],
    Urano: [67.597, 7.215, 0.05], Nettuno: [129.663, 33.031, 0.05],
  });
  // Luna piena alta in cielo: qui conta la parallasse, quasi un grado
  const corpi = confronta('2026-03-03T02:00:00Z', { Luna: [238.214, 39.001, 0.1], Giove: [289.547, 12.885, 0.05] });
  vicino(corpi.Luna.illuminata, 0.998, 0.005, 'Luna illuminata');
  vicino(corpi.Giove.magnitudine, -2.28, 0.25, 'magnitudine di Giove');
  vicino(corpi.Venere.magnitudine, -3.79, 0.25, 'magnitudine di Venere');
  // anelli di Saturno aperti: più luminoso di quasi mezza magnitudine
  const saturno = G.corpiCelesti(new Date('2031-07-20T12:00:00Z')).find((c) => c.nome === 'Saturno');
  vicino(saturno.magnitudine, 0.12, 0.25, 'magnitudine di Saturno');
});

prova('punti cardinali in italiano', () => {
  assert.deepStrictEqual([0, 44, 90, 200, 270, 338].map(G.puntoCardinale), ['N', 'NE', 'E', 'S', 'O', 'N']);
});

console.log(`${prove} prove superate`);
