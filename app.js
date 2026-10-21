/* ============================================================
   State
   ============================================================ */
let DATA = { invoices: [], settings: { kanzlei:"", ansprech:"", iban:"", frist:"10", zzTage:"14" }, lastImport: null, importLog: [], templates: {}, leereAktenVermerke: {} };
let sortMode = "az", sortDir = "asc";
let activeInvoiceForReminder = null;
let currentDetailAz = null;
let detailReturnView = 'rechnungen';
// Eigener Speicher-Schlüssel für die Muster-Vorlage, damit sie im selben Browser nicht die Daten
// einer anderen (produktiven) Kopie des Dashboards liest oder überschreibt.
const STORAGE_KEY = "muster-dashboard-data-v1";
/* ============================================================
   Storage
   ============================================================ */
async function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      DATA = Object.assign({invoices:[],settings:{},lastImport:null,importLog:[],templates:{},leereAktenVermerke:{}}, parsed);
      DATA.settings = Object.assign({kanzlei:"",ansprech:"",iban:"",frist:"10",zzTage:"14"}, DATA.settings);
      DATA.templates = DATA.templates || {};
      DATA.leereAktenVermerke = DATA.leereAktenVermerke || {};
    }
  }catch(e){ console.warn("Konnte gespeicherte Daten nicht laden:", e); }
  renderAll();
  maybeShowDailyHint();
}
async function saveData(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
    hideSaveFailBanner();
  }catch(e){
    showToast("Speichern fehlgeschlagen: " + e.message);
    showSaveFailBanner();
  }
}
// Dauerhafter Hinweis (verschwindet NICHT von selbst wie der Toast), solange eine Änderung nicht
// gespeichert werden konnte - damit das nicht unbemerkt bleibt und Daten verloren gehen.
function showSaveFailBanner(){
  const b = document.getElementById('saveFailBanner');
  if(b) b.style.display = 'flex';
}
function hideSaveFailBanner(){
  const b = document.getElementById('saveFailBanner');
  if(b) b.style.display = 'none';
}
/* ============================================================
   Helpers
   ============================================================ */
function fmtEUR(n){ if(n===null||n===undefined||isNaN(n)) return "–"; return n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}) + " €"; }
// Robuste Zahlen-Umwandlung fuer den Excel-Import: Excel liefert Betraege normalerweise als echte
// Zahl (dann greift einfach der erste Fall), manchmal aber auch als Text - und zwar je nach
// Formatierung im deutschen Format ("1.234,56") oder im rohen/englischen Format ("1234.56").
// parseFloat() allein wuerde "1.234,56" faelschlich als 1.234 lesen (Komma wird ignoriert) und so
// einen Betrag um den Faktor ~1000 verfaelschen, ohne dass ein Fehler auftritt. Diese Funktion
// erkennt das deutsche Format anhand von Punkt+Komma bzw. nur-Komma und wandelt es vorher korrekt um.
function parseNumberDE(v){
  if(v===null||v===undefined||v==="") return null;
  if(typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim().replace(/[€\s]/g,'');
  if(s==='') return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if(hasComma && hasDot){
    // z.B. "1.234,56" -> Punkt ist Tausendertrenner, Komma ist Dezimaltrenner
    s = s.replace(/\./g,'').replace(',', '.');
  } else if(hasComma){
    // z.B. "1234,56" -> Komma ist Dezimaltrenner
    s = s.replace(',', '.');
  }
  // nur Punkt vorhanden (z.B. "1234.56") oder gar kein Trennzeichen: bereits im richtigen Format
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function toISO(d){
  if(!d) return null;
  if(d instanceof Date) return d.toISOString().slice(0,10);
  if(typeof d === "number"){ const epoch = new Date(Date.UTC(1899,11,30)); return new Date(epoch.getTime()+d*86400000).toISOString().slice(0,10); }
  const s = String(d).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return s.slice(0,10);
  const dt = new Date(s);
  if(!isNaN(dt)) return dt.toISOString().slice(0,10);
  return null;
}
function fmtDate(iso){ if(!iso) return "–"; const [y,m,d]=iso.split("-"); return `${d}.${m}.${y}`; }
function fmtDateTime(iso){ return iso ? new Date(iso).toLocaleString('de-DE') : "–"; }
function addDays(iso, days){ if(!iso) return null; const d = new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+(parseInt(days,10)||0)); return d.toISOString().slice(0,10); }
function addMonths(iso, n){
  // Kalendermonate addieren und dabei den Tag auf die tatsaechliche Laenge des Ziel-Monats begrenzen
  // (sonst wuerde z.B. der 31.01. + 1 Monat faelschlich in den Maerz "ueberlaufen" statt auf den
  // 28.02./29.02. begrenzt zu werden - wichtig fuer die "volle Kalendermonate"-Frist im Mahnwesen).
  const [y,m,d] = iso.split('-').map(Number);
  const totalMonthIndex = (y*12 + (m-1)) + n;
  const targetYear = Math.floor(totalMonthIndex/12);
  const targetMonth = totalMonthIndex - targetYear*12; // 0-basiert
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth+1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  const dt = new Date(Date.UTC(targetYear, targetMonth, day));
  return dt.toISOString().slice(0,10);
}
function endOfMonth(iso){ const [y,m] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m, 0)); return dt.toISOString().slice(0,10); }
function monthsBetween(isoStart, isoEnd){ const [y1,m1] = isoStart.split('-').map(Number); const [y2,m2] = isoEnd.split('-').map(Number); return (y2-y1)*12 + (m2-m1); }
function todayISO(){
  // Bewusst über die lokalen Datumsfelder (nicht toISOString(), das auf UTC umrechnet):
  // toISOString() würde z.B. kurz nach Mitternacht in Deutschland (UTC+1/+2) noch den
  // Vortag liefern, weil UTC dann noch nicht auf den neuen Tag umgesprungen ist.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function parseAz(az){
  if(!az) return {num:0,year:0};
  const cleaned = String(az).trim().replace(/[／∕⁄]/g, "/"); // alternative Schrägstrich-Zeichen aus Excel/Copy-Paste normalisieren
  const m = cleaned.match(/(\d+)\s*\/\s*(\d{2,4})/); // ohne Anker: erkennt auch Aktenzeichen mit Zusatzzeichen/Anhängen
  if(!m) return {num:0,year:0};
  let year = parseInt(m[2],10); if(year<100) year += 2000;
  return {num:parseInt(m[1],10), year};
}
function isOverdue(inv){ const ms = getMahnStatus(inv); return !!(ms && (ms.naechsterSchrittFaellig || ms.nextStep === 'inkasso')); }
function needsEscalation(inv){ const ms = getMahnStatus(inv); return !!(ms && ms.naechsterSchrittFaellig && ms.nextStep !== 'erinnerung'); }
function computeDerived(inv){
  // Manuell als erledigt markierte Rechnungen: Betrag bewusst NICHT aus rechnungsbetrag/beglichenerBetrag
  // neu berechnen (sonst würde z.B. ein erneutes Speichern der Einstellungen den echten erhaltenen
  // Betrag verfälschen). Der ursprünglich offene Betrag bleibt dokumentiert in manuellErledigtBetrag.
  if(inv.manuellErledigt){
    inv.offenerBetrag = 0;
    inv.status = "beglichen";
  } else {
    if(inv.offenerBetrag === null || inv.offenerBetrag === undefined){
      inv.offenerBetrag = Math.round((inv.rechnungsbetrag - (inv.beglichenerBetrag||0))*100)/100;
    } else {
      inv.beglichenerBetrag = Math.round((inv.rechnungsbetrag - inv.offenerBetrag)*100)/100;
    }
    inv.offenerBetrag = Math.round(inv.offenerBetrag*100)/100;
    inv.status = inv.offenerBetrag < 5 ? "beglichen" : (inv.beglichenerBetrag>0 ? "teilweise" : "offen");
  }
  if(!inv.zahlungsziel && inv.rechnungsdatum){ inv.zahlungsziel = addDays(inv.rechnungsdatum, DATA.settings.zzTage || 14); inv.zahlungszielGeschaetzt = true; }
  else { inv.zahlungszielGeschaetzt = false; }
  return inv;
}
// Markiert eine Rechnung manuell als erledigt (keine weitere Zahlung erwartet), ohne dass tatsächlich
// Geld eingegangen ist. Der offene Betrag zählt danach überall (Summen, Prognose, Mahnwesen) als 0.
function markManuellErledigt(rechnungsnummer, grund){
  const inv = DATA.invoices.find(i=>i.rechnungsnummer===rechnungsnummer);
  if(!inv || inv.manuellErledigt) return;
  const betrag = inv.offenerBetrag;
  inv.manuellErledigt = true;
  inv.manuellErledigtGrund = (grund||'').trim();
  inv.manuellErledigtDatum = todayISO();
  inv.manuellErledigtBetrag = betrag;
  computeDerived(inv);
  inv.mahnungen = inv.mahnungen || [];
  inv.mahnungen.push({ type:'manuell_erledigt', datum: todayISO(), betrag, grund: inv.manuellErledigtGrund });
  saveData();
  renderAll();
}
// Macht die manuelle Erledigt-Markierung rückgängig; der ursprüngliche offene Betrag wird wiederhergestellt.
function unmarkManuellErledigt(rechnungsnummer){
  const inv = DATA.invoices.find(i=>i.rechnungsnummer===rechnungsnummer);
  if(!inv || !inv.manuellErledigt) return;
  inv.manuellErledigt = false;
  inv.offenerBetrag = inv.manuellErledigtBetrag;
  inv.manuellErledigtGrund = '';
  inv.manuellErledigtBetrag = null;
  computeDerived(inv);
  saveData();
  renderAll();
}
// Freie Notiz/Bemerkung an einer Rechnung (z.B. "mit Erinnerung vorerst abwarten").
function setInvoiceNotiz(rechnungsnummer, text){
  const inv = DATA.invoices.find(i=>i.rechnungsnummer===rechnungsnummer);
  if(!inv) return;
  inv.notiz = (text||'').trim();
  saveData();
  renderAll();
}
// Vermerk "keine Rechnung zu erwarten" für ein Aktenzeichen ohne hinterlegte Rechnung (Lücken-Zeile
// in der fortlaufenden Mandanten-Liste). Kommt später doch eine echte Rechnung dazu, wird dieser
// Vermerk automatisch bedeutungslos, da die Zeile dann keine Lücke mehr ist.
function setKeineRechnungVermerk(year, num, grund){
  DATA.leereAktenVermerke = DATA.leereAktenVermerke || {};
  DATA.leereAktenVermerke[year+'-'+num] = { keineRechnung:true, grund:(grund||'').trim(), datum: todayISO() };
  saveData();
  renderAll();
}
function clearKeineRechnungVermerk(year, num){
  if(DATA.leereAktenVermerke) delete DATA.leereAktenVermerke[year+'-'+num];
  saveData();
  renderAll();
}
function mahnLabel(type){ return type==='mahnung2' ? '2. Mahnung' : type==='mahnung' ? '1. Mahnung' : type==='zahlung' ? 'Zahlung erhalten' : type==='manuell_erledigt' ? 'Manuell erledigt' : type==='keine_rechnung' ? 'Keine Rechnung erwartet' : 'Erinnerung'; }
function getMahnStatus(inv){
  if(inv.status === 'beglichen') return null;
  const events = inv.mahnungen || [];
  // Letzte tatsaechlich erhaltene Zahlung (falls es schon eine gab) - davon haengt ab, welche Wartefrist
  // gilt (siehe unten: allererste Rate seit Rechnungsversand vs. Folgerate nach einer bereits erhaltenen Zahlung).
  let letzteZahlung = null;
  for(let i=events.length-1;i>=0;i--){ if(events[i].type==='zahlung'){ letzteZahlung = events[i].datum; break; } }
  const hatBereitsGezahlt = !!letzteZahlung;
  const letzteAktivitaet = letzteZahlung || inv.statusdatum || inv.rechnungsdatum || todayISO();
  // Erinnerungen/Mahnungen, die NACH der letzten Zahlung verschickt wurden (= aktueller, noch nicht geloester Vorgang).
  // Nur echte Mahnstufen zaehlen hier mit - ein "manuell erledigt"-Eintrag (der beim Rueckgaengig-Machen
  // bewusst als Verlaufs-/Audit-Eintrag stehen bleibt) ist keine Mahnstufe und darf die Akte nicht faelschlich
  // auf "Mahnbescheid pruefen" springen lassen, obwohl nie eine Erinnerung/Mahnung verschickt wurde.
  const relevant = events.filter(e => ['erinnerung','mahnung','mahnung2'].includes(e.type) && e.datum > letzteAktivitaet);
  const fristTage = parseInt(DATA.settings.frist,10) || 10;
  if(relevant.length === 0){
    // Noch keine Erinnerung fuer den aktuellen Zyklus verschickt. Zwei unterschiedliche Wartefristen,
    // je nachdem, ob es bereits eine Zahlung zu dieser Rechnung gab:
    // - Allererste Rate seit Rechnungsversand: Der Mandant hat laut Zahlungsziel 14 Tage Zeit (das an
    //   der Rechnung hinterlegte Zahlungsziel - entweder das echte aus dem Import der Kanzleisoftware,
    //   sonst die Schaetzung Rechnungsdatum + Zahlungsziel-Tage aus den Einstellungen).
    // - Nach einer bereits erhaltenen Zahlung: Ratenzahlung laeuft monatsweise - eine im Januar erhaltene
    //   Rate deckt den Januar ab, und fuer die naechste Rate hat der Mandant dann bis zum Ende des
    //   Folgemonats Zeit (Zahlung im Januar -> Frist bis Ende Februar), unabhaengig vom genauen Tag der
    //   letzten Zahlung innerhalb ihres Monats.
    const deadline = hatBereitsGezahlt
      ? endOfMonth(addMonths(letzteAktivitaet, 1))
      : (inv.zahlungsziel || addDays(inv.rechnungsdatum, DATA.settings.zzTage || 14));
    const faellig = deadline && deadline < todayISO();
    return { nextStep: 'erinnerung', deadline, naechsterSchrittFaellig: faellig, letzteAktivitaet };
  }
  const last = relevant[relevant.length - 1];
  const deadline = addDays(last.datum, fristTage);
  const faellig = deadline && deadline < todayISO();
  let nextStep = last.type === 'erinnerung' ? 'mahnung' : last.type === 'mahnung' ? 'mahnung2' : 'inkasso';
  // Auch nach der 2. Mahnung (Stufe "inkasso"/Mahnbescheid) gilt der Vorgang als "fällig", sobald die
  // Frist seit der 2. Mahnung ohne Zahlung verstrichen ist - so erscheint er ebenfalls in der Glocke,
  // im "Nur fällige"-Filter und im roten Dashboard-Bereich, statt stillschweigend liegen zu bleiben.
  return { nextStep, deadline, naechsterSchrittFaellig: faellig, letzteAktivitaet };
}
const DEFAULT_TEMPLATES = {
  erinnerung: {
    subject: "Zahlungserinnerung zur Rechnung Nr. {{rechnungsnummer}} (Az. {{aktenzeichen}})",
    text: `Sehr geehrte Damen und Herren,

nach unseren Unterlagen steht zu der unten aufgeführten Rechnung noch ein Betrag offen. Vermutlich handelt es sich lediglich um ein Versehen – wir bitten daher um Verständnis für diese freundliche Erinnerung.

Rechnung:                {{rechnungsnummer}} vom {{rechnungsdatum}}
Aktenzeichen:             {{aktenzeichen}}
Rechnungsbetrag:          {{rechnungsbetrag}}
Bereits gezahlt:          {{beglichener_betrag}}
Noch offener Betrag:      {{offener_betrag}}
Ursprüngliches Zahlungsziel: {{zahlungsziel}}

Sollte Ihre Zahlung zwischenzeitlich bereits veranlasst worden sein, betrachten Sie dieses Schreiben bitte als gegenstandslos. Andernfalls bitten wir Sie, den offenen Betrag innerhalb der nächsten {{frist_tage}} Tage{{iban_hinweis}}

Für Rückfragen stehen wir Ihnen jederzeit gerne zur Verfügung.

Mit freundlichen Grüßen

{{ansprechpartner}}
{{kanzleiname}}`
  },
  mahnung: {
    subject: "1. Mahnung zur Rechnung Nr. {{rechnungsnummer}} (Az. {{aktenzeichen}})",
    text: `Sehr geehrte Damen und Herren,

trotz Fälligkeit am {{zahlungsziel}} und unserer vorangegangenen Zahlungserinnerung ist zu der folgenden Rechnung bislang kein Zahlungseingang bei uns zu verzeichnen:

Rechnung:              {{rechnungsnummer}} vom {{rechnungsdatum}}
Aktenzeichen:           {{aktenzeichen}}
Rechnungsbetrag:        {{rechnungsbetrag}}
Bereits gezahlt:        {{beglichener_betrag}}
Noch offener Betrag:    {{offener_betrag}}

Wir bitten Sie, den offenen Betrag umgehend, spätestens jedoch innerhalb von {{frist_tage}} Tagen ab dem {{heute}}{{iban_hinweis}}

Sollten Sie den Betrag bereits beglichen haben, betrachten Sie dieses Schreiben bitte als gegenstandslos. Bei Fragen zu dieser Rechnung oder falls eine Ratenzahlung gewünscht wird, setzen Sie sich bitte umgehend mit uns in Verbindung.

Bleibt der Ausgleich innerhalb der genannten Frist aus, behalten wir uns die Einleitung weiterer rechtlicher Schritte vor.

Mit freundlichen Grüßen

{{ansprechpartner}}
{{kanzleiname}}`
  },
  mahnung2: {
    subject: "2. und letzte Mahnung zur Rechnung Nr. {{rechnungsnummer}} (Az. {{aktenzeichen}})",
    text: `Sehr geehrte Damen und Herren,

trotz unserer Mahnung vom {{letzte_mahnung_datum}} ist zu der folgenden Rechnung weiterhin weder ein Zahlungseingang noch eine Rückmeldung Ihrerseits bei uns zu verzeichnen:

Rechnung:              {{rechnungsnummer}} vom {{rechnungsdatum}}
Aktenzeichen:           {{aktenzeichen}}
Rechnungsbetrag:        {{rechnungsbetrag}}
Bereits gezahlt:        {{beglichener_betrag}}
Noch offener Betrag:    {{offener_betrag}}

Wir fordern Sie hiermit letztmalig auf, den offenen Betrag innerhalb von {{frist_tage}} Tagen ab dem {{heute}}{{iban_hinweis}}

Sollte der Ausgleich nicht fristgerecht erfolgen oder keine Rückmeldung Ihrerseits eingehen, sehen wir uns ohne weitere Ankündigung gezwungen, die Angelegenheit an ein Inkassounternehmen bzw. zur gerichtlichen Geltendmachung zu übergeben. Die hierdurch entstehenden weiteren Kosten gehen zu Ihren Lasten.

Wir bitten Sie daher dringend, den offenen Betrag fristgerecht auszugleichen oder sich umgehend mit uns in Verbindung zu setzen, um eine einvernehmliche Lösung zu finden.

Mit freundlichen Grüßen

{{ansprechpartner}}
{{kanzleiname}}`
  }
};
const PLACEHOLDER_LIST = ["aktenzeichen","rechnungsnummer","mandant","rechnungsdatum","zahlungsziel","rechnungsbetrag","offener_betrag","beglichener_betrag","frist_tage","heute","kanzleiname","ansprechpartner","iban","letzte_mahnung_datum"];
function fillTemplate(str, vars){
  return String(str||"").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, key) => (vars[key] !== undefined && vars[key] !== null) ? vars[key] : "");
}
function buildTemplate(inv, type){
  const s = DATA.settings;
  const tpl = (DATA.templates && DATA.templates[type]) || DEFAULT_TEMPLATES[type];
  const erste = (inv.mahnungen||[]).slice().reverse().find(m=>m.type==='mahnung');
  const vars = {
    aktenzeichen: inv.aktenzeichen, rechnungsnummer: inv.rechnungsnummer, mandant: inv.mandant || "",
    rechnungsdatum: fmtDate(inv.rechnungsdatum), zahlungsziel: fmtDate(inv.zahlungsziel),
    rechnungsbetrag: fmtEUR(inv.rechnungsbetrag), offener_betrag: fmtEUR(inv.offenerBetrag), beglichener_betrag: fmtEUR(inv.beglichenerBetrag),
    frist_tage: s.frist || "10", heute: fmtDate(todayISO()),
    kanzleiname: s.kanzlei || "[Kanzleiname]", ansprechpartner: s.ansprech || "[Ansprechpartner]", iban: s.iban || "",
    iban_hinweis: s.iban ? ` auf folgendes Konto:\n\nIBAN: ${s.iban}` : ".",
    letzte_mahnung_datum: erste ? fmtDate(erste.datum) : "zuvor genanntem Datum"
  };
  return { subject: fillTemplate(tpl.subject, vars), text: fillTemplate(tpl.text, vars) };
}
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(()=>t.classList.remove('show'), 3200);
}
/* ============================================================
   Navigation
   ============================================================ */
