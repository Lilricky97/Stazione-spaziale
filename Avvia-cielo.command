#!/bin/zsh
# Doppio clic: avvia Cielo su La Spezia e apre il browser. Per un altro posto: --lat e --lon.
cd -- "$(dirname -- "$0")"
exec python3 cielo.py --apri
