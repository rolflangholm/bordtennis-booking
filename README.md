# 🏓 Bordtennis booking

Et lille bookingsystem til bordtennisrummet på kontoret. Slut med at stå og vente ved bordet. Book en tid, gå tilbage til skrivebordet, og kom ned når det er jeres tur.

- **Double**: 4 pladser pr. booking (Hold A vs Hold B)
- **20 minutter ad gangen** (kan ændres)
- **Live-status** øverst: *"Bordet er ledigt nu"* eller *"Optaget · ledigt kl. 14:40"* med en knap til at booke næste ledige tid
- **Mangler I spillere?** Book med tomme pladser, så kan kolleger trykke *+ Tilmeld*
- **Live-opdatering**: alle skærme opdaterer med det samme, når nogen booker
- **Fair brug**: hver person kan højst være med i 2 kommende kampe (kan ændres)
- Kun den der bookede kan aflyse, og man kan kun fjerne sig selv
- Virker på mobil og har dark mode
- **Ingen afhængigheder**: kun Node.js, ingen database og ingen `npm install`

## Kom i gang

Kræver [Node.js](https://nodejs.org) 18 eller nyere.

```bash
git clone https://github.com/<dit-brugernavn>/bordtennis-booking.git
cd bordtennis-booking
npm start
```

Åbn http://localhost:8040. Kolleger på samme netværk bruger `http://<din-computers-ip>:8040`.

## Indstillinger

Alt sættes med miljøvariabler:

| Variabel | Standard | Beskrivelse |
|---|---|---|
| `PORT` | `8040` | Port serveren lytter på |
| `TITLE` | `Bordtennis booking` | Navn i toppen af siden |
| `SLOT_MINUTES` | `20` | Længde på en booking i minutter |
| `OPEN_TIME` | `08:00` | Første tid der kan bookes |
| `CLOSE_TIME` | `18:00` | Bordet lukker |
| `DAYS_AHEAD` | `14` | Hvor mange dage frem man kan booke |
| `MAX_ACTIVE_PER_PERSON` | `2` | Max kommende kampe pr. person (`0` = ingen grænse) |
| `WEEKENDS` | `false` | Vis lørdag og søndag |
| `DATA_FILE` | `data/bookings.json` | Hvor bookinger gemmes |

Eksempel:

```bash
SLOT_MINUTES=15 OPEN_TIME=07:30 TITLE="Pingpong-hulen" npm start
```

Serveren bruger maskinens tidszone. Sæt evt. `TZ=Europe/Copenhagen`, hvis den kører i skyen.

## Drift

### Docker

```bash
docker build -t bordtennis-booking .
docker run -d -p 8040:8040 -v bordtennis-data:/data -e TZ=Europe/Copenhagen --restart unless-stopped bordtennis-booking
```

### Hosting

Appen er én Node-proces, der gemmer i en JSON-fil, så den kører fint på en gammel computer på kontoret, en Raspberry Pi eller en lille cloud-server (Render, Fly.io, Railway). Husk en *persistent disk/volume* til `DATA_FILE`, ellers forsvinder bookingerne ved genstart.

> Der er ingen login. Alle med adgang til siden kan booke. Den er tænkt til et internt netværk og bør ikke lægges åbent på internettet uden en adgangsbeskyttelse foran.

## Udvikling

```bash
npm run dev   # genstarter ved ændringer
npm test      # kører testene (node:test)
```

### Struktur

```
server.js          HTTP-server, API og live-opdatering (Server-Sent Events)
lib/store.js       Bookingregler og lagring
public/            Frontend (ren HTML/CSS/JS)
test/              Tests
```

### API

| Metode | Sti | Body |
|---|---|---|
| `GET` | `/api/config` | |
| `GET` | `/api/bookings?date=YYYY-MM-DD` | |
| `POST` | `/api/bookings` | `{ date, start, name, players: [makker, modstander, modstander] }` |
| `POST` | `/api/bookings/:id/join` | `{ seat: 0-3, name }` |
| `POST` | `/api/bookings/:id/leave` | `{ seat, token }` |
| `POST` | `/api/bookings/:id/cancel` | `{ token }` |
| `GET` | `/api/events` | Server-Sent Events, sender `change` ved ændringer |

## Licens

MIT
