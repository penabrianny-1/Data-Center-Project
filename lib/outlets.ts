import { isDisallowedSource } from "./schema";

export type OutletType =
  | "government" | "national_news" | "business_news" | "public_media" | "local_news" | "nonprofit_news" | "trade" | "press_release";

/**
 * Classify a publisher by domain. Returns null for sources that should never
 * appear: aggregators, social and user-generated platforms, finance content
 * farms and AI-generated "news" sites.
 */
const NATIONAL = /(^|\.)(nytimes|washingtonpost|wsj|reuters|apnews|bloomberg|ft|politico|cnn|cnbc|axios|npr|pbs|thehill|usatoday|nbcnews|cbsnews|abcnews\.go|foxnews|foxbusiness|newsweek|time|theatlantic|businessinsider|fortune|forbes|theguardian|latimes|economist|vox|propublica|semafor|marketwatch|barrons|theverge|wired|arstechnica|techcrunch|insideclimatenews|grist|statnews|bbc)\.(com|org|co\.uk)$/;
const TRADE = /(^|\.)(utilitydive|datacenterdynamics|datacenterknowledge|datacenterfrontier|rtoinsider|eenews|canarymedia|power-eng|powermag|latitudemedia|heatmap|tdworld|spglobal|energynews|mypowernet|construction(dive)?|enr|bisnow|bizjournals|govtech|route-fifty|routefifty|smartcitiesdive|electrek|datacentre(magazine)?|capacitymedia)\.(com|org|news|us)$/;
const PUBLIC_MEDIA = /(^|\.)(npr|pbs|opb|kqed|wbur|wnyc|wamu|wvpublic|wvpb|wfae|wunc|wvia|whyy|wesa|kcur|wfyi|kunc|kosu|kgou|nhpr|wvxu|lpm|wypr|kpbs|laist|capradio|mprnews|wpr|michiganradio|wosu|ideastream|gpb|wabe|kjzz|kut|tpr|houstonpublicmedia|kera|vpm|whro|iowapublicradio|nebraskapublicmedia|wuft|wgcu|wmfe|wlrn|knpr|kunr|ksut|kvpr|kvcr|wamc|wskg|wxxi|wbfo|wjct|wkms|wkyu|weku|wuky|wvtf|wcve|wmra|wrvo|wspa)\.(org|fm|com)$/;
const NONPROFIT = /(^|\.)(newsfromthestates|statesnewsroom|stateline|calmatters|cardinalnews|mountainstatespotlight|westvirginiawatch|virginiamercury|georgiarecorder|ohiocapitaljournal|indianacapitalchronicle|azmirror|texastribune|mlive|nevadacurrent|wisconsinexaminer|minnesotareformer|michiganadvance|penncapital-star|spotlightpa|marylandmatters|ncnewsline|iowacapitaldispatch|nebraskaexaminer|newjerseymonitor|tennesseelookout|kentuckylantern|scdailygazette|oklahomavoice|missouriindependent|lailluminator|utahnewsdispatch|floridaphoenix|coloradonewsline|oregoncapitalchronicle|thecity|chalkbeat|mississippitoday|alabamareflector|arkansasadvocate|idahocapitalsun|kansasreflector|mainemorningstar|montanafreepress|dailymontanan|newhampshirebulletin|sourcenm|southdakotasearchlight|vtdigger|washingtonstatestandard|wyofile|insidenova|baltimorebanner|thetexan)\.(org|com|news)$/;
const WIRES = /(^|\.)(prnewswire|businesswire|globenewswire|accessnewswire|einpresswire|newswire|prweb|openpr)\.(com|ca)$/;
/** Aggregators, user-generated platforms, low-quality finance/content farms and AI portals: dropped. */
const DROP = /(^|\.)(msn|yahoo|newsbreak|ground\.news|flipboard|substack|medium|linkedin|facebook|x|twitter|reddit|quora|youtube|tiktok|seekingalpha|benzinga|investing|tipranks|zacks|simplywall\.st|marketscreener|marketbeat|stocktitan|finviz|citizenportal\.ai|patch|newsbreakapp|ts2|opentools|aimagazine|techbullion|dailymotion|aol|tradingview|biggo|hoodline|newsbreak|knowtechie|archyde|dailypolitical|thenationaldesk|headtopics|newsnow|inkl|pressreader|ainvest|ad-hoc-news|bitget|coinmarketcap|binance)\.(com|ai|st|news|app|tech|ca|co\.uk|de)$/;


export function outletTypeFor(domain: string): OutletType | null {
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (DROP.test(d) || isDisallowedSource(`https://${d}/`)) return null;
  if (/\.gov$|\.gov\.\w+$|\.state\.[a-z]{2}\.us$/.test(d)) return "government";
  if (WIRES.test(d)) return "press_release";
  if (PUBLIC_MEDIA.test(d)) return "public_media";
  if (NONPROFIT.test(d)) return "nonprofit_news";
  if (TRADE.test(d)) return "trade";
  if (/(^|\.)(cnbc|bloomberg|wsj|ft|fortune|forbes|marketwatch|barrons|businessinsider|economist)\./.test(d)) return "business_news";
  if (NATIONAL.test(d)) return "national_news";
  return "local_news";
}

