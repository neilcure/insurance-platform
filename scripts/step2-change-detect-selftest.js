/* eslint-disable no-console */
/**
 * Self-test for Step 2 "Update client information?" detection logic.
 *
 * Goal: ensure we do NOT treat "field not present in form values" as a deletion.
 * This was the cause of the dialog popping even when the user made no changes.
 *
 * Run:
 *   node scripts/step2-change-detect-selftest.js
 */

function canonicalizePrefixedKey(k) {
  let out = String(k ?? "").trim();
  if (!out) return "";
  const lower = out.toLowerCase();
  if (lower.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
  if (lower.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
  return out.toLowerCase();
}

function isEmptyClientValue(v) {
  return typeof v === "undefined" || v === null || (typeof v === "string" && v.trim() === "");
}

function readCurrentByCanonical(values, canonKey) {
  const valuesByLower = new Map(Object.entries(values ?? {}).map(([k, v]) => [String(k ?? "").toLowerCase(), v]));
  const ck = String(canonKey ?? "").toLowerCase();
  if (!ck) return { hasAny: false, anyEmpty: false, anyValue: false };
  const dbl =
    ck.startsWith("contactinfo_")
      ? `contactinfo__${ck.slice("contactinfo_".length)}`
      : ck.startsWith("insured_")
        ? `insured__${ck.slice("insured_".length)}`
        : ck;
  const candidates = [];
  if (valuesByLower.has(ck)) candidates.push(valuesByLower.get(ck));
  if (valuesByLower.has(dbl)) candidates.push(valuesByLower.get(dbl));
  for (const [kk, vv] of valuesByLower.entries()) {
    if (kk.endsWith(`__${ck}`) || kk.endsWith(`__${dbl}`)) candidates.push(vv);
  }
  const hasAny = candidates.length > 0;
  const anyEmpty = candidates.some((v) => isEmptyClientValue(v));
  const anyValue = candidates.some((v) => !isEmptyClientValue(v));
  return { hasAny, anyEmpty, anyValue };
}

function computeBaselineDeletes(baseline, values) {
  const out = {};
  for (const [k, before] of Object.entries(baseline ?? {})) {
    const ck = canonicalizePrefixedKey(k);
    if (!ck) continue;
    if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
    const now = readCurrentByCanonical(values, ck);
    // IMPORTANT (current app behavior): only treat as cleared if the field is present in form values.
    const isCleared = now.hasAny && now.anyEmpty && !now.anyValue;
    if (!isEmptyClientValue(before) && isCleared) out[ck] = null;
  }
  return out;
}

function filterClientUpdatePayload(normalized, dirtyFieldNames) {
  const touched = new Set();
  if (dirtyFieldNames && dirtyFieldNames.size > 0) {
    for (const raw of Array.from(dirtyFieldNames)) {
      const base = String(raw ?? "").split(".")[0] ?? "";
      if (!base) continue;
      const ck = canonicalizePrefixedKey(base);
      if (ck && (ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) touched.add(ck.toLowerCase());
      if (base.toLowerCase().includes("__")) {
        const tail = base.toLowerCase().split("__").pop() ?? "";
        const tailCanon = canonicalizePrefixedKey(tail);
        if (tailCanon && (tailCanon.startsWith("insured_") || tailCanon.startsWith("contactinfo_"))) {
          touched.add(tailCanon.toLowerCase());
        }
      }
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(normalized ?? {})) {
    const kk = String(k ?? "").toLowerCase();
    if (!kk) continue;
    if (v === null) out[kk] = null;
    else if (touched.size > 0 && touched.has(kk)) out[kk] = v;
  }
  return out;
}

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("OK:", name);
  }
}

function run() {
  const baseline = {
    contactinfo_tel: "88888888",
    contactinfo_email: "a@b.com",
    insured_companyname: "ACME",
  };

  // 1) Field missing from form values (not rendered on this step) must NOT count as delete
  {
    const values = {
      // tel is missing entirely
      contactinfo__email: "a@b.com",
      insured__companyname: "ACME",
    };
    const del = computeBaselineDeletes(baseline, values);
    assert("missing field does not delete tel", !Object.prototype.hasOwnProperty.call(del, "contactinfo_tel"));
  }

  // 2) Field present but cleared => should be delete
  {
    const values = {
      contactinfo__tel: "",
      contactinfo__email: "a@b.com",
      insured__companyname: "ACME",
    };
    const del = computeBaselineDeletes(baseline, values);
    assert("cleared field deletes tel", del.contactinfo_tel === null);
  }

  // 3) Field present and unchanged => no delete
  {
    const values = {
      contactinfo__tel: "88888888",
      contactinfo__email: "a@b.com",
      insured__companyname: "ACME",
    };
    const del = computeBaselineDeletes(baseline, values);
    assert("unchanged field does not delete tel", !Object.prototype.hasOwnProperty.call(del, "contactinfo_tel"));
  }

  // 4) Multiple variants present: one empty one value => should NOT be delete
  {
    const values = {
      contactinfo__tel: "",
      contactinfo_tel: "88888888",
    };
    const del = computeBaselineDeletes(baseline, values);
    assert("value variant prevents delete", !Object.prototype.hasOwnProperty.call(del, "contactinfo_tel"));
  }

  // 5) Even if normalized contains many prefilled values, when nothing is dirty it must filter to empty (no popup).
  {
    const normalized = {
      contactinfo_tel: "88888888",
      contactinfo_email: "a@b.com",
      insured_companyname: "ACME",
    };
    const filtered = filterClientUpdatePayload(normalized, new Set());
    assert("prefilled values do not count as changes", Object.keys(filtered).length === 0);
  }

  // 6) Dirty field should be included.
  {
    const normalized = { contactinfo_tel: "77777777", contactinfo_email: "a@b.com" };
    const dirty = new Set(["contactinfo__tel"]);
    const filtered = filterClientUpdatePayload(normalized, dirty);
    assert("dirty field included", filtered.contactinfo_tel === "77777777");
    assert("non-dirty field excluded", !Object.prototype.hasOwnProperty.call(filtered, "contactinfo_email"));
  }
}

run();

