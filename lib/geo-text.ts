/**
 * Text geography for news: is a story about a U.S. place, and which states?
 * Pure functions, safe for client and server.
 */

/** Major cities, counties and data-center hubs → state. Ambiguous names (Portland, Columbia, Springfield…) are omitted. */
export const PLACE_STATE: Record<string, string> = {
  // Data-center hubs & frequently covered localities
  "Ashburn": "VA", "Loudoun": "VA", "Prince William": "VA", "Manassas": "VA", "Culpeper": "VA", "Fauquier": "VA", "Chesapeake": "VA", "Virginia Beach": "VA", "Henrico": "VA", "Chesterfield": "VA",
  "Abilene": "TX", "Amarillo": "TX", "Hood County": "TX", "Midland": "TX", "Odessa": "TX", "Dallas": "TX", "Fort Worth": "TX", "Houston": "TX", "San Antonio": "TX", "Austin": "TX", "El Paso": "TX",
  "New Albany": "OH", "Columbus, Ohio": "OH", "Cleveland": "OH", "Cincinnati": "OH", "Dayton": "OH", "Toledo": "OH",
  "Council Bluffs": "IA", "Altoona": "IA", "Cedar Rapids": "IA", "Des Moines": "IA",
  "Papillion": "NE", "Omaha": "NE", "Lincoln, Nebraska": "NE",
  "Cheyenne": "WY", "Quincy, Washington": "WA", "Seattle": "WA", "Spokane": "WA",
  "Hillsboro": "OR", "The Dalles": "OR", "Prineville": "OR",
  "Reno": "NV", "Las Vegas": "NV", "Storey County": "NV", "Tahoe-Reno": "NV",
  "Mesa": "AZ", "Phoenix": "AZ", "Tucson": "AZ", "Chandler": "AZ", "Goodyear": "AZ", "Maricopa County": "AZ", "Pima County": "AZ",
  "Mount Pleasant, Wisconsin": "WI", "Port Washington": "WI", "Milwaukee": "WI", "Madison, Wisconsin": "WI", "Beaver Dam": "WI",
  "Memphis": "TN", "Nashville": "TN", "Knoxville": "TN", "Chattanooga": "TN",
  "Atlanta": "GA", "Fayetteville, Georgia": "GA", "Douglas County, Georgia": "GA", "Coweta": "GA", "Savannah": "GA",
  "Richland Parish": "LA", "New Orleans": "LA", "Baton Rouge": "LA", "Shreveport": "LA",
  "Pittsburgh": "PA", "Philadelphia": "PA", "Harrisburg": "PA", "Scranton": "PA", "Archbald": "PA", "Lackawanna": "PA", "Luzerne": "PA",
  "Chicago": "IL", "Champaign": "IL", "Aurora, Illinois": "IL",
  "Indianapolis": "IN", "Fort Wayne": "IN", "New Carlisle": "IN", "Lebanon, Indiana": "IN",
  "Detroit": "MI", "Saline Township": "MI", "Grand Rapids": "MI", "Lansing": "MI",
  "Minneapolis": "MN", "St. Paul": "MN", "Rosemount": "MN",
  "Kansas City": "MO", "St. Louis": "MO",
  "Charlotte": "NC", "Raleigh": "NC", "Durham": "NC", "Greensboro": "NC",
  "Columbia, South Carolina": "SC", "Spartanburg": "SC", "Greenville, South Carolina": "SC", "Berkeley County, South Carolina": "SC",
  "Baltimore": "MD", "Frederick County": "MD", "Montgomery County, Maryland": "MD", "Prince George's": "MD",
  "Denver": "CO", "Aurora, Colorado": "CO", "Colorado Springs": "CO",
  "Salt Lake": "UT", "Eagle Mountain": "UT", "Iron County": "UT",
  "Oklahoma City": "OK", "Tulsa": "OK",
  "Albuquerque": "NM", "Santa Fe": "NM", "Santa Teresa": "NM",
  "Boise": "ID", "Kuna": "ID",
  "Louisville": "KY", "Lexington, Kentucky": "KY",
  "Birmingham, Alabama": "AL", "Huntsville": "AL", "Montgomery, Alabama": "AL",
  "Jackson, Mississippi": "MS", "Meridian": "MS",
  "Little Rock": "AR", "Billings": "MT", "Missoula": "MT", "Fargo": "ND", "Bismarck": "ND", "Sioux Falls": "SD",
  "Boston": "MA", "Providence": "RI", "Hartford": "CT", "Wilmington, Delaware": "DE", "Newark, New Jersey": "NJ", "Jersey City": "NJ",
  "New York City": "NY", "Buffalo": "NY", "Albany, New York": "NY", "Rochester, New York": "NY",
  "Los Angeles": "CA", "San Francisco": "CA", "San Jose": "CA", "Santa Clara": "CA", "Sacramento": "CA", "San Diego": "CA", "Imperial County": "CA", "Silicon Valley": "CA",
  "Miami": "FL", "Tampa": "FL", "Orlando": "FL", "Jacksonville": "FL",
  "Honolulu": "HI", "Anchorage": "AK", "Burlington, Vermont": "VT", "Manchester, New Hampshire": "NH", "Portland, Maine": "ME",
  "Charleston, West Virginia": "WV", "Mason County, West Virginia": "WV", "Putnam County, West Virginia": "WV",
};

