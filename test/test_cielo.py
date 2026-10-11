# python3 -m unittest discover -s test
import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import cielo  # noqa: E402

AEREO = {"hex": "4CA2D1", "flight": "RYR46SZ ", "r": "EI-EKA", "t": "B738", "alt_baro": 11650, "alt_geom": 11900,
         "gs": 400.0, "track": 212.5, "baro_rate": -1280, "squawk": "1000", "emergency": "none", "category": "A3",
         "lat": 45.6, "lon": 9.0, "seen_pos": 1.5}
TLE = "ISS (ZARYA)\n1 25544U 98067A   26283.78925095  .00010839  00000+0  20582-3 0  9996\n" \
      "2 25544  51.6307  88.0087 0006720 246.7167 113.3114 15.48817123589672\n"


class Finto:
    """Al posto della rete: risponde secondo l'inizio dell'indirizzo e conta le richieste."""

    def __init__(self, risposte):
        self.risposte = risposte
        self.chiesti = []

    def __call__(self, url, timeout=10):
        self.chiesti.append(url)
        for inizio, risposta in self.risposte.items():
            if url.startswith(inizio):
                if isinstance(risposta, Exception):
                    raise risposta
                return risposta if isinstance(risposta, bytes) else json.dumps(risposta).encode()
        raise urllib.error.URLError("non previsto: " + url)


def non_trovato(url):
    return urllib.error.HTTPError(url, 404, "Not Found", {}, None)


class Aerei(unittest.TestCase):
    def test_unita_convertite(self):
        a = cielo.normalizza_aereo(AEREO)
        self.assertEqual(a["volo"], "RYR46SZ")
        self.assertEqual(a["hex"], "4ca2d1")
        self.assertEqual(a["quota_m"], round(11900 * 0.3048))          # la quota geometrica se c'è
        self.assertEqual(a["velocita_kmh"], 741)
        self.assertEqual(a["salita_ms"], -6.5)
        self.assertFalse(a["emergenza"])

    def test_scartati_quelli_che_non_stanno_in_cielo(self):
        for cambio in ({"lat": None}, {"alt_baro": "ground"}, {"category": "C1"},
                       {"alt_geom": None, "alt_baro": None}):
            self.assertIsNone(cielo.normalizza_aereo({**AEREO, **cambio}), cambio)

    def test_quota_barometrica_se_manca_quella_geometrica(self):
        a = cielo.normalizza_aereo({**AEREO, "alt_geom": None})
        self.assertEqual(a["quota_m"], round(11650 * 0.3048))

    def test_seconda_fonte_se_la_prima_non_risponde(self):
        rete = Finto({"https://api.adsb.lol/": urllib.error.URLError("giù"),
                      "https://opendata.adsb.fi/": {"aircraft": [AEREO]}})
        risposta = cielo.Cielo(scarica=rete).aerei(45.46, 9.19, 150)
        self.assertEqual(risposta["fonte"], "adsb.fi")
        self.assertEqual(len(risposta["aerei"]), 1)
        self.assertIn("/dist/81", rete.chiesti[-1])                    # 150 km sono 81 miglia nautiche

    def test_risposte_ravvicinate_dalla_memoria(self):
        rete = Finto({"https://api.adsb.lol/": {"ac": [AEREO]}})
        c = cielo.Cielo(scarica=rete)
        c.aerei(45.46, 9.19, 150)
        c.aerei(45.46, 9.19, 150)
        self.assertEqual(len(rete.chiesti), 1)

    def test_nessuna_fonte(self):
        rete = Finto({})
        with self.assertRaises(RuntimeError):
            cielo.Cielo(scarica=rete).aerei(45.46, 9.19, 150)


