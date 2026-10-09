// Dagens motivation: ét citat om dagen, det samme for alle. Tilføj gerne flere.
export const QUOTES = [
  { text: 'Du misser 100 % af de skud, du ikke tager.', author: 'Wayne Gretzky' },
  { text: 'Livet skal forstås baglæns, men leves forlæns.', author: 'Søren Kierkegaard' },
  { text: 'At vove er at miste fodfæstet en kort stund. Ikke at vove er at miste sig selv.', author: 'Søren Kierkegaard' },
  { text: 'Livet er som at cykle. For at holde balancen skal du blive ved med at bevæge dig.', author: 'Albert Einstein' },
  { text: 'Jeg har fejlet igen og igen og igen i mit liv. Og det er derfor, jeg lykkes.', author: 'Michael Jordan' },
  { text: 'Talent vinder kampe, men teamwork og intelligens vinder mesterskaber.', author: 'Michael Jordan' },
  { text: 'Hvis du vil gå hurtigt, så gå alene. Hvis du vil gå langt, så gå sammen.', author: 'Afrikansk ordsprog' },
  { text: 'Ingen af os er så kloge som os alle sammen.', author: 'Ken Blanchard' },
  { text: 'Hårdt arbejde slår talent, når talent ikke arbejder hårdt.', author: 'Tim Notke' },
  { text: 'Det er ikke, fordi tingene er svære, at vi ikke tør. Det er, fordi vi ikke tør, at de er svære.', author: 'Seneca' },
  { text: 'Den bedste måde at forudsige fremtiden på er at opfinde den.', author: 'Alan Kay' },
  { text: 'Uanset om du tror, du kan, eller tror, du ikke kan, så har du ret.', author: 'Henry Ford' },
  { text: 'Jeg er ikke et produkt af mine omstændigheder. Jeg er et produkt af mine beslutninger.', author: 'Stephen Covey' },
  { text: 'Gør, hvad du kan, med det, du har, der hvor du er.', author: 'Theodore Roosevelt' },
  { text: 'Mod er ikke fravær af frygt, men sejren over den.', author: 'Nelson Mandela' },
  { text: 'Vi er, hvad vi gentagne gange gør. Fortræffelighed er derfor ikke en handling, men en vane.', author: 'Will Durant' },
  { text: 'Mestre bliver ved med at spille, til de får det rigtigt.', author: 'Billie Jean King' },
  { text: 'Pres er et privilegium.', author: 'Billie Jean King' },
  { text: 'Det handler ikke om, hvorvidt du bliver slået ned. Det handler om, hvorvidt du rejser dig igen.', author: 'Vince Lombardi' },
  { text: 'Fantasi er vigtigere end viden.', author: 'Albert Einstein' },
  { text: 'Start, hvor du er. Brug, hvad du har. Gør, hvad du kan.', author: 'Arthur Ashe' },
  { text: 'Rejsen på tusind mil begynder med ét skridt.', author: 'Lao Tzu' },
  { text: 'Hvis du ikke kan lide noget, så lav det om. Kan du ikke lave det om, så lav din indstilling om.', author: 'Maya Angelou' },
  { text: 'Motivation får dig i gang. Vane holder dig i gang.', author: 'Jim Ryun' },
  { text: 'Mestre bliver ikke skabt i ringen. Det er bare dér, man opdager dem.', author: 'Joe Frazier' },
  { text: 'Umuligt er ikke en kendsgerning. Det er en mening.', author: 'Muhammad Ali' },
  { text: 'Lad være med at tælle dagene. Få dagene til at tælle.', author: 'Muhammad Ali' },
  { text: 'Den eneste måde at lave godt arbejde på er at elske det, du laver.', author: 'Steve Jobs' },
  { text: 'Bliv ved med at være sulten. Bliv ved med at være lidt tosset.', author: 'Steve Jobs' },
  { text: 'Det simple kan være sværere end det komplekse.', author: 'Steve Jobs' },
  { text: 'Det perfekte er det godes fjende.', author: 'Voltaire' },
  { text: 'Det er ret sjovt at gøre det umulige.', author: 'Walt Disney' },
  { text: 'Den bedste tid at plante et træ var for 20 år siden. Den næstbedste tid er nu.', author: 'Kinesisk ordsprog' },
  { text: 'Den, der vil noget, finder en vej. Den, der ikke vil, finder en undskyldning.', author: 'Ordsprog' },
  { text: 'Hvis du ikke kan flyve, så løb. Hvis du ikke kan løbe, så gå. Men bliv ved med at bevæge dig fremad.', author: 'Martin Luther King Jr.' },
  { text: 'Den, der intet vover, intet vinder.', author: 'Ordsprog' },
  { text: 'Øvelse gør mester.', author: 'Ordsprog' },
  { text: 'Den største risiko er ikke at tage nogen risiko.', author: 'Mark Zuckerberg' },
  { text: 'Hvis det ikke udfordrer dig, forandrer det dig ikke.', author: 'Fred DeVito' },
  { text: 'Hver ulempe har sin fordel.', author: 'Johan Cruyff' },
  { text: 'Det er ikke slut, før det er slut.', author: 'Yogi Berra' },
  { text: '"At leve er ikke nok," sagde sommerfuglen. "Man må have solskin, frihed og en lille blomst."', author: 'H.C. Andersen' },
  { text: 'Det er ikke bjerget, vi besejrer, men os selv.', author: 'Edmund Hillary' },
  { text: 'Det, der ikke slår mig ihjel, gør mig stærkere.', author: 'Friedrich Nietzsche' },
  { text: 'Glæde er det eneste, der bliver større, når man deler det.', author: 'Albert Schweitzer' },
  { text: 'Hvad man ikke har i hovedet, må man have i benene.', author: 'Dansk ordsprog' },
  { text: 'Sejren tilhører den mest udholdende.', author: 'Napoleon Bonaparte' },
  { text: 'Det er altid for tidligt at give op.', author: 'Norman Vincent Peale' },
  { text: 'Ingen kan gå tilbage og lave en helt ny start, men alle kan starte i dag og lave en helt ny slutning.', author: 'Maria Robinson' },
  { text: 'Alle vores drømme kan gå i opfyldelse, hvis vi har modet til at forfølge dem.', author: 'Walt Disney' },
];

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Samme citat for alle på samme dag; et nyt hver dag. Vi springer med et fast skridt gennem
// listen (i stedet for 1, 2, 3 …), så de blandes, og alle citater kommer før gentagelse.
export function quoteOfTheDay(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  let step = 17;
  while (gcd(step, QUOTES.length) !== 1) step++;
  return QUOTES[(day * step) % QUOTES.length];
}
