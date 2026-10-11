# Cielo — proiettore del cielo

A page to project on a wall or ceiling showing what is overhead in real time: aircraft (with airline, type and route), all active satellites, the ISS and Tiangong with their visible passes, the Moon with its phase and the planets. The user writes in Italian; keep the interface, comments and README in Italian.

- `cielo.py` is a stdlib-only Python server (works from Python 3.7). The browser cannot call the ADS-B services directly (no CORS), so aircraft (adsb.lol, then adsb.fi), routes and aircraft details (adsbdb.com, then hexdb.io) and TLE (CelesTrak) go through it. Keep CelesTrak downloads cached in `cache/`: at most one per group every 2 hours.
- The default location is La Spezia (`LA_SPEZIA` in cielo.py), as the user asked. A position saved in the page settings or given in the URL wins over it.
- `web/` is the page: `geometria.js` has the dependency-free maths (also loaded by the Node tests), `cielo.js` the app, `vendor/satellite.min.js` is satellite.js 5.0.0 (MIT).
- The dome uses a stereographic projection; "dal basso" (looking up) puts east to the left of north.
- Tests: `python3 -m unittest discover -s test` and `node test/geometria.test.js`. Reference values for the Sun, Moon and planets come from PyEphem 4 without refraction; check new astronomy against an independent source the same way.
- The user starts it on a Mac with `Avvia-cielo.command` (double click). Keep it executable.
