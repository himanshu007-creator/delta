/**
 * Countries: where to put a marker, and what to call it.
 *
 * The geography itself comes from `dotted-map` via lib/dotmap.ts — a sampled
 * coastline with no country outlines in it, because borders are disputed and
 * drawing them would make a political claim this product has no business
 * making. A dot showing where a company is registered makes no such claim.
 *
 * This module is the other half: turning whatever a page said about a country
 * into something placeable.
 */

/**
 * Representative point and name per country, for the ones our sources actually
 * produce plus the rest of the significant commercial world.
 *
 * A representative point, not a true centroid: the marker should land on the
 * country's populated centre, which for Norway or Chile is nowhere near the
 * geometric middle.
 */
export const COUNTRIES: Record<string, { lon: number; lat: number; name: string }> = {
  AE: { lon: 54.4, lat: 24.5, name: "United Arab Emirates" },
  AR: { lon: -58.4, lat: -34.6, name: "Argentina" },
  AT: { lon: 16.4, lat: 48.2, name: "Austria" },
  AU: { lon: 151.2, lat: -33.9, name: "Australia" },
  BE: { lon: 4.35, lat: 50.85, name: "Belgium" },
  BG: { lon: 23.3, lat: 42.7, name: "Bulgaria" },
  BR: { lon: -46.6, lat: -23.5, name: "Brazil" },
  CA: { lon: -79.4, lat: 43.7, name: "Canada" },
  CH: { lon: 8.5, lat: 47.4, name: "Switzerland" },
  CL: { lon: -70.7, lat: -33.5, name: "Chile" },
  CN: { lon: 116.4, lat: 39.9, name: "China" },
  CO: { lon: -74.1, lat: 4.7, name: "Colombia" },
  CY: { lon: 33.4, lat: 35.2, name: "Cyprus" },
  CZ: { lon: 14.4, lat: 50.1, name: "Czechia" },
  DE: { lon: 13.4, lat: 52.5, name: "Germany" },
  DK: { lon: 12.6, lat: 55.7, name: "Denmark" },
  EE: { lon: 24.8, lat: 59.4, name: "Estonia" },
  ES: { lon: -3.7, lat: 40.4, name: "Spain" },
  FI: { lon: 24.9, lat: 60.2, name: "Finland" },
  FR: { lon: 2.35, lat: 48.85, name: "France" },
  GB: { lon: -0.13, lat: 51.5, name: "United Kingdom" },
  GR: { lon: 23.7, lat: 38.0, name: "Greece" },
  HK: { lon: 114.2, lat: 22.3, name: "Hong Kong" },
  HR: { lon: 16.0, lat: 45.8, name: "Croatia" },
  HU: { lon: 19.0, lat: 47.5, name: "Hungary" },
  ID: { lon: 106.8, lat: -6.2, name: "Indonesia" },
  IE: { lon: -6.26, lat: 53.35, name: "Ireland" },
  IL: { lon: 34.8, lat: 32.1, name: "Israel" },
  IN: { lon: 77.2, lat: 28.6, name: "India" },
  IT: { lon: 12.5, lat: 41.9, name: "Italy" },
  JE: { lon: -2.1, lat: 49.2, name: "Jersey" },
  JP: { lon: 139.7, lat: 35.7, name: "Japan" },
  KE: { lon: 36.8, lat: -1.3, name: "Kenya" },
  KR: { lon: 127.0, lat: 37.6, name: "South Korea" },
  KY: { lon: -81.4, lat: 19.3, name: "Cayman Islands" },
  LT: { lon: 25.3, lat: 54.7, name: "Lithuania" },
  LU: { lon: 6.13, lat: 49.61, name: "Luxembourg" },
  LV: { lon: 24.1, lat: 56.9, name: "Latvia" },
  MT: { lon: 14.5, lat: 35.9, name: "Malta" },
  MX: { lon: -99.1, lat: 19.4, name: "Mexico" },
  MY: { lon: 101.7, lat: 3.1, name: "Malaysia" },
  NG: { lon: 3.4, lat: 6.5, name: "Nigeria" },
  NL: { lon: 4.9, lat: 52.37, name: "Netherlands" },
  NO: { lon: 10.75, lat: 59.91, name: "Norway" },
  NZ: { lon: 174.8, lat: -41.3, name: "New Zealand" },
  PH: { lon: 121.0, lat: 14.6, name: "Philippines" },
  PL: { lon: 21.0, lat: 52.2, name: "Poland" },
  PT: { lon: -9.14, lat: 38.72, name: "Portugal" },
  RO: { lon: 26.1, lat: 44.4, name: "Romania" },
  SA: { lon: 46.7, lat: 24.7, name: "Saudi Arabia" },
  SE: { lon: 18.07, lat: 59.33, name: "Sweden" },
  SG: { lon: 103.8, lat: 1.35, name: "Singapore" },
  SI: { lon: 14.5, lat: 46.1, name: "Slovenia" },
  SK: { lon: 17.1, lat: 48.1, name: "Slovakia" },
  TH: { lon: 100.5, lat: 13.8, name: "Thailand" },
  TR: { lon: 32.9, lat: 39.9, name: "Türkiye" },
  TW: { lon: 121.6, lat: 25.0, name: "Taiwan" },
  UA: { lon: 30.5, lat: 50.4, name: "Ukraine" },
  US: { lon: -95.7, lat: 39.0, name: "United States" },
  VG: { lon: -64.6, lat: 18.4, name: "British Virgin Islands" },
  VN: { lon: 105.8, lat: 21.0, name: "Vietnam" },
  ZA: { lon: 18.4, lat: -33.9, name: "South Africa" },
};

