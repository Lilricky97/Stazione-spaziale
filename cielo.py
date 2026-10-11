#!/usr/bin/env python3
"""Cielo: serve la pagina da proiettare e le porta aerei, rotte e satelliti.

I servizi ADS-B non permettono al browser di leggerli direttamente (non mandano
l'intestazione CORS), per questo le richieste passano da qui. Solo libreria standard.
"""
import argparse
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

QUI = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(QUI, "web")
CACHE = os.path.join(QUI, "cache")
AGENTE = "Cielo/1.0 (proiettore personale del cielo)"

# Posizioni in tempo reale dalle reti di ricevitori volontari, in ordine di preferenza.
# Il raggio è in miglia nautiche, al massimo 250 per entrambe.
FONTI_AEREI = [
    ("adsb.lol", "https://api.adsb.lol/v2/point/{lat:.4f}/{lon:.4f}/{nm}"),
    ("adsb.fi", "https://opendata.adsb.fi/api/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}"),
]
AEREI_VALIDITA = 4                # secondi: più schermi aperti non moltiplicano le richieste
ROTTA_VALIDITA = 6 * 3600
ROTTA_IGNOTA_VALIDITA = 3600
GUASTO_VALIDITA = 300             # un servizio che non risponde si riprova dopo 5 minuti
AEREO_VALIDITA = 7 * 24 * 3600

# CelesTrak chiede di non riscaricare lo stesso gruppo più di una volta ogni 2 ore.
GRUPPI_SATELLITI = {"stations", "visual", "active", "starlink", "gnss", "weather", "science", "geo", "amateur"}
TLE_VALIDITA = 6 * 3600
TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={gruppo}&FORMAT=tle"

LA_SPEZIA = (44.1025, 9.8241, 5)   # posizione predefinita: latitudine, longitudine, quota in metri

NOMINATIVO = re.compile(r"^[A-Z0-9]{2,8}$")
ESADECIMALE = re.compile(r"^~?[0-9a-f]{6}$")
VEICOLI_A_TERRA = {"C1", "C2"}    # categorie ADS-B dei mezzi di superficie


def scarica(url, timeout=10):
    richiesta = urllib.request.Request(url, headers={"User-Agent": AGENTE, "Accept": "*/*"})
    with urllib.request.urlopen(richiesta, timeout=timeout) as risposta:
        return risposta.read()


def numero(valore):
    return isinstance(valore, (int, float)) and not isinstance(valore, bool) and math.isfinite(valore)


def normalizza_aereo(a):
    """Riduce un aereo nel formato readsb (adsb.lol, adsb.fi) a ciò che serve alla pagina.

    Restituisce None per ciò che non si può mettere in cielo: senza posizione, senza quota,
    fermo a terra o veicolo di servizio sulla pista.
    """
    if not isinstance(a, dict) or not numero(a.get("lat")) or not numero(a.get("lon")):
        return None
    if a.get("alt_baro") == "ground" or a.get("category") in VEICOLI_A_TERRA:
        return None
    piedi = a.get("alt_geom") if numero(a.get("alt_geom")) else a.get("alt_baro")
    if not numero(piedi):
        return None
    rotta = next((a[k] for k in ("track", "true_heading", "mag_heading") if numero(a.get(k))), None)
    variazione = next((a[k] for k in ("geom_rate", "baro_rate") if numero(a.get(k))), 0)
    eta = a.get("seen_pos") if numero(a.get("seen_pos")) else a.get("seen", 0)
    return {
        "hex": str(a.get("hex", "")).lower(),
        "volo": str(a.get("flight") or "").strip(),
        "reg": str(a.get("r") or "").strip(),
        "tipo": str(a.get("t") or "").strip(),
        "descrizione": str(a.get("desc") or "").strip(),
        "lat": a["lat"],
        "lon": a["lon"],
        "quota_m": round(piedi * 0.3048),
        "velocita_kmh": round(a["gs"] * 1.852) if numero(a.get("gs")) else None,
        "rotta": rotta,
        "salita_ms": round(variazione * 0.00508, 1),
        "squawk": str(a.get("squawk") or ""),
        "emergenza": a.get("emergency") not in (None, "", "none"),
        "eta_s": eta if numero(eta) else 0,
    }


