## Contact Information display rules (Client & Policy Details)

- Always use the shared helpers in `lib/format/contact-info.ts` for Contact Information labels and ordering.

### Ordering
1) Personal Title, Name, Tel, Mobile, Email  
2) Address: Flat Number, Floor Number, Block Number, Block Name, Street Number, Street Name, Property Name, District Name, Area

### Label normalization
- `ptitle` / `title` → Personal Title  
- `district` / `districtname` → District Name  
- `flatno` / `flatnumber`, `streetno` / `streetnumber` → Flat/Street Number  
- `foorno` → Floor Number

### Usage
- Labels: `formatContactLabel(label, key)`
- Ordering: `getContactSortWeight(key)` for stable sort

This keeps Client Details and Policy Details consistent even if backend keys vary.