function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.railbtn[data-nav]').forEach(n=>n.classList.toggle('active', n.getAttribute('data-nav')===name));
}
function renderViewByName(name){
  if(name==='dashboard') renderDashboardOverview();
  else if(name==='rechnungen') renderRechnungen();
  else if(name==='mandanten'){ renderMandanten(); renderArchiv(); }
  else if(name==='mahnwesen') renderMahnwesen();
  else if(name==='reports') renderReports();
  else if(name==='vorlagen') renderTemplateFields();
  else if(name==='settings') renderSettingsForm();
}
document.querySelectorAll('.railbtn[data-nav]').forEach(el=>{
  el.addEventListener('click', ()=>{
    const nav = el.getAttribute('data-nav');
    showView(nav);
    renderViewByName(nav);
  });
});
document.getElementById('backLink').addEventListener('click', ()=>{
  showView(detailReturnView);
  renderViewByName(detailReturnView);
});
/* ============================================================
   Import (beide Buttons teilen sich die Logik)
   ============================================================ */
async function handleImportFile(file){
  try{
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array', cellDates:true});
    const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('rechnung')) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {defval:null});
    let imported = 0, skipped = 0;
    const skippedDetails = [];
    const byId = {};
    DATA.invoices.forEach(inv => byId[inv.rechnungsnummer] = inv);
    rows.forEach((row, idx)=>{
      const get = (...keys)=>{
        for(const k of keys){
          const found = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
          if(found && row[found] !== null && row[found] !== "") return row[found];
        }
        return null;
      };
      const rechnungsnummer = get("Rechnungsnummer","Re.-Nr.","Re-Nr","Rechnungs-Nr");
      const aktenzeichen = get("Aktenzeichen","Az","Az.");
      const betrag = get("Rechnungsbetrag","Re.-Betrag","Re-Betrag");
      if(!rechnungsnummer || !aktenzeichen || betrag===null || betrag===undefined){
        skipped++;
        // Zeile 2 = erste Datenzeile in Excel (Zeile 1 ist die Kopfzeile) - so findet man die
        // fehlerhafte Zeile beim Nachschauen in der Quelldatei ohne Suchen.
        const fehlend = [];
        if(!rechnungsnummer) fehlend.push('Rechnungsnummer');
        if(!aktenzeichen) fehlend.push('Aktenzeichen');
        if(betrag===null || betrag===undefined) fehlend.push('Rechnungsbetrag');
        skippedDetails.push({ zeile: idx+2, grund: `Fehlt: ${fehlend.join(', ')}` });
        return;
      }
      const existing = byId[String(rechnungsnummer)];
      const nochOffenRaw = get("noch offen","Noch offen","Offener Betrag");
      const guthabenRaw = get("Guthaben");
      const zahlungszielRaw = get("Zahlungsziel","Fälligkeit","Faelligkeit");
      const rec = {
        rechnungsnummer: String(rechnungsnummer),
        aktenzeichen: String(aktenzeichen).trim(),
        mandant: get("Mandant","Empfänger","Empfaenger") || (existing?existing.mandant:"") || "",
        rechnungsdatum: toISO(get("Rechnungsdatum","Datum")),
        zahlungsziel: zahlungszielRaw ? toISO(zahlungszielRaw) : (existing ? (existing.zahlungszielGeschaetzt ? null : existing.zahlungsziel) : null),
        rechnungsbetrag: parseNumberDE(betrag) || 0,
        offenerBetrag: nochOffenRaw!==null ? (parseNumberDE(nochOffenRaw) || 0) : null,
        beglichenerBetrag: parseNumberDE(get("Bereits beglichener Betrag","Beglichen")) || 0,
        guthaben: guthabenRaw!==null ? (parseNumberDE(guthabenRaw) || 0) : (existing ? existing.guthaben||0 : 0),
        statusdatum: toISO(get("Statusdatum")) || (existing ? existing.statusdatum : null),
        email: get("E-Mail Rechnungsempfaenger","E-Mail Rechnungsempfänger","E-Mail") || (existing?existing.email:"") || "",
        mahnungen: existing ? existing.mahnungen.slice() : []
      };
      computeDerived(rec);
      // Automatische Zahlungserkennung: ist der offene Betrag gegenüber dem letzten Import gesunken,
      // wurde eine Rate gezahlt -> als Ereignis vermerken. Das setzt die Mahnkette für den naechsten
      // Zyklus automatisch zurueck (siehe getMahnStatus).
      if(existing && rec.offenerBetrag < existing.offenerBetrag - 0.01){
        const betragGezahlt = Math.round((existing.offenerBetrag - rec.offenerBetrag)*100)/100;
        const zahlungNeuerAlsBekannt = rec.statusdatum && (!existing.statusdatum || rec.statusdatum > existing.statusdatum);
        const zahlungsdatum = zahlungNeuerAlsBekannt ? rec.statusdatum : todayISO();
        rec.mahnungen.push({ type: 'zahlung', datum: zahlungsdatum, betrag: betragGezahlt });
        rec.mahnungen.sort((a,b)=> a.datum.localeCompare(b.datum));
      }
      byId[rec.rechnungsnummer] = rec;
      imported++;
    });
    DATA.invoices = Object.values(byId);
    DATA.lastImport = new Date().toISOString();
    DATA.importLog.unshift({ filename: file.name, timestamp: DATA.lastImport, imported, skipped, skippedDetails });
    DATA.importLog = DATA.importLog.slice(0, 30);
    await saveData();
    renderAll();
    showToast(`Import abgeschlossen: ${imported} Rechnung(en) übernommen${skipped?`, ${skipped} Zeile(n) übersprungen`:''}.`);
  }catch(err){
    showToast("Fehler beim Import: " + err.message);
  }
}
document.getElementById('fileInput').addEventListener('change', (e)=>{ if(e.target.files[0]) handleImportFile(e.target.files[0]); e.target.value=""; });
document.getElementById('saveFailExportBtn').addEventListener('click', ()=>{ document.getElementById('exportBtn').click(); });
document.getElementById('resetBtn').addEventListener('click', async ()=>{
  if(!confirm('Wirklich alle importierten Rechnungsdaten löschen (inkl. „Keine Rechnung erwartet"-Vermerken und deren Notizen)? Dies kann nicht rückgängig gemacht werden.')) return;
  // Alles, was sich auf konkrete Rechnungen/Aktenzeichen bezieht, wird zurückgesetzt - nicht nur die
  // Rechnungen selbst (mit ihren Notizen/Verlauf), sondern auch die "Keine Rechnung erwartet"-Vermerke
  // zu Aktenzeichen-Lücken, da diese sonst im Archiv/Verlauf sichtbar stehen bleiben würden, obwohl
  // keine Rechnungsdaten mehr vorhanden sind. Einstellungen, Textvorlagen und der Login-Name bleiben
  // davon bewusst unberührt (siehe Button-Name "Rechnungsdaten zurücksetzen").
  DATA.invoices = []; DATA.lastImport = null; DATA.importLog = []; DATA.leereAktenVermerke = {};
  await saveData(); showView('dashboard'); renderAll();
});
document.getElementById('exportBtn').addEventListener('click', ()=>{
  const rows = DATA.invoices.map(i=>({
    "Aktenzeichen": i.aktenzeichen, "Re.-Nr.": i.rechnungsnummer, "Empfänger": i.mandant,
    "Datum": i.rechnungsdatum, "Zahlungsziel": i.zahlungsziel, "Re.-Betrag": i.rechnungsbetrag,
    "noch offen": i.offenerBetrag, "Guthaben": i.guthaben||0, "Status": i.status, "Statusdatum": i.statusdatum,
    "Letzte Erinnerung/Mahnung": (i.mahnungen&&i.mahnungen.length) ? `${mahnLabel(i.mahnungen[i.mahnungen.length-1].type)} (${i.mahnungen[i.mahnungen.length-1].datum})` : ""
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Rechnungen");
  XLSX.writeFile(wb, `Rechnungen_Export_${todayISO()}.xlsx`);
  showToast("Export gestartet.");
});
/* ============================================================
   Filtering / Sorting (Dashboard)
   ============================================================ */
function getFilteredSorted(){
  const year = document.getElementById('filterYear').value;
  const status = document.getElementById('filterStatus').value;
  const az = document.getElementById('filterAz').value.trim().toLowerCase();
  const onlyOverdue = document.getElementById('chipOverdue').classList.contains('active');
  const onlyMahn = document.getElementById('chipMahn').classList.contains('active');
  let list = DATA.invoices.filter(inv=>{
    const p = parseAz(inv.aktenzeichen);
    if(year && p.year !== parseInt(year,10)) return false;
    if(status && inv.status !== status && !(status==='offen' && inv.status==='teilweise')) return false;
    if(az && !String(inv.aktenzeichen||"").toLowerCase().includes(az) && !String(inv.mandant||"").toLowerCase().includes(az) && !String(inv.rechnungsnummer||"").toLowerCase().includes(az)) return false;
    if(onlyOverdue && !isOverdue(inv)) return false;
    if(onlyMahn){ if(!needsEscalation(inv)) return false; }
    return true;
  });
  list.sort((a,b)=>{
    let res = 0;
    if(sortMode === "az"){ const pa=parseAz(a.aktenzeichen), pb=parseAz(b.aktenzeichen); res = pa.year-pb.year || pa.num-pb.num; }
    else if(sortMode === "datum") res = (a.rechnungsdatum||"").localeCompare(b.rechnungsdatum||"");
    else if(sortMode === "offen") res = a.offenerBetrag - b.offenerBetrag;
    return sortDir === "asc" ? res : -res;
  });
  return list;
}
['filterYear','filterStatus'].forEach(id=>document.getElementById(id).addEventListener('change', renderRechnungen));
document.getElementById('filterAz').addEventListener('input', renderRechnungen);
function renderTopSearchResults(query){
  const box = document.getElementById('topSearchResults');
  const q = String(query||"").trim().toLowerCase();
  if(!q){ box.classList.remove('show'); box.innerHTML=''; return; }
  try{
    const map = {};
    DATA.invoices.forEach(inv=>{
      const hit = String(inv.aktenzeichen||"").toLowerCase().includes(q)
        || String(inv.mandant||"").toLowerCase().includes(q)
        || String(inv.rechnungsnummer||"").toLowerCase().includes(q);
      if(!hit) return;
      if(!map[inv.aktenzeichen]) map[inv.aktenzeichen] = { aktenzeichen: inv.aktenzeichen, mandant: inv.mandant, offen: 0 };
      map[inv.aktenzeichen].offen += (inv.offenerBetrag||0);
    });
    const matches = Object.values(map).slice(0,8);
    box.innerHTML = matches.length ? matches.map(m=>`
      <div class="topsearch-item" data-az="${escapeHtml(m.aktenzeichen)}">
        <span class="topsearch-az">${escapeHtml(m.aktenzeichen)}</span>
        <span class="topsearch-name">${escapeHtml(m.mandant||'–')}</span>
        <span class="topsearch-amount">${fmtEUR(m.offen)}</span>
      </div>`).join('') : `<div class="topsearch-empty">Keine Treffer für „${escapeHtml(query)}"</div>`;
    box.querySelectorAll('[data-az]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const az = el.getAttribute('data-az');
        document.getElementById('topSearch').value = '';
        document.getElementById('filterAz').value = '';
        box.classList.remove('show'); box.innerHTML='';
        renderRechnungen();
        openAkteDetail(az);
      });
    });
    box.classList.add('show');
  }catch(err){
    console.error('Suchvorschläge konnten nicht geladen werden:', err);
    box.classList.remove('show'); box.innerHTML='';
  }
}
document.getElementById('topSearch').addEventListener('input', (e)=>{
  document.getElementById('filterAz').value = e.target.value;
  renderRechnungen();
  renderTopSearchResults(e.target.value);
});
document.getElementById('topSearch').addEventListener('focus', (e)=>{ if(e.target.value) renderTopSearchResults(e.target.value); });
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.topbar-search')) document.getElementById('topSearchResults').classList.remove('show');
});
document.getElementById('chipOverdue').addEventListener('click', (e)=>{ e.currentTarget.classList.toggle('active'); renderRechnungen(); });
document.getElementById('chipMahn').addEventListener('click', (e)=>{ e.currentTarget.classList.toggle('active'); renderRechnungen(); });
document.querySelectorAll('.sortbtn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const mode = btn.getAttribute('data-sort');
    if(sortMode === mode) sortDir = sortDir==='asc'?'desc':'asc'; else { sortMode = mode; sortDir = 'asc'; }
    document.querySelectorAll('.sortbtn').forEach(b=>{ b.classList.remove('active'); b.textContent = b.textContent.replace(/ [↑↓]$/,''); });
    btn.classList.add('active'); btn.textContent += sortDir==='asc' ? ' ↑' : ' ↓';
    renderRechnungen();
  });
});
/* ============================================================
   Render: Dashboard
   ============================================================ */