def leggi_aerei(dati):
    elenco = dati.get("ac", dati.get("aircraft")) if isinstance(dati, dict) else None
    if not isinstance(elenco, list):
        raise ValueError("Risposta senza elenco di aerei")
    return [aereo for aereo in map(normalizza_aereo, elenco) if aereo]


def aeroporto_adsbdb(a):
    if not isinstance(a, dict):
        return None
    return {"iata": a.get("iata_code") or "", "icao": a.get("icao_code") or "", "nome": a.get("name") or "",
            "citta": a.get("municipality") or "", "paese": a.get("country_name") or "",
            "lat": a.get("latitude"), "lon": a.get("longitude")}


def rotta_adsbdb(dati, volo):
    rotta = dati.get("response", {}).get("flightroute") if isinstance(dati.get("response"), dict) else None
    if not isinstance(rotta, dict):
        return None
    compagnia = rotta.get("airline") if isinstance(rotta.get("airline"), dict) else {}
    partenza, arrivo = aeroporto_adsbdb(rotta.get("origin")), aeroporto_adsbdb(rotta.get("destination"))
    if not partenza or not arrivo:
        return None
    return {"volo": volo, "volo_iata": rotta.get("callsign_iata") or "", "compagnia": compagnia.get("name") or "",
            "partenza": partenza, "arrivo": arrivo, "fonte": "adsbdb.com"}


def aeroporto_hexdb(a):
    return {"iata": a.get("iata") or "", "icao": a.get("icao") or "", "nome": a.get("airport") or "",
            "citta": a.get("region_name") or "", "paese": a.get("country_code") or "",
            "lat": a.get("latitude"), "lon": a.get("longitude")}


def aereo_adsbdb(dati):
    a = dati.get("response", {}).get("aircraft") if isinstance(dati.get("response"), dict) else None
    if not isinstance(a, dict):
        return None
    return {"modello": " ".join(p for p in (a.get("manufacturer"), a.get("type")) if p), "tipo": a.get("icao_type") or "",
            "reg": a.get("registration") or "", "proprietario": a.get("registered_owner") or "",
            "paese": a.get("registered_owner_country_name") or "", "fonte": "adsbdb.com"}


def aereo_hexdb(a):
    if not isinstance(a, dict) or not a.get("Registration"):
        return None
    return {"modello": " ".join(p for p in (a.get("Manufacturer"), a.get("Type")) if p), "tipo": a.get("ICAOTypeCode") or "",
            "reg": a.get("Registration") or "", "proprietario": a.get("RegisteredOwners") or "", "paese": "",
            "fonte": "hexdb.io"}


def tle_valido(testo):
    righe = testo.splitlines()
    return any(r.startswith("1 ") for r in righe) and any(r.startswith("2 ") for r in righe)


class Archivio:
    """Memoria a scadenza per le risposte dei servizi esterni."""

    def __init__(self):
        self.voci = {}
        self.blocco = threading.Lock()

    def leggi(self, chiave):
        with self.blocco:
            voce = self.voci.get(chiave)
        if voce and voce[0] > time.time():
            return voce[1], True
        return None, False

    def scrivi(self, chiave, valore, validita):
        with self.blocco:
            self.voci[chiave] = (time.time() + validita, valore)
        return valore


