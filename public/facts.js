// Dagens fun fact: én om dagen, den samme for alle. Tilføj gerne flere nederst.
export const FACTS = [
  'Bolden vejer kun 2,7 gram og har en diameter på 40 mm.',
  'Indtil år 2000 var bolden 38 mm. Den blev gjort større for at sænke farten, så det var lettere at følge med på tv.',
  'Et bordtennisbord er 2,74 m langt, 1,525 m bredt og 76 cm højt.',
  'Nettet er præcis 15,25 cm højt.',
  'Bordtennis blev OL-sport i 1988 i Seoul.',
  'Siden 2001 spilles der til 11 point i stedet for 21.',
  'Et sæt skal vindes med mindst 2 point. Ved 10-10 fortsætter man, til nogen fører med 2.',
  'Ved 10-10 skifter serven efter hvert eneste point i stedet for hvert andet.',
  'Ved serven skal bolden kastes mindst 16 cm op fra en flad, åben hånd.',
  'I double skal serven gå diagonalt: fra din højre halvdel til modstanderens højre halvdel.',
  'I double skal makkerne slå skiftevis. Slår den samme spiller to gange i træk, er pointet tabt.',
  'Rammer serven nettet og lander korrekt, er det en "let", og serven tages om. Der er ingen grænse for, hvor mange gange det må ske.',
  'En bold, der rammer bordkanten ovenfra, tæller. En bold, der rammer bordets side, gør ikke.',
  'Du må gerne ramme bolden med hånden, der holder batten, så længe det er under håndleddet.',
  'Rører du bordet med din frie hånd under en duel, taber du pointet.',
  'I begyndelsen var bordtennis selskabsleg i det victorianske England, hvor man efter sigende brugte bøger som net og champagneprop som bold.',
  'Navnet "Ping-Pong" kommer af lyden og var oprindeligt et registreret varemærke.',
  'I 1971 blev det amerikanske landshold inviteret til Kina. Det åbnede for dialog mellem landene og blev kendt som "ping-pong-diplomati".',
  'Siden 2014 er der spillet med plastikbolde i stedet for celluloid.',
  'Batten skal have sort belægning på den ene side. Siden 2021 må den anden side være rød, blå, grøn, lilla eller pink.',
  'Bolden må være hvid eller orange.',
  'Topspillere kan slå bolden med over 100 km/t, og på et bord på under 3 meter.',
  'Til professionelle kampe skal der være mindst 14 × 7 meter gulv og 5 meter til loftet.',
  'Tager et sæt over 10 minutter, træder "speed-reglen" i kraft: modtagersiden vinder pointet, hvis de returnerer 13 gange i træk.',
  'Svenske Jan-Ove Waldner var den første mand, der vandt OL, VM og World Cup i single. I Kina kaldes han "det evigt grønne træ".',
  'Waldner deltog i fem olympiske lege fra 1988 til 2004.',
  'Ma Long blev i 2021 den første mand, der forsvarede sin olympiske guldmedalje i herresingle.',
  'Kina har vundet langt de fleste OL-guldmedaljer i bordtennis siden 1988.',
  'Mixed double kom på OL-programmet i Tokyo 2020, og Japan vandt guld foran Kina.',
  'Bordtennis har været med ved Paralympics lige fra de første lege i Rom 1960.',
  'Danske Michael Maze vandt OL-bronze i herredouble i Athen 2004 sammen med Finn Tugwell.',
  'Ved VM 2005 vendte Michael Maze 0-3 i sæt til sejr mod kineseren Hao Shuai og vandt bronze.',
  'Ved VM 2005 fortalte Timo Boll dommeren, at modstanderens bold havde ramt kanten, og gav dermed selv pointet væk. Det huskes som et af sportens fineste øjeblikke af fair play.',
  'Bordtennisscenerne i "Forrest Gump" blev filmet uden bold. Bolden blev lagt ind digitalt bagefter.',
  'Der findes to klassiske greb: "shakehand", hvor man holder batten som et håndtryk, og "penholder", hvor man holder den som en pen.',
  'En kamp spilles typisk bedst af 5 eller 7 sæt.',
  'Serven skifter efter hvert andet point, uanset hvem der vinder dem.',
  'I double skifter man også rækkefølge på modtagerne mellem sættene, så alle møder alle.',
  'Bordet er som regel blåt eller grønt og mat, så bolden er let at se og ikke blænder.',
  'Bordtennis kaldes ofte "skak i høj fart", fordi man både skal læse skru, placering og modstanderens næste træk.',
  'Bolden må kun hoppe én gang på din side, før du slår den tilbage. Man må ikke tage den i luften over bordet.',
  'Den spiller, der server, må ikke skjule bolden for modstanderen med kroppen eller armen.',
  'Under serven skal bolden være bag bordets baglinje og over bordets højde.',
  'Ma Long og Fan Zhendong har begge vundet OL, VM og World Cup i single, ligesom Waldner før dem.',
  'Chen Meng vandt OL-guld i damesingle både i Tokyo 2020 og i Paris 2024.',
  'Bolden er hul og fyldt med luft, og den skal kunne hoppe ca. 24-26 cm, når den slippes fra 30 cm.',
  'I double må serven kun gå fra højre side, men under resten af duellen må bolden ramme hele bordet.',
];

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Samme fact for alle på samme dag; en ny hver dag. Vi springer med et fast skridt gennem
// listen (i stedet for 1, 2, 3 …), så emnerne blandes, og alle facts stadig kommer før gentagelse.
export function factOfTheDay(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  let step = 17;
  while (gcd(step, FACTS.length) !== 1) step++;
  return FACTS[(day * step) % FACTS.length];
}