function populateYearFilter(){
  const sel = document.getElementById('filterYear'); const current = sel.value;
  const startYear = 2016;
  const endYear = new Date().getFullYear() + 1; // erweitert sich jedes Jahr automatisch
  let years = [];
  for(let y = endYear; y >= startYear; y--) years.push(y);
  sel.innerHTML = '<option value="">Alle</option>' + years.map(y=>`<option value="${y}">${y}</option>`).join("");
  sel.value = current;
}
function statusPill(inv){
  const overdue = isOverdue(inv);
  if(inv.manuellErledigt) return `<span class="status-pill status-beglichen">Erledigt (manuell)</span>`;
  if(inv.status==='beglichen') return `<span class="status-pill status-beglichen">Beglichen</span>`;
  if(inv.status==='teilweise') return `<span class="status-pill status-teilweise">${overdue?'<span class="dot"></span>':''}Teilweise</span>`;
  return `<span class="status-pill status-offen">${overdue?'<span class="dot"></span>':''}${overdue?'Überfällig':'Offen'}</span>`;
}
function renderMahnHint(inv){
  if(inv.status === 'beglichen') return '';
  const ms = getMahnStatus(inv);
  if(!ms) return '';
  if(ms.nextStep === 'inkasso'){
    return ms.deadline < todayISO()
      ? `<div class="hist due">Frist der 2. Mahnung abgelaufen – Mahnbescheid prüfen</div>`
      : `<div class="hist">Frist aus 2. Mahnung endet ${fmtDate(ms.deadline)}, danach Mahnbescheid prüfen</div>`;
  }
  const label = ms.nextStep === 'erinnerung' ? 'Rate erwartet bis' : mahnLabel(ms.nextStep) + ' möglich';
  if(ms.nextStep === 'erinnerung'){
    return ms.naechsterSchrittFaellig
      ? `<div class="hist due">Rate seit ${fmtDate(ms.deadline)} überfällig – Erinnerung möglich</div>`
      : `<div class="hist">Rate erwartet bis ${fmtDate(ms.deadline)}</div>`;
  }
  return ms.naechsterSchrittFaellig
    ? `<div class="hist due">${mahnLabel(ms.nextStep)} möglich seit ${fmtDate(ms.deadline)}</div>`
    : `<div class="hist">${mahnLabel(ms.nextStep)} möglich ab ${fmtDate(ms.deadline)}</div>`;
}
function renderKPIs(target, list){
  const offenList = list.filter(i=>i.status!=='beglichen');
  const overdueList = list.filter(isOverdue);
  const mahnFaelligList = list.filter(needsEscalation);
  const sumOffen = offenList.reduce((s,i)=>s+i.offenerBetrag,0);
  const sumOverdue = overdueList.reduce((s,i)=>s+i.offenerBetrag,0);
  const sumTotal = list.reduce((s,i)=>s+i.rechnungsbetrag,0);
  document.getElementById(target).innerHTML = `
    <div class="kpi kpi-blue"><div class="kpi-label">Rechnungen gesamt</div><div class="kpi-value blue">${list.length}</div><div class="kpi-sub">Gesamtvolumen ${fmtEUR(sumTotal)}</div></div>
    <div class="kpi kpi-yellow"><div class="kpi-label">Offene Rechnungen</div><div class="kpi-value yellow">${offenList.length}</div><div class="kpi-sub">davon offen: ${fmtEUR(sumOffen)}</div></div>
    <div class="kpi kpi-red"><div class="kpi-label">Rate überfällig</div><div class="kpi-value red">${overdueList.length}</div><div class="kpi-sub">davon überfällig: ${fmtEUR(sumOverdue)}</div></div>
    <div class="kpi kpi-gold"><div class="kpi-label">Mahnung fällig</div><div class="kpi-value ${mahnFaelligList.length?'red':''}">${mahnFaelligList.length}</div><div class="kpi-sub">1./2. Mahnung oder Mahnbescheid jetzt möglich</div></div>
    <div class="kpi kpi-green"><div class="kpi-label">Beglichen</div><div class="kpi-value green">${list.length-offenList.length}</div><div class="kpi-sub">Quote: ${list.length?Math.round((list.length-offenList.length)/list.length*100):0}%</div></div>
  `;
}
function dashboardBucket(inv){
  if(inv.status === 'beglichen') return 'beglichen';
  if(inv.status === 'teilweise') return 'teilweise';
  if(needsEscalation(inv)) return 'mahnung';
  if(isOverdue(inv)) return 'ueberfaellig';
  return 'offen';
}
function daysOverdue(inv){
  if(!inv.zahlungsziel) return 0;
  const target = new Date(inv.zahlungsziel+"T00:00:00Z").getTime();
  if(isNaN(target)) return 0;
  return Math.round((new Date(todayISO()+"T00:00:00Z").getTime() - target) / 86400000);
}
function agingBucket(inv){
  const days = daysOverdue(inv);
  if(days <= 0) return 0;
  if(days <= 30) return 1;
  if(days <= 60) return 2;
  if(days <= 90) return 3;
  return 4;
}
function renderDashboardCharts(){
  const chartsBox = document.getElementById('chartsRow');
  const insightsBox = document.getElementById('insightsRow');
  try{
  renderDashboardChartsInner(chartsBox, insightsBox);
  }catch(err){
    console.error('Dashboard-Diagramme konnten nicht gerendert werden:', err);
    chartsBox.innerHTML = '';
    insightsBox.innerHTML = '';
  }
}
function renderDashboardChartsInner(chartsBox, insightsBox){
  if(DATA.invoices.length === 0){ chartsBox.innerHTML = ''; insightsBox.innerHTML = ''; return; }
  /* --- Fälligkeitsalter-Balkendiagramm (offene Rechnungen) --- */
  const offen = DATA.invoices.filter(i=>i.status!=='beglichen');
  const bucketLabels = ['noch nicht fällig','1–30 Tage','31–60 Tage','61–90 Tage','> 90 Tage'];
  const bucketSums = [0,0,0,0,0];
  offen.forEach(inv=>{ bucketSums[agingBucket(inv)] += inv.offenerBetrag; });
  const maxSum = Math.max(...bucketSums, 1);
  const barsHtml = bucketLabels.map((lbl,i)=>{
    const h = Math.round((bucketSums[i]/maxSum)*118) + 6;
    return `<div class="bar-col">
      <div class="bar-value">${bucketSums[i]>0?fmtEUR(bucketSums[i]).replace(',00',''):'–'}</div>
      <div class="bar" style="height:${h}px;"></div>
      <div class="bar-label">${lbl}</div>
    </div>`;
  }).join('');
  /* --- Status-Verteilung-Donut --- */
  const bucketMeta = {
    offen:      { label: 'Offen, nicht fällig',  color: 'var(--blue)' },
    ueberfaellig:{ label: 'Erinnerung/überfällig', color: 'var(--yellow)' },
    mahnung:    { label: 'Mahnung/Mahnbescheid fällig', color: 'var(--red)' },
    teilweise:  { label: 'Teilweise bezahlt',     color: 'var(--violet)' },
    beglichen:  { label: 'Beglichen',             color: 'var(--green)' }
  };
  const counts = { offen:0, ueberfaellig:0, mahnung:0, teilweise:0, beglichen:0 };
  DATA.invoices.forEach(inv=>{ counts[dashboardBucket(inv)]++; });
  const total = DATA.invoices.length;
  let acc = 0;
  const segments = Object.keys(bucketMeta).map(k=>{
    const pct = total ? (counts[k]/total*100) : 0;
    const seg = `${bucketMeta[k].color} ${acc}% ${acc+pct}%`;
    acc += pct;
    return seg;
  }).join(', ');
  const legendHtml = Object.keys(bucketMeta).map(k=>`
    <div class="legend-row"><span class="legend-dot" style="background:${bucketMeta[k].color};"></span>
      <span class="legend-label">${bucketMeta[k].label}</span><span class="legend-count">${counts[k]}</span></div>
  `).join('');
  chartsBox.innerHTML = `
    <div class="chart-card">
      <div class="chart-card-head"><h3 class="section">Offene Forderungen nach Fälligkeitsalter</h3><span class="chart-meta">in € · Stand heute</span></div>
      <div class="barchart">${barsHtml}</div>
    </div>
    <div class="chart-card">
      <div class="chart-card-head"><h3 class="section">Status-Verteilung</h3></div>
      <div class="donut-wrap">
        <div class="donut" style="background:conic-gradient(${segments || 'var(--border) 0% 100%'});">
          <div class="donut-hole"><div class="donut-hole-num">${total}</div><div class="donut-hole-label">Rechnungen</div></div>
        </div>
        <div class="donut-legend">${legendHtml}</div>
      </div>
    </div>
  `;
  /* --- Nächste Mahnschritte & kritischste Fälle --- */
  const pending = offen.map(inv=>({inv, ms:getMahnStatus(inv)})).filter(x=>x.ms);
  pending.sort((a,b)=>{
    if(a.ms.naechsterSchrittFaellig !== b.ms.naechsterSchrittFaellig) return a.ms.naechsterSchrittFaellig ? -1 : 1;
    return (a.ms.deadline||'').localeCompare(b.ms.deadline||'');
  });
  const nextSteps = pending.slice(0,5).map(({inv,ms})=>{
    const label = ms.nextStep==='erinnerung' ? 'Zahlungserinnerung' : ms.nextStep==='inkasso' ? 'Mahnbescheid prüfen' : mahnLabel(ms.nextStep);
    const pillColor = ms.naechsterSchrittFaellig ? 'var(--red)' : 'var(--text2)';
    const pillBg = ms.naechsterSchrittFaellig ? 'var(--red-soft)' : 'var(--surface2)';
    const statusTxt = ms.naechsterSchrittFaellig ? 'fällig' : `ab ${fmtDate(ms.deadline)}`;
    return `<div class="insight-item" data-az="${escapeHtml(inv.aktenzeichen)}">
      <div><div class="insight-main">${escapeHtml(inv.mandant||inv.aktenzeichen)}</div>
        <div class="insight-meta">${escapeHtml(inv.aktenzeichen)} · ${label}</div></div>
      <div class="insight-right"><span class="insight-pill" style="color:${pillColor};background:${pillBg};">${statusTxt}</span></div>
    </div>`;
  }).join('') || `<div class="insight-empty">Aktuell sind keine Erinnerungen oder Mahnungen fällig.</div>`;
  const critical = offen.filter(isOverdue).map(inv=>{
    return {inv, days: daysOverdue(inv)};
  }).sort((a,b)=> b.days - a.days).slice(0,5).map(({inv,days})=>`
    <div class="insight-item" data-az="${escapeHtml(inv.aktenzeichen)}">
      <div><div class="insight-main">${escapeHtml(inv.mandant||inv.aktenzeichen)}</div>
        <div class="insight-meta">${escapeHtml(inv.aktenzeichen)} · ${days>0?days+' Tage überfällig':'überfällig'}</div></div>
      <div class="insight-right"><div class="insight-amount">${fmtEUR(inv.offenerBetrag)}</div></div>
    </div>`).join('') || `<div class="insight-empty">Aktuell keine überfälligen Rechnungen.</div>`;
  insightsBox.innerHTML = `
    <div class="insight-card">
      <div class="insight-card-head"><h3 class="section">Nächste Mahnschritte</h3><span class="insight-link" id="linkMahn">Mahnung fällig →</span></div>
      ${nextSteps}
    </div>
    <div class="insight-card">
      <div class="insight-card-head"><h3 class="section">Kritischste Fälle</h3><span class="insight-link" id="linkKritisch">Nur überfällige →</span></div>
      ${critical}
    </div>
  `;
  insightsBox.querySelectorAll('[data-az]').forEach(el=>{
    el.addEventListener('click', ()=> openAkteDetail(el.getAttribute('data-az')));
  });
  const linkMahn = document.getElementById('linkMahn');
  if(linkMahn) linkMahn.addEventListener('click', ()=>{ document.getElementById('chipMahn').classList.add('active'); showView('rechnungen'); renderViewByName('rechnungen'); });
  const linkKritisch = document.getElementById('linkKritisch');
  if(linkKritisch) linkKritisch.addEventListener('click', ()=>{ document.getElementById('chipOverdue').classList.add('active'); showView('rechnungen'); renderViewByName('rechnungen'); });
}
function mandantKey(inv){ return (inv.mandant && inv.mandant.trim()) || "Ohne Mandantenname"; }
function renderDashboardOverview(){
  document.getElementById('dashSubtitle').textContent = DATA.lastImport
    ? `Stand: ${fmtDateTime(DATA.lastImport)} · ${DATA.invoices.length} Rechnungen im Bestand`
    : "Noch keine Daten importiert.";
  renderKPIs('kpiRow', DATA.invoices);
  document.getElementById('dashEmptyHint').style.display = DATA.invoices.length ? 'none' : 'block';
  renderForecastChart();
  renderDashboardCharts();
}
/* --- Einnahmenprognose: Zahlungsmoral & Ratenhöhe je Mandant --- */
function monthKey(iso){ return iso ? String(iso).slice(0,7) : null; }
function addMonthsToKey(key, n){
  const [y,m] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m-1)+n, 1));
  return dt.toISOString().slice(0,7);
}
function monthKeyLabel(key){
  const [y,m] = key.split('-').map(Number);
  const names = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  return `${names[m-1]} ${String(y).slice(2)}`;
}
function fmtEURShort(n){
  if(n===null||n===undefined||isNaN(n)) return "–";
  return Math.round(n).toLocaleString('de-DE') + " €";
}
// Ermittelt je Mandant aus der bisherigen Zahlungshistorie: durchschnittliche Ratenhöhe,
// durchschnittlicher Zahlungsabstand (wie oft wird gezahlt) und die "Zahlungsmoral"
// (Verhältnis geleisteter Zahlungen zu nötigen Erinnerungen/Mahnungen).
function computeMandantProfiles(){
  const byMandant = {};
  DATA.invoices.forEach(inv=>{
    const key = mandantKey(inv);
    if(!byMandant[key]) byMandant[key] = { zahlungen: [], escalations: 0, offen: 0 };
    (inv.mahnungen||[]).forEach(ev=>{
      if(ev.type === 'zahlung') byMandant[key].zahlungen.push({ datum: ev.datum, betrag: ev.betrag||0 });
      else if(ev.type !== 'manuell_erledigt') byMandant[key].escalations++;
    });
    if(inv.status !== 'beglichen') byMandant[key].offen += inv.offenerBetrag;
  });
  const profiles = {};
  Object.keys(byMandant).forEach(key=>{
    const m = byMandant[key];
    const zahlungen = m.zahlungen.slice().sort((a,b)=>String(a.datum).localeCompare(String(b.datum)));
    let avgBetrag = 0, avgIntervallTage = 30;
    if(zahlungen.length){
      avgBetrag = zahlungen.reduce((s,z)=>s+z.betrag,0) / zahlungen.length;
    }
    if(zahlungen.length >= 2){
      let totalDays = 0, n = 0;
      for(let i=1;i<zahlungen.length;i++){
        const d1 = new Date(zahlungen[i-1].datum+"T00:00:00Z").getTime();
        const d2 = new Date(zahlungen[i].datum+"T00:00:00Z").getTime();
        const days = (d2-d1)/86400000;
        if(days>0){ totalDays += days; n++; }
      }
      if(n) avgIntervallTage = totalDays/n;
    }
    const zahlungenCount = zahlungen.length;
    const escalations = m.escalations;
    // Keine Historie vorhanden: neutraler Startwert statt Extremwert
    const reliability = (zahlungenCount + escalations === 0)
      ? 0.7
      : Math.max(0.15, Math.min(1, zahlungenCount / (zahlungenCount + escalations)));
    // Rate umgerechnet auf einen Monatswert (Deckel gegen Ausreißer bei sehr kurzen Intervallen)
    const monthlyRate = avgBetrag > 0 ? avgBetrag * Math.min(3, 30/avgIntervallTage) : 0;
    profiles[key] = { avgBetrag, avgIntervallTage, zahlungenCount, escalations, reliability, monthlyRate, offen: m.offen };
  });
  return profiles;
}
// Baut die Monatsreihe (Vergangenheit = echte Ist-Zahlen, Gegenwart/Zukunft = Prognose)
function computeRevenueForecast(monthsPast, monthsFuture){
  const profiles = computeMandantProfiles();
  const currentKey = monthKey(todayISO());
  const actualByMonth = {};
  DATA.invoices.forEach(inv=>{
    (inv.mahnungen||[]).forEach(ev=>{
      if(ev.type === 'zahlung'){
        const k = monthKey(ev.datum);
        actualByMonth[k] = (actualByMonth[k]||0) + (ev.betrag||0);
      }
    });
  });
  const keys = [];
  for(let i=-monthsPast; i<=monthsFuture; i++){ keys.push(addMonthsToKey(currentKey, i)); }
  const remainingByMandant = {};
  Object.keys(profiles).forEach(k=>{ remainingByMandant[k] = profiles[k].offen; });
  const forecastByMonth = {};
  keys.filter(k=>k>=currentKey).forEach(mk=>{
    Object.keys(profiles).forEach(mand=>{
      const p = profiles[mand];
      const remaining = remainingByMandant[mand];
      if(!remaining || remaining <= 0) return;
      let planned = p.monthlyRate > 0 ? p.monthlyRate : (p.offen>0 ? p.offen/3 : 0);
      planned = Math.min(planned, remaining);
      const erwartet = planned * p.reliability;
      forecastByMonth[mk] = (forecastByMonth[mk]||0) + erwartet;
      remainingByMandant[mand] = remaining - planned;
    });
  });
  return keys.map(k=>({
    key: k,
    label: monthKeyLabel(k),
    actual: k <= currentKey ? (actualByMonth[k]||0) : null,
    forecast: k >= currentKey ? (forecastByMonth[k]||0) : null,
    isCurrent: k === currentKey
  }));
}
function renderForecastChart(){
  const box = document.getElementById('forecastChartRow');
  if(!box) return;
  if(DATA.invoices.length === 0){ box.innerHTML = ''; return; }
  const data = computeRevenueForecast(3,3);
  const maxVal = Math.max(...data.map(d=>Math.max(d.actual||0, d.forecast||0)), 1);
  const groupsHtml = data.map(d=>{
    const hA = d.actual!==null ? Math.round((d.actual/maxVal)*118) + 6 : 0;
    const hF = d.forecast!==null ? Math.round((d.forecast/maxVal)*118) + 6 : 0;
    const actualBar = d.actual!==null
      ? `<div class="fbar-col"><div class="fbar-value">${d.actual>0?fmtEURShort(d.actual):'–'}</div><div class="fbar fbar-actual" style="height:${hA}px;" title="Tatsächlich ${fmtEUR(d.actual)}"></div></div>`
      : `<div class="fbar-col"><div class="fbar-value">–</div><div class="fbar-empty" title="Für diesen Monat liegt noch keine Prognose vor"></div></div>`;
    const forecastBar = d.forecast!==null
      ? `<div class="fbar-col"><div class="fbar-value">${d.forecast>0?fmtEURShort(d.forecast):'–'}</div><div class="fbar fbar-forecast" style="height:${hF}px;" title="Prognose ${fmtEUR(d.forecast)}"></div></div>`
      : `<div class="fbar-col"><div class="fbar-value">–</div><div class="fbar-empty" title="Für diesen Monat liegen bereits die Ist-Zahlen vor"></div></div>`;
    return `<div class="bar-group${d.isCurrent?' bar-group-current':''}">
      <div class="bar-pair">${actualBar}${forecastBar}</div>
      <div class="bar-label">${d.label}${d.isCurrent?'<span class="bar-label-tag">heute</span>':''}</div>
    </div>`;
  }).join('');
  box.innerHTML = `
    <div class="chart-card">
      <div class="chart-card-head">
        <h3 class="section">Einnahmenprognose</h3>
        <span class="chart-meta">in € · je Monat</span>
      </div>
      <div class="chart-legend-row">
        <span class="legend-chip"><span class="legend-dot" style="background:var(--green);"></span>Tatsächlich erzielt</span>
        <span class="legend-chip"><span class="legend-dot" style="background:var(--blue);"></span>Voraussichtlich (Prognose)</span>
      </div>
      <div class="barchart barchart-grouped">${groupsHtml}</div>
      <div class="chart-footnote">Die Prognose schätzt je Mandant die zu erwartende monatliche Zahlung aus der bisherigen Ratenhöhe und -häufigkeit und gewichtet sie mit dessen Zahlungsmoral (Verhältnis geleisteter Zahlungen zu nötigen Erinnerungen/Mahnungen). Mandanten ohne Zahlungshistorie gehen mit einem neutralen Schätzwert ein.</div>
    </div>
  `;
}
function renderRechnungen(){
  document.getElementById('lastImportLabel').textContent = DATA.lastImport
    ? `Zuletzt importiert: ${fmtDateTime(DATA.lastImport)} · ${DATA.invoices.length} Rechnungen im Bestand`
    : "Noch keine Daten importiert.";
  populateYearFilter();
  const list = getFilteredSorted();
  const box = document.getElementById('akteList');
  if(DATA.invoices.length === 0){
    box.innerHTML = `<div class="empty"><h3>Noch keine Rechnungen importiert</h3><p>Nutzen Sie oben „Excel importieren", um zu starten.</p></div>`;
    return;
  }
  if(list.length === 0){
    box.innerHTML = `<div class="empty"><h3>Keine Treffer</h3><p>Für die gewählten Filter wurden keine Rechnungen gefunden.</p></div>`;
    return;
  }
  const groups = []; const map = {};
  list.forEach(inv=>{
    if(!map[inv.aktenzeichen]){ map[inv.aktenzeichen] = { aktenzeichen: inv.aktenzeichen, mandant: inv.mandant, invoices: [] }; groups.push(map[inv.aktenzeichen]); }
    map[inv.aktenzeichen].invoices.push(inv);
  });
  box.innerHTML = groups.map(g=>{
    const sumBetrag = g.invoices.reduce((s,i)=>s+i.rechnungsbetrag,0);
    const sumOffen = g.invoices.reduce((s,i)=>s+i.offenerBetrag,0);
    const hasEmail = !!g.invoices[0].email;
    // Als beglichen gilt eine Akte, sobald der GESAMTE offene Betrag über alle Rechnungen dieser
    // Akte hinweg unter 5 € liegt (nicht schon, wenn nur eine von mehreren Rechnungen bezahlt ist).
    const isSettled = sumOffen < 5;
    const azTagStyle = isSettled ? ' style="color:var(--green);border-color:var(--green);"' : '';
    return `
    <div class="akte-row" data-az="${escapeHtml(g.aktenzeichen)}">
      <span class="az-tag"${azTagStyle}>${escapeHtml(g.aktenzeichen)}</span>
      <span class="akte-mandant">${escapeHtml(g.mandant||'–')}</span>
      <span class="akte-meta">${g.invoices.length} Rechnung${g.invoices.length>1?'en':''}${!hasEmail?' · E-Mail fehlt':''}</span>
      <span class="badge-count${isSettled?' green':''}">${g.invoices.filter(i=>i.status!=='beglichen').length} offen</span>
      <div class="sums">
        <div><div class="sum-label">Summe</div><div class="sum-value">${fmtEUR(sumBetrag)}</div></div>
        <div><div class="sum-label">Offen</div><div class="sum-value ${isSettled?'green':'red'}">${fmtEUR(sumOffen)}</div></div>
      </div>
      <span style="color:var(--text3);">→</span>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-az]').forEach(el=>{
    el.addEventListener('click', ()=> openAkteDetail(el.getAttribute('data-az')));
  });
}
let selectedAzYear = null;
let azOlderYearsExpanded = false; // steuert, ob die eingeklappten (älteren) Jahres-Reiter unter Mandanten sichtbar sind
// Gruppiert alle Rechnungen nach Jahr und Aktenzeichen-Nummer (aus dem Aktenzeichen "Nummer/Jahr" geparst).
function groupInvoicesByAktenzeichen(){
  const byYear = {};
  DATA.invoices.forEach(inv=>{
    const parsed = parseAz(inv.aktenzeichen);
    if(!parsed.year || !parsed.num) return; // Aktenzeichen ohne erkennbares "Nummer/Jahr"-Format werden hier nicht eingeordnet
    if(!byYear[parsed.year]) byYear[parsed.year] = {};
    if(!byYear[parsed.year][parsed.num]) byYear[parsed.year][parsed.num] = { az: inv.aktenzeichen, invoices: [] };
    byYear[parsed.year][parsed.num].invoices.push(inv);
  });
  return byYear;
}
function renderMandanten(){
  const box = document.getElementById('mandantenList');
  const tabsBox = document.getElementById('azYearTabs');
  if(DATA.invoices.length === 0){
    tabsBox.innerHTML = '';
    box.innerHTML = `<div class="empty"><h3>Noch keine Aktenzeichen</h3><p>Sobald Rechnungen importiert sind, erscheinen die Aktenzeichen hier fortlaufend nach Jahr sortiert.</p></div>`;
    return;
  }
  const byYear = groupInvoicesByAktenzeichen();
  const years = Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  if(years.length === 0){
    tabsBox.innerHTML = '';
    box.innerHTML = `<div class="empty"><h3>Keine gültigen Aktenzeichen gefunden</h3><p>Die importierten Aktenzeichen konnten keinem Jahr/keiner Nummer zugeordnet werden (erwartetes Format z.B. „12/26").</p></div>`;
    return;
  }
  if(!selectedAzYear || !years.includes(selectedAzYear)) selectedAzYear = years[years.length-1];
  // Nur das aktuelle Jahr und die beiden Vorjahre direkt als Reiter zeigen - ältere Jahre werden
  // hinter einem "Weitere Jahre"-Reiter eingeklappt, damit die Reiterzeile bei vielen Jahren nicht
  // endlos lang wird. Ist gerade ein älteres Jahr ausgewählt, bleibt es trotzdem sichtbar (die
  // Ansicht klappt sich dann automatisch auf), statt den aktiven Reiter zu verstecken.
  const currentYear = new Date().getFullYear();
  const cutoffYear = currentYear - 2;
  const recentYears = years.filter(y => y >= cutoffYear);
  const olderYears = years.filter(y => y < cutoffYear);
  const showOlderYears = azOlderYearsExpanded || olderYears.includes(selectedAzYear);
  // Reihenfolge: der Auf-/Zuklapp-Reiter für die frühen Jahre steht VORNE (chronologisch zuerst),
  // danach folgen - falls aufgeklappt - die frühen Jahre selbst und zuletzt die aktuellen Jahre,
  // sodass die gesamte Reiterzeile von links nach rechts chronologisch aufsteigend bleibt.
  const yearBtnHtml = y => `<button class="tpltabbtn${y===selectedAzYear?' active':''}" data-az-year="${y}">${y}</button>`;
  let tabsHtml = '';
  if(olderYears.length){
    tabsHtml += showOlderYears
      ? `<button class="tpltabbtn" id="azOlderCollapseBtn" title="Frühere Jahre wieder ausblenden">▸ Frühere Jahre ausblenden</button>` + olderYears.map(yearBtnHtml).join('')
      : `<button class="tpltabbtn" id="azOlderExpandBtn" title="Frühere Jahre anzeigen">◂ Frühere Jahre (${olderYears.length})</button>`;
  }
  tabsHtml += recentYears.map(yearBtnHtml).join('');
  tabsBox.innerHTML = tabsHtml;
  tabsBox.querySelectorAll('[data-az-year]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ selectedAzYear = parseInt(btn.getAttribute('data-az-year'),10); renderMandanten(); });
  });
  const azOlderExpandBtn = document.getElementById('azOlderExpandBtn');
  if(azOlderExpandBtn) azOlderExpandBtn.addEventListener('click', ()=>{ azOlderYearsExpanded = true; renderMandanten(); });
  const azOlderCollapseBtn = document.getElementById('azOlderCollapseBtn');
  if(azOlderCollapseBtn) azOlderCollapseBtn.addEventListener('click', ()=>{ azOlderYearsExpanded = false; renderMandanten(); });
  const yearGroups = byYear[selectedAzYear];
  const nums = Object.keys(yearGroups).map(Number);
  let maxNum = Math.max(...nums);
  const MAX_ROWS = 3000; // Sicherheitsdeckel gegen eine durch einen Datenfehler explodierende Liste
  const capped = maxNum > MAX_ROWS;
  if(capped) maxNum = MAX_ROWS;
  const yearShort = String(selectedAzYear).slice(2);
  let rowsHtml = '';
  for(let n=1; n<=maxNum; n++){
    const g = yearGroups[n];
    const panelId = `az-${selectedAzYear}-${n}`;
    if(!g){
      const vermerkKey = selectedAzYear + '-' + n;
      const vermerk = (DATA.leereAktenVermerke || {})[vermerkKey];
      const isNoRe = vermerk && vermerk.keineRechnung;
      const azTagStyleGap = isNoRe ? ' style="color:var(--green);border-color:var(--green);"' : '';
      rowsHtml += `
      <div class="mandant-card">
        <div class="mandant-row" data-toggle="${panelId}">
          <span class="az-tag"${azTagStyleGap}>${n}/${yearShort}</span>
          <span class="mandant-name"></span>
          <span class="akte-meta" style="font-style:italic;">${isNoRe ? 'Keine Rechnung erwartet' + (vermerk.grund ? ` – ${escapeHtml(vermerk.grund)}` : '') : '– kein Vorgang hinterlegt –'}</span>
          <div class="sums"></div>
          <span class="mandant-caret" id="caret-${panelId}">▾</span>
        </div>
        <div class="mandant-akten" id="${panelId}" style="display:none;">
          <div class="akte-row akte-row-nested" style="display:block;color:var(--text2);padding:16px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;">
              <input type="checkbox" data-nore-check="${vermerkKey}" ${isNoRe?'checked':''}>
              Es wird keine Rechnung zu diesem Aktenzeichen geben
            </label>
            <textarea data-nore-grund="${vermerkKey}" placeholder="Grund / Notiz (optional)" style="min-height:56px;margin-top:8px;">${isNoRe ? escapeHtml(vermerk.grund||'') : ''}</textarea>
            <button class="btn btn-sm" data-nore-save="${vermerkKey}" style="margin-top:8px;">Speichern</button>
          </div>
        </div>
      </div>`;
      continue;
    }
    const sumTotal = g.invoices.reduce((s,i)=>s+i.rechnungsbetrag,0);
    const sumOffen = g.invoices.reduce((s,i)=>s+i.offenerBetrag,0);
    const name = g.invoices.find(i=>i.mandant && i.mandant.trim())?.mandant || "Ohne Mandantenname";
    // Als beglichen gilt eine Akte, sobald der GESAMTE offene Betrag über alle Rechnungen dieser
    // Akte hinweg unter 5 € liegt (nicht schon, wenn nur eine von mehreren Rechnungen bezahlt ist).
    const isSettled = sumOffen < 5;
    const azTagStyle = isSettled ? ' style="color:var(--green);border-color:var(--green);"' : '';
    rowsHtml += `
    <div class="mandant-card">
      <div class="mandant-row" data-toggle="${panelId}">
        <span class="az-tag"${azTagStyle}>${n}/${yearShort}</span>
        <span class="mandant-name">${escapeHtml(name)}</span>
        <span class="akte-meta">${g.invoices.length} Rechnung${g.invoices.length>1?'en':''}</span>
        <div class="sums">
          <div><div class="sum-label">Gesamt</div><div class="sum-value">${fmtEUR(sumTotal)}</div></div>
          <div><div class="sum-label">Offen</div><div class="sum-value ${isSettled?'green':'red'}">${fmtEUR(sumOffen)}</div></div>
        </div>
        <span class="mandant-caret" id="caret-${panelId}">▾</span>
      </div>
      <div class="mandant-akten" id="${panelId}" style="display:none;">
        <div class="akte-row akte-row-nested" data-az="${escapeHtml(g.az)}">
          <span class="az-tag"${azTagStyle}>${escapeHtml(g.az)}</span>
          <span class="akte-meta">${escapeHtml(name)} · ${g.invoices.length} Rechnung${g.invoices.length>1?'en':''}</span>
          <div class="sums">
            <div><div class="sum-label">Summe</div><div class="sum-value">${fmtEUR(sumTotal)}</div></div>
            <div><div class="sum-label">Offen</div><div class="sum-value ${isSettled?'green':'red'}">${fmtEUR(sumOffen)}</div></div>
          </div>
          <span style="color:var(--text3);">→</span>
        </div>
      </div>
    </div>`;
  }
  if(capped){
    rowsHtml += `<div class="empty"><p>Hinweis: Es wurden nur die ersten ${MAX_ROWS} Aktenzeichen-Nummern angezeigt. Bitte prüfen Sie, ob ein Aktenzeichen fehlerhaft importiert wurde.</p></div>`;
  }
  box.innerHTML = rowsHtml;
  box.querySelectorAll('[data-toggle]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.getAttribute('data-toggle');
      const panel = document.getElementById(id);
      const caret = document.getElementById('caret-'+id);
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      caret.textContent = open ? '▾' : '▴';
    });
  });
  box.querySelectorAll('[data-az]').forEach(el=>{
    el.addEventListener('click', (e)=>{ e.stopPropagation(); openAkteDetail(el.getAttribute('data-az')); });
  });
  box.querySelectorAll('[data-nore-save]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      const key = el.getAttribute('data-nore-save');
      const dash = key.lastIndexOf('-');
      const y = parseInt(key.slice(0,dash),10), n = parseInt(key.slice(dash+1),10);
      const panel = el.closest('.mandant-akten');
      const checked = panel.querySelector('[data-nore-check]').checked;
      const grund = panel.querySelector('[data-nore-grund]').value;
      if(checked) setKeineRechnungVermerk(y, n, grund);
      else clearKeineRechnungVermerk(y, n);
    });
  });
}
function renderMahnwesen(){
  const offen = DATA.invoices.filter(i=>i.status!=='beglichen');
  const rows = offen.map(inv=>({inv, ms:getMahnStatus(inv)})).filter(x=>x.ms);
  const counts = {erinnerung:0, mahnung:0, mahnung2:0, inkasso:0};
  rows.forEach(({ms})=>{ if(ms.nextStep in counts) counts[ms.nextStep]++; });
  document.getElementById('mahnSummary').innerHTML = `
    <div class="kpi"><div class="kpi-label">Erinnerung anstehend</div><div class="kpi-value">${counts.erinnerung}</div></div>
    <div class="kpi"><div class="kpi-label">1. Mahnung möglich</div><div class="kpi-value">${counts.mahnung}</div></div>
    <div class="kpi"><div class="kpi-label">2. Mahnung möglich</div><div class="kpi-value">${counts.mahnung2}</div></div>
    <div class="kpi"><div class="kpi-label">Mahnbescheid prüfen</div><div class="kpi-value ${counts.inkasso?'red':''}">${counts.inkasso}</div></div>
  `;
  const onlyFaellig = document.getElementById('mahnOnlyFaellig').classList.contains('active');
  const stufe = document.getElementById('mahnStufeFilter').value;
  let list = rows.filter(({ms})=>{
    if(onlyFaellig && !ms.naechsterSchrittFaellig) return false;
    if(stufe && ms.nextStep !== stufe) return false;
    return true;
  });
  list.sort((a,b)=>{
    if(a.ms.naechsterSchrittFaellig !== b.ms.naechsterSchrittFaellig) return a.ms.naechsterSchrittFaellig ? -1 : 1;
    return (a.ms.deadline||'').localeCompare(b.ms.deadline||'');
  });
  const box = document.getElementById('mahnwesenTable');
  if(list.length === 0){
    box.innerHTML = `<div class="empty"><h3>Keine Treffer</h3><p>Aktuell steht für die gewählten Filter kein Mahnschritt an.</p></div>`;
    return;
  }
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
    <table><thead><tr>
      <th>Mandant</th><th>Aktenzeichen</th><th style="text-align:right">Offen</th><th>Nächster Schritt</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${list.map(({inv,ms})=>{
      const label = ms.nextStep==='erinnerung' ? 'Zahlungserinnerung' : ms.nextStep==='inkasso' ? 'Mahnbescheid prüfen' : mahnLabel(ms.nextStep);
      const statusTxt = ms.naechsterSchrittFaellig ? `<span class="hist due">fällig seit ${fmtDate(ms.deadline)}</span>` : `<span class="hist">ab ${fmtDate(ms.deadline)}</span>`;
      return `<tr data-az="${escapeHtml(inv.aktenzeichen)}" style="cursor:pointer;">
        <td>${escapeHtml(inv.mandant||'–')}</td>
        <td class="rn">${escapeHtml(inv.aktenzeichen)}</td>
        <td class="amount">${fmtEUR(inv.offenerBetrag)}</td>
        <td>${label}</td>
        <td>${statusTxt}</td>
        <td>
          <div class="row-actions" style="flex-wrap:wrap;gap:6px;">
            ${ms.nextStep!=='inkasso' ? `<button class="btn btn-sm" data-remind="${ms.nextStep}" data-id="${escapeHtml(inv.rechnungsnummer)}">${ms.nextStep==='erinnerung'?'Erinnerung senden':mahnLabel(ms.nextStep)+' senden'}</button>` : ''}
            <button class="btn btn-sm" data-erledigt="${escapeHtml(inv.rechnungsnummer)}">Als erledigt markieren</button>
            <button class="btn btn-sm" data-notiz="${escapeHtml(inv.rechnungsnummer)}" title="${inv.notiz?escapeHtml(inv.notiz):''}">${inv.notiz?'📝 Notiz':'📝 Notiz'}</button>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody></table>
  </div>`;
  box.querySelectorAll('[data-remind]').forEach(el=>{
    el.addEventListener('click', (e)=>{ e.stopPropagation(); openReminderModal(el.getAttribute('data-id'), el.getAttribute('data-remind')); });
  });
  box.querySelectorAll('[data-erledigt]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      const grund = prompt('Grund (z. B. "keine weitere Zahlung erwartet, da ..."):', '');
      if(grund === null) return;
      markManuellErledigt(el.getAttribute('data-erledigt'), grund);
    });
  });
  box.querySelectorAll('[data-notiz]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      const id = el.getAttribute('data-notiz');
      const cur = DATA.invoices.find(i=>i.rechnungsnummer===id);
      const text = prompt('Notiz für Rechnung ' + id + ':', (cur && cur.notiz) || '');
      if(text === null) return;
      setInvoiceNotiz(id, text);
    });
  });
  box.querySelectorAll('tr[data-az]').forEach(el=>{
    el.addEventListener('click', ()=> openAkteDetail(el.getAttribute('data-az')));
  });
}
document.getElementById('mahnOnlyFaellig').addEventListener('click', (e)=>{ e.currentTarget.classList.toggle('active'); renderMahnwesen(); });
document.getElementById('mahnStufeFilter').addEventListener('change', renderMahnwesen);
function renderReports(){
  document.getElementById('repCount').textContent = DATA.invoices.length + " Rechnungen";
  document.getElementById('repLast').textContent = DATA.lastImport ? fmtDateTime(DATA.lastImport) : "–";
  const beglichen = DATA.invoices.filter(i=>i.status==='beglichen');
  let dsoSum=0, dsoCount=0;
  beglichen.forEach(inv=>{
    const zahlungen = (inv.mahnungen||[]).filter(m=>m.type==='zahlung');
    const letzte = zahlungen.length ? zahlungen[zahlungen.length-1].datum : null;
    if(letzte && inv.rechnungsdatum){
      const days = Math.round((new Date(letzte+"T00:00:00Z") - new Date(inv.rechnungsdatum+"T00:00:00Z"))/86400000);
      if(!isNaN(days) && days>=0){ dsoSum+=days; dsoCount++; }
    }
  });
  const dso = dsoCount ? Math.round(dsoSum/dsoCount) : null;
  const totalCount = DATA.invoices.length;
  const mitMahnung = DATA.invoices.filter(i=>(i.mahnungen||[]).some(m=>m.type!=='zahlung' && m.type!=='manuell_erledigt')).length;
  const mahnquote = totalCount ? Math.round(mitMahnung/totalCount*100) : 0;
  const abgeschrieben = DATA.invoices.filter(i=>i.manuellErledigt);
  const abgeschriebenSumme = abgeschrieben.reduce((sum,i)=>sum + (i.manuellErledigtBetrag||0), 0);
  document.getElementById('repMetrics').innerHTML = `
    <div class="kpi"><div class="kpi-label">Ø Zahlungsdauer (beglichen)</div><div class="kpi-value">${dso!==null? dso+' Tage' : '–'}</div><div class="kpi-sub">${dsoCount} beglichene Rechnung(en) mit Zahlungsdatum</div></div>
    <div class="kpi"><div class="kpi-label">Mahnquote</div><div class="kpi-value ${mahnquote>30?'red':''}">${mahnquote}%</div><div class="kpi-sub">${mitMahnung} von ${totalCount} Rechnungen mit Erinnerung/Mahnung</div></div>
    <div class="kpi"><div class="kpi-label">Abgeschriebene Forderungen</div><div class="kpi-value ${abgeschriebenSumme>0?'red':''}">${fmtEUR(abgeschriebenSumme)}</div><div class="kpi-sub">${abgeschrieben.length} manuell als erledigt markierte Rechnung(en), insgesamt</div></div>
  `;
  const map = {};
  DATA.invoices.forEach(inv=>{ map[mandantKey(inv)] = (map[mandantKey(inv)]||0) + inv.offenerBetrag; });
  const top = Object.entries(map).filter(([,v])=>v>0.01).sort((a,b)=>b[1]-a[1]).slice(0,5);
  document.getElementById('repTopMandanten').innerHTML = top.length ? top.map(([name,sum])=>`
    <div class="insight-item" style="cursor:default;">
      <div class="insight-main">${escapeHtml(name)}</div>
      <div class="insight-right"><div class="insight-amount">${fmtEUR(sum)}</div></div>
    </div>`).join('') : `<div class="insight-empty">Keine offenen Forderungen.</div>`;
  const box = document.getElementById('importLogTable');
  if(!DATA.importLog || DATA.importLog.length === 0){
    box.innerHTML = `<div class="empty"><h3>Noch keine Datei importiert</h3><p>Importieren Sie Rechnungen auf der Seite „Rechnungen", um hier eine Historie zu sehen.</p></div>`;
    return;
  }
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
    <table><thead><tr><th>Datei</th><th>Datum/Uhrzeit</th><th style="text-align:right">Importiert</th><th style="text-align:right">Übersprungen</th></tr></thead>
    <tbody>${DATA.importLog.map(log=>{
      const details = log.skippedDetails || [];
      const shown = details.slice(0,10);
      const detailHtml = shown.length ? `<tr><td colspan="4" style="padding-top:0;">
        <div class="hist due" style="margin-top:0;">Übersprungene Zeilen: ${shown.map(d=>`Zeile ${d.zeile} (${escapeHtml(d.grund)})`).join(' · ')}${details.length>shown.length?` · … und ${details.length-shown.length} weitere`:''}</div>
      </td></tr>` : '';
      return `
      <tr>
        <td>📄 ${escapeHtml(log.filename)}</td>
        <td>${fmtDateTime(log.timestamp)}</td>
        <td class="amount" style="color:var(--green)">${log.imported}</td>
        <td class="amount" style="color:${log.skipped?'var(--red)':'var(--text2)'}">${log.skipped}</td>
      </tr>${detailHtml}`;}).join('')}</tbody></table>
  </div>`;
}
/* ============================================================
   Render: Akte Detail
   ============================================================ */
function openAkteDetail(az){
  const activeView = document.querySelector('.view.active');
  if(activeView && activeView.id !== 'view-detail') detailReturnView = activeView.id.replace('view-','');
  currentDetailAz = az;
  const invoices = DATA.invoices.filter(i=>i.aktenzeichen === az);
  if(invoices.length === 0) return;
  document.getElementById('detailAz').textContent = az;
  document.getElementById('detailMandant').textContent = invoices[0].mandant || "Ohne Mandantenname";
  const email = invoices.find(i=>i.email)?.email || "";
  const emailEl = document.getElementById('detailEmail');
  emailEl.textContent = "✉ " + (email || "E-Mail-Adresse hinterlegen");
  emailEl.className = "email-link" + (email ? "" : " missing");
  emailEl.onclick = ()=>{
    const current = invoices.find(i=>i.email)?.email || "";
    const value = prompt(`E-Mail-Adresse für Akte ${az} (gilt für alle Rechnungen dieser Akte):`, current);
    if(value === null) return;
    DATA.invoices.forEach(i=>{ if(i.aktenzeichen===az) i.email = value.trim(); });
    saveData(); openAkteDetail(az);
  };
  const sumBetrag = invoices.reduce((s,i)=>s+i.rechnungsbetrag,0);
  const sumOffen = invoices.reduce((s,i)=>s+i.offenerBetrag,0);
  document.getElementById('detailKpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Rechnungen</div><div class="kpi-value">${invoices.length}</div></div>
    <div class="kpi"><div class="kpi-label">Gesamtbetrag</div><div class="kpi-value">${fmtEUR(sumBetrag)}</div></div>
    <div class="kpi"><div class="kpi-label">Noch offen</div><div class="kpi-value ${sumOffen>0?'red':''}">${fmtEUR(sumOffen)}</div></div>
  `;
  document.getElementById('detailInvoices').innerHTML = invoices.map(inv=>{
    const ms = getMahnStatus(inv);
    const canRemind = inv.status!=='beglichen' && detailReturnView!=='mandanten';
    const canErledigt = inv.status!=='beglichen';
    return `
    <tr>
      <td class="rn">${escapeHtml(inv.rechnungsnummer)}</td>
      <td>${fmtDate(inv.rechnungsdatum)}</td>
      <td>${fmtDate(inv.zahlungsziel)}${inv.zahlungszielGeschaetzt?'<div class="hist">geschätzt</div>':''}</td>
      <td class="amount">${fmtEUR(inv.rechnungsbetrag)}</td>
      <td class="amount">${fmtEUR(inv.beglichenerBetrag)}</td>
      <td class="amount">${fmtEUR(inv.offenerBetrag)}</td>
      <td>${statusPill(inv)}${renderMahnHint(inv)}</td>
      <td>
        <div class="row-actions" style="flex-wrap:wrap;gap:6px;">
          ${canRemind ? `
            <button class="btn btn-sm" data-remind="erinnerung" data-id="${escapeHtml(inv.rechnungsnummer)}">Erinnerung</button>
            <button class="btn btn-sm btn-danger" data-remind="mahnung" data-id="${escapeHtml(inv.rechnungsnummer)}">Mahnung</button>
            ${ms && ms.nextStep==='mahnung2' ? `<button class="btn btn-sm btn-danger" data-remind="mahnung2" data-id="${escapeHtml(inv.rechnungsnummer)}">2. Mahnung</button>` : ''}
          ` : ''}
          ${canErledigt ? `<button class="btn btn-sm" data-erledigt="${escapeHtml(inv.rechnungsnummer)}">Als erledigt markieren</button>` : ''}
          ${inv.manuellErledigt ? `<button class="btn btn-sm" data-undo-erledigt="${escapeHtml(inv.rechnungsnummer)}">Rückgängig</button>` : ''}
          <button class="btn btn-sm" data-notiz="${escapeHtml(inv.rechnungsnummer)}" title="${inv.notiz?escapeHtml(inv.notiz):''}">${inv.notiz?'📝 Notiz':'📝 Notiz'}</button>
        </div>
        ${inv.manuellErledigt && inv.manuellErledigtGrund ? `<div class="hist" style="margin-top:4px;">Grund: ${escapeHtml(inv.manuellErledigtGrund)}</div>` : ''}
        ${inv.notiz ? `<div class="hist" style="margin-top:4px;color:var(--gold);">Notiz: ${escapeHtml(inv.notiz)}</div>` : ''}
      </td>
    </tr>
  `;}).join('');
  document.getElementById('detailInvoices').querySelectorAll('[data-remind]').forEach(el=>{
    el.addEventListener('click', ()=> openReminderModal(el.getAttribute('data-id'), el.getAttribute('data-remind')));
  });
  document.getElementById('detailInvoices').querySelectorAll('[data-erledigt]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const grund = prompt('Grund (z. B. "keine weitere Zahlung erwartet, da ..."):', '');
      if(grund === null) return;
      markManuellErledigt(el.getAttribute('data-erledigt'), grund);
    });
  });
  document.getElementById('detailInvoices').querySelectorAll('[data-undo-erledigt]').forEach(el=>{
    el.addEventListener('click', ()=>{
      if(!confirm('Diese Rechnung wieder als offen führen?')) return;
      unmarkManuellErledigt(el.getAttribute('data-undo-erledigt'));
    });
  });
  document.getElementById('detailInvoices').querySelectorAll('[data-notiz]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.getAttribute('data-notiz');
      const cur = DATA.invoices.find(i=>i.rechnungsnummer===id);
      const text = prompt('Notiz für Rechnung ' + id + ':', (cur && cur.notiz) || '');
      if(text === null) return;
      setInvoiceNotiz(id, text);
    });
  });
  const events = [];
  invoices.forEach(inv => (inv.mahnungen||[]).forEach(m => events.push({...m, rechnungsnummer: inv.rechnungsnummer})));
  events.sort((a,b)=> b.datum.localeCompare(a.datum));
  const tlBox = document.getElementById('detailTimeline');
  if(events.length === 0){
    tlBox.innerHTML = `<div style="color:var(--text2);font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;">Für diese Akte wurden bisher keine Zahlungserinnerungen oder Mahnungen verschickt.</div>`;
  } else {
    tlBox.innerHTML = `<div class="timeline">${events.map(ev=>{
      let color, bg, icon;
      if(ev.type === 'zahlung'){ color = 'var(--green)'; bg = 'var(--green-soft)'; icon = '✓'; }
      else if(ev.type === 'erinnerung'){ color = 'var(--gold)'; bg = 'var(--gold-soft)'; icon = '🕐'; }
      else if(ev.type === 'manuell_erledigt'){ color = 'var(--blue)'; bg = 'var(--blue-soft)'; icon = '✔'; }
      else { color = 'var(--red)'; bg = 'var(--red-soft)'; icon = '⚠'; }
      return `<div class="tl-item">
        <div class="tl-dot" style="background:${bg};color:${color};">${icon}</div>
        <div><div class="tl-label" style="color:${color};">${mahnLabel(ev.type)}${ev.type==='zahlung' && ev.betrag ? ` (${fmtEUR(ev.betrag)})` : ''}</div>
        <div class="tl-meta">${fmtDate(ev.datum)} · Rechnung ${escapeHtml(ev.rechnungsnummer)}${ev.type==='manuell_erledigt' && ev.grund ? ` · Grund: ${escapeHtml(ev.grund)}` : ''}</div></div>
      </div>`;
    }).join('')}</div>`;
  }
  showView('detail');
}
/* ============================================================
   Render: Mandanten / Archiv
   ============================================================ */
