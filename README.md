# 🏓 Bordtennis booking

Et lille bookingsystem til bordtennisrummet på kontoret. Slut med at stå og vente ved bordet. Book en tid, gå tilbage til skrivebordet, og kom ned når det er jeres tur.

- **Double**: 4 pladser pr. booking (Hold A vs Hold B)
- **20 minutter ad gangen**: 15 min kamp + 5 min buffer (kan ændres)
- **Live-status** øverst: *"Bordet er ledigt nu"* eller *"Optaget · ledigt kl. 14:40"* med en knap til at booke næste ledige tid
- **Mangler I spillere?** Book med tomme pladser, så kan kolleger trykke *+ Tilmeld*
- **Live-opdatering**: alle skærme opdaterer med det samme, når nogen booker
- **Fair brug**: hver person kan højst være med i 2 kommende kampe (kan ændres)
- Kun den der bookede kan aflyse, og man kan kun fjerne sig selv
- **Regler** på siden (knappen *Regler*), som bruger de aktuelle indstillinger og vises automatisk første gang
- **Scoreboard** med dag, uge, måned og alt: podie, stilling, kamphistorik og en fejring med konfetti, når et resultat gemmes
- **Vi spiller om** hvid Monster og Arla Protein kakao. Hver taber giver en drik til en vinder (fx Rolf → Henrik: Monster, Bo → Dennis: Protein kakao), og hver drik har sit eget *Betalt*-kryds
- **Bookeren og vinderne** kan indtaste og rette resultatet. Siden genkender dig på navnet under *Hvem er du?*
- **Taber-animation**: når et resultat gemmes, får taberne (genkendt på navnet) vinderne at se på podiet med NSF-kongekroner og pokal, mens de selv står i regnvejr med den drik, de skylder
- **Køleskabet** delt op pr. produkt: lager, hvem der skylder, "snart tomt"-varsel og log. Tæller automatisk ned, når en drik krydses af, og alle kan rette antallet efter påfyldning
- **Dagens motivation**: et nyt motiverende citat hver dag, det samme for alle. Flere kan tilføjes i `public/quotes.js`
- Virker på mobil og har dark mode

**Sådan hænger det sammen:** Siden er en statisk side på **GitHub Pages**. Bookingerne ligger i en gratis **Supabase**-database, hvor alle regler håndhæves, så ingen kan snyde uden om siden. Begge dele er gratis.

---

## Opsætning (ca. 10 minutter)

### 1. Opret databasen i Supabase

1. Opret en gratis konto på [supabase.com](https://supabase.com) og lav et **nyt projekt** (vælg region *Frankfurt* eller *Stockholm*). Brug et projekt kun til dette.
2. Åbn **SQL Editor** → **New query**, indsæt hele indholdet af [`supabase/schema.sql`](supabase/schema.sql), og tryk **Run**.
3. Gå til **Project Settings → API** (eller *API Keys*) og find:
   - **Project URL**, fx `https://abcdefgh.supabase.co`
   - den **publishable**-nøgle (`sb_publishable_…`). Har dit projekt den ikke, bruges **anon public**-nøglen.

> Den publishable/anon-nøgle er lavet til at ligge offentligt i en browser. Brug **aldrig** `secret`- eller `service_role`-nøglen i appen.

### 2. Læg det på GitHub Pages

1. Lav et nyt repo på GitHub og push koden:
   ```bash
   git remote add origin https://github.com/<dit-brugernavn>/bordtennis-booking.git
   git push -u origin main
   ```
2. I repoet på GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**. Opret to variabler:
   - `SUPABASE_URL` = din Project URL
   - `SUPABASE_KEY` = din publishable/anon-nøgle
3. **Settings → Pages → Source: GitHub Actions**.
4. Gå til fanen **Actions**, vælg *Test og udgiv på GitHub Pages*, og tryk **Run workflow**. Fremover udgives siden automatisk, hver gang der pushes til `main`.

Siden ligger nu på `https://<dit-brugernavn>.github.io/bordtennis-booking/`. Del linket med kollegerne, og læg det gerne som bogmærke eller på hjemmeskærmen på telefonen.

---

## Indstillinger

Indstillingerne ligger i databasen. Ret dem i Supabase under **Table Editor → settings**, og siden bruger dem med det samme. Der er ingen ny udgivelse nødvendig.

| Felt | Standard | Beskrivelse |
|---|---|---|
| `title` | `Bordtennis booking` | Navn i toppen af siden |
| `slot_minutes` | `20` | Længde på en booking i minutter (kamp + buffer) |
| `buffer_minutes` | `5` | Den del af tiden, der er buffer til at spille færdig og komme til og fra pladsen |
| `open_time` | `08:00` | Første tid der kan bookes |
| `close_time` | `18:00` | Bordet lukker |
| `days_ahead` | `14` | Hvor mange dage frem man kan booke |
| `max_active_per_person` | `2` | Max kommende kampe pr. person (`0` = ingen grænse) |
| `weekends` | `false` | Tillad booking lørdag og søndag |
| `timezone` | `Europe/Copenhagen` | Kontorets tidszone |
| `fridge_low_at` | `4` | Køleskabet vises som "snart tomt", når der er så få tilbage (grundlag for påmindelser til festudvalget) |

Skifter I `slot_minutes` eller `open_time`, bør eksisterende fremtidige bookinger passe til det nye tidsgitter. Ellers vises de ikke.

**Slet eller ret en booking som admin:** Supabase → **Table Editor → bookings** (resultater ligger i **results**).

---

## Godt at vide

- **Der er ingen login.** Alle der har linket, kan se navnene på bookingerne og booke. Det er fint til et bordtennisbord, men læg ikke følsomme oplysninger i navnefelterne.
- **Bookingerne er knyttet til browseren.** Den der bookede, kan aflyse fra den samme browser. Rydder man browserdata eller skifter enhed, kan en admin slette bookingen i Supabase.
- **Gratis Supabase-projekter sættes på pause** efter en uge uden aktivitet. Det sker ikke, så længe I bruger siden, og ellers kan projektet vækkes med ét klik i Supabase.
- Gamle bookinger ryddes automatisk op efter 60 dage.

---

## Udvikling

Kræver [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run demo   # kører hele appen lokalt med en indbygget database. Ingen Supabase-konto nødvendig.
               # DEMO_NOW="2026-10-09 10:25" npm run demo lader databasen tro, at klokken er noget andet.
npm test       # tester databasereglerne i schema.sql mod en rigtig Postgres (PGlite)
```

Åbn http://localhost:8040. Vil du køre lokalt mod jeres rigtige Supabase, så kopiér `public/config.example.js` til `public/config.js`, udfyld den, og kør `npm start`.

### Struktur

```
public/               Selve siden (HTML/CSS/JS), som udgives på GitHub Pages
supabase/schema.sql   Tabeller, sikkerhed og bookingregler
test/                 Tests af reglerne
dev-server.js         Lokal server (+ demo-tilstand)
.github/workflows/    Tester og udgiver automatisk ved push
```

## Licens

MIT