class Cielo:
    def __init__(self, scarica=scarica, cartella_cache=CACHE):
        self.scarica = scarica
        self.cartella_cache = cartella_cache
        self.archivio = Archivio()
        self.blocchi_tle = {g: threading.Lock() for g in GRUPPI_SATELLITI}

    def json_da(self, url, timeout=10):
        return json.loads(self.scarica(url, timeout=timeout).decode("utf-8"))

    def aerei(self, lat, lon, raggio_km):
        nm = max(1, min(250, round(raggio_km / 1.852)))
        chiave = ("aerei", round(lat, 3), round(lon, 3), nm)
        dati, trovato = self.archivio.leggi(chiave)
        if trovato:
            return dati
        errori = []
        for nome, modello in FONTI_AEREI:
            try:
                elenco = leggi_aerei(self.json_da(modello.format(lat=lat, lon=lon, nm=nm), timeout=6))
            except (OSError, ValueError) as errore:
                errori.append(f"{nome}: {errore}")
                print(f"Aerei: {nome} non risponde ({errore}), provo la fonte successiva", file=sys.stderr)
                continue
            return self.archivio.scrivi(chiave, {"fonte": nome, "ora": time.time(), "aerei": elenco}, AEREI_VALIDITA)
        raise RuntimeError("Nessuna fonte di aerei raggiungibile (" + "; ".join(errori) + ")")

    def rotta(self, volo):
        dati, trovato = self.archivio.leggi(("rotta", volo))
        if trovato:
            return dati
        rotta, guasti = None, []
        try:
            rotta = rotta_adsbdb(self.json_da("https://api.adsbdb.com/v0/callsign/" + volo), volo)
        except (OSError, ValueError) as errore:
            # 404 vuol dire nominativo sconosciuto; con gli altri errori la risposta vale poco
            if not (isinstance(errore, urllib.error.HTTPError) and errore.code == 404):
                guasti.append(errore)
        if rotta is None:
            rotta = self.rotta_hexdb(volo, guasti)
        if rotta is None:
            validita = GUASTO_VALIDITA if guasti else ROTTA_IGNOTA_VALIDITA
            return self.archivio.scrivi(("rotta", volo), {"volo": volo, "sconosciuta": True}, validita)
        return self.archivio.scrivi(("rotta", volo), rotta, ROTTA_VALIDITA)

    def rotta_hexdb(self, volo, guasti):
        try:
            percorso = self.json_da("https://hexdb.io/api/v1/route/icao/" + volo).get("route", "")
            codici = percorso.split("-")
            if len(codici) < 2 or not all(re.fullmatch(r"[A-Z0-9]{3,4}", c) for c in codici):
                return None
            partenza = aeroporto_hexdb(self.json_da("https://hexdb.io/api/v1/airport/icao/" + codici[0]))
            arrivo = aeroporto_hexdb(self.json_da("https://hexdb.io/api/v1/airport/icao/" + codici[-1]))
        except (OSError, ValueError, AttributeError) as errore:
            if not (isinstance(errore, urllib.error.HTTPError) and errore.code == 404):
                guasti.append(errore)
            return None
        return {"volo": volo, "volo_iata": "", "compagnia": "", "partenza": partenza, "arrivo": arrivo, "fonte": "hexdb.io"}

    def aereo(self, esadecimale):
        dati, trovato = self.archivio.leggi(("aereo", esadecimale))
        if trovato:
            return dati
        aereo, guasti = None, False
        for url, lettore in (("https://api.adsbdb.com/v0/aircraft/", aereo_adsbdb),
                             ("https://hexdb.io/api/v1/aircraft/", aereo_hexdb)):
            try:
                aereo = lettore(self.json_da(url + esadecimale))
            except (OSError, ValueError) as errore:
                guasti = guasti or not (isinstance(errore, urllib.error.HTTPError) and errore.code == 404)
                continue
            if aereo:
                break
        validita = AEREO_VALIDITA if aereo else GUASTO_VALIDITA if guasti else ROTTA_IGNOTA_VALIDITA
        return self.archivio.scrivi(("aereo", esadecimale), aereo, validita)

    def tle(self, gruppo):
        """Elementi orbitali del gruppo; tenuti su disco e riscaricati solo quando vecchi."""
        os.makedirs(self.cartella_cache, exist_ok=True)
        percorso = os.path.join(self.cartella_cache, gruppo + ".tle")
        with self.blocchi_tle[gruppo]:
            eta = time.time() - os.path.getmtime(percorso) if os.path.exists(percorso) else None
            if eta is not None and eta < TLE_VALIDITA:
                return self.leggi_file(percorso), eta
            try:
                testo = self.scarica(TLE_URL.format(gruppo=gruppo), timeout=60).decode("utf-8", "replace")
                if not tle_valido(testo):
                    raise ValueError(testo.strip()[:200] or "risposta vuota")
            except (OSError, ValueError) as errore:
                if eta is None:
                    raise RuntimeError(f"CelesTrak non raggiungibile per il gruppo {gruppo}: {errore}")
                return self.leggi_file(percorso), eta    # meglio elementi di qualche ora fa che niente
            temporaneo = percorso + ".nuovo"
            with open(temporaneo, "w", encoding="utf-8") as file:
                file.write(testo)
            os.replace(temporaneo, percorso)
            return testo, 0

    @staticmethod
    def leggi_file(percorso):
        with open(percorso, encoding="utf-8") as file:
            return file.read()