class Rotte(unittest.TestCase):
    ADSBDB = {"response": {"flightroute": {
        "callsign": "ITY602", "callsign_iata": "AZ602", "airline": {"name": "ITA Airways"},
        "origin": {"iata_code": "FCO", "icao_code": "LIRF", "name": "Fiumicino", "municipality": "Rome",
                   "country_name": "Italy", "latitude": 41.8, "longitude": 12.25},
        "destination": {"iata_code": "JFK", "icao_code": "KJFK", "name": "John F Kennedy", "municipality": "New York",
                        "country_name": "United States", "latitude": 40.64, "longitude": -73.78}}}}

    def test_rotta_da_adsbdb(self):
        rotta = cielo.Cielo(scarica=Finto({"https://api.adsbdb.com/v0/callsign/": self.ADSBDB})).rotta("ITY602")
        self.assertEqual(rotta["volo_iata"], "AZ602")
        self.assertEqual(rotta["compagnia"], "ITA Airways")
        self.assertEqual((rotta["partenza"]["iata"], rotta["arrivo"]["citta"]), ("FCO", "New York"))

    def test_hexdb_se_adsbdb_non_la_conosce(self):
        rete = Finto({
            "https://api.adsbdb.com/v0/callsign/": non_trovato("adsbdb"),
            "https://hexdb.io/api/v1/route/icao/": {"flight": "AFR71DN", "route": "LFPG-LIPE"},
            "https://hexdb.io/api/v1/airport/icao/LFPG": {"iata": "CDG", "icao": "LFPG", "airport": "Charles de Gaulle",
                                                          "latitude": 49.0, "longitude": 2.55},
            "https://hexdb.io/api/v1/airport/icao/LIPE": {"iata": "BLQ", "icao": "LIPE", "airport": "Bologna",
                                                          "latitude": 44.5, "longitude": 11.29},
        })
        rotta = cielo.Cielo(scarica=rete).rotta("AFR71DN")
        self.assertEqual((rotta["partenza"]["iata"], rotta["arrivo"]["iata"], rotta["fonte"]), ("CDG", "BLQ", "hexdb.io"))

    def test_rotta_sconosciuta_ricordata(self):
        rete = Finto({"https://api.adsbdb.com/": non_trovato("adsbdb"), "https://hexdb.io/": non_trovato("hexdb")})
        c = cielo.Cielo(scarica=rete)
        self.assertTrue(c.rotta("HBKNE")["sconosciuta"])
        chieste = len(rete.chiesti)
        c.rotta("HBKNE")
        self.assertEqual(len(rete.chiesti), chieste)

    def test_servizio_guasto_ricordato_poco(self):
        rete = Finto({"https://api.adsbdb.com/": urllib.error.HTTPError("x", 429, "Too Many Requests", {}, None),
                      "https://hexdb.io/": urllib.error.URLError("giù")})
        c = cielo.Cielo(scarica=rete)
        self.assertTrue(c.rotta("ITY602")["sconosciuta"])
        scadenza = c.archivio.voci[("rotta", "ITY602")][0]
        self.assertLessEqual(scadenza - time.time(), cielo.GUASTO_VALIDITA)

    def test_aereo_da_adsbdb(self):
        rete = Finto({"https://api.adsbdb.com/v0/aircraft/": {"response": {"aircraft": {
            "type": "A320-251N", "icao_type": "A20N", "manufacturer": "Airbus", "registration": "OE-LSP",
            "registered_owner": "easyJet Europe", "registered_owner_country_name": "Austria"}}}})
        aereo = cielo.Cielo(scarica=rete).aereo("440cc1")
        self.assertEqual((aereo["modello"], aereo["reg"], aereo["proprietario"]), ("Airbus A320-251N", "OE-LSP", "easyJet Europe"))


class Satelliti(unittest.TestCase):
    def setUp(self):
        self.cartella = tempfile.TemporaryDirectory()
        self.addCleanup(self.cartella.cleanup)

    def test_scaricati_una_volta_poi_dal_disco(self):
        rete = Finto({"https://celestrak.org/": TLE.encode()})
        c = cielo.Cielo(scarica=rete, cartella_cache=self.cartella.name)
        self.assertEqual(c.tle("stations")[0], TLE)
        self.assertEqual(c.tle("stations")[0], TLE)
        self.assertEqual(len(rete.chiesti), 1)

    def test_vecchi_ma_meglio_che_niente(self):
        c = cielo.Cielo(scarica=Finto({"https://celestrak.org/": b"GP data has not updated since your last download"}),
                        cartella_cache=self.cartella.name)
        percorso = os.path.join(self.cartella.name, "stations.tle")
        with open(percorso, "w") as file:
            file.write(TLE)
        vecchio = time.time() - cielo.TLE_VALIDITA - 60
        os.utime(percorso, (vecchio, vecchio))
        testo, eta = c.tle("stations")
        self.assertEqual(testo, TLE)
        self.assertGreater(eta, cielo.TLE_VALIDITA)

    def test_senza_rete_e_senza_copia(self):
        c = cielo.Cielo(scarica=Finto({}), cartella_cache=self.cartella.name)
        with self.assertRaises(RuntimeError):
            c.tle("stations")


if __name__ == "__main__":
    unittest.main()