/** Residents' names → state ("Nebraskans", "Texan", "Hoosiers"). */
export const DEMONYM_STATE: Record<string, string> = {
  Alabamian: "AL", Alaskan: "AK", Arizonan: "AZ", Arkansan: "AR", Californian: "CA", Coloradan: "CO", Connecticuter: "CT",
  Delawarean: "DE", Floridian: "FL", Hawaiian: "HI", Idahoan: "ID", Illinoisan: "IL", Hoosier: "IN", Iowan: "IA", Kansan: "KS",
  Kentuckian: "KY", Louisianan: "LA", Mainer: "ME", Marylander: "MD", Michigander: "MI", Minnesotan: "MN", Mississippian: "MS",
  Missourian: "MO", Montanan: "MT", Nebraskan: "NE", Nevadan: "NV", "New Hampshirite": "NH", "New Jerseyan": "NJ", "New Mexican": "NM",
  "New Yorker": "NY", "North Carolinian": "NC", "North Dakotan": "ND", Ohioan: "OH", Oklahoman: "OK", Oregonian: "OR",
  Pennsylvanian: "PA", "Rhode Islander": "RI", "South Carolinian": "SC", "South Dakotan": "SD", Tennessean: "TN", Texan: "TX",
  Utahn: "UT", Vermonter: "VT", "West Virginian": "WV", Washingtonian: "WA", Wisconsinite: "WI", Wyomingite: "WY",
};

