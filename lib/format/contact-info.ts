export type ContactFieldMeta = {
	key: string;
	label?: string;
};

export function canonicalizeContactKey(rawKey: string): string {
	const base = String(rawKey ?? "")
		.replace(/^(insured|contactinfo)__?/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
	return base;
}

// Priority buckets to mirror Policy Details ordering
// 1-9: core contact; 100+ address in canonical sequence; 10000 fallback/unknown
const CONTACT_PRIORITY: Record<string, number> = {
	ptitle: 1,
	title: 1,
	fullname: 2,
	name: 2,
	tel: 3,
	phone: 3,
	mobile: 4,
	email: 5,
};

const ADDRESS_PRIORITY: Record<string, number> = {
	flatno: 110,
	flatnumber: 110,
	floorno: 120,
	foorno: 120,
	blockno: 130,
	blocknumber: 130,
	blockname: 140,
	streetno: 150,
	streetnumber: 150,
	streetname: 160,
	propertyname: 170,
	district: 180,
	districtname: 180,
	area: 190,
};

export function getContactSortWeight(rawKey: string): number {
	const key = canonicalizeContactKey(rawKey);
	if (Object.prototype.hasOwnProperty.call(CONTACT_PRIORITY, key)) return CONTACT_PRIORITY[key];
	if (Object.prototype.hasOwnProperty.call(ADDRESS_PRIORITY, key)) return ADDRESS_PRIORITY[key];
	return 10000;
}

export function formatContactLabel(rawLabel: string, rawKey: string): string {
	const dropPrefix = String(rawKey ?? "").replace(/^(insured|contactinfo)__?/i, "");
	const baseRaw = rawLabel?.trim() ? rawLabel : dropPrefix;
	const canon = baseRaw.toLowerCase().replace(/\s+/g, "");
	const map: Record<string, string> = {
		flatno: "Flat Number",
		flatnumber: "Flat Number",
		floorno: "Floor Number",
		foorno: "Floor Number",
		blockno: "Block Number",
		blocknumber: "Block Number",
		blockname: "Block Name",
		streetno: "Street Number",
		streetnumber: "Street Number",
		streetname: "Street Name",
		propertyname: "Property Name",
		district: "District Name",
		districtname: "District Name",
		area: "Area",
		companyname: "Company Name",
		category: "Category",
		brnumber: "BR No.",
		cinumber: "CI No.",
		fullname: "Full Name",
		idnumber: "ID No.",
		ptitle: "Personal Title",
		title: "Personal Title",
	};
	if (map[canon]) return map[canon];
	const withSpaces = baseRaw
		.replace(/[_\-]+/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/\s+/g, " ")
		.trim();
	return withSpaces.replace(/\b\w/g, (c) => c.toUpperCase());
}