function docTypeLabel(type){
  if(type==='zahlung') return 'Zahlung erhalten';
  return mahnLabel(type);
}
function renderArchiv(){
  const az = document.getElementById('archFilterAz').value.trim().toLowerCase();
  const mandant = document.getElementById('archFilterMandant').value.trim().toLowerCase();
  const type = document.getElementById('archFilterType').value;
  const from = document.getElementById('archFilterFrom').value;
  const to = document.getElementById('archFilterTo').value;
  let docs = [];
  DATA.invoices.forEach(inv=>{
    (inv.mahnungen||[]).forEach(m=>{
      docs.push({ datum: m.datum, type: m.type, betrag: m.betrag, aktenzeichen: inv.aktenzeichen, rechnungsnummer: inv.rechnungsnummer, mandant: inv.mandant||"", grund: m.grund||"" });
    });
  });
  Object.entries(DATA.leereAktenVermerke || {}).forEach(([key, v])=>{
    if(!v || !v.keineRechnung) return;
    const dash = key.lastIndexOf('-');
    const year = key.slice(0,dash), num = key.slice(dash+1);
    docs.push({ datum: v.datum, type:'keine_rechnung', betrag:0, aktenzeichen: `${num}/${String(year).slice(2)}`, rechnungsnummer:'–', mandant:'', grund: v.grund||'', synthetic:true });
  });
  docs = docs.filter(d=>{
    if(az && !d.aktenzeichen.toLowerCase().includes(az)) return false;
    if(mandant && !d.mandant.toLowerCase().includes(mandant)) return false;
    if(type && d.type !== type) return false;
    if(from && d.datum < from) return false;
    if(to && d.datum > to) return false;
    return true;
  });
  docs.sort((a,b)=> b.datum.localeCompare(a.datum));
  const box = document.getElementById('archivTable');
  if(docs.length === 0){
    box.innerHTML = `<div class="empty"><h3>Keine Dokumente gefunden</h3><p>Sobald Sie Zahlungserinnerungen oder Mahnungen verschicken, erscheinen sie hier im Archiv.</p></div>`;
    return;
  }
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
    <table><thead><tr>
      <th>Datum</th><th>Aktenzeichen</th><th>Mandant</th><th>Dokument</th><th>Rechnung</th><th>Status</th>
    </tr></thead>
    <tbody>${docs.map(d=>{
      const isZahlung = d.type === 'zahlung';
      const isVermerk = d.type==='manuell_erledigt' || d.type==='keine_rechnung';
      const color = isZahlung ? 'var(--green)' : isVermerk ? 'var(--blue)' : (d.type==='erinnerung' ? 'var(--gold)' : 'var(--red)');
      const statusLabel = isZahlung ? 'Erfasst' : isVermerk ? 'Vermerkt' : 'Versendet';
      const extra = isVermerk && d.grund ? ` – ${escapeHtml(d.grund)}` : '';
      const azCell = d.synthetic
        ? `<span style="font-family:'IBM Plex Mono',monospace;color:var(--text2);">${escapeHtml(d.aktenzeichen)}</span>`
        : `<span class="archiv-az" data-archaz="${escapeHtml(d.aktenzeichen)}" style="font-family:'IBM Plex Mono',monospace;color:var(--accent);cursor:pointer;">${escapeHtml(d.aktenzeichen)}</span>`;
      return `
      <tr>
        <td>${fmtDate(d.datum)}</td>
        <td>${azCell}</td>
        <td>${escapeHtml(d.mandant||'–')}</td>
        <td style="color:${color};font-weight:600;">${docTypeLabel(d.type)}${isZahlung && d.betrag ? ` (${fmtEUR(d.betrag)})` : ''}${extra}</td>
        <td class="rn">${escapeHtml(d.rechnungsnummer)}</td>
        <td><span class="status-pill status-beglichen">${statusLabel}</span></td>
      </tr>`;
    }).join('')}</tbody></table>
  </div>`;
  box.querySelectorAll('[data-archaz]').forEach(el=>{
    el.addEventListener('click', ()=> openAkteDetail(el.getAttribute('data-archaz')));
  });
}
['archFilterAz','archFilterMandant','archFilterType','archFilterFrom','archFilterTo'].forEach(id=>{
  document.getElementById(id).addEventListener('input', renderArchiv);
  document.getElementById(id).addEventListener('change', renderArchiv);
});
/* ============================================================
   Render: Einstellungen
   ============================================================ */
function renderSettingsForm(){
  document.getElementById('setKanzlei').value = DATA.settings.kanzlei || "";
  document.getElementById('setAnsprech').value = DATA.settings.ansprech || "";
  document.getElementById('setIban').value = DATA.settings.iban || "";
  document.getElementById('setFrist').value = DATA.settings.frist || "10";
  document.getElementById('setZzTage').value = DATA.settings.zzTage || "14";
  renderTemplateFields();
}
let activeTplTab = "erinnerung";
function renderTemplateFields(){
  ["erinnerung","mahnung","mahnung2"].forEach(type=>{
    const tpl = (DATA.templates && DATA.templates[type]) || DEFAULT_TEMPLATES[type];
    document.getElementById('tplSubject_'+type).value = tpl.subject;
    document.getElementById('tplText_'+type).value = tpl.text;
  });
}
document.querySelectorAll('[data-tpltab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    activeTplTab = btn.getAttribute('data-tpltab');
    document.querySelectorAll('[data-tpltab]').forEach(b=>b.classList.toggle('active', b===btn));
    document.querySelectorAll('[data-tplpanel]').forEach(p=> p.style.display = (p.getAttribute('data-tplpanel')===activeTplTab) ? 'block' : 'none');
  });
});
document.getElementById('resetTplBtn').addEventListener('click', ()=>{
  if(!confirm(`Vorlage "${activeTplTab}" wirklich auf den Standardtext zurücksetzen? (Erst nach "Vorlagen speichern" endgültig übernommen.)`)) return;
  document.getElementById('tplSubject_'+activeTplTab).value = DEFAULT_TEMPLATES[activeTplTab].subject;
  document.getElementById('tplText_'+activeTplTab).value = DEFAULT_TEMPLATES[activeTplTab].text;
});
document.getElementById('saveTplBtn').addEventListener('click', async ()=>{
  DATA.templates = DATA.templates || {};
  ["erinnerung","mahnung","mahnung2"].forEach(type=>{
    DATA.templates[type] = {
      subject: document.getElementById('tplSubject_'+type).value,
      text: document.getElementById('tplText_'+type).value
    };
  });
  await saveData();
  showToast("Vorlagen gespeichert.");
});
document.getElementById('saveSettingsBtn').addEventListener('click', async ()=>{
  DATA.settings = {
    kanzlei: document.getElementById('setKanzlei').value.trim(),
    ansprech: document.getElementById('setAnsprech').value.trim(),
    iban: document.getElementById('setIban').value.trim(),
    frist: document.getElementById('setFrist').value.trim() || "10",
    zzTage: document.getElementById('setZzTage').value.trim() || "14"
  };
  DATA.invoices.forEach(inv=>{ if(inv.zahlungszielGeschaetzt) inv.zahlungsziel = null; computeDerived(inv); });
  await saveData();
  renderAll();
  showToast("Einstellungen gespeichert.");
});
/* ============================================================
   Reminder Modal
   ============================================================ */
function openReminderModal(rechnungsnummer, type){
  const inv = DATA.invoices.find(i=>i.rechnungsnummer === rechnungsnummer);
  if(!inv) return;
  activeInvoiceForReminder = {inv, type};
  const tpl = buildTemplate(inv, type);
  document.getElementById('reminderTitle').textContent = type==='mahnung2' ? '2. Mahnung erstellen (mit Inkasso-Hinweis)' : type==='mahnung' ? 'Mahnung erstellen' : 'Zahlungserinnerung erstellen';
  document.getElementById('reminderMeta').textContent = `Akte ${inv.aktenzeichen} · Rechnung ${inv.rechnungsnummer} · Offen: ${fmtEUR(inv.offenerBetrag)}`;
  document.getElementById('reminderEmail').value = inv.email || "";
  document.getElementById('reminderSubject').value = tpl.subject;
  document.getElementById('reminderText').value = tpl.text;
  document.getElementById('reminderModal').classList.add('show');
}
document.querySelectorAll('[data-close]').forEach(el=>{
  el.addEventListener('click', ()=> document.getElementById(el.getAttribute('data-close')).classList.remove('show'));
});
document.getElementById('sendReminderBtn').addEventListener('click', async ()=>{
  if(!activeInvoiceForReminder) return;
  const email = document.getElementById('reminderEmail').value.trim();
  const subject = document.getElementById('reminderSubject').value.trim();
  const text = document.getElementById('reminderText').value;
  if(!email){ showToast("Keine E-Mail-Adresse hinterlegt – bitte manuell eingeben."); return; }
  window.open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, '_blank');
  const { inv, type } = activeInvoiceForReminder;
  inv.mahnungen = inv.mahnungen || [];
  inv.mahnungen.push({ type, datum: todayISO() });
  inv.email = email;
  await saveData();
  document.getElementById('reminderModal').classList.remove('show');
  const activeView = document.querySelector('.view.active');
  const activeName = activeView ? activeView.id.replace('view-','') : 'rechnungen';
  if(activeName === 'detail'){
    if(currentDetailAz) openAkteDetail(currentDetailAz);
    renderViewByName(detailReturnView);
  } else {
    renderViewByName(activeName);
  }
  showToast(`${mahnLabel(type)} vermerkt und E-Mail-Programm geöffnet.`);
});
/* ============================================================
   Anmeldung: Jede Person hat ihr eigenes Supabase-Auth-Konto (eigene
   Login-E-Mail + eigenes Passwort, von dir in Supabase verwaltet).
   Beim Start werden die Namen angezeigt; nach Auswahl wird das jeweils
   eigene Passwort echt serverseitig über Supabase geprüft. Erst danach
   startet die eigentliche App (loadData).
   ============================================================ */
const SUPABASE_URL = "https://ckcvouwkgjoygrhxnukb.supabase.co";
const SUPABASE_KEY = "sb_publishable_LmsPB5PuGX6p5eZMPNHEeA_OG-zEIMf";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Feste Zuordnung Name -> Supabase-Login-E-Mail. Reihenfolge hier = Anzeigereihenfolge
// im Anmelde-Fenster. Neue Kollegen/innen: hier einfach einen weiteren Eintrag ergänzen
// und in Supabase (Authentication -> Users -> Add user) ein Konto mit derselben E-Mail anlegen.
const TEAM = [
  { name: "Isam Osman", email: "Isam@mahnwesen.de" },
  { name: "Ali Ajouaou", email: "Ali@mahnwesen.de" }
];

const ACTIVE_USER_KEY = "muster-dashboard-active-user";
let activeUserName = null;
let selectedTeamMember = null;

function initials(name){
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||"") + (parts[1]?.[0]||"")).toUpperCase() || "?";
}
function renderUserChip(){
  if(activeUserName){
    document.getElementById('userAvatarInitial').textContent = initials(activeUserName);
    document.getElementById('userChipName').textContent = activeUserName;
    document.querySelector('.user-chip-sub').textContent = "Angemeldet";
  } else {
    document.getElementById('userAvatarInitial').textContent = "?";
    document.getElementById('userChipName').textContent = "Nicht angemeldet";
    document.querySelector('.user-chip-sub').textContent = "Anmelden";
  }
}
document.getElementById('userChip').addEventListener('click', async ()=>{
  if(!confirm(`Abmelden${activeUserName?' ('+activeUserName+')':''}?`)) return;
  await supabaseClient.auth.signOut();
  sessionStorage.removeItem(ACTIVE_USER_KEY);
  location.reload();
});

function showAuthError(msg){
  const el = document.getElementById('authError');
  el.textContent = msg; el.style.display = 'block';
}
function hideAuthError(){
  document.getElementById('authError').style.display = 'none';
}

function renderUserList(){
  const list = document.getElementById('authUserList');
  list.innerHTML = TEAM.map(u => `
    <button class="auth-user-btn" type="button" data-user="${escapeHtml(u.name)}">
      <span class="auth-avatar">${escapeHtml(initials(u.name))}</span>
      <span class="auth-user-name">${escapeHtml(u.name)}</span>
    </button>`).join('');
  list.querySelectorAll('[data-user]').forEach(b=>{
    b.addEventListener('click', ()=> selectTeamMember(b.getAttribute('data-user')));
  });
}

function selectTeamMember(name){
  selectedTeamMember = TEAM.find(u => u.name === name);
  if(!selectedTeamMember) return;
  hideAuthError();
  document.getElementById('authGateTitle').textContent = selectedTeamMember.name;
  document.getElementById('authUserList').style.display = 'none';
  document.getElementById('authPasswordBox').style.display = 'block';
  document.getElementById('authPassword').value = '';
  document.getElementById('authPassword').focus();
}

document.getElementById('authBackBtn').addEventListener('click', ()=>{
  selectedTeamMember = null;
  hideAuthError();
  document.getElementById('authGateTitle').textContent = 'Wer arbeitet gerade?';
  document.getElementById('authPasswordBox').style.display = 'none';
  document.getElementById('authUserList').style.display = 'flex';
});

document.getElementById('authSubmitBtn').addEventListener('click', async ()=>{
  if(!selectedTeamMember) return;
  hideAuthError();
  const password = document.getElementById('authPassword').value;
  if(!password){ showAuthError('Bitte Passwort eingeben.'); return; }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true; btn.textContent = 'Prüfe…';
  const { error } = await supabaseClient.auth.signInWithPassword({ email: selectedTeamMember.email, password });
  btn.disabled = false; btn.textContent = 'Anmelden';
  if(error){ showAuthError('Passwort falsch.'); return; }
  activeUserName = selectedTeamMember.name;
  sessionStorage.setItem(ACTIVE_USER_KEY, activeUserName);
  document.getElementById('authGate').classList.remove('show');
  renderUserChip();
  startApp();
});
document.getElementById('authPassword').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('authSubmitBtn').click(); });

async function startApp(){
  await loadData();
}

// Beim (Neu-)Laden der Seite prüfen, ob bereits eine gültige Supabase-Sitzung besteht.
(async function initAuthGate(){
  renderUserList();
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(session){
    const saved = sessionStorage.getItem(ACTIVE_USER_KEY);
    const match = TEAM.find(u => u.email.toLowerCase() === (session.user.email||'').toLowerCase());
    activeUserName = saved || (match ? match.name : (session.user.email||'Angemeldet'));
    document.getElementById('authGate').classList.remove('show');
    renderUserChip();
    startApp();
    return;
  }
  // sonst: Namensauswahl bleibt sichtbar, das ist der Normalzustand beim ersten Aufruf.
})();
/* ============================================================
   Init
   ============================================================ */
function renderAll(){
  const active = document.querySelector('.view.active');
  const name = active ? active.id.replace('view-','') : 'dashboard';
  if(name === 'detail'){ if(currentDetailAz) openAkteDetail(currentDetailAz); }
  else renderViewByName(name);
  renderNotifBell();
}
/* ============================================================
   Glocke / Tages-Hinweis: fällige Erinnerungen & Mahnungen
   ============================================================ */
function computeFaelligeMahnschritte(){
  const counts = {erinnerung:0, mahnung:0, mahnung2:0, inkasso:0};
  DATA.invoices.forEach(inv=>{
    if(inv.status==='beglichen') return;
    const ms = getMahnStatus(inv);
    if(!ms || !ms.naechsterSchrittFaellig) return;
    if(ms.nextStep in counts) counts[ms.nextStep]++;
  });
  return counts;
}
function faelligeHinweistext(counts){
  const versandParts = [];
  if(counts.erinnerung) versandParts.push(`${counts.erinnerung} Zahlungserinnerung${counts.erinnerung>1?'en':''}`);
  if(counts.mahnung) versandParts.push(`${counts.mahnung} erste Mahnung${counts.mahnung>1?'en':''}`);
  if(counts.mahnung2) versandParts.push(`${counts.mahnung2} zweite Mahnung${counts.mahnung2>1?'en':''}`);
  const sentences = [];
  if(versandParts.length){
    const list = versandParts.length === 1
      ? versandParts[0]
      : versandParts.slice(0,-1).join(', ') + ' und ' + versandParts[versandParts.length-1];
    sentences.push(`Heute stehen ${list} zum Versand an.`);
  }
  if(counts.inkasso){
    sentences.push(`${counts.inkasso} ${counts.inkasso>1?'Fälle sollten':'Fall sollte'} zur Prüfung eines gerichtlichen Mahnbescheids vorgelegt werden.`);
  }
  if(sentences.length === 0) return 'Aktuell steht kein Mahnschritt an.';
  return sentences.join(' ');
}
function renderNotifBell(){
  const counts = computeFaelligeMahnschritte();
  const total = counts.erinnerung + counts.mahnung + counts.mahnung2 + counts.inkasso;
  const dot = document.getElementById('notifDot');
  if(dot) dot.style.display = total>0 ? 'block' : 'none';
  const textBox = document.getElementById('notifPopupText');
  if(textBox) textBox.textContent = faelligeHinweistext(counts);
}
function openNotifPopup(){
  renderNotifBell();
  document.getElementById('notifPopup').classList.add('show');
}
function closeNotifPopup(){
  document.getElementById('notifPopup').classList.remove('show');
}
document.getElementById('notifBell').addEventListener('click', (e)=>{
  e.stopPropagation();
  const popup = document.getElementById('notifPopup');
  popup.classList.contains('show') ? closeNotifPopup() : openNotifPopup();
});
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.notif-bell-wrap')) closeNotifPopup();
});
const DAILY_HINT_KEY = 'muster-dashboard-daily-hint-last-shown';
// Zeigt das Popup automatisch einmal pro Tag, sobald es (Ortszeit) 8 Uhr morgens ist und das
// Dashboard offen ist/geöffnet wird - funktioniert nur, während die Seite tatsächlich läuft.
function maybeShowDailyHint(){
  if(new Date().getHours() < 8) return;
  const todayKey = todayISO();
  if(localStorage.getItem(DAILY_HINT_KEY) === todayKey) return;
  const counts = computeFaelligeMahnschritte();
  if(counts.erinnerung + counts.mahnung + counts.mahnung2 + counts.inkasso === 0) return;
  localStorage.setItem(DAILY_HINT_KEY, todayKey);
  openNotifPopup();
}
// Prüft auch dann noch einmal, wenn die Seite über Nacht/über die 8-Uhr-Marke hinweg geöffnet bleibt.
setInterval(maybeShowDailyHint, 5*60*1000);
// loadData() wird jetzt erst nach erfolgreicher Anmeldung aufgerufen (siehe startApp() weiter oben).