/**
 * Our sources disagree about how to write a country.
 *
 * The same dataset contains US, USA and "United States"; GB and UK. Normalising
 * at read time rather than at extraction keeps every adapter free to record
 * exactly what the page said, which is what the source quote has to match.
 */
const ALIASES: Record<string, string> = {
  USA: "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", AMERICA: "US",
  UK: "GB", "UNITED KINGDOM": "GB", ENGLAND: "GB", SCOTLAND: "GB", WALES: "GB",
  "GREAT BRITAIN": "GB", "NORTHERN IRELAND": "GB",
  DEUTSCHLAND: "DE", GERMANY: "DE", FRANCE: "FR", NEDERLAND: "NL", NETHERLANDS: "NL",
  HOLLAND: "NL", BELGIUM: "BE", BELGIË: "BE", IRELAND: "IE", EIRE: "IE",
  SPAIN: "ES", ESPAÑA: "ES", ITALY: "IT", ITALIA: "IT", SWEDEN: "SE", NORWAY: "NO",
  DENMARK: "DK", FINLAND: "FI", POLAND: "PL", PORTUGAL: "PT", SWITZERLAND: "CH",
  SCHWEIZ: "CH", AUSTRIA: "AT", ÖSTERREICH: "AT", CANADA: "CA", AUSTRALIA: "AU",
  "NEW ZEALAND": "NZ", SINGAPORE: "SG", INDIA: "IN", JAPAN: "JP", CHINA: "CN",
  ISRAEL: "IL", "SOUTH AFRICA": "ZA", BRAZIL: "BR", MEXICO: "MX", CYPRUS: "CY",
  ROMANIA: "RO", JERSEY: "JE", LUXEMBOURG: "LU", "CZECH REPUBLIC": "CZ",
};

/** Resolve whatever a page said into an ISO code we can place on the map. */
export function normaliseCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/\.$/, "");
  if (!v) return null;
  if (COUNTRIES[v]) return v;
  const alias = ALIASES[v];
  if (alias) return alias;
  // A trailing country in a one-line address: "London, England".
  const tail = v.split(/[,;]/).map((s) => s.trim()).filter(Boolean).pop();
  if (tail && tail !== v) return COUNTRIES[tail] ? tail : (ALIASES[tail] ?? null);
  return null;
}

export const countryName = (iso: string): string => COUNTRIES[iso]?.name ?? iso;

/**
 * The country a locale names, if it names one.
 *
 * `en-gb` is a market; bare `de` is a language spoken in three countries, so
 * it is NOT evidence of a market and resolves to nothing. That rule is what
 * keeps the map honest — and it discards URL-path noise for free, since
 * nothing like `/ci-cd/` carries a real region subtag.
 */
export function localeCountry(locale: string): string | null {
  const m = locale.trim().toLowerCase().match(/^[a-z]{2}[-_]([a-z]{2})$/);
  if (!m) return null;
  const iso = m[1].toUpperCase();
  return COUNTRIES[iso] ? iso : null;
}