def crea_gestore(cielo, configurazione):
    class Gestore(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=WEB, **kwargs)

        def log_message(self, formato, *args):
            if args and str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
                super().log_message(formato, *args)

        def end_headers(self):
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def manda(self, stato, corpo, tipo="application/json; charset=utf-8"):
            dati = corpo if isinstance(corpo, bytes) else json.dumps(corpo, ensure_ascii=False).encode("utf-8")
            self.send_response(stato)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(dati)))
            self.end_headers()
            self.wfile.write(dati)

        def do_GET(self):
            indirizzo = urllib.parse.urlsplit(self.path)
            if not indirizzo.path.startswith("/api/"):
                return super().do_GET()
            parametri = {k: v[0] for k, v in urllib.parse.parse_qs(indirizzo.query).items()}
            try:
                self.rispondi_api(indirizzo.path, parametri)
            except (BrokenPipeError, ConnectionResetError):
                pass                        # la pagina è stata chiusa o ricaricata nel frattempo
            except ValueError as errore:
                self.manda(400, {"errore": str(errore)})
            except (RuntimeError, OSError) as errore:
                self.manda(502, {"errore": str(errore)})

        def rispondi_api(self, percorso, parametri):
            if percorso == "/api/config":
                return self.manda(200, configurazione)
            if percorso == "/api/aerei":
                lat, lon = float(parametri.get("lat", "x")), float(parametri.get("lon", "x"))
                raggio = float(parametri.get("raggio_km", "150"))
                if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 1 <= raggio <= 460):
                    raise ValueError("Posizione o raggio fuori scala")
                return self.manda(200, cielo.aerei(lat, lon, raggio))
            if percorso == "/api/dettagli":
                volo = parametri.get("volo", "").strip().upper()
                esadecimale = parametri.get("hex", "").strip().lower()
                risposta = {}
                if NOMINATIVO.match(volo):
                    risposta["rotta"] = cielo.rotta(volo)
                if ESADECIMALE.match(esadecimale) and not esadecimale.startswith("~"):
                    risposta["aereo"] = cielo.aereo(esadecimale)
                return self.manda(200, risposta)
            if percorso == "/api/tle":
                gruppo = parametri.get("gruppo", "")
                if gruppo not in GRUPPI_SATELLITI:
                    raise ValueError("Gruppo di satelliti sconosciuto")
                testo, eta = cielo.tle(gruppo)
                self.send_response(200)
                dati = testo.encode("utf-8")
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(dati)))
                self.send_header("X-Eta-Secondi", str(round(eta)))
                self.end_headers()
                self.wfile.write(dati)
                return None
            raise ValueError("Indirizzo sconosciuto")

    return Gestore


def main():
    parser = argparse.ArgumentParser(description="Proietta aerei, satelliti e stazioni spaziali sopra di te.")
    parser.add_argument("--lat", type=float, default=LA_SPEZIA[0], help="latitudine in gradi, nord positivo (predefinita: La Spezia)")
    parser.add_argument("--lon", type=float, default=LA_SPEZIA[1], help="longitudine in gradi, est positivo (predefinita: La Spezia)")
    parser.add_argument("--quota", type=float, default=LA_SPEZIA[2], help="quota sul mare in metri")
    parser.add_argument("--porta", type=int, default=8642)
    parser.add_argument("--rete", action="store_true",
                        help="accetta collegamenti dalla rete di casa (per aprire la pagina da un altro dispositivo)")
    parser.add_argument("--apri", action="store_true", help="apre la pagina nel browser")
    argomenti = parser.parse_args()
    if not (-90 <= argomenti.lat <= 90 and -180 <= argomenti.lon <= 180):
        parser.error("latitudine o longitudine fuori scala")

    configurazione = {"lat": argomenti.lat, "lon": argomenti.lon, "quota": argomenti.quota}
    server = ThreadingHTTPServer(("0.0.0.0" if argomenti.rete else "127.0.0.1", argomenti.porta),
                                 crea_gestore(Cielo(), configurazione))
    indirizzo = f"http://localhost:{argomenti.porta}/"
    print(f"Cielo pronto: {indirizzo}  (Ctrl+C per fermare)")
    if argomenti.apri:
        threading.Timer(0.5, webbrowser.open, [indirizzo]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
