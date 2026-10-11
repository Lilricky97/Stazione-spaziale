// Il cielo sopra di te: aerei dalle reti ADS-B, satelliti e stazioni spaziali da CelesTrak.
(function () {
  'use strict';
  const G = window.Geometria;
  const SAT = window.satellite;
  const GRADI = Math.PI / 180;

  const ISS = 25544, TIANGONG = 48274;
  const STAZIONI = {
    [ISS]: { nome: 'ISS', descrizione: 'Stazione Spaziale Internazionale', femminile: true },
    [TIANGONG]: { nome: 'Tiangong', descrizione: 'stazione spaziale cinese', femminile: true },
  };

  const OGNI_AEREI_MS = 5000;
  const OGNI_TLE_MS = 6 * 3600 * 1000;
  const AEREO_SCOMPARSO_MS = 60000;
  const PREVISIONE_MAX_S = 30;          // oltre, la posizione stimata non vale più
  const SATELLITI_PER_FOTOGRAMMA = 700; // quanti satelliti sotto l'orizzonte ricontrollare a ogni disegno
  const FOTOGRAMMI_AL_SECONDO = 30;
  const SOGLIA_PASSAGGIO = 10;          // gradi: sotto, case e alberi coprono quasi sempre
  const ETICHETTE_AEREI = 30;
  const ETICHETTE_COMPLETE = 12;

  const PREDEFINITE = {
    lat: null, lon: null, quota: 0,
    raggioKm: 150, satelliti: 'tutti', starlink: true, elevMin: 0, scie: true,
    vista: 'basso', nord: 0, testo: 1,
  };
  const CHIAVE = 'cielo.impostazioni';
  // Nomi brevi nell'indirizzo, per avviare un proiettore già configurato: ?lat=45.46&lon=9.19&nord=90
  const DA_INDIRIZZO = {
    lat: 'lat', lon: 'lon', quota: 'quota', raggio: 'raggioKm', satelliti: 'satelliti', starlink: 'starlink',
    elev: 'elevMin', scie: 'scie', vista: 'vista', nord: 'nord', testo: 'testo',
  };

  const numeri = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
  const decimali = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const orario = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

  const tela = document.getElementById('cielo');
  const ctx = tela.getContext('2d');
  const $ = (id) => document.getElementById(id);

  let imp = { ...PREDEFINITE };
  const stato = {
    fontePosizione: '',
    aerei: new Map(),
    fonteAerei: '', aereiAlle: 0, erroreAerei: '',
    dettagli: new Map(), richiesteDettagli: 0,
    satelliti: [], cursore: 0, erroreSatelliti: '', tleAlle: 0, caricamentoTle: 0,
    sole: null, direzioneSole: null, soleAlle: 0,
    corpi: [], corpiAlle: 0,
    passaggi: new Map(), passaggiAlle: 0,
    tracce: new Map(),
    selezione: null,
    cliccabili: [],
    timerAerei: 0,
  };

  // ---------- impostazioni ----------

  function leggiSalvate() {
    try { return JSON.parse(localStorage.getItem(CHIAVE)) || {}; } catch (e) { return {}; }
  }

  // La posizione si ricorda solo se scritta nelle impostazioni: quella dell'indirizzo,
  // del server o del dispositivo vale per questa volta.
  function salva() {
    const daSalvare = { ...leggiSalvate(), ...imp };
    if (stato.fontePosizione !== 'impostazioni') {
      const salvate = leggiSalvate();
      for (const k of ['lat', 'lon', 'quota']) daSalvare[k] = salvate[k] ?? null;
    }
    try { localStorage.setItem(CHIAVE, JSON.stringify(daSalvare)); } catch (e) { /* la pagina funziona anche senza */ }
  }

  function daIndirizzo() {
    const risultato = {};
    for (const [chiave, valore] of new URLSearchParams(location.search)) {
      const nome = DA_INDIRIZZO[chiave];
      if (!nome) continue;
      if (typeof PREDEFINITE[nome] === 'boolean') risultato[nome] = valore !== '0' && valore !== 'no';
      else if (nome === 'satelliti' || nome === 'vista') risultato[nome] = valore;
      else risultato[nome] = Number(valore);
    }
    return risultato;
  }

  function entro(v, min, max, altrimenti) {
    const n = v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : altrimenti;
  }

  function pulisci(i) {
    const lat = entro(i.lat, -90, 90, null), lon = entro(i.lon, -180, 180, null);
    return {
      lat: lat !== null && lon !== null ? lat : null,
      lon: lat !== null && lon !== null ? lon : null,
      quota: entro(i.quota, -500, 9000, 0),
      raggioKm: entro(i.raggioKm, 10, 460, PREDEFINITE.raggioKm),
      satelliti: ['stazioni', 'luminosi', 'tutti'].includes(i.satelliti) ? i.satelliti : PREDEFINITE.satelliti,
      starlink: i.starlink !== false,
      elevMin: entro(i.elevMin, 0, 45, 0),
      scie: i.scie !== false,
      vista: i.vista === 'alto' ? 'alto' : 'basso',
      nord: ((entro(i.nord, -3600, 3600, 0) % 360) + 360) % 360,
      testo: entro(i.testo, 0.5, 3, 1),
    };
  }

  function osservatore() {
    return { lat: imp.lat, lon: imp.lon, quota: imp.quota };
  }

  function haPosizione() {
    return imp.lat !== null && imp.lon !== null;
  }

  // ---------- aerei ----------

  async function aggiornaAerei() {
    clearTimeout(stato.timerAerei);
    if (!haPosizione()) return;
    let attesa = OGNI_AEREI_MS;
    try {
      const indirizzo = `/api/aerei?lat=${imp.lat}&lon=${imp.lon}&raggio_km=${imp.raggioKm}`;
      const risposta = await fetch(indirizzo);
      const dati = await risposta.json();
      if (!risposta.ok) throw new Error(dati.errore || `errore ${risposta.status}`);
      ricevi(dati);
      stato.erroreAerei = '';
    } catch (errore) {
      stato.erroreAerei = 'Aerei non aggiornati: ' + errore.message;
      attesa = 2 * OGNI_AEREI_MS;
    }
    stato.timerAerei = setTimeout(aggiornaAerei, attesa);
  }

  function ricevi(dati) {
    const adesso = Date.now();
    stato.fonteAerei = dati.fonte;
    stato.aereiAlle = adesso;
    for (const d of dati.aerei) {
      const id = d.hex || d.volo;
      if (!id) continue;
      let a = stato.aerei.get(id);
      const t0 = adesso - Math.max(0, d.eta_s || 0) * 1000;
      if (a) {
        // La nuova posizione corregge quella stimata: lo scarto si assorbe in due secondi invece di saltare.
        const prima = posizioneAereo(a, adesso);
        const dopo = prevedi(d, t0, adesso);
        a.correzione = { lat: prima.lat - dopo.lat, lon: prima.lon - dopo.lon, quota: prima.quota - dopo.quota, alle: adesso };
        if (Math.abs(a.correzione.lat) > 0.05 || Math.abs(a.correzione.lon) > 0.05) a.correzione = null;
      } else {
        a = { id, scia: [], correzione: null };
        stato.aerei.set(id, a);
      }
      a.dati = d;
      a.t0 = t0;
      a.visto = adesso;
      const ultimo = a.scia[a.scia.length - 1];
      if (!ultimo || G.distanza(ultimo.lat, ultimo.lon, d.lat, d.lon) > 300) {
        a.scia.push({ lat: d.lat, lon: d.lon, quota: d.quota_m });
        if (a.scia.length > 40) a.scia.shift();
      }
    }
    for (const [id, a] of stato.aerei) if (adesso - a.visto > AEREO_SCOMPARSO_MS) stato.aerei.delete(id);
  }

  function prevedi(d, t0, alle) {
    const dt = Math.min(PREVISIONE_MAX_S, Math.max(0, (alle - t0) / 1000));
    let { lat, lon } = d;
    if (d.velocita_kmh && Number.isFinite(d.rotta)) ({ lat, lon } = G.avanza(lat, lon, d.rotta, d.velocita_kmh / 3.6 * dt));
    return { lat, lon, quota: Math.max(0, d.quota_m + (d.salita_ms || 0) * dt) };
  }

  function posizioneAereo(a, alle) {
    const p = prevedi(a.dati, a.t0, alle);
    const c = a.correzione;
    if (c) {
      const resto = 1 - (alle - c.alle) / 2000;
      if (resto > 0) {
        p.lat += c.lat * resto;
        p.lon += c.lon * resto;
        p.quota += c.quota * resto;
      }
    }
    return p;
  }

  function chiaveDettagli(d) {
    return `${d.hex}|${d.volo}`;
  }

  function chiediDettagli(visibili) {
    for (const a of visibili) {
      if (stato.richiesteDettagli >= 3) return;
      const chiave = chiaveDettagli(a.dati);
      const gia = stato.dettagli.get(chiave);
      if ((gia && !(gia.riprovaDopo < Date.now())) || (!a.dati.volo && !a.dati.hex)) continue;
      stato.dettagli.set(chiave, { inAttesa: true });
      stato.richiesteDettagli++;
      const parametri = new URLSearchParams({ volo: a.dati.volo, hex: a.dati.hex });
      fetch('/api/dettagli?' + parametri)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
        .then((dati) => stato.dettagli.set(chiave, dati))
        .catch(() => stato.dettagli.set(chiave, { inAttesa: true, riprovaDopo: Date.now() + 60000 }))
        .finally(() => { stato.richiesteDettagli--; });
    }
    while (stato.dettagli.size > 3000) stato.dettagli.delete(stato.dettagli.keys().next().value);
  }

  function dettagliDi(a) {
    const d = stato.dettagli.get(chiaveDettagli(a.dati));
    return d && !d.inAttesa ? d : null;
  }

  function rottaNota(a) {
    const rotta = dettagliDi(a)?.rotta;
    return rotta && !rotta.sconosciuta ? rotta : null;
  }

  function sigla(aeroporto) {
    return aeroporto.iata || aeroporto.icao || '?';
  }

  function nomeVolo(a) {
    const rotta = rottaNota(a);
    const iata = rotta?.volo_iata;
    // Il numero del biglietto (AZ602 per ITY602) solo se il nominativo radio è la compagnia più
    // il numero: KLC27U o RYR46SZ sono sigle radio, e WA27U non sarebbe un volo vero.
    if (iata && /^[A-Z]{3}\d{1,4}$/.test(a.dati.volo)) return iata;
    return a.dati.volo || a.dati.reg || a.dati.hex.toUpperCase();
  }

  // ---------- satelliti ----------

  async function caricaSatelliti() {
    const numero = ++stato.caricamentoTle;
    const gruppi = ['stations'];
    if (imp.satelliti !== 'stazioni') gruppi.push('visual');
    if (imp.satelliti === 'tutti') gruppi.push('active');
    const tutti = new Map();
    const errori = [];
    for (const gruppo of gruppi) {
      try {
        const risposta = await fetch('/api/tle?gruppo=' + gruppo);
        if (!risposta.ok) throw new Error((await risposta.json()).errore || risposta.status);
        for (const s of leggiTle(await risposta.text())) {
          const gia = tutti.get(s.norad);
          const sat = gia || s;
          if (!gia) tutti.set(s.norad, sat);
          if (gruppo === 'visual') sat.luminoso = true;
        }
      } catch (errore) {
        errori.push(`${gruppo}: ${errore.message}`);
      }
    }
    if (numero !== stato.caricamentoTle) return;   // nel frattempo sono cambiate le impostazioni
    stato.satelliti = [...tutti.values()].filter((s) => imp.starlink || !s.starlink);
    stato.cursore = 0;
    stato.tleAlle = Date.now();
    stato.passaggiAlle = 0;
    stato.tracce.clear();
    stato.erroreSatelliti = errori.length ? 'Satelliti non caricati: ' + errori.join('; ') : '';
  }

  function leggiTle(testo) {
    const righe = testo.split(/\r?\n/);
    const elenco = [];
    for (let i = 0; i + 1 < righe.length; i++) {
      const r1 = righe[i], r2 = righe[i + 1];
      if (!r1.startsWith('1 ') || !r2.startsWith('2 ')) continue;
      const precedente = i > 0 ? righe[i - 1].trim() : '';
      const nome = precedente && !precedente.startsWith('2 ') ? precedente.replace(/^0 /, '') : r1.slice(2, 7).trim();
      const satrec = SAT.twoline2satrec(r1, r2);
      i++;
      if (satrec.error) continue;
      const norad = Number(r1.slice(2, 7));
      elenco.push({
        norad, nome, satrec,
        stazione: STAZIONI[norad] || null,
        starlink: nome.startsWith('STARLINK'),
        luminoso: false,
        sopra: false, az: 0, el: -90, dist: 0, pos: null, vel: null, illuminato: false,
      });
    }
    return elenco;
  }

  function guardaSatellite(s, data, tempo, oss) {
    const pv = SAT.propagate(s.satrec, data);
    const p = pv && pv.position;
    if (!p || !Number.isFinite(p.x)) {
      s.el = -90;
      s.sopra = false;
      return false;
    }
    const angoli = SAT.ecfToLookAngles(oss, SAT.eciToEcf(p, tempo));
    s.az = (angoli.azimuth / GRADI + 360) % 360;
    s.el = angoli.elevation / GRADI;
    s.dist = angoli.rangeSat;
    s.pos = p;
    s.vel = pv.velocity;
    return true;
  }

  function osservatoreSat() {
    return { latitude: imp.lat * GRADI, longitude: imp.lon * GRADI, height: imp.quota / 1000 };
  }

  function aggiornaSatelliti(data) {
    const elenco = stato.satelliti;
    if (!elenco.length || !haPosizione()) return;
    const tempo = SAT.gstime(data), oss = osservatoreSat();
    // A turno si ricontrollano quelli sotto l'orizzonte: chi sorge entra nell'elenco di quelli da seguire.
    for (let i = 0, n = Math.min(elenco.length, SATELLITI_PER_FOTOGRAMMA); i < n; i++) {
      const s = elenco[stato.cursore++ % elenco.length];
      if (!s.sopra && guardaSatellite(s, data, tempo, oss)) s.sopra = s.el > -2;
    }
    const sole = stato.direzioneSole;
    for (const s of elenco) {
      if (!s.sopra) continue;
      if (guardaSatellite(s, data, tempo, oss)) {
        s.sopra = s.el > -2;
        s.illuminato = sole ? !G.inOmbra(s.pos, sole) : false;
      }
    }
  }

  function quotaKm(s, data) {
    return SAT.eciToGeodetic(s.pos, SAT.gstime(data)).height;
  }

  function vistaSatelliteAlle(s, t) {
    const data = new Date(t);
    const pv = SAT.propagate(s.satrec, data);
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return null;
    const angoli = SAT.ecfToLookAngles(osservatoreSat(), SAT.eciToEcf(pv.position, SAT.gstime(data)));
    return { az: (angoli.azimuth / GRADI + 360) % 360, el: angoli.elevation / GRADI, pos: pv.position };
  }

  // Il primo passaggio sopra SOGLIA_PASSAGGIO che inizia prima di `limite`, o quello in corso.
  // Si vede a occhio nudo se per almeno mezzo minuto la stazione è al Sole mentre qui è buio:
  // qualche secondo appena sopra la soglia, all'uscita dall'ombra, non basta per trovarla.
  function passaggioDa(s, da, limite) {
    const salto = 20000;
    let t = da, v = vistaSatelliteAlle(s, t);
    if (!v) return null;
    const inCorso = v.el >= SOGLIA_PASSAGGIO;
    if (!inCorso) {
      let prima = v.el;
      for (t += salto; t < limite; t += salto) {
        v = vistaSatelliteAlle(s, t);
        if (!v) return null;
        if (v.el >= SOGLIA_PASSAGGIO && prima < SOGLIA_PASSAGGIO) break;
        prima = v.el;
      }
      if (t >= limite) return null;
      let a = t - salto, b = t;   // il momento in cui supera la soglia, al secondo
      while (b - a > 1000) {
        const m = (a + b) / 2;
        const vm = vistaSatelliteAlle(s, m);
        if (vm && vm.el >= SOGLIA_PASSAGGIO) b = m; else a = m;
      }
      t = b;
      v = vistaSatelliteAlle(s, t);
    }
    const inizio = t;
    let massimo = { t, ...v };
    const passo = 5000;
    let alSole = 0, alBuio = 0;
    while (v && v.el >= SOGLIA_PASSAGGIO && t < limite + 3600000) {
      const data = new Date(t);
      if (!G.inOmbra(v.pos, G.direzioneSole(data))) {
        alSole += passo;
        if (G.posizioneSole(data, osservatore()).el < -6) alBuio += passo;
      }
      if (v.el > massimo.el) massimo = { t, ...v };
      t += passo;
      v = vistaSatelliteAlle(s, t);
    }
    const sole = G.posizioneSole(new Date(massimo.t), osservatore()).el;
    return { inCorso, inizio, fine: t, massimo, visibile: alBuio >= 30000, illuminata: alSole >= 30000, sole };
  }

  function prossimoPassaggio(s, da) {
    return passaggioDa(s, da, da + 24 * 3600 * 1000);
  }

  function prossimoVisibile(s, da) {
    const limite = da + 3 * 24 * 3600 * 1000;
    for (let t = da, p; (p = passaggioDa(s, t, limite)); t = p.fine + 60000) if (p.visibile) return p;
    return null;
  }

  function comeSiVede(p) {
    if (p.visibile) return 'visibile a occhio nudo';
    if (!p.illuminata) return p.sole >= 0 ? 'di giorno, non si vede' : 'in ombra, non si vede';
    return p.sole >= 0 ? 'di giorno, non si vede' : 'cielo ancora chiaro: forse si vede';
  }

  // Dove passerà e dove è passato il satellite, per disegnarne il percorso in cielo.
  function traccia(s, adesso) {
    const vecchia = stato.tracce.get(s.norad);
    if (vecchia && adesso - vecchia.alle < 10000) return vecchia.punti;
    const punti = [];
    for (let dt = -180; dt <= 900; dt += 15) {
      const v = vistaSatelliteAlle(s, adesso + dt * 1000);
      if (v) punti.push({ ...v, futuro: dt > 0 });
    }
    stato.tracce.set(s.norad, { alle: adesso, punti });
    return punti;
  }

  // ---------- Luna e pianeti ----------

  const COLORI_CORPI = {
    Luna: '#f4f1e6', Mercurio: '#c9b8a6', Venere: '#fff3c4', Marte: '#ff7a4d',
    Giove: '#f1d6a8', Saturno: '#e8c873', Urano: '#9fe3e6', Nettuno: '#8fa8ff',
  };

  // Si muovono piano rispetto alle stelle: basta rifarli ogni cinque secondi.
  function aggiornaCorpi(data) {
    const oss = osservatore();
    stato.corpi = G.corpiCelesti(data).map((c) => ({ ...c, ...G.osservaCorpo(c.vettore, data, oss) }));
    stato.corpiAlle = data.getTime();
  }

  function comeSiVedeCorpo(c) {
    const sole = stato.sole ? stato.sole.el : 0;
    if (c.el <= 0) return "sotto l'orizzonte";
    if (c.nome === 'Luna') return c.illuminata < 0.03 ? 'quasi nuova, non si vede' : 'visibile';
    if (c.allungamento < 10) return 'troppo vicino al Sole';
    if (sole >= 0) return c.magnitudine < -3.5 ? 'di giorno: solo sapendo dove guardare' : 'di giorno non si vede';
    if (sole > -6) return c.magnitudine < 0.5 ? 'visibile nel crepuscolo' : 'cielo ancora chiaro';
    if (c.magnitudine < 5) return 'visibile a occhio nudo';
    if (c.magnitudine < 6.2) return 'al limite: serve un cielo molto buio';
    return 'serve un binocolo';
  }

  function faseLuna(c) {
    const percento = numeri.format(c.illuminata * 100);
    if (c.illuminata > 0.97) return 'piena';
    if (c.illuminata < 0.03) return 'nuova';
    return `${percento}% ${c.crescente ? 'crescente' : 'calante'}`;
  }

  // Direzione sullo schermo da un punto del cielo verso un altro, lungo il cerchio massimo:
  // da qui si sa da che parte la Luna è illuminata.
  function direzioneVerso(da, a) {
    const versore = (v) => [Math.cos(v.el * GRADI) * Math.sin(v.az * GRADI), Math.cos(v.el * GRADI) * Math.cos(v.az * GRADI), Math.sin(v.el * GRADI)];
    const m = versore(da), t = versore(a);
    const k = m[0] * t[0] + m[1] * t[1] + m[2] * t[2];
    const p = m.map((x, i) => x + 0.02 * (t[i] - k * x));
    const n = Math.hypot(...p);
    const passo = { az: (Math.atan2(p[0], p[1]) / GRADI + 360) % 360, el: Math.asin(p[2] / n) / GRADI };
    const s0 = sulloSchermo(da.az, da.el), s1 = sulloSchermo(passo.az, passo.el);
    return Math.atan2(s1.y - s0.y, s1.x - s0.x);
  }

  function disegnaLuna(c, x, y, raggio) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#2b2d33';
    ctx.beginPath(); ctx.arc(0, 0, raggio, 0, 2 * Math.PI); ctx.fill();
    if (stato.sole) ctx.rotate(direzioneVerso(c, stato.sole));
    // Metà rivolta al Sole, poi il terminatore: un'ellisse larga quanto la parte in ombra o in luce.
    const k = 1 - 2 * c.illuminata;
    ctx.fillStyle = COLORI_CORPI.Luna;
    ctx.shadowColor = 'rgba(244,241,230,0.6)';
    ctx.shadowBlur = raggio * 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, raggio, -Math.PI / 2, Math.PI / 2);
    ctx.ellipse(0, 0, Math.abs(k) * raggio, raggio, 0, Math.PI / 2, k > 0 ? -Math.PI / 2 : Math.PI * 1.5, k > 0);
    ctx.fill();
    ctx.restore();
  }

  function raggioCorpo(c) {
    if (c.nome === 'Luna') return disegno.carattere * 1.05;
    return disegno.carattere * Math.min(0.75, Math.max(0.17, 0.42 - 0.07 * c.magnitudine));
  }

  // Luna e pianeti prendono il posto prima degli aerei e si disegnano dopo, sopra a tutto.
  function preparaCorpi(occupati, rinviate) {
    const ordinati = [...stato.corpi].sort((a, b) => a.magnitudine - b.magnitudine);
    for (const c of ordinati) {
      if (c.el < -0.5) continue;
      const p = sulloSchermo(c.az, Math.max(0, c.el));
      const raggio = raggioCorpo(c);
      rinviate.push(() => disegnaCorpo(c, p, raggio));
      const lato = Math.max(raggio * 1.4, disegno.carattere * 0.5);
      occupati.push({ x: p.x - lato, y: p.y - lato, w: 2 * lato, h: 2 * lato });
      stato.cliccabili.push({ x: p.x, y: p.y, tipo: 'corpo', id: c.nome, peso: 3 });
      const seconda = c.nome === 'Luna' ? faseLuna(c) : '';
      piazzaEtichetta(occupati, p.x, p.y, [
        { testo: c.nome, colore: COLORI_CORPI[c.nome], peso: 700, scala: 0.95 },
        ...(seconda ? [{ testo: seconda, colore: '#d8d4c4', scala: 0.75 }] : []),
      ], lato * 1.1, true, rinviate);
    }
  }

  function disegnaCorpo(c, p, raggio) {
    if (c.nome === 'Luna') return disegnaLuna(c, p.x, p.y, raggio);
    const colore = COLORI_CORPI[c.nome];
    ctx.save();
    ctx.fillStyle = colore;
    ctx.shadowColor = colore;
    ctx.shadowBlur = c.magnitudine < 1 ? raggio * 2.5 : raggio;
    ctx.beginPath(); ctx.arc(p.x, p.y, raggio, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
    if (c.nome === 'Saturno') {
      ctx.strokeStyle = colore;
      ctx.lineWidth = Math.max(1, raggio / 3);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, raggio * 2, raggio * 0.6, -0.35, 0, 2 * Math.PI); ctx.stroke();
    }
  }

  // ---------- disegno ----------

  const disegno = { w: 0, h: 0, cx: 0, cy: 0, r: 0, carattere: 14 };

  function ridimensiona() {
    const dpr = window.devicePixelRatio || 1;
    disegno.w = window.innerWidth;
    disegno.h = window.innerHeight;
    tela.width = Math.round(disegno.w * dpr);
    tela.height = Math.round(disegno.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    disegno.cx = disegno.w / 2;
    disegno.cy = disegno.h / 2;
    disegno.r = Math.min(disegno.w, disegno.h) / 2 * 0.9;
    // I riquadri stanno nei lati liberi accanto alla cupola; se lo schermo è stretto, sopra e sotto.
    const lato = (disegno.w - 2 * disegno.r) / 2 - 24;
    document.documentElement.style.setProperty('--larghezza-pannello', lato >= 200 ? `${Math.floor(lato)}px` : '48vw');
    aggiornaCarattere();
  }

  function aggiornaCarattere() {
    disegno.carattere = Math.max(10, Math.min(40, Math.min(disegno.w, disegno.h) / 62)) * imp.testo;
    document.documentElement.style.setProperty('--testo', imp.testo);
  }

  function sulloSchermoPunto(oss, p) {
    const v = G.osserva(oss, p.lat, p.lon, p.quota);
    return sulloSchermo(v.az, v.el);
  }

  function sulloSchermo(az, el) {
    const p = G.proietta(az, el, imp.nord, imp.vista === 'basso');
    return { x: disegno.cx + p.x * disegno.r, y: disegno.cy + p.y * disegno.r };
  }

  function scritta(testo, x, y, colore, peso = 400, scala = 1, allinea = 'left') {
    ctx.font = `${peso} ${disegno.carattere * scala}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = allinea;
    ctx.lineWidth = Math.max(2, disegno.carattere * scala / 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineJoin = 'round';
    ctx.strokeText(testo, x, y);
    ctx.fillStyle = colore;
    ctx.fillText(testo, x, y);
  }

  function larghezza(testo, peso, scala) {
    ctx.font = `${peso} ${disegno.carattere * scala}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    return ctx.measureText(testo).width;
  }

  // Le etichette non si sovrappongono: chi arriva prima (il più alto in cielo) sceglie il posto.
  // Con `rinviate` il posto si prende subito ma la scritta si disegna alla fine, sopra gli aerei.
  function piazzaEtichetta(occupati, x, y, righe, scostamento, sempre = false, rinviate = null) {
    const altezza = disegno.carattere * 1.2;
    const w = Math.max(...righe.map((r) => larghezza(r.testo, r.peso || 400, r.scala || 1)));
    const h = altezza * righe.reduce((somma, r) => somma + (r.scala || 1), 0);
    const posti = [
      [x + scostamento, y - h / 2], [x - scostamento - w, y - h / 2],
      [x - w / 2, y + scostamento], [x - w / 2, y - scostamento - h],
    ];
    const dentro = posti.filter(([px, py]) => px >= 0 && py >= 0 && px + w <= disegno.w && py + h <= disegno.h);
    const liberi = dentro.filter(([px, py]) => !occupati.some((o) =>
      px < o.x + o.w && o.x < px + w && py < o.y + o.h && o.y < py + h));
    for (const [px, py] of liberi.length || !sempre ? liberi : dentro.slice(0, 1)) {
      occupati.push({ x: px, y: py, w, h });
      const scrivi = () => {
        let riga = py;
        for (const r of righe) {
          riga += altezza * (r.scala || 1);
          scritta(r.testo, px, riga - altezza * 0.28, r.colore, r.peso || 400, r.scala || 1);
        }
      };
      if (rinviate) rinviate.push(scrivi); else scrivi();
      return true;
    }
    return false;
  }

  function disegnaCupola(sole, occupati) {
    const { cx, cy, r } = disegno;
    const notte = sole && sole.el < -6;
    const fondo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    fondo.addColorStop(0, notte ? '#01030a' : '#041026');
    fondo.addColorStop(1, notte ? '#040b1c' : '#0a1f45');
    ctx.fillStyle = fondo;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(106,162,255,0.16)';
    for (const el of [30, 60]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * G.raggioCupola(el), 0, 2 * Math.PI);
      ctx.stroke();
    }
    for (let az = 0; az < 360; az += 30) {
      const a = sulloSchermo(az, 0), b = sulloSchermo(az, 80);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(106,162,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();

    const croce = disegno.carattere * 0.5;
    ctx.strokeStyle = 'rgba(106,162,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(cx - croce, cy); ctx.lineTo(cx + croce, cy);
    ctx.moveTo(cx, cy - croce); ctx.lineTo(cx, cy + croce);
    ctx.stroke();

    for (const [az, lettera] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'O']]) {
      const p = G.proietta(az, 0, imp.nord, imp.vista === 'basso');
      const distanza = disegno.r + disegno.carattere * 1.3;
      const x = disegno.cx + p.x * distanza, y = disegno.cy + p.y * distanza, lato = disegno.carattere * 1.1;
      ctx.textBaseline = 'middle';
      scritta(lettera, x, y, lettera === 'N' ? '#ff8f8f' : '#9fbcff', 700, 1.5, 'center');
      ctx.textBaseline = 'alphabetic';
      occupati.push({ x: x - lato, y: y - lato, w: 2 * lato, h: 2 * lato });
    }
    const p30 = sulloSchermo(imp.nord === 0 ? 45 : 0, 30);
    scritta('30°', p30.x + 3, p30.y - 3, 'rgba(142,163,199,0.6)', 400, 0.7);
    const p60 = sulloSchermo(imp.nord === 0 ? 45 : 0, 60);
    scritta('60°', p60.x + 3, p60.y - 3, 'rgba(142,163,199,0.6)', 400, 0.7);
  }

  function disegnaSole(sole, occupati) {
    if (!sole || sole.el < -1) return;
    const p = sulloSchermo(sole.az, Math.max(0, sole.el));
    const raggio = disegno.carattere * 0.9;
    const alone = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, raggio * 3);
    alone.addColorStop(0, 'rgba(255,211,77,0.55)');
    alone.addColorStop(1, 'rgba(255,211,77,0)');
    ctx.fillStyle = alone;
    ctx.beginPath(); ctx.arc(p.x, p.y, raggio * 3, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath(); ctx.arc(p.x, p.y, raggio, 0, 2 * Math.PI); ctx.fill();
    occupati.push({ x: p.x - raggio * 1.5, y: p.y - raggio * 1.5, w: raggio * 3, h: raggio * 3 });
    piazzaEtichetta(occupati, p.x, p.y, [{ testo: 'Sole', colore: '#ffd34d', peso: 600, scala: 0.9 }], raggio * 1.6, true);
  }

  function disegnaSatelliti(adesso, notte, occupati) {
    const etichettabili = [];
    for (const s of stato.satelliti) {
      if (!s.sopra || s.el < imp.elevMin || s.stazione) continue;
      const p = sulloSchermo(s.az, s.el);
      const acceso = notte && s.illuminato;
      let raggio = (s.luminoso ? 2.2 : 1.5) * Math.max(1, disegno.carattere / 16);
      if (s.starlink) raggio *= 0.8;
      ctx.fillStyle = acceso ? (s.luminoso ? '#ffffff' : '#c9dbff') : (s.starlink ? '#34507f' : '#55709f');
      ctx.fillRect(p.x - raggio, p.y - raggio, raggio * 2, raggio * 2);
      stato.cliccabili.push({ x: p.x, y: p.y, tipo: 'satellite', id: s.norad, peso: 1 });
      if (s.luminoso && acceso && s.el > 20) etichettabili.push({ s, p });   // i nomi solo di quelli che si vedono
    }
    etichettabili.sort((a, b) => b.s.el - a.s.el);
    for (const { s, p } of etichettabili.slice(0, 12)) {
      piazzaEtichetta(occupati, p.x, p.y, [{ testo: nomeBreve(s.nome), colore: '#b8c9ea', scala: 0.75 }], 6);
    }
    const scelto = satelliteScelto();
    if (scelto && !scelto.stazione) disegnaTraccia(scelto, adesso, '#c9dbff');
  }

  function nomeBreve(nome) {
    return nome.replace(/\s*\(.*\)\s*$/, '').replace(/\s+R\/B$/, ' (stadio razzo)');
  }

  function disegnaTraccia(s, adesso, colore) {
    const punti = traccia(s, adesso);
    ctx.lineWidth = Math.max(1.5, disegno.carattere / 9);
    for (const futuro of [false, true]) {
      ctx.strokeStyle = colore;
      ctx.globalAlpha = futuro ? 0.55 : 0.3;
      ctx.setLineDash(futuro ? [disegno.carattere * 0.4, disegno.carattere * 0.4] : []);
      ctx.beginPath();
      let aperto = false;
      for (let i = 0; i < punti.length; i++) {
        const v = punti[i];
        const nelTratto = futuro ? v.futuro || (punti[i + 1] && punti[i + 1].futuro) : !v.futuro || (i > 0 && !punti[i - 1].futuro);
        if (v.el < 0 || !nelTratto) { aperto = false; continue; }
        const p = sulloSchermo(v.az, v.el);
        if (aperto) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        aperto = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function stazioniVisibili() {
    return stato.satelliti.filter((s) => s.stazione && s.sopra && s.el >= Math.max(0, imp.elevMin));
  }

  // Percorso e scritta delle stazioni vanno prima degli aerei, così le loro scritte non le coprono;
  // la sagoma si disegna per ultima, sopra a tutto.
  function preparaStazioni(adesso, notte, occupati, rinviate) {
    for (const s of stazioniVisibili()) {
      disegnaTraccia(s, adesso, '#7ef0ff');
      const p = sulloSchermo(s.az, s.el);
      const u = disegno.carattere * 0.45;
      const accesa = notte && s.illuminato;
      occupati.push({ x: p.x - u * 2.8, y: p.y - u * 1.2, w: u * 5.6, h: u * 2.4 });
      const seconda = `${numeri.format(quotaKm(s, new Date(adesso)))} km · ${accesa ? 'illuminata: guardala!' : s.illuminato ? 'al Sole' : 'in ombra'}`;
      piazzaEtichetta(occupati, p.x, p.y, [
        { testo: s.stazione.nome, colore: '#7ef0ff', peso: 700, scala: 1.25 },
        { testo: seconda, colore: '#bff7ff', scala: 0.85 },
      ], u * 3.2, true, rinviate);
    }
  }

  function disegnaStazioni(notte) {
    for (const s of stazioniVisibili()) {
      const p = sulloSchermo(s.az, s.el);
      const u = disegno.carattere * 0.45;
      const accesa = notte && s.illuminato;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = accesa ? '#ffffff' : '#7ef0ff';
      ctx.shadowColor = '#7ef0ff';
      ctx.shadowBlur = accesa ? u * 3 : u;
      ctx.fillRect(-u * 0.5, -u * 0.5, u, u);                  // il modulo centrale
      ctx.fillRect(-u * 2.6, -u * 0.9, u * 1.6, u * 1.8);      // i pannelli solari
      ctx.fillRect(u * 1.0, -u * 0.9, u * 1.6, u * 1.8);
      ctx.fillRect(-u * 1.1, -u * 0.12, u * 2.2, u * 0.24);
      ctx.restore();
      stato.cliccabili.push({ x: p.x, y: p.y, tipo: 'satellite', id: s.norad, peso: 3 });
    }
  }

  const SAGOMA = (() => {
    const meta = [[10, 0], [7, -1.1], [1.5, -1.3], [-3, -9.5], [-5.5, -9.5], [-3, -1.3], [-7.5, -1.1], [-9.5, -4.2], [-11, -4.2], [-10, 0]];
    return meta.concat(meta.slice(1, -1).reverse().map(([x, y]) => [x, -y]));
  })();

  function disegnaAereo(x, y, angolo, dimensione, colore) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angolo);
    ctx.scale(dimensione / 20, dimensione / 20);
    ctx.beginPath();
    SAGOMA.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = colore;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  function aereiVisibili(adesso) {
    const oss = osservatore();
    const visibili = [];
    for (const a of stato.aerei.values()) {
      const p = posizioneAereo(a, adesso);
      const v = G.osserva(oss, p.lat, p.lon, p.quota);
      a.posizione = p;
      a.vista = v;
      if (v.el >= imp.elevMin && v.el > 0) visibili.push(a);
    }
    return visibili.sort((x, y) => y.vista.el - x.vista.el);
  }

  // Più vicino, più grande: a colpo d'occhio si vede quale passa davvero sopra la testa.
  function dimensioneAereo(a) {
    const vicinanza = Math.min(1, Math.max(0, 1 - a.vista.dist / 80000));
    return disegno.carattere * (1.1 + 1.3 * vicinanza);
  }

  function disegnaAerei(visibili, adesso, occupati) {
    const oss = osservatore();
    for (const a of visibili) {
      const qui = sulloSchermo(a.vista.az, a.vista.el);
      const dimensione = dimensioneAereo(a);
      a.schermo = qui;
      const scelto = stato.selezione && stato.selezione.tipo === 'aereo' && stato.selezione.id === a.id;
      if (imp.scie || scelto) {
        ctx.strokeStyle = 'rgba(255,191,90,0.35)';
        ctx.lineWidth = Math.max(1.5, disegno.carattere / 10);
        ctx.beginPath();
        let aperto = false;
        for (const punto of a.scia.concat([a.posizione])) {
          const v = G.osserva(oss, punto.lat, punto.lon, punto.quota);
          if (v.el < 0) { aperto = false; continue; }
          const s = sulloSchermo(v.az, v.el);
          if (aperto) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
          aperto = true;
        }
        ctx.stroke();
      }
      // La punta segue lo spostamento sulla cupola, non la rotta sulla carta: vicino allo zenit sono diverse.
      const da = sulloSchermoPunto(oss, prevedi(a.dati, adesso, adesso));
      const verso = sulloSchermoPunto(oss, prevedi(a.dati, adesso, adesso + 20000));
      const angolo = Math.hypot(verso.x - da.x, verso.y - da.y) > 0.5 ? Math.atan2(verso.y - da.y, verso.x - da.x) : -Math.PI / 2;
      const colore = a.dati.emergenza ? '#ff6b6b' : '#ffbf5a';
      disegnaAereo(qui.x, qui.y, angolo, dimensione, colore);
      if (scelto) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(qui.x, qui.y, dimensione * 0.85, 0, 2 * Math.PI); ctx.stroke();
      }
      stato.cliccabili.push({ x: qui.x, y: qui.y, tipo: 'aereo', id: a.id, peso: 2 });
      occupati.push({ x: qui.x - dimensione / 2, y: qui.y - dimensione / 2, w: dimensione, h: dimensione });
    }
    // Prima le scritte dei più alti: se manca spazio, restano senza quelli bassi all'orizzonte,
    // e oltre ETICHETTE_AEREI scritte il cielo proiettato non si legge più.
    const scelto = stato.selezione && stato.selezione.tipo === 'aereo' ? visibili.find((a) => a.id === stato.selezione.id) : null;
    let scritte = 0;
    for (const a of scelto ? [scelto, ...visibili.filter((x) => x !== scelto)] : visibili) {
      if (scritte >= ETICHETTE_AEREI && a !== scelto) break;
      const qui = a.schermo;
      const rotta = rottaNota(a);
      const tipo = a.dati.tipo || dettagliDi(a)?.aereo?.tipo || '';
      const quota = `${decimali.format(a.posizione.quota / 1000)} km`;
      // Il punto di domanda segnala una rotta d'archivio che non torna con la posizione.
      const dubbio = rotta && G.rottaCoerente({ ...a.posizione, rotta: a.dati.rotta }, rotta.partenza, rotta.arrivo) === false ? ' ?' : '';
      const seconda = rotta ? `${sigla(rotta.partenza)} → ${sigla(rotta.arrivo)}${dubbio} · ${quota}`
        : `${Number.isFinite(a.dati.rotta) ? 'verso ' + G.puntoCardinale(a.dati.rotta) + ' · ' : ''}${quota}`;
      const completa = scritte < ETICHETTE_COMPLETE || a.vista.el >= 15 || a === scelto;
      const righe = completa ? [
        { testo: `${nomeVolo(a)}${tipo ? ' · ' + tipo : ''}`, colore: '#ffd79a', peso: 700 },
        { testo: seconda, colore: '#ffe9c7', scala: 0.85 },
      ] : [{ testo: rotta ? `${nomeVolo(a)} → ${sigla(rotta.arrivo)}${dubbio}` : nomeVolo(a), colore: '#e8c48a', peso: 600, scala: 0.8 }];
      if (piazzaEtichetta(occupati, qui.x, qui.y, righe, dimensioneAereo(a) * 0.7)) scritte++;
    }
  }

  let ultimoDisegno = 0;
  let ultimiPannelli = 0;

  function fotogramma(t) {
    requestAnimationFrame(fotogramma);
    if (t - ultimoDisegno < 1000 / FOTOGRAMMI_AL_SECONDO - 3) return;
    ultimoDisegno = t;
    const adesso = Date.now();
    const data = new Date(adesso);
    ctx.clearRect(0, 0, disegno.w, disegno.h);
    if (!haPosizione()) {
      ctx.textBaseline = 'middle';
      scritta('Dimmi dove sei: premi S', disegno.cx, disegno.cy, '#9fbcff', 600, 1.6, 'center');
      ctx.textBaseline = 'alphabetic';
      if (adesso - ultimiPannelli > 500) { aggiornaPannelli(adesso, []); ultimiPannelli = adesso; }
      return;
    }
    if (adesso - stato.soleAlle > 1000) {
      stato.sole = G.posizioneSole(data, osservatore());
      stato.direzioneSole = G.direzioneSole(data);
      stato.soleAlle = adesso;
    }
    const notte = stato.sole.el < -6;
    if (adesso - stato.corpiAlle > 5000) aggiornaCorpi(data);
    aggiornaSatelliti(data);
    const visibili = aereiVisibili(adesso);
    chiediDettagli(visibili);

    stato.cliccabili = [];
    const occupati = [];
    disegnaCupola(stato.sole, occupati);
    disegnaSole(stato.sole, occupati);
    disegnaSatelliti(adesso, notte, occupati);
    const rinviate = [];
    preparaCorpi(occupati, rinviate);
    preparaStazioni(adesso, notte, occupati, rinviate);
    disegnaAerei(visibili, adesso, occupati);
    disegnaStazioni(notte);
    for (const disegna of rinviate) disegna();

    if (adesso - ultimiPannelli > 500) {
      aggiornaPannelli(adesso, visibili);
      ultimiPannelli = adesso;
    }
  }

  // ---------- pannelli ----------

  function riempi(el, html) {
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function sicuro(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function satelliteScelto() {
    const sel = stato.selezione;
    return sel && sel.tipo === 'satellite' ? stato.satelliti.find((s) => s.norad === sel.id && s.sopra) || null : null;
  }

  function giornoOra(t, adesso) {
    const giorno = new Date(t).toDateString();
    const oggi = new Date(adesso).toDateString();
    const domani = new Date(adesso + 86400000).toDateString();
    const prefisso = giorno === oggi ? 'alle' : giorno === domani ? 'domani alle' : 'il ' + new Date(t).toLocaleDateString('it-IT') + ' alle';
    return `${prefisso} ${orario.format(new Date(t))}`;
  }

  function aggiornaPannelli(adesso, visibili) {
    const data = new Date(adesso);
    const sec = String(data.getSeconds()).padStart(2, '0');
    riempi($('ora'), `${orario.format(data)}<small>:${sec}</small>`);
    riempi($('data'), sicuro(data.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })));
    if (haPosizione()) {
      const lat = `${decimali.format(Math.abs(imp.lat))}° ${imp.lat >= 0 ? 'N' : 'S'}`;
      const lon = `${decimali.format(Math.abs(imp.lon))}° ${imp.lon >= 0 ? 'E' : 'O'}`;
      const sole = stato.sole;
      const luce = !sole ? '' : sole.el > 0 ? 'giorno' : sole.el > -6 ? 'crepuscolo' : sole.el > -12 ? 'crepuscolo nautico' : 'notte';
      riempi($('luogo'), sicuro(`${lat} · ${lon}${luce ? ' · ' + luce : ''}`));
    } else {
      riempi($('luogo'), '');
    }
    aggiornaConteggi(adesso, visibili);
    aggiornaDettaglio(adesso, visibili);
    aggiornaStazioni(adesso);
  }

  function aggiornaConteggi(adesso, visibili) {
    if (!haPosizione()) return riempi($('conteggi'), '');
    const righe = [];
    const fa = stato.aereiAlle ? Math.round((adesso - stato.aereiAlle) / 1000) : null;
    righe.push(`<div><span class="titolo aereo">✈ ${numeri.format(visibili.length)}</span> aerei sopra l'orizzonte</div>`);
    righe.push(`<div class="tenue">entro ${numeri.format(imp.raggioKm)} km${stato.fonteAerei ? ` · ${sicuro(stato.fonteAerei)}, ${fa} s fa` : ''}</div>`);
    if (stato.satelliti.length) {
      const sopra = stato.satelliti.filter((s) => s.sopra && s.el >= Math.max(0, imp.elevMin));
      const accesi = stato.sole && stato.sole.el < -6 ? sopra.filter((s) => s.illuminato).length : 0;
      righe.push(`<div class="riga"><span class="titolo">● ${numeri.format(sopra.length)}</span> satelliti sopra l'orizzonte</div>`);
      righe.push(`<div class="tenue">su ${numeri.format(stato.satelliti.length)} seguiti${accesi ? ` · ${numeri.format(accesi)} illuminati dal Sole` : ''}</div>`);
    } else if (!stato.erroreSatelliti) {
      righe.push('<div class="riga tenue">Carico i satelliti…</div>');
    }
    if (stato.corpi.length) {
      const luna = stato.corpi.find((c) => c.nome === 'Luna');
      const lunaQui = luna.el > 0 ? `${numeri.format(luna.el)}° verso ${G.puntoCardinale(luna.az)}` : "sotto l'orizzonte";
      righe.push(`<div class="riga"><span class="titolo">☾ Luna</span> ${faseLuna(luna)} · ${lunaQui}</div>`);
      const sopra = stato.corpi.filter((c) => c.nome !== 'Luna' && c.el > 0).sort((a, b) => b.el - a.el);
      const sotto = stato.corpi.filter((c) => c.nome !== 'Luna' && c.el <= 0).map((c) => c.nome);
      for (const c of sopra) {
        righe.push(`<div><span style="color:${COLORI_CORPI[c.nome]}">●</span> <b>${c.nome}</b> ${numeri.format(c.el)}° ${G.puntoCardinale(c.az)} <span class="tenue">· ${comeSiVedeCorpo(c)}</span></div>`);
      }
      if (sotto.length) righe.push(`<div class="tenue">sotto l'orizzonte: ${sotto.join(', ')}</div>`);
    }
    for (const errore of [stato.erroreAerei, stato.erroreSatelliti]) if (errore) righe.push(`<div class="riga errore">${sicuro(errore)}</div>`);
    riempi($('conteggi'), righe.join(''));
  }

  function descriviMoto(salita) {
    if (salita > 1.5) return `in salita ${decimali.format(salita)} m/s`;
    if (salita < -1.5) return `in discesa ${decimali.format(-salita)} m/s`;
    return 'in volo livellato';
  }

  function aggiornaDettaglio(adesso, visibili) {
    if (!haPosizione()) return riempi($('dettaglio'), '');
    const sel = stato.selezione;
    if (sel && sel.tipo === 'corpo') {
      const c = stato.corpi.find((x) => x.nome === sel.id);
      if (c && c.el > -0.5) return riempi($('dettaglio'), schedaCorpo(c));
      stato.selezione = null;
    }
    if (sel && sel.tipo === 'satellite') {
      const s = satelliteScelto();
      if (s) return riempi($('dettaglio'), schedaSatellite(s, adesso));
      stato.selezione = null;
    }
    let a = sel && sel.tipo === 'aereo' ? visibili.find((x) => x.id === sel.id) : null;
    if (sel && sel.tipo === 'aereo' && !a) stato.selezione = null;
    const titolo = a ? 'Selezionato' : 'Il più alto sopra di te';
    a = a || visibili[0];
    if (!a) {
      const attesa = stato.aereiAlle ? `Nessun aereo sopra l'orizzonte entro ${numeri.format(imp.raggioKm)} km.` : 'Cerco gli aerei…';
      return riempi($('dettaglio'), `<div class="tenue">${attesa}</div>`);
    }
    const d = a.dati, info = dettagliDi(a), rotta = rottaNota(a), aereo = info?.aereo;
    const righe = [`<div class="etichetta">${titolo}</div>`];
    const compagnia = rotta?.compagnia || aereo?.proprietario || '';
    righe.push(`<div class="titolo aereo">✈ ${sicuro(nomeVolo(a))}${compagnia ? ' · ' + sicuro(compagnia) : ''}</div>`);
    const modello = aereo?.modello || d.descrizione || d.tipo;
    const sigle = [modello, d.reg || aereo?.reg, d.volo && d.volo !== nomeVolo(a) ? d.volo : ''].filter(Boolean);
    if (sigle.length) righe.push(`<div>${sicuro(sigle.join(' · '))}</div>`);
    if (rotta) {
      const luogo = (x) => `${x.citta || x.nome} (${sigla(x)})`;
      righe.push(`<div class="riga">${sicuro(luogo(rotta.partenza))} → <b>${sicuro(luogo(rotta.arrivo))}</b></div>`);
      const coerente = G.rottaCoerente({ ...a.posizione, rotta: d.rotta }, rotta.partenza, rotta.arrivo);
      const nota = coerente === false ? 'la posizione non torna: la rotta in archivio forse è vecchia'
        : coerente ? 'coerente con la posizione' : '';
      righe.push(`<div class="tenue">rotta da ${sicuro(rotta.fonte)}${nota ? ', ' + nota : ''}</div>`);
    } else if (info || !d.volo) {
      righe.push(`<div class="riga tenue">Rotta non in archivio${Number.isFinite(d.rotta) ? `: va verso ${G.puntoCardinale(d.rotta)} (${numeri.format(d.rotta)}°)` : ''}</div>`);
    } else {
      righe.push('<div class="riga tenue">Cerco da dove viene e dove va…</div>');
    }
    const quota = `${numeri.format(Math.round(a.posizione.quota / 10) * 10)} m`;
    const velocita = d.velocita_kmh ? ` · ${numeri.format(d.velocita_kmh)} km/h` : '';
    righe.push(`<div class="riga">${quota}${velocita} · ${descriviMoto(d.salita_ms)}</div>`);
    righe.push(`<div class="tenue">a ${decimali.format(a.vista.dist / 1000)} km da te, ${numeri.format(a.vista.el)}° sopra l'orizzonte verso ${G.puntoCardinale(a.vista.az)}</div>`);
    if (d.emergenza || ['7500', '7600', '7700'].includes(d.squawk)) {
      righe.push(`<div class="riga allarme">Codice transponder ${sicuro(d.squawk)}: emergenza dichiarata</div>`);
    }
    riempi($('dettaglio'), righe.join(''));
  }

  function schedaCorpo(c) {
    const distanza = c.nome === 'Luna' ? `${numeri.format(c.distanzaKm)} km`
      : `${decimali.format(c.distanzaKm / 1e6)} milioni di km (${decimali.format(c.distanzaKm / 149597870.7)} UA)`;
    const righe = [
      '<div class="etichetta">Selezionato</div>',
      `<div class="titolo" style="color:${COLORI_CORPI[c.nome]}">${c.nome === 'Luna' ? '☾' : '●'} ${c.nome}</div>`,
    ];
    if (c.nome === 'Luna') righe.push(`<div>${faseLuna(c)}</div>`);
    else righe.push(`<div>magnitudine ${decimali.format(c.magnitudine)} · a ${numeri.format(c.allungamento)}° dal Sole</div>`);
    righe.push(`<div class="riga">a ${distanza} dalla Terra</div>`);
    righe.push(`<div>${numeri.format(c.el)}° sopra l'orizzonte verso ${G.puntoCardinale(c.az)}</div>`);
    righe.push(`<div class="tenue">${comeSiVedeCorpo(c)}</div>`);
    return righe.join('');
  }

  function schedaSatellite(s, adesso) {
    const data = new Date(adesso);
    const velocita = s.vel ? Math.hypot(s.vel.x, s.vel.y, s.vel.z) : 0;
    const notte = stato.sole && stato.sole.el < -6;
    const luce = s.illuminato ? (notte ? 'illuminato dal Sole mentre qui è buio: si può vedere' : 'illuminato dal Sole') : 'nell\'ombra della Terra';
    return [
      '<div class="etichetta">Selezionato</div>',
      `<div class="titolo${s.stazione ? ' stazione' : ''}">● ${sicuro(s.stazione ? s.stazione.nome + ' · ' + s.stazione.descrizione : nomeBreve(s.nome))}</div>`,
      `<div class="tenue">${sicuro(s.nome)} · NORAD ${s.norad}</div>`,
      `<div class="riga">${numeri.format(quotaKm(s, data))} km di quota · ${decimali.format(velocita)} km/s</div>`,
      `<div>a ${numeri.format(s.dist)} km da te, ${numeri.format(s.el)}° verso ${G.puntoCardinale(s.az)}</div>`,
      `<div class="tenue">${luce}</div>`,
    ].join('');
  }

  function aggiornaStazioni(adesso) {
    if (!haPosizione()) return riempi($('stazioni'), '');
    const stazioni = stato.satelliti.filter((s) => s.stazione);
    if (!stazioni.length) return riempi($('stazioni'), '');
    if (adesso - stato.passaggiAlle > 60000) {
      for (const s of stazioni) {
        const p = prossimoPassaggio(s, adesso);
        stato.passaggi.set(s.norad, { p, visibile: p && p.visibile ? p : prossimoVisibile(s, adesso) });
      }
      stato.passaggiAlle = adesso;
    }
    const notte = stato.sole && stato.sole.el < -6;
    const righe = ['<div class="etichetta">Stazioni spaziali</div>'];
    for (const s of stazioni) {
      const nome = `<span class="titolo stazione">${sicuro(s.stazione.nome)}</span>`;
      if (s.sopra && s.el > 0) {
        const guarda = notte && s.illuminato && s.el > SOGLIA_PASSAGGIO ? ' · <b>illuminata: guardala!</b>' : s.illuminato ? ' · al Sole' : ' · in ombra';
        righe.push(`<div class="riga">${nome} sopra di te: ${numeri.format(s.el)}° verso ${G.puntoCardinale(s.az)}${guarda}</div>`);
        continue;
      }
      const { p, visibile } = stato.passaggi.get(s.norad) || {};
      const quanto = (x) => `alta ${numeri.format(x.massimo.el)}° verso ${G.puntoCardinale(x.massimo.az)}`;
      if (!p) {
        righe.push(`<div class="riga">${nome} <span class="tenue">nessun passaggio alto nelle prossime 24 ore</span></div>`);
      } else {
        const quando = p.inCorso ? 'sta passando ora' : `passa ${giornoOra(p.inizio, adesso)}`;
        righe.push(`<div class="riga">${nome} ${quando}, ${quanto(p)}<div class="tenue">${comeSiVede(p)}</div></div>`);
      }
      if (visibile && visibile !== p) {
        righe.push(`<div>a occhio nudo: <b>${giornoOra(visibile.inizio, adesso)}</b>, ${quanto(visibile)}</div>`);
      } else if (!visibile) {
        righe.push('<div class="tenue">nessun passaggio visibile nei prossimi 3 giorni</div>');
      }
    }
    riempi($('stazioni'), righe.join(''));
  }

  // ---------- comandi ----------

  const finestra = $('impostazioni');
  const modulo = $('modulo');

  function apriImpostazioni(avviso) {
    for (const [nome, valore] of Object.entries(imp)) {
      const campo = modulo.elements[nome];
      if (!campo) continue;
      if (campo.type === 'checkbox') campo.checked = valore;
      else campo.value = valore ?? '';
    }
    $('avviso-posizione').hidden = !avviso;
    $('esito-dispositivo').textContent = '';
    mostraValori();
    if (!finestra.open) finestra.showModal();
  }

  function mostraValori() {
    $('valore-nord').textContent = `${modulo.elements.nord.value}°`;
    $('valore-testo').textContent = `${decimali.format(Number(modulo.elements.testo.value))}×`;
    $('valore-elevMin').textContent = `${modulo.elements.elevMin.value}°`;
  }

  function leggiModulo() {
    const e = modulo.elements;
    return pulisci({
      lat: e.lat.value, lon: e.lon.value, quota: e.quota.value, raggioKm: e.raggioKm.value,
      satelliti: e.satelliti.value, starlink: e.starlink.checked, elevMin: e.elevMin.value, scie: e.scie.checked,
      vista: e.vista.value, nord: e.nord.value, testo: e.testo.value,
    });
  }

  function applica(nuove) {
    const vecchie = imp;
    imp = nuove;
    aggiornaCarattere();
    const spostato = vecchie.lat !== imp.lat || vecchie.lon !== imp.lon || vecchie.quota !== imp.quota;
    if (spostato || vecchie.raggioKm !== imp.raggioKm) {
      stato.aerei.clear();
      stato.aereiAlle = 0;
      stato.fonteAerei = '';
      aggiornaAerei();
    }
    if (spostato) {
      for (const s of stato.satelliti) s.sopra = false;
      stato.passaggiAlle = 0;
      stato.tracce.clear();
      stato.soleAlle = 0;
      stato.corpiAlle = 0;
    }
    if (vecchie.satelliti !== imp.satelliti || vecchie.starlink !== imp.starlink || !stato.tleAlle) caricaSatelliti();
  }

  modulo.addEventListener('input', mostraValori);
  modulo.addEventListener('input', (evento) => {
    // Nord, vista e testi si vedono subito, così si allinea il proiettore guardando il soffitto.
    if (['nord', 'vista', 'testo'].includes(evento.target.name)) {
      const prova = leggiModulo();
      imp = { ...imp, nord: prova.nord, vista: prova.vista, testo: prova.testo };
      aggiornaCarattere();
    }
  });
  let primaDiAprire = null;
  finestra.addEventListener('close', () => {
    if (finestra.returnValue === 'salva') {
      const nuove = leggiModulo();
      if (primaDiAprire && (nuove.lat !== primaDiAprire.lat || nuove.lon !== primaDiAprire.lon ||
        nuove.quota !== primaDiAprire.quota)) stato.fontePosizione = 'impostazioni';
      applica(nuove);
      salva();
      if (!haPosizione()) setTimeout(() => apriConCopia(true), 0);
    } else if (primaDiAprire) {
      imp = primaDiAprire;
      aggiornaCarattere();
    }
    primaDiAprire = null;
  });
  const apriConCopia = (avviso) => { primaDiAprire = { ...imp }; apriImpostazioni(avviso); };

  $('usa-dispositivo').addEventListener('click', async () => {
    const esito = $('esito-dispositivo');
    esito.textContent = 'Chiedo la posizione…';
    try {
      const p = await posizioneDispositivo();
      modulo.elements.lat.value = p.lat.toFixed(4);
      modulo.elements.lon.value = p.lon.toFixed(4);
      if (p.quota !== null) modulo.elements.quota.value = Math.round(p.quota);
      esito.textContent = `Trovata, precisa a circa ${numeri.format(p.precisione)} m. Premi Salva.`;
    } catch (errore) {
      esito.textContent = 'Non disponibile: ' + errore.message;
    }
  });

  function posizioneDispositivo() {
    return new Promise((risolvi, rifiuta) => {
      if (!navigator.geolocation) return rifiuta(new Error('questo browser non la fornisce'));
      navigator.geolocation.getCurrentPosition(
        (p) => risolvi({ lat: p.coords.latitude, lon: p.coords.longitude, quota: p.coords.altitude, precisione: p.coords.accuracy }),
        (e) => rifiuta(new Error(e.code === 1 ? 'permesso negato' : 'posizione non trovata')),
        { timeout: 15000, maximumAge: 600000 });
    });
  }

  function schermoIntero() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  $('schermo-intero').addEventListener('click', schermoIntero);
  $('apri-impostazioni').addEventListener('click', () => apriConCopia(false));

  window.addEventListener('keydown', (evento) => {
    if (finestra.open || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    const tasto = evento.key.toLowerCase();
    let cambiato = true;
    if (tasto === 's') { apriConCopia(false); cambiato = false; }
    else if (tasto === 'f') { schermoIntero(); cambiato = false; }
    else if (evento.key === 'ArrowLeft') imp.nord = (imp.nord + 355) % 360;
    else if (evento.key === 'ArrowRight') imp.nord = (imp.nord + 5) % 360;
    else if (tasto === '+' || tasto === '=') imp.testo = Math.min(3, Math.round((imp.testo + 0.1) * 10) / 10);
    else if (tasto === '-') imp.testo = Math.max(0.5, Math.round((imp.testo - 0.1) * 10) / 10);
    else if (evento.key === 'Escape') { stato.selezione = null; cambiato = false; }
    else return;
    evento.preventDefault();
    if (cambiato) { aggiornaCarattere(); salva(); }
  });

  tela.addEventListener('click', (evento) => {
    let migliore = null, minimo = Infinity;
    for (const c of stato.cliccabili) {
      const d = Math.hypot(c.x - evento.clientX, c.y - evento.clientY) - c.peso * 3;
      if (d < minimo) { minimo = d; migliore = c; }
    }
    stato.selezione = migliore && minimo < 24 ? { tipo: migliore.tipo, id: migliore.id } : null;
    ultimiPannelli = 0;
  });

  // Il puntatore e il pulsante spariscono quando il mouse sta fermo: sul soffitto non servono.
  let timerQuiete = 0;
  function sveglia() {
    document.body.classList.remove('quieto');
    clearTimeout(timerQuiete);
    timerQuiete = setTimeout(() => document.body.classList.add('quieto'), 3000);
  }
  window.addEventListener('mousemove', sveglia);
  window.addEventListener('resize', ridimensiona);

  // ---------- avvio ----------

  async function avvia() {
    ridimensiona();
    sveglia();
    requestAnimationFrame(fotogramma);
    const salvate = leggiSalvate();
    const indirizzo = daIndirizzo();
    imp = pulisci({ ...PREDEFINITE, ...salvate, ...indirizzo });
    aggiornaCarattere();
    if (indirizzo.lat !== undefined && haPosizione()) stato.fontePosizione = 'indirizzo';
    else if (haPosizione()) stato.fontePosizione = 'impostazioni';
    if (!haPosizione()) {
      try {
        const configurazione = await (await fetch('/api/config')).json();
        if (Number.isFinite(configurazione.lat) && Number.isFinite(configurazione.lon)) {
          imp = pulisci({ ...imp, lat: configurazione.lat, lon: configurazione.lon, quota: configurazione.quota });
          stato.fontePosizione = 'server';
        }
      } catch (e) { /* senza server di configurazione si prova col dispositivo */ }
    }
    if (!haPosizione()) {
      try {
        const p = await posizioneDispositivo();
        imp = pulisci({ ...imp, lat: p.lat, lon: p.lon, quota: p.quota ?? imp.quota });
        stato.fontePosizione = 'dispositivo';
      } catch (e) { /* la si chiede a mano */ }
    }
    caricaSatelliti();
    if (haPosizione()) aggiornaAerei();
    else apriConCopia(true);
  }

  avvia();
})();
