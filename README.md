# Cielo sopra di me — il proiettore del cielo

Una pagina da proiettare sul soffitto che mostra, in tempo reale, cosa c'è sopra di te:

- **aerei**: quale volo è, la compagnia, il modello, **da dove viene e dove va**, quota, velocità, se sale o scende;
- **satelliti**: tutti quelli attivi (circa 16 000, di cui più della metà Starlink). Di notte quelli illuminati dal Sole, che sono quelli che si possono vedere, sono più luminosi;
- **stazioni spaziali**: la ISS e la cinese Tiangong, con il percorso in cielo, il prossimo passaggio e **il prossimo passaggio visibile a occhio nudo**;
- **Luna e pianeti**: la Luna con la sua fase (la parte illuminata è rivolta verso il Sole), Mercurio, Venere, Marte, Giove, Saturno (con l'anello), Urano e Nettuno, grandi secondo quanto sono luminosi, e per ognuno se ora si vede a occhio nudo;
- il **Sole**, l'ora, la data e i punti cardinali.

La posizione predefinita è **La Spezia** (44,1025° N, 9,8241° E).

Il cielo è disegnato come una cupola: lo zenit (sopra la tua testa) al centro, l'orizzonte sul bordo. Gli aerei più vicini sono disegnati più grandi.

Non servono chiavi né abbonamenti: i dati vengono da servizi gratuiti (vedi sotto).

## Come si avvia

Serve Python 3 (sul Mac arriva con Xcode) e una connessione a internet.

**Mac:** doppio clic su `Avvia-cielo.command`. Si apre il browser già su La Spezia. Per fermarlo, chiudi la finestra del Terminale.

**Da terminale (Mac, Linux, Raspberry Pi)**, nella cartella del progetto:

```
python3 cielo.py
```

poi apri `http://localhost:8642/`. Per un altro posto: `python3 cielo.py --lat 45.4642 --lon 9.19 --quota 120`. Una posizione scritta nelle impostazioni della pagina vale più di quella del server e resta ricordata nel browser. `--apri` apre da solo il browser, `--porta` cambia la porta, `--rete` permette di aprire la pagina da un altro dispositivo di casa (all'indirizzo del computer, porta 8642).

Le impostazioni si possono anche scrivere nell'indirizzo, comodo per un proiettore sempre acceso:
`http://localhost:8642/?nord=90&vista=basso&testo=1.4&raggio=150&satelliti=tutti` (anche `lat=` e `lon=`)

### Raspberry Pi sempre acceso

1. Copia la cartella del progetto sul Raspberry (Raspberry Pi OS con desktop), per esempio in `/home/pi/Stazione-spaziale`.
2. Avvio automatico del server: aggiungi a `crontab -e` la riga
   `@reboot python3 /home/pi/Stazione-spaziale/cielo.py`
3. Avvio automatico del browser a schermo intero: crea `~/.config/autostart/cielo.desktop` con
   ```
   [Desktop Entry]
   Type=Application
   Name=Cielo
   Exec=sh -c "sleep 10; chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:8642/"
   ```

Su un Raspberry Pi 4 o 5 dovrebbe andare fluido; su modelli più piccoli, se va a scatti, nelle impostazioni scegli **Satelliti → Stazioni e i satelliti più luminosi**. Non l'ho provato su un Raspberry vero.

## Allineare il proiettore

Apri le impostazioni (tasto **S**, o la rotella che compare muovendo il mouse).

- **Vista → Dal basso** se ti sdrai e guardi il soffitto: est e ovest sono come nel cielo vero (con il nord in alto, l'est sta a **sinistra**). **Dall'alto** è come una carta geografica.
- **Dove sta il Nord sul soffitto**: ruota (anche con le frecce ← →) finché la **N rossa** punta verso il nord vero; la bussola del telefono aiuta. Controllo: di giorno il Sole disegnato deve stare dalla parte da cui entra la luce, e un aereo che senti passare deve essere dalla parte giusta.
- Se il proiettore ha l'immagine specchiata (modalità retroproiezione o soffitto), sistemala nel menu del proiettore.
- **Grandezza dei testi** (anche con + e −): dal letto al soffitto ci sono 2–3 metri, di solito serve 1,3–1,6.
- Il nero non manda luce: lo sfondo resta nero, al buio si vedono solo cielo, aerei e scritte.

Altri tasti: **F** schermo intero, **Esc** toglie la selezione. Con un clic su un aereo o un satellite se ne vedono i dettagli nel riquadro in basso a sinistra; senza clic c'è l'aereo più alto sopra di te.

## Da dove vengono i dati, e i limiti

- **Aerei:** posizioni dalle reti di ricevitori ADS-B dei volontari, [adsb.lol](https://adsb.lol) e, se non risponde, [adsb.fi](https://adsb.fi). Aggiornate ogni 5 secondi; tra un aggiornamento e l'altro la pagina fa avanzare gli aerei secondo rotta e velocità. Mancano gli aerei senza transponder ADS-B (molti militari, alcuni piccoli) e le zone senza ricevitori vicini.
- **Da dove a dove:** dagli archivi [adsbdb.com](https://www.adsbdb.com) e [hexdb.io](https://hexdb.io), compilati da volontari a partire dal nominativo radio del volo. **Possono essere vecchi:** una compagnia a volte riusa un nominativo per un altro collegamento. Per questo la pagina controlla se l'aereo sta davvero tra partenza e arrivo e punta verso l'arrivo, e lo scrive ("coerente con la posizione" oppure "la posizione non torna"); in cielo una rotta che non torna ha un punto di domanda (`JFK → LOS ?`).
- **Satelliti e stazioni:** elementi orbitali da [CelesTrak](https://celestrak.org), calcolati nel browser con [satellite.js](https://github.com/shashwatak/satellite-js) (licenza MIT, in `web/vendor`). Il server li tiene in `cache/` e li riscarica ogni 6 ore, come chiede CelesTrak (non più di una volta ogni 2 ore). Precisione: qualche chilometro, cioè meno di un grado in cielo.
- **Luna e pianeti:** calcolati nella pagina con le formule di Paul Schlyter ("How to compute planetary positions") e le magnitudini dell'Astronomical Almanac; errore di qualche centesimo di grado, nessun servizio esterno.
- **Visibile a occhio nudo** vuol dire: per almeno mezzo minuto la stazione è sopra 10° di elevazione, è illuminata dal Sole e qui il Sole è più di 6° sotto l'orizzonte. Per i pianeti: sopra l'orizzonte, ad almeno 10° dal Sole, con il cielo buio e magnitudine sotto 5 (nel crepuscolo solo i più luminosi, di giorno solo Venere e solo sapendo dove guardare). Non tiene conto di nuvole, case e luci della città.

## Prove

```
python3 -m unittest discover -s test
node test/geometria.test.js
```

Cosa è stato verificato l'11 ottobre 2026:

- i test sopra (conversioni, fonti di riserva, archivi, geometria del cielo, Sole, ombra della Terra, Luna e pianeti);
- posizione di ISS e Tiangong, passaggi sopra 10° e primo passaggio visibile confrontati con PyEphem: stessi gradi al centesimo e stessi orari entro 5 secondi;
- Luna e pianeti da La Spezia in tre date (2026, 2031) confrontati con PyEphem: entro 0,03° i pianeti, 0,07° la Luna; magnitudini entro 0,25 (Mercurio vicino al Sole fino a 0,6);
- la pagina in Chromium con i dati veri su Milano e su La Spezia: 75–110 aerei entro 150 km con le rotte, 16 070 satelliti seguiti (circa 1 100 sopra l'orizzonte, compreso l'arco dei geostazionari), la Luna piena e Giove, Saturno, Nettuno e Urano la sera, di giorno e di notte, a schermo largo e su telefono.

Non verificato: un proiettore vero, un Raspberry Pi vero, e la geolocalizzazione del browser (nelle prove la posizione era data a mano).
