// Generates the Android copy of the About / Terms text from the web source of truth.
//   node tools/gen_android_legal.js
const fs = require('fs');
const path = require('path');
const L = require('../js/legal-content.js');
const OUT = process.env.ANDROID_LEGAL_OUT ||
  'E:\\RelayControlApp\\app\\src\\main\\java\\com\\example\\narismartrelay\\LegalContent.kt';

const k = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n') + '"';
const list = a => 'listOf(' + (a || []).map(k).join(',\n            ') + ')';
const section = s => `        Section(\n            title = ${k(s.title)},\n            paras = ${list(s.paras)},\n            bullets = ${list(s.bullets)}\n        )`;
const doc = (d, extra) => `Doc(\n        title = ${k(d.title)},\n        intro = ${list(d.intro || (d.tagline ? [d.tagline] : []))},\n        sections = listOf(\n${d.sections.map(section).join(',\n')}\n        ),\n        footer = ${k(d.footer)}\n    )`;

const kt = `package com.example.narismartrelay

/**
 * GENERATED FILE - do not edit by hand.
 * Source of truth: NARI-switch/js/legal-content.js
 * Regenerate with:  node tools/gen_android_legal.js
 */
object LegalContent {
    data class Section(val title: String, val paras: List<String>, val bullets: List<String>)
    data class Doc(val title: String, val intro: List<String>, val sections: List<Section>, val footer: String)

    const val TERMS_VERSION = ${k(L.termsVersion)}
    const val TERMS_UPDATED = ${k(L.termsUpdated)}
    const val COMPANY = ${k(L.company)}
    const val MADE_IN_INDIA = ${L.madeInIndia ? "true" : "false"}
    const val WEBSITE = ${k(L.website)}
    const val PRIVACY_URL = ${k(L.privacyUrl)}

    val about: Doc = ${doc(L.about)}

    val terms: Doc = ${doc(L.terms)}
}
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, kt, 'utf8');
console.log('Wrote', OUT, kt.length, 'chars');

