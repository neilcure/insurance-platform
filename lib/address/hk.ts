export type ParsedHongKongAddress = {
  flatNumber?: string;
  floorNumber?: string;
  blockNumber?: string;
  blockName?: string;
  streetNumber?: string;
  streetName?: string;
  propertyName?: string;
  districtName?: string;
};

// Minimal list of HK districts (English) for quick matching
// Source: Hong Kong 18 districts (common spellings)
export const HONG_KONG_DISTRICTS = [
  "Central and Western",
  "Eastern",
  "Southern",
  "Wan Chai",
  "Kowloon City",
  "Kwun Tong",
  "Sham Shui Po",
  "Wong Tai Sin",
  "Yau Tsim Mong",
  "Islands",
  "Kwai Tsing",
  "North",
  "Sai Kung",
  "Sha Tin",
  "Tai Po",
  "Tsuen Wan",
  "Tuen Mun",
  "Yuen Long",
  // Common neighborhood names frequently used as districts in addresses
  "Sheung Wan",
  "Causeway Bay",
  "Hung Hom",
  "Mong Kok",
  "Tsim Sha Tsui",
  "Jordan",
  "Shatin",
  "Tai Wai",
  "Tsuen Wan West",
  // New Territories neighborhoods
  "Fanling",
  "Sheung Shui",
  "Tin Shui Wai",
  "Tseung Kwan O",
  "Ma On Shan",
  "Tung Chung",
  "Yuen Long Town",
  "Kam Tin",
  "Lam Tin",
  "Lo Wu",
  "Lok Ma Chau",
  // Kowloon neighborhoods
  "To Kwa Wan",
  "Kowloon Tong",
  "Kowloon Bay",
  "Ngau Tau Kok",
  "Kwai Chung",
  "Tsing Yi",
  "Lei Yue Mun",
  "Diamond Hill",
  "San Po Kong",
  "Cheung Sha Wan",
  "Lai Chi Kok",
  // Hong Kong Island neighborhoods
  "Aberdeen",
  "Ap Lei Chau",
  "Stanley",
  "Repulse Bay",
  "Happy Valley",
  "Pok Fu Lam",
  "Kennedy Town",
  "Sai Ying Pun",
  "Mid-Levels",
  "North Point",
  "Quarry Bay",
  "Chai Wan",
  "Shau Kei Wan",
  "Sai Wan Ho",
  // Outlying Islands
  "Discovery Bay",
  "Cheung Chau",
  "Peng Chau",
  "Lamma Island",
  "Mui Wo",
];

// Very lightweight parser that tries to extract common components from free-text HK addresses.
// It aims for "good enough" extraction and allows users to adjust before applying.
export function parseHongKongAddress(input: string): ParsedHongKongAddress {
  const text = String(input ?? "").trim().replace(/\s+/g, " ");
  const result: ParsedHongKongAddress = {};

  // Flat/Unit
  // Examples: "Flat C", "Flat C-D", "RM 1203", "Unit A", "室A", "室 A"
  const flatMatch =
    text.match(/\b(?:FLAT|UNIT|RM|ROOM)\s*([A-Z0-9\-]+)\b/i) ||
    text.match(/(?:室)\s*([A-Z0-9\-]+)/i);
  if (flatMatch) result.flatNumber = flatMatch[1];

  // Floor
  // Examples: "26/F", "26F", "26/Floor", "26樓"
  const floorMatch =
    text.match(/\b(\d{1,2})\s*\/?\s*(?:F|\/F|FLOOR)\b/i) ||
    text.match(/\b(\d{1,2})\s*(?:樓)\b/i);
  if (floorMatch) result.floorNumber = floorMatch[1];

  // Block number (often "Blk 16", "Block 16")
  const blockNumMatch = text.match(/\b(?:BLK|BLOCK)\s*([A-Z0-9\-]+)\b/i);
  if (blockNumMatch) result.blockNumber = blockNumMatch[1];

  // Block/Building name (take the phrase before "Block" or end after "Building/Court/Tower/Phase/Estate")
  const blockNameMatch =
    text.match(/\b([A-Z0-9\s\-\&']+?)\s+(?:BUILDING|COURT|TOWER|ESTATE|PHASE)\b/i) ||
    text.match(/\b(?:BLOCK|BLK)\s*[A-Z0-9\-]+\s+([A-Z0-9\s\-\&']+?)\b/i);
  if (blockNameMatch) result.blockName = cleanup(blockNameMatch[1]);

  // Street number and name
  // Examples:
  // - "123 King's Road", "12A Nathan Road"
  // - "8-12 King's Road", "No.8-12 King's Road", "No: 8–12 Ma Kok Street", "#8-12 ..."
  // - "No.8-12 Street" (no street name)
  // Handles hyphen variations: -, –, —, ~, 至
  const streetMatch = text.match(
    /\b((?:NO\.?|NO:|#)?\s*\d+(?:\s*[-–—~至]\s*\d+)?[A-Z]?)\s+((?:[A-Z][A-Z\s'\-\.]*\s+)?(?:ROAD|RD\.?|STREET|ST\.?|AVENUE|AVE\.?|DRIVE|DR\.?|LANE|LN\.?|COURT|CT\.?|WAY|BOULEVARD|BLVD\.?|PATH|PLACE|PL\.?|TERRACE|TER\.?|CIRCUIT))\b/i,
  );
  if (streetMatch) {
    // Strip optional "No." / "No:" / "#" prefix and condense spaces/hyphen variants
    const rawNo = streetMatch[1].replace(/^(?:NO\.?|NO:|#)\s*/i, "");
    result.streetNumber = rawNo.replace(/\s*[-–—~至]\s*/g, "-");
    result.streetName = expandAbbreviation(cleanup(streetMatch[2]));
  }

  // Property name (pick a prominent building/estate name if present, including the suffix)
  const propertyMatch = text.match(
    /\b([A-Z][A-Z0-9\s'\-]+?\s+(?:BUILDING|TOWER|ESTATE|MANSION|COURT|GARDEN|RESIDENCE|RESIDENCES|PLAZA|CENTRE|CENTER|HOUSE|TERRACE|LODGE|VILLAS?))\b/i,
  );
  if (propertyMatch) result.propertyName = cleanup(propertyMatch[1]);

  // District - match by list presence
  const lower = text.toLowerCase();
  const matchedDistrict =
    HONG_KONG_DISTRICTS.find((d) => lower.includes(d.toLowerCase())) ?? undefined;
  if (matchedDistrict) result.districtName = matchedDistrict;

  return result;
}

function cleanup(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function expandAbbreviation(s: string): string {
  return s
    .replace(/\bRD\.?\b/i, "Road")
    .replace(/\bST\.?\b/i, "Street")
    .replace(/\bAVE\.?\b/i, "Avenue")
    .replace(/\bDR\.?\b/i, "Drive")
    .replace(/\bLN\.?\b/i, "Lane")
    .replace(/\bCT\.?\b/i, "Court")
    .replace(/\bPL\.?\b/i, "Place")
    .replace(/\bTER\.?\b/i, "Terrace")
    .replace(/\bBLVD\.?\b/i, "Boulevard");
}