const PLACE_PATTERNS = [
  ...Object.entries(DEMONYM_STATE).map(([d, st]) => ({ st, re: new RegExp(`\\b${d.replace(/ /g, "\\s+")}s?\\b`) })),
  ...Object.entries(PLACE_STATE).map(([place, st]) => ({ st, re: new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}\\b`) })),
];

/** States implied by named U.S. places (cities, counties, hubs). */
export function statesFromPlaces(text: string): string[] {
  return [...new Set(PLACE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.st))];
}

/** Explicit U.S. anchors: national institutions and grid operators. */
export const US_ANCHOR = /\b(U\.S\.|US|United States|America|American|Americans|nationwide|the nation[’']s|Trump|Speaker|GOP|Democrats?|Democratic|Republicans?|Sen\.|Rep\.|Mike Johnson|Congress|congressional|Senate|House of Representatives|federal|FERC|DOE|EPA|White House|Trump administration|Biden administration|PJM|ERCOT|MISO|SPP|CAISO|NYISO|ISO-NE|NERC|Department of Energy|Supreme Court|statehouse|state legislature|governor|midterms?)\b/;

/** Non-U.S. countries, regions, demonyms and major foreign data-center markets. */
export const FOREIGN = /\b(Canada|Canadian|(?<!New\s)Mexico|(?<!New\s)Mexican|Brazil|Brazilian|Chile|Chilean|Argentina|Colombia|Peru|UK|U\.K\.|Britain|British|England|English|Scotland|Scottish|Wales|Welsh|Ireland|Irish|Slough|Europe|European|EU|Germany|German|Frankfurt|France|French|Marseille|Netherlands|Dutch|Amsterdam|Rotterdam|Belgium|Belgian|Spain|Spanish|Madrid|Portugal|Portuguese|Italy|Italian|Poland|Polish|Warsaw|Czech|Austria|Austrian|Switzerland|Swiss|Zurich|Nordic|Norway|Norwegian|Sweden|Swedish|Stockholm|Finland|Finnish|Denmark|Danish|Iceland|Icelandic|Russia|Russian|Ukraine|Ukrainian|Greece|Greek|Turkey|Turkish|Israel|Israeli|Saudi|UAE|Emirates|Emirati|Abu Dhabi|Dubai|Qatar|Qatari|Bahrain|Kuwait|Oman|Egypt|Egyptian|Morocco|Moroccan|Nigeria|Nigerian|Kenya|Kenyan|South Africa|Africa|African|India|Indian|Mumbai|Chennai|Pakistan|Bangladesh|China|Chinese|Beijing|Shanghai|Hong Kong|Japan|Japanese|Tokyo|Osaka|Korea|Korean|Seoul|Taiwan|Taiwanese|Singapore|Singaporean|Malaysia|Malaysian|Johor|Indonesia|Indonesian|Jakarta|Batam|Borneo|Thailand|Thai|Bangkok|Vietnam|Vietnamese|Philippines|Filipino|Australia|Australian|Aussie|New Zealand|Kiwi|Asia|Asian|Asia-Pacific|APAC|EMEA|LATAM|Latin America|Middle East|Gulf states|North Sea)\b/;

/** AP-style and postal abbreviations used in headlines ("WV", "Pa.", "N.C."). */
const STATE_ABBREV = /\b(Ala\.|Ariz\.|Ark\.|Calif\.|Colo\.|Conn\.|Del\.|Fla\.|Ga\.|Ill\.|Ind\.|Kan\.|Ky\.|La\.|Md\.|Mass\.|Mich\.|Minn\.|Miss\.|Mo\.|Mont\.|Neb\.|Nev\.|N\.H\.|N\.J\.|N\.M\.|N\.Y\.|N\.C\.|N\.D\.|Okla\.|Ore\.|Pa\.|R\.I\.|S\.C\.|S\.D\.|Tenn\.|Vt\.|Va\.|Wash\.|W\.Va\.|Wis\.|Wyo\.|WV|NC|SC|NJ|NY|NM|ND|SD|NH|PA|VA|TX|OH|GA|AZ|NV|IA|IN|MI|MN|WI|MO|KY|TN|AL|MS|LA|OK|KS|NE|CO|UT|ID|MT|WY|OR|WA|CA|FL|MD|DE|CT|RI|MA|VT|ME|AR|HI|AK)\b/;
const STATE_NAME = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington state|West Virginia|Wisconsin|Wyoming)\b/;

const STATE_CODE_BY_NAME: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY",
  Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
  Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
  "Washington state": "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

/** State codes for states named in text ("West Virginia" doesn't also count as Virginia). */
export function stateNamesIn(text: string): string[] {
  const out = new Set<string>();
  for (const [name, code] of Object.entries(STATE_CODE_BY_NAME)) {
    const re = new RegExp(`${code === "VA" ? "(?<!West\\s)" : ""}\\b${name.replace(/ /g, "\\s+")}\\b`);
    if (re.test(text)) out.add(code);
  }
  return [...out];
}

export const namesUSPlace = (s: string) => STATE_NAME.test(s) || US_ANCHOR.test(s) || statesFromPlaces(s).length > 0 || STATE_ABBREV.test(s);

/**
 * Domestic = a happening in the U.S. The headline decides foreignness: a
 * headline naming a foreign place and no U.S. place is international. Otherwise
 * the story must be tied to a state (outlet home state, state or place names)
 * or carry an explicit U.S. anchor in its headline or summary.
 */
export function isDomestic(title: string, stateCount: number, summary = ""): boolean {
  // A headline about a foreign place that names no U.S. place is international,
  // whatever the outlet's home state. (Shared town names like Paris or Dublin are not treated as foreign.)
  // U.S. places inside quotes ("the 'Texas of Europe'") are nicknames, not locations.
  const unquoted = title.replace(/[‘“"'][^‘’“”"']{1,60}[’”"']/g, " ");
  if (FOREIGN.test(title) && !namesUSPlace(unquoted)) return false;
  if (stateCount > 0 || namesUSPlace(title)) return true;
  const text = `${title} ${summary}`;
  if (FOREIGN.test(text) && !namesUSPlace(summary)) return false;
  return namesUSPlace(summary);
}

export const isSponsored = (title: string) => /^\s*\[?sponsored\b|^\s*paid post|partner content|^\s*advertorial/i.test(title);
